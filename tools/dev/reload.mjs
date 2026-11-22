// Reload mid-day keeps the day: opens the start shop on the dev server, lets the autoplayer serve
// two cups, reloads straight after the payment and compares money, day, phase and
// today's stats. Customers are not saved, so the shop reopens empty (by design).
// Usage: npm run dev, then node tools/dev/reload.mjs http://localhost:5173/games/laphat-yay-sine/
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [url] = process.argv.slice(2);
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1100, height: 600 } });
const errs = [];
p.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));

const ready = async () => {
  await p.waitForFunction(() => window.__game?.bridge?.player, null, { timeout: 30000 });
  await p.waitForTimeout(500);
};
const snap = () =>
  p.evaluate(() => {
    const s = window.__game.bridge.player;
    const t = s.today;
    return JSON.stringify({ money: s.money, day: window.__game.view.day, phase: s.phase, served: t.served, poured: t.poured, earned: t.earned, tips: t.tips, best: t.best, hour: Math.floor(window.__game.view.gameMinute / 60) });
  });

await p.goto(url);
await ready();
// M2.5: the start shop has 8 seats; the autoplayer (tools/dev/autoplay.js) serves like a player.
await p.addScriptTag({ content: readFileSync('tools/dev/autoplay.js', 'utf8') });
await p.evaluate(async () => {
  await window.__game.bridge.act({ k: 'openShop' });
  window.__autoplay.start();
});
// Wait for two payments (customers arrive at random; each cup is ordered, poured and carried).
await p.waitForFunction(() => window.__game.bridge.player.today.served >= 2, null, { timeout: 240000, polling: 200 });
const before = await snap(); // an hourly autosave may also have run before the reload
await p.reload();
await ready();
const after = await snap();
console.log(JSON.stringify({ before: JSON.parse(before), after: JSON.parse(after), same: before === after }));
console.log(errs.length ? errs.join('\n') : 'no errors');
await b.close();
