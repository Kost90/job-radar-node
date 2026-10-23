import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { zipSync } from 'fflate';

const FILES = ['index.mjs', 'index.mjs.map'];

// Fixed metadata: the same build gives byte-identical zip, so the deploy hash
// changes only when the code changes.
const entry = (file) => [
  readFileSync(`dist/${file}`),
  {
    mtime: new Date('2000-01-01T00:00:00Z'),
    os: 3, // Unix
    attrs: 0o100644 * 2 ** 16, // regular file, rw-r--r--: Lambda must be able to read it
  },
];

rmSync('function.zip', { force: true });
const zip = zipSync(Object.fromEntries(FILES.map((f) => [f, entry(f)])), {
  level: 9,
});
writeFileSync('function.zip', zip);
console.log(`function.zip: ${(zip.length / 1024).toFixed(1)} KiB`);
