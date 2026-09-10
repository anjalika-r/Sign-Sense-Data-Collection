// Local Sign Sense server: serves the app and saves each approved capture immediately.
const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const root = __dirname;
const sessionsRoot = path.join(root, "sessions");
const port = Number(process.env.SIGN_SENSE_PORT || 8001);
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".jpg": "image/jpeg", ".webm": "video/webm" };
const safePart = (value) => /^[a-z0-9_-]+$/i.test(value) ? value : null;
const send = (res, status, body, type = "application/json; charset=utf-8") => { res.writeHead(status, { "Content-Type": type }); res.end(body); };
const body = (req) => new Promise((resolve, reject) => { const chunks = []; req.on("data", (chunk) => chunks.push(chunk)); req.on("end", () => resolve(Buffer.concat(chunks))); req.on("error", reject); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  try {
    if (parts[0] === "api" && parts[1] === "sessions" && safePart(parts[2])) {
      const session = path.join(sessionsRoot, parts[2]);
      if (parts[3] === "state" && req.method === "GET") {
        try { return send(res, 200, await fsp.readFile(path.join(session, "session_state.json"))); } catch { return send(res, 200, JSON.stringify({ taskIndex: 0, saved: [] })); }
      }
      if (parts[3] === "state" && req.method === "PUT") {
        await fsp.mkdir(session, { recursive: true }); await fsp.writeFile(path.join(session, "session_state.json"), await body(req)); return send(res, 204, "");
      }
      if (parts[3] === "file" && req.method === "PUT" && parts[4]) {
        const relative = parts.slice(4).join("/");
        const target = path.resolve(session, relative);
        if (!target.startsWith(session + path.sep)) return send(res, 400, JSON.stringify({ error: "Invalid path" }));
        await fsp.mkdir(path.dirname(target), { recursive: true }); await fsp.writeFile(target, await body(req)); return send(res, 204, "");
      }
      if (parts[3] === "file" && req.method === "GET" && parts[4]) {
        const relative = parts.slice(4).join("/");
        const target = path.resolve(session, relative);
        if (!target.startsWith(session + path.sep) || !fs.existsSync(target)) return send(res, 404, "Not found", "text/plain");
        return send(res, 200, await fsp.readFile(target), mime[path.extname(target)] || "application/octet-stream");
      }
    }
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const target = path.resolve(root, requested);
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return send(res, 404, "Not found", "text/plain");
    return send(res, 200, await fsp.readFile(target), mime[path.extname(target)] || "application/octet-stream");
  } catch (error) { console.error(error); return send(res, 500, JSON.stringify({ error: "Could not save session data." })); }
}).listen(port, () => console.log(`Sign Sense running at http://localhost:${port}`));
