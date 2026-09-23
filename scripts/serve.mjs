#!/usr/bin/env node
/**
 * Static server with clean URLs:
 * / → index.html
 * /blog/ → blog/index.html
 * /blog/post-slug/ → blog/post-slug/index.html
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 5173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function resolve(urlPath) {
  let raw = decodeURIComponent(urlPath.split("?")[0].split("#")[0] || "/");
  if (raw === "/index.html" || raw === "/index") return { redirect: "/" };
  if (raw === "/blog/index.html" || raw === "/blog/index") return { redirect: "/blog/" };

  if (raw.length > 1 && raw.endsWith("/")) {
    const dirIndex = path.join(root, raw, "index.html");
    if (fs.existsSync(dirIndex)) return { file: dirIndex };
  }

  const candidate = path.normalize(path.join(root, raw === "/" ? "index.html" : raw));
  if (!candidate.startsWith(root)) return { status: 403 };

  if (fs.existsSync(candidate)) {
    const stat = fs.statSync(candidate);
    if (stat.isFile()) return { file: candidate };
    if (stat.isDirectory()) {
      const idx = path.join(candidate, "index.html");
      if (fs.existsSync(idx)) {
        if (!raw.endsWith("/")) return { redirect: `${raw}/` };
        return { file: idx };
      }
    }
  }

  const asHtml = `${candidate}.html`;
  if (fs.existsSync(asHtml)) return { file: asHtml };

  const asIndex = path.join(candidate, "index.html");
  if (fs.existsSync(asIndex)) {
    if (!raw.endsWith("/")) return { redirect: `${raw}/` };
    return { file: asIndex };
  }

  return { status: 404 };
}

http
  .createServer((req, res) => {
    const result = resolve(req.url || "/");
    if (result.redirect) {
      res.writeHead(301, { Location: result.redirect, "Cache-Control": "no-cache" });
      return res.end();
    }
    if (result.status) {
      res.writeHead(result.status);
      return res.end(result.status === 403 ? "forbidden" : "not found");
    }
    fs.readFile(result.file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end("not found");
      }
      const ext = path.extname(result.file);
      res.writeHead(200, {
        "Content-Type": types[ext] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(data);
    });
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`serving http://127.0.0.1:${port}`);
  });
