/*
 * Serves the static export in out/ with the rewrites and headers from
 * vercel.json, so local end-to-end tests see the routing of the deployment.
 *
 * Usage: node scripts/serve-out.mjs        (PORT, default 3100)
 * File resolution follows Vercel's cleanUrls: <path>, <path>.html, <path>/index.html.
 * Unknown paths get out/404.html with status 404.
 */
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'out');
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
const port = Number(process.env.PORT ?? 3100);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/** Compiles a Vercel source pattern (`:name`, `:name*`) to an anchored RegExp. */
function compile(pattern) {
  const body = pattern
    .split('/')
    .map((part) => {
      if (/^:\w+\*$/.test(part)) return '.*';
      if (/^:\w+$/.test(part)) return '[^/]+';
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return new RegExp(`^${body}$`);
}

const rewrites = (vercel.rewrites ?? []).map((r) => ({ test: compile(r.source), destination: r.destination }));
const headerRules = (vercel.headers ?? []).map((h) => ({ test: compile(h.source), headers: h.headers }));

/** Returns the file under out/ for a URL path, or null. Paths outside out/ are rejected. */
function resolveFile(urlPath) {
  const base = normalize(join(outDir, urlPath));
  if (base !== outDir && !base.startsWith(outDir + sep)) return null;
  for (const candidate of [base, `${base}.html`, join(base, 'index.html')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
    }
  }
  return null;
}

function send(res, status, file, extraHeaders) {
  res.writeHead(status, {
    'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    ...extraHeaders,
  });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  const headers = {};
  for (const rule of headerRules) {
    if (rule.test.test(urlPath)) for (const { key, value } of rule.headers) headers[key] = value;
  }
  const direct = resolveFile(urlPath);
  const rewrite = direct ? null : rewrites.find((r) => r.test.test(urlPath));
  const file = direct ?? (rewrite ? resolveFile(rewrite.destination) : null);
  if (file) {
    send(res, 200, file, headers);
    return;
  }
  const notFound = resolveFile('/404');
  if (notFound) send(res, 404, notFound, headers);
  else res.writeHead(404).end('Not found');
});

server.on('error', (err) => {
  console.error(`serve-out: ${err.message}`);
  process.exit(1);
});
server.listen(port, () => {
  console.error(`serve-out: http://localhost:${port}`);
});
