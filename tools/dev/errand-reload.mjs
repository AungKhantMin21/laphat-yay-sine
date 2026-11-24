// M3: a reload mid-errand keeps the shopping. Walks to the wet market, buys a pack to carry and
// one to deliver, screenshots the parcel in hand, saves, reloads and compares. The player isn't
// saved and wakes up in the shop, so the carried pack is put away at once: it must be on the shelf
// (tea +1 pack of 50), the delivery still on its way, money and today's market rows unchanged.
// Usage: npm run dev, then node tools/dev/errand-reload.mjs http://localhost:5173/games/laphat-yay-sine/ [shot.png]
import { chromium } from 'playwright-core';

const [url, shot] = process.argv.slice(2);
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
    return JSON.stringify({ money: s.money, carry: s.carry, deliveries: s.deliveries, stock: s.stock, market: s.market[0].map((r) => r.qty) });
  });

await p.goto(url);
await ready();
await p.evaluate(() => window.__game.bridge.act({ k: 'visit', shop: 0 }));
await p.waitForSelector('.shop-panel:not(.hidden)', { timeout: 60000 });
const bought = await p.evaluate(async () => {
  const br = window.__game.bridge;
  const a = (x) => br.act(x);
  const r1 = await a({ k: 'buy', shop: 0, item: 0, qty: 1 });
  const r2 = await a({ k: 'buy', shop: 0, item: 1, qty: 1, deliver: true });
  return [r1.ok, r2.ok];
});
await p.waitForTimeout(400);
if (shot) await p.screenshot({ path: shot });
const before = await snap();
await p.evaluate(() => window.__game.bridge.save('manual'));
await p.waitForTimeout(500);
await p.reload();
await ready();
const after = await snap();
const B = JSON.parse(before);
const A = JSON.parse(after);
const kept =
  A.money === B.money &&
  JSON.stringify(A.deliveries) === JSON.stringify(B.deliveries) &&
  JSON.stringify(A.market) === JSON.stringify(B.market) &&
  A.carry.length === 0 &&
  A.stock[0] === B.stock[0] + 50 * B.carry[0].qty; // a tea pack holds 50 portions (ingredients.json)
console.log(JSON.stringify({ bought, before: B, after: A, kept }));
console.log(errs.length ? errs.join('\n') : 'no errors');
await b.close();
