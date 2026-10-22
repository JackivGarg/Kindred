import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const entry = Object.entries(manifest).find(([, value]) => value.isEntry);
assert(entry, 'Build the application before checking its bundle.');
const visited = new Set();
const files = new Set();
function collect(key) {
  if (visited.has(key)) return;
  visited.add(key);
  const chunk = manifest[key];
  if (!chunk) return;
  if (chunk.file.endsWith('.js')) files.add(chunk.file);
  for (const dependency of chunk.imports ?? []) collect(dependency);
}
collect(entry[0]);
let totalBytes = 0;
let compressedBytes = 0;
for (const file of files) {
  const content = await readFile(`dist/${file}`);
  const gzipBytes = gzipSync(content).byteLength;
  totalBytes += content.byteLength;
  compressedBytes += gzipBytes;
  console.log(`${file}: ${content.byteLength} bytes; ${gzipBytes} gzip bytes`);
}
console.log(
  `Initial JavaScript: ${totalBytes} bytes; ${compressedBytes} gzip bytes across ${files.size} cacheable files.`,
);
// Includes all initial static dependencies, not just the smaller entry file.
assert(totalBytes <= 550_000, 'Initial JavaScript exceeds the 550 KB budget.');
assert(compressedBytes <= 175_000, 'Initial compressed JavaScript exceeds the 175 KB budget.');
