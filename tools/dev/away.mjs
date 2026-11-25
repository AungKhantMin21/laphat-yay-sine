// M4: coming back after days away, through the real boot path. In a throwaway browser profile:
// 1) start a game and save it, close the browser; 2) move the save's time 3 days into the past
// (IndexedDB, from a same-origin page that doesn't start the game), close; 3) open the game: the
// worker must catch up 3 days, show the "while you were away" card and land on day + 3 with the
// same money (no staff, so no wages and no sales).
// Usage: npm run dev, then node tools/dev/away.mjs http://localhost:5173/games/laphat-yay-sine/ [shot.png]
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const [url, shot] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), 'lys-away-'));
const errs = [];
const open = async () => {
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    viewport: { width: 1100, height: 600 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  return { ctx, page };
};
const ready = (p) => p.waitForFunction(() => window.__game?.bridge?.player, null, { timeout: 30000 });

// 1) A game, saved.
let { ctx, page } = await open();
await page.goto(url);
await ready(page);
const before = await page.evaluate(() => ({ day: window.__game.bridge.player.day, money: window.__game.bridge.player.money }));
await page.evaluate(() => window.__game.bridge.save('manual'));
await page.waitForTimeout(1500);
await ctx.close();

// 2) Three days and a minute ago (savedAt = f64 at byte 12 of the save).
({ ctx, page } = await open());
await page.goto(new URL('@vite/client', url).href);
const moved = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const req = indexedDB.open('laphat');
      req.onsuccess = () => {
        const tx = req.result.transaction('saves', 'readwrite');
        const st = tx.objectStore('saves');
        const g = st.get('slot0');
        g.onsuccess = () => {
          const buf = g.result;
          new DataView(buf).setFloat64(12, Date.now() - 3 * 86_400_000 - 60_000, true);
          st.put(buf, 'slot0');
          tx.oncomplete = () => resolve(true);
        };
        g.onerror = () => resolve(false);
      };
      req.onerror = () => resolve(false);
    }),
);
await ctx.close();

// 3) Back again.
({ ctx, page } = await open());
await page.goto(url);
await ready(page);
const shown = await page.waitForSelector('.away:not(.hidden) .hud-btn:not(.hidden)', { timeout: 30000 }).then(
  () => true,
  () => false,
);
const card = await page.evaluate(() => [...document.querySelectorAll('.away .away-title, .away .away-line')].map((e) => e.textContent));
const after = await page.evaluate(() => ({ day: window.__game.bridge.player.day, money: window.__game.bridge.player.money, phase: window.__game.bridge.player.phase }));
if (shot) await page.screenshot({ path: shot });
await ctx.close();
rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify({ moved, shown, before, after, card, ok: moved && shown && after.day === before.day + 3 && after.money === before.money }));
console.log(errs.length ? errs.join('\n') : 'no errors');
