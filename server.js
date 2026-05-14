const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".vcf": "text/vcard; charset=utf-8"
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function safeId(raw) {
  return String(raw || "").replace(/[^a-z0-9-]/gi, "").slice(0, 64);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  // POST /api/contact — receive contact JSON, write VCF to disk
  if (req.method === "POST" && url.pathname === "/api/contact") {
    try {
      const body = await readBody(req);
      const contact = JSON.parse(body);
      const id = safeId(contact.id);
      if (!id || !contact.vcf) return send(res, 400, "Bad request");
      fs.writeFileSync(path.join(DATA_DIR, `${id}.vcf`), contact.vcf, "utf8");
      send(res, 200, JSON.stringify({ ok: true }), {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      });
    } catch {
      send(res, 500, "Server error");
    }
    return;
  }

  // GET /c/:id — serve VCF for mobile to trigger "Save Contact"
  const vcfMatch = url.pathname.match(/^\/c\/([a-z0-9-]+)$/i);
  if (vcfMatch) {
    const id = safeId(vcfMatch[1]);
    const vcfPath = path.join(DATA_DIR, `${id}.vcf`);
    try {
      const data = fs.readFileSync(vcfPath, "utf8");
      send(res, 200, data, {
        "Content-Type": "text/vcard; charset=utf-8",
        "Content-Disposition": `attachment; filename="${id}.vcf"`,
        "Cache-Control": "no-store"
      });
    } catch {
      send(res, 404, "Contact not found");
    }
    return;
  }

  // Static file fallback
  let filePath = path.join(ROOT, url.pathname === "/" ? "index.html" : url.pathname);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(ROOT)) return send(res, 404, "Not found");
  fs.readFile(filePath, (error, data) => {
    if (error) return send(res, 404, "Not found");
    send(res, 200, data, {
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
  });
}).listen(PORT, () => {
  console.log(`Contact Saver running at http://localhost:${PORT}`);
});
