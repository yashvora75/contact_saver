const router = require("express").Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../db");

function makeToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: "90d" });
}

// POST /api/auth/signup
router.post("/signup", async (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = (req.body.password || "").trim();

  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

  try {
    const exists = await db.query("SELECT id FROM users WHERE email = $1", [email]);
    if (exists.rows.length) return res.status(409).json({ error: "An account with that email already exists." });

    const password_hash = await bcrypt.hash(password, 12);
    const result = await db.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email",
      [email, password_hash]
    );
    const user = result.rows[0];
    res.json({ token: makeToken(user), email: user.email });
  } catch (err) {
    console.error("Signup error:", err.message);
    res.status(500).json({ error: "Could not create account. Try again." });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = (req.body.password || "").trim();

  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

  try {
    const result = await db.query("SELECT id, email, password_hash FROM users WHERE email = $1", [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: "No account found with that email." });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: "Incorrect password." });

    res.json({ token: makeToken(user), email: user.email });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Login failed. Try again." });
  }
});

module.exports = router;
