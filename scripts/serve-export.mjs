// Local UI test server, not a production backend. Mirrors Pages' extensionless export routes.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { URL } from "node:url";

const root = resolve("out");
const port = Number(process.env.CRM_PREVIEW_PORT || 8788);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };
createServer(async (request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405).end(); return; }
  let path;
  try { path = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
  catch { response.writeHead(400).end(); return; }
  if (path.startsWith("/clients/") && path !== "/clients/") path = path.endsWith(".txt") ? "/clients/placeholder.txt" : "/clients/placeholder";
  const candidates = path === "/" ? ["index.html"] : [path.slice(1), path.slice(1) + ".html", path.slice(1) + "/index.html"];
  for (const candidate of candidates) {
    const file = resolve(root, candidate);
    if (!file.startsWith(root + sep)) continue;
    try {
      const data = await readFile(file);
      response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : data); return;
    } catch { /* Try the next export path. */ }
  }
  response.writeHead(404).end("Not found");
}).listen(port, "127.0.0.1", () => console.log("UI export preview: http://127.0.0.1:" + port));
