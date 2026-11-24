// Probe script (M3): the paint tool end to end. Opens the shop, jumps to 09:00, walks to the
// hardware stall, buys every material row (carry), walks home (put away), opens build mode, picks a
// floor finish and paints the front row by tapping, picks a wall paint and taps the back wall, then
// undoes one tile. Reports materials before/after and the painted tiles in the mirror.
// Usage: node tools/dev/probe.mjs <dev-url> shot.png @tools/dev/paint.js
(async () => {
  const g = window.__game;
  const v = g.view;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 60000) => {
    const end = performance.now() + ms;
    for (;;) {
      const r = fn();
      if (r) return r;
      if (performance.now() > end) return null;
      await sleep(200);
    }
  };
  const canvas = document.querySelector('#stage canvas');
  const k = () => g.stage.size.devPerCss / g.stage.size.scale;
  const tapTile = (x, y, lift = 0) => {
    const wx = (x - y) * 16;
    const wy = (x + y) * 8 + 8 - lift;
    const cx = (wx + g.stage.world.x) / k();
    const cy = (wy + g.stage.world.y) / k();
    const o = { clientX: cx, clientY: cy, pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true, button: 0 };
    canvas.dispatchEvent(new PointerEvent('pointerdown', o));
    canvas.dispatchEvent(new PointerEvent('pointerup', o));
  };
  const out = {};
  await g.bridge.act({ k: 'openShop' });
  g.bridge.jump(v.day * 1440 + 9 * 60);
  await sleep(500);
  await g.bridge.act({ k: 'visit', shop: 3 });
  out.atShop = !!(await until(() => document.querySelector('.shop-panel:not(.hidden)'), 60000));
  const rows = g.bridge.player.market[3];
  // Two floor rows and one wall row if they're on sale today (carry max 4).
  let bought = 0;
  for (let i = 0; i < rows.length && bought < 4; i++) {
    const r = await g.bridge.act({ k: 'buy', shop: 3, item: i, qty: 1 });
    if (r.ok) bought++;
  }
  out.bought = bought;
  await g.bridge.act({ k: 'walkTo', x: 31, y: 18 });
  out.home = !!(await until(() => g.bridge.player.carry.length === 0, 60000));
  out.materials = [...g.bridge.player.materials];
  g.camera.centreOn((30 - 14) * 16, (30 + 14) * 8);
  document.querySelector('.build-toggle').click();
  await sleep(300);
  const mats = [...document.querySelectorAll('.drawer button')].filter((b) => b.querySelector('i.mat'));
  out.matButtons = mats.length;
  const floorIdx = g.bridge.player.materials.findIndex((n, i) => n > 0 && i < 4);
  const wallIdx = g.bridge.player.materials.findIndex((n, i) => n > 0 && i >= 4);
  // Floor: tap the front row (x 30..33, y 18).
  if (floorIdx >= 0) {
    mats[g.bridge.player.materials.slice(0, floorIdx).filter((n) => n > 0).length]?.click();
    await sleep(200);
    for (let x = 30; x < 34; x++) {
      tapTile(x, 18);
      await sleep(250);
    }
  }
  if (wallIdx >= 0) {
    const order = g.bridge.player.materials.slice(0, wallIdx).filter((n) => n > 0).length;
    [...document.querySelectorAll('.drawer button')].filter((b) => b.querySelector('i.mat'))[order]?.click();
    await sleep(200);
    for (let x = 27; x < 31; x++) {
      tapTile(x, 9, 20);
      await sleep(250);
    }
  }
  await sleep(500);
  const W = v.area.w;
  out.floor = [30, 31, 32, 33].map((x) => v.area.floor[18 * W + x]);
  out.wall = [27, 28, 29, 30].map((x) => v.area.paint[9 * W + x]);
  out.after = [...g.bridge.player.materials];
  if (window.__shot !== 'paint') {
    await g.bridge.act({ k: 'undo' });
    await sleep(300);
    out.undone = [...g.bridge.player.materials];
  }
  return JSON.stringify(out);
})();
