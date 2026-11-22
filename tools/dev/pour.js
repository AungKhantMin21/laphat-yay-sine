// Probe script (M2.6): furnish a small shop, open it, wait for a seated customer with an order,
// tap their bubble through the real gesture path, pour with Space (tea, then milk) and check the
// payment. Then opens the pour UI on a second customer mid-pour for the screenshot.
(async () => {
  const g = window.__game;
  const act = (a) => g.bridge.act(a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const plan = [
    [3, 27, 12], [0, 27, 11], [0, 27, 13], [0, 26, 12],
    [3, 31, 12], [0, 31, 11], [0, 31, 13], [0, 32, 12],
  ];
  for (const [type, x, y] of plan) await act({ k: 'place', type, x, y, rot: 0, colour: 0 });
  await act({ k: 'openShop' });
  g.camera.centreOn((30 - 12) * 16, (30 + 12) * 8);
  g.stage.setZoom(2);
  const canvas = document.querySelector('#stage canvas');
  const head = { x: 0, y: 0 };
  /** A seated customer waiting for a cup, as [handle, cssX, cssY]. */
  const waiting = (skip) => {
    const v = g.view;
    for (let i = 1; i < 256; i++) {
      const h = v.npcHandle(i);
      if (!h || h === skip || v.npcOrderState[i] !== 1 || v.npcAnim[i] !== 2) continue;
      if (!g.npcs.headOf(h, head)) continue;
      const k = g.stage.size.devPerCss / g.stage.size.scale;
      return [h, (head.x + g.stage.world.x) / k, (head.y - 4 + g.stage.world.y) / k];
    }
    return null;
  };
  const until = async (fn, ms = 90000) => {
    const end = performance.now() + ms;
    for (;;) {
      const r = fn();
      if (r) return r;
      if (performance.now() > end) return null;
      await sleep(250);
    }
  };
  const tap = (x, y) => {
    const o = { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, button: 0 };
    canvas.dispatchEvent(new PointerEvent('pointerdown', o));
    canvas.dispatchEvent(new PointerEvent('pointerup', o));
  };
  const key = (type) => document.dispatchEvent(new KeyboardEvent(type, { key: ' ', code: 'Space', bubbles: true }));
  const holdSpace = async (ms) => {
    key('keydown');
    await sleep(ms);
    key('keyup');
    await sleep(100);
  };

  const first = await until(() => waiting(0));
  if (!first) return JSON.stringify({ error: 'no seated customer with an order' });
  const [h1, x1, y1] = first;
  const money0 = g.bridge.player.money;
  tap(x1, y1);
  await sleep(300);
  const opened = g.pour.isOpen;
  const slot = h1 & 0xffff;
  const pouringState = g.view.npcOrderState[slot];
  const drink = g.view.npcDrink[slot];
  const target = [0.35, 0.5, 0.22][drink];
  // Tea to ~90 % × (1 − milk share) at 0.3/s, then milk at 0.15/s.
  await holdSpace((0.9 * (1 - target) / 0.3) * 1000);
  const stageAfterTea = document.querySelector('.pour').dataset.stage;
  await holdSpace((0.9 * target / 0.15) * 1000);
  await sleep(500);
  const served = { open: g.pour.isOpen, order: g.view.npcOrderState[slot], money: g.bridge.player.money - money0, poured: g.bridge.player.today.poured };
  const bubble = document.querySelector('.react:not(.hidden)')?.textContent ?? null;

  // Second customer: leave the overlay open mid-pour for the screenshot.
  const second = await until(() => waiting(h1), 60000);
  let second2 = null;
  if (second) {
    tap(second[1], second[2]);
    await sleep(300);
    key('keydown');
    await sleep(1200);
    key('keyup');
    second2 = { open: g.pour.isOpen, stage: document.querySelector('.pour').dataset.stage };
  }
  return JSON.stringify({ opened, pouringState, drink, stageAfterTea, served, bubble, second: second2 });
})();
