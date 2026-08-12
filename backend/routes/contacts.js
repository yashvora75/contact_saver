const router = require("express").Router();
const db = require("../db");
const requireAuth = require("../middleware/auth");

// GET /api/contacts — fetch all contacts + deleted for the logged-in user
router.get("/", requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      "SELECT id, data, deleted_at, updated_at FROM contacts WHERE user_id = $1 ORDER BY updated_at DESC",
      [req.user.id]
    );

    const contacts = [];
    const deleted = [];

    for (const row of result.rows) {
      const entry = { ...row.data, id: row.id, updatedAt: row.updated_at, deletedAt: row.deleted_at || "" };
      if (row.deleted_at) {
        deleted.push(entry);
      } else {
        contacts.push(entry);
      }
    }

    res.json({ contacts, deleted });
  } catch (err) {
    console.error("Fetch contacts error:", err.message);
    res.status(500).json({ error: "Could not load contacts." });
  }
});

// PUT /api/contacts — sync full state (upsert all contacts + deleted)
router.put("/", requireAuth, async (req, res) => {
  const contacts = Array.isArray(req.body.contacts) ? req.body.contacts : [];
  const deleted = Array.isArray(req.body.deleted) ? req.body.deleted : [];
  const all = [
    ...contacts.map(c => ({ ...c, deletedAt: null })),
    ...deleted.map(c => ({ ...c, deletedAt: c.deletedAt || new Date().toISOString() }))
  ];

  if (!all.length) return res.json({ ok: true });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const contact of all) {
      const { id, deletedAt, updatedAt, ...rest } = contact;
      if (!id) continue;
      await client.query(
        `INSERT INTO contacts (id, user_id, data, deleted_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           data = EXCLUDED.data,
           deleted_at = EXCLUDED.deleted_at,
           updated_at = EXCLUDED.updated_at`,
        [
          id,
          req.user.id,
          JSON.stringify(rest),
          deletedAt || null,
          updatedAt || new Date().toISOString()
        ]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Sync contacts error:", err.message);
    res.status(500).json({ error: "Could not save contacts." });
  } finally {
    client.release();
  }
});

// DELETE /api/contacts/:id — permanently delete one contact
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    await db.query(
      "DELETE FROM contacts WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete contact error:", err.message);
    res.status(500).json({ error: "Could not delete contact." });
  }
});

module.exports = router;
