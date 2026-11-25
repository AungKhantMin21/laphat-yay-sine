// Perf gate on a PRODUCTION build (npm run build && npx vite preview --port 4173).
// Imports a save code through Settings, throttles the CPU, pans, and prints the ?debug=1 overlay.
// Usage: node tools/dev/gate.mjs http://localhost:4173/games/laphat-yay-sine/ code.txt [shotDir] [crowd]
// `crowd` > 0 opens the shop and makes that many customers arrive at once (debug `crowd`), then waits
// for them to walk in and sit before measuring.
// GATE_WALK=1 (M3): instead of panning, the player walks to the farthest shop (the hardware stall)
// while the camera follows, and the overlay is read during the walk.
import { readFileSync } from 'node:fs';
import { chromium, devices } from 'playwright-core';

const [url, codeFile, shotDir, crowdArg] = process.argv.slice(2);
const crowd = Number(crowdArg ?? 0);
const code = codeFile ? readFileSync(codeFile, 'utf8').trim() : '';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false });

async function run(label, ctxOpts, cpu, q, buildMode) {
  const ctx = await b.newContext(ctxOpts);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url + q);
  await p.waitForSelector('.settings-btn');
  await p.waitForTimeout(3500); // tier benchmark + title card
  if (code) {
    await p.click('.settings-btn');
    await p.fill('.settings-box textarea', code);
    const imp = p.locator('.settings-box .hud-btn.danger');
    await imp.click();
    await imp.click(); // second tap confirms
    await p.waitForTimeout(1000);
    await p.click('.settings-box .row .hud-btn:last-child');
  }
  if (crowd > 0) {
    // The player works too: the autoplayer queues jobs and pours (tools/dev/autoplay.js).
    await p.evaluate((noplay) => {
      window.__game = window.__game ?? window.__debug;
      window.__noplay = noplay;
    }, !!process.env.GATE_NOPLAY);
    await p.addScriptTag({ content: readFileSync('tools/dev/autoplay.js', 'utf8') });
    await p.evaluate((n) => {
      const b = window.__debug.bridge;
      void b.act({ k: 'openShop' });
      b.crowd(n);
      if (!window.__noplay) window.__autoplay.start();
    }, crowd);
    await p.waitForTimeout(35000); // walk in from both street edges (~30 s), sit, order
  }
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  if (buildMode) {
    await p.click('.build-toggle');
    await p.selectOption('.heat select', '1');
  }
  await p.waitForTimeout(1500);
  if (process.env.GATE_WALK && !buildMode) {
    await p.evaluate(() => {
      window.__autoplay?.stop?.();
      void window.__debug.bridge.act({ k: 'visit', shop: 3 });
    });
    await p.waitForTimeout(12000); // mid-walk: new chunks stream in as the camera follows
  } else {
    const vw = ctxOpts.viewport?.width ?? 900;
    await p.mouse.move(vw / 2, 250);
    await p.mouse.down();
    for (let i = 0; i < 70; i++) {
      await p.mouse.move(vw / 2 - (i % 35) * 6, 250 - (i % 35) * 3);
      await p.waitForTimeout(45);
    }
    await p.mouse.up();
  }
  const txt = await p.evaluate(() => document.getElementById('perf')?.textContent ?? 'no overlay');
  console.log(`--- ${label} (cpu ${cpu}x)${buildMode ? ' [build + overlay]' : ''}\n${txt}${errs.length ? '\nERRORS: ' + errs.join('; ') : ''}`);
  if (shotDir && shotDir !== '-') await p.screenshot({ path: `${shotDir}/gate-${label.replace(/\W+/g, '_')}${buildMode ? '_build' : ''}.png` });
  await ctx.close();
}

const desk = { viewport: { width: 1280, height: 720 } };
const px7 = { ...devices['Pixel 7 landscape'] };
await run('desktop', desk, 1, '?debug=1', false);
await run('desktop', desk, 1, '?debug=1', true);
await run('Pixel7 Low', px7, 6, '?debug=1&tier=low', false);
await run('Pixel7 Low', px7, 6, '?debug=1&tier=low', true);
await run('Pixel7 Mid', px7, 4, '?debug=1&tier=mid', true);
await b.close();
