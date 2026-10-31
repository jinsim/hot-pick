import { writeFile } from 'node:fs/promises';
const url = 'https://books.toscrape.com/';
const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error', headers: { 'User-Agent': 'hot-pick-example/0.2' } });
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const chunks = []; let size = 0;
for await (const chunk of response.body) {
  size += chunk.length;
  if (size > 2 * 1024 * 1024) throw new Error('Unexpected response size');
  chunks.push(chunk);
}
await writeFile(new URL('./books.html', import.meta.url), Buffer.concat(chunks));
console.log(`Fetched ${size} bytes from ${url} with TLS verification enabled`);
