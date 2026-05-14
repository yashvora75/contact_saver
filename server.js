const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let filePath = path.join(ROOT, url.pathname === "/" ? "index.html" : url.pathname);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(ROOT)) {
    return send(res, 404, "Not found");
  }
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
