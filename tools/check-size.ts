// Fails if the first download (everything in dist/ except music) is over the 3 MB budget.
// Usage: node tools/check-size.ts dist
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const BUDGET = 3 * 1024 * 1024;
const MUSIC = new Set(['.ogg', '.m4a']);

const dir = process.argv[2] ?? 'dist';
let total = 0;
let music = 0;
const sizes: Array<[string, number]> = [];

function walk(path: string): void {
  for (const name of readdirSync(path)) {
    const full = join(path, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
    } else if (MUSIC.has(extname(name))) {
      music += st.size;
    } else {
      total += st.size;
      sizes.push([full, st.size]);
    }
  }
}

walk(dir);
sizes.sort((a, b) => b[1] - a[1]);
const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;
for (const [file, size] of sizes.slice(0, 8)) console.log(`${kb(size).padStart(10)}  ${file}`);
console.log(`First download: ${kb(total)} of ${kb(BUDGET)} budget (music, lazy: ${kb(music)})`);
if (total > BUDGET) {
  console.error('Over the 3 MB first-download budget.');
  process.exit(1);
}
