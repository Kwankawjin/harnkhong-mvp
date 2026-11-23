// Production static server for the built app (dist/). No dependencies, so it
// still runs after `npm prune --omit=dev`. Listens on 127.0.0.1:$PORT behind
// nginx and falls back to index.html for client-side routes like /admin.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const port = Number(process.env.PORT) || 3100;
const host = process.env.HOST || "127.0.0.1";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

async function resolveFile(urlPath) {
  let path;
  try {
    path = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  const file = normalize(join(root, path));
  if (file !== root && !file.startsWith(root + sep)) return null;
  try {
    const info = await stat(file);
    if (info.isFile()) return file;
    if (info.isDirectory()) {
      const index = join(file, "index.html");
      if ((await stat(index)).isFile()) return index;
    }
  } catch {}
  return null;
}

createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  try {
    let file = await resolveFile(req.url || "/");
    // Unknown paths without an extension are app routes (SPA fallback).
    if (!file && !extname((req.url || "/").split("?")[0])) file = join(root, "index.html");
    if (!file) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    const body = await readFile(file);
    const isAsset = file.startsWith(join(root, "assets") + sep);
    res.writeHead(200, {
      "Content-Type": types[extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end("Server error");
  }
}).listen(port, host, () => {
  console.log(`harnkhong serving ${root} on http://${host}:${port}`);
});
