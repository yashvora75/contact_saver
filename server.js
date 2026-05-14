const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "contacts.json");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const seedContacts = [
  {
    id: "demo-001",
    slug: "aanya-shah",
    fullName: "Aanya Shah",
    role: "Founder",
    company: "Brill Brains Consulting",
    phone: "+91 98765 43210",
    email: "aanya@brillbrains.example",
    website: "https://brillbrains.example",
    address: "Mumbai, Maharashtra, India",
    notes: "Business strategy, operations, and growth systems.",
    photoUrl: "",
    brandColor: "#1266F1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

function ensureDataFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(seedContacts, null, 2));
  }
}

function readContacts() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeContacts(contacts) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(contacts, null, 2));
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function cleanText(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

function slugify(value) {
  const slug = cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "contact";
}

function uniqueSlug(base, contacts, currentId) {
  const root = slugify(base);
  let candidate = root;
  let index = 2;
  while (contacts.some(contact => contact.slug === candidate && contact.id !== currentId)) {
    candidate = `${root}-${index++}`;
  }
  return candidate;
}

function normalizeContact(input, contacts, existing = {}) {
  const now = new Date().toISOString();
  const id = existing.id || crypto.randomUUID();
  const fullName = cleanText(input.fullName || existing.fullName);
  const company = cleanText(input.company || existing.company);
  const requestedSlug = input.slug ? cleanText(input.slug) : fullName || company || id.slice(0, 8);

  if (!fullName) {
    const error = new Error("Full name is required");
    error.status = 400;
    throw error;
  }

  return {
    id,
    slug: uniqueSlug(requestedSlug, contacts, id),
    fullName,
    role: cleanText(input.role),
    company,
    phone: cleanText(input.phone),
    email: cleanText(input.email).toLowerCase(),
    website: cleanText(input.website),
    address: cleanText(input.address),
    notes: cleanText(input.notes),
    photoUrl: cleanText(input.photoUrl),
    brandColor: /^#[0-9a-fA-F]{6}$/.test(input.brandColor || "") ? input.brandColor : "#1266F1",
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

function escapeVCard(value) {
  return cleanText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function vcardFor(contact, origin) {
  const names = contact.fullName.split(/\s+/);
  const lastName = names.length > 1 ? names[names.length - 1] : "";
  const firstName = names.length > 1 ? names.slice(0, -1).join(" ") : contact.fullName;
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escapeVCard(lastName)};${escapeVCard(firstName)};;;`,
    `FN:${escapeVCard(contact.fullName)}`
  ];

  if (contact.company) lines.push(`ORG:${escapeVCard(contact.company)}`);
  if (contact.role) lines.push(`TITLE:${escapeVCard(contact.role)}`);
  if (contact.phone) lines.push(`TEL;TYPE=CELL:${escapeVCard(contact.phone)}`);
  if (contact.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVCard(contact.email)}`);
  if (contact.website) lines.push(`URL:${escapeVCard(contact.website)}`);
  if (contact.address) lines.push(`ADR;TYPE=WORK:;;${escapeVCard(contact.address)};;;;`);
  if (contact.notes) lines.push(`NOTE:${escapeVCard(contact.notes)}`);
  lines.push(`SOURCE:${origin}/card/${encodeURIComponent(contact.slug)}`);
  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

function publicContact(contact) {
  return { ...contact };
}

function serveStatic(res, filePath) {
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(PUBLIC_DIR)) {
    return notFound(res);
  }
  fs.readFile(normalized, (err, data) => {
    if (err) return notFound(res);
    const ext = path.extname(normalized).toLowerCase();
    send(res, 200, data, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600"
    });
  });
}

function originFor(req) {
  const host = req.headers.host || `localhost:${PORT}`;
  return `http://${host}`;
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/contacts") {
    return sendJson(res, 200, readContacts().map(publicContact));
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/contacts/")) {
    const slug = decodeURIComponent(url.pathname.split("/").pop());
    const contact = readContacts().find(item => item.slug === slug || item.id === slug);
    return contact ? sendJson(res, 200, publicContact(contact)) : notFound(res);
  }

  if (req.method === "POST" && url.pathname === "/api/contacts") {
    try {
      const input = JSON.parse(await readBody(req) || "{}");
      const contacts = readContacts();
      const existing = input.id ? contacts.find(item => item.id === input.id) : null;
      const contact = normalizeContact(input, contacts, existing || {});
      const nextContacts = existing
        ? contacts.map(item => item.id === contact.id ? contact : item)
        : [contact, ...contacts];
      writeContacts(nextContacts);
      return sendJson(res, existing ? 200 : 201, publicContact(contact));
    } catch (error) {
      return sendJson(res, error.status || 400, { error: error.message || "Invalid contact" });
    }
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/contacts/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const contacts = readContacts();
    const nextContacts = contacts.filter(contact => contact.id !== id);
    writeContacts(nextContacts);
    return sendJson(res, 200, { ok: true, deleted: contacts.length - nextContacts.length });
  }

  return notFound(res);
}

async function router(req, res) {
  const url = new URL(req.url, originFor(req));

  if (url.pathname.startsWith("/api/")) {
    return handleApi(req, res, url);
  }

  if (req.method === "GET" && url.pathname.startsWith("/vcf/")) {
    const slug = decodeURIComponent(path.basename(url.pathname, ".vcf"));
    const contact = readContacts().find(item => item.slug === slug || item.id === slug);
    if (!contact) return notFound(res);
    const body = vcardFor(contact, originFor(req));
    const fileName = `${contact.slug}.vcf`;
    return send(res, 200, body, {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "no-store"
    });
  }

  if (req.method === "GET" && url.pathname.startsWith("/card/")) {
    return serveStatic(res, path.join(PUBLIC_DIR, "card.html"));
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return serveStatic(res, path.join(PUBLIC_DIR, "index.html"));
  }

  if (req.method === "GET") {
    return serveStatic(res, path.join(PUBLIC_DIR, url.pathname));
  }

  return notFound(res);
}

ensureDataFile();

const server = http.createServer((req, res) => {
  router(req, res).catch(error => {
    console.error(error);
    sendJson(res, 500, { error: "Server error" });
  });
});

server.listen(PORT, () => {
  console.log(`Contact Saver running at http://localhost:${PORT}`);
});
