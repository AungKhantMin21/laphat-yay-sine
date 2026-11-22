// Dev-only browser probe: opens the game in system Chrome, waits for the worker, evaluates a JS
// expression (dev server exposes window.__game), optionally screenshots, and reports page errors.
// Usage: node tools/dev/probe.mjs <url> [screenshot.png] [js-expression-or-@file.js]
// Example: npm run dev  (port 5173)  then
//   node tools/dev/probe.mjs http://localhost:5173/games/laphat-yay-sine/ shot.png @tools/dev/furnish150.js
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [url, shot, exprArg] = process.argv.slice(2);
// @a.js,b.js loads several files in order (e.g. tools/dev/autoplay.js before a probe script).
const expr = exprArg?.startsWith('@') ? exprArg.slice(1).split(',').map((f) => readFileSync(f, 'utf8')).join('\n') : exprArg;
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1100, height: 600 } });
const errs = [];
p.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
p.on('console', (m) => {
  if (m.type() === 'error' && !/404/.test(m.text())) errs.push(m.text());
});
await p.goto(url);
await p.waitForFunction(() => window.__game?.bridge?.player, null, { timeout: 20000 });
await p.waitForTimeout(800);
if (expr) console.log(await p.evaluate(expr));
if (shot) await p.screenshot({ path: shot });
console.log(errs.length ? errs.join('\n') : 'no errors');
await b.close();
