import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPublicSnapshot, snapshotIdentity } from './snapshot.mjs';

const catalogCache = 'public, max-age=300, must-revalidate, no-transform';
const contentType = 'application/json; charset=utf-8';

function matchesETag(header, etag) {
  if (typeof header !== 'string') return false;
  if (header.trim() === '*') return true;
  // A comma can be part of a quoted opaque tag. GET/HEAD use weak comparison.
  const tag = /(?:^|,)[ \t]*(?:W\/)?"([\x21\x23-\x7e\x80-\xff]*)"[ \t]*(?=,|$)/gy;
  let match;
  while ((match = tag.exec(header))) {
    if (`"${match[1]}"` === etag) return true;
  }
  return false;
}

function snapshotLoader(file) {
  let cached, failed, pending;
  async function load() {
    const identity = snapshotIdentity(await fs.stat(file, { bigint: true }));
    if (cached?.identity === identity) return cached;
    if (failed?.identity === identity && Date.now() < failed.retryAt) throw Error('Snapshot unavailable');
    try {
      const body = await readPublicSnapshot(file, identity);
      const etag = `"sha256-${createHash('sha256').update(body).digest('hex')}"`;
      failed = undefined;
      return (cached = { identity, body, etag });
    } catch (error) {
      cached = undefined;
      failed = { identity, retryAt: Date.now() + 2000 };
      throw error;
    }
  }
  return () => pending ??= load().finally(() => { pending = undefined; });
}

export function createCatalogServer({ catalogFile } = {}) {
  if (!catalogFile) throw Error('CATALOG_FILE is required');
  const load = snapshotLoader(path.resolve(catalogFile));
  return createServer({ headersTimeout: 10000, requestTimeout: 15000 }, async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (status, data) => {
      res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data));
    };
    if (req.url !== '/v1/catalog' && req.url !== '/health') {
      reply(404, { error: 'not_found' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      reply(405, { error: 'method_not_allowed' });
      return;
    }

    let snapshot;
    try {
      snapshot = await load();
    } catch {
      // Filesystem and validation diagnostics can contain private paths or input.
      reply(503, { error: 'catalog_unavailable' });
      return;
    }
    if (req.url === '/health') {
      reply(200, { ok: true });
      return;
    }

    res.setHeader('Cache-Control', catalogCache);
    res.setHeader('ETag', snapshot.etag);
    if (matchesETag(req.headers['if-none-match'], snapshot.etag)) {
      res.writeHead(304).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': snapshot.body.length });
    res.end(req.method === 'HEAD' ? undefined : snapshot.body);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid PORT');
  const server = createCatalogServer({ catalogFile: process.env.CATALOG_FILE });
  server.listen(port, '0.0.0.0', () => console.log(`Catalog HTTP server listening on port ${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}
