// Subsets Noto Sans Myanmar to WOFF2 by whole Unicode ranges, keeping all OpenType layout
// (GSUB/GPOS) so Myanmar shaping works for any text a player types. Never subset by my.json text.
// Needs Python fonttools + brotli: `pip install fonttools brotli`.
// Usage: node tools/subset-font.ts
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

const SRC = 'art/fonts/NotoSansMyanmar-Regular.ttf';
const OUT = 'assets/fonts/NotoSansMyanmar-subset.woff2';

const UNICODES = [
  'U+0000-007F', // Basic Latin (digits, punctuation)
  'U+00A0', // no-break space
  'U+1000-109F', // Myanmar
  'U+AA60-AA7F', // Myanmar Extended-A
  'U+A9E0-A9FF', // Myanmar Extended-B
  'U+200B-200D', // ZWSP, ZWNJ, ZWJ (used in Myanmar text)
  'U+2010-2027', // dashes, quotes, bullet, ellipsis
  'U+2030-205E', // per mille, primes, other common punctuation
  'U+25CC', // dotted circle (shaping fallback for stray marks)
].join(',');

execFileSync(
  'pyftsubset',
  [
    SRC,
    `--unicodes=${UNICODES}`,
    '--layout-features=*', // keep every GSUB/GPOS feature
    '--layout-scripts=*',
    '--glyph-names',
    '--notdef-outline',
    '--no-hinting',
    '--desubroutinize',
    '--name-IDs=*',
    '--flavor=woff2',
    `--output-file=${OUT}`,
  ],
  { stdio: 'inherit' },
);
console.log(`${OUT}: ${(statSync(OUT).size / 1024).toFixed(1)} KB`);
