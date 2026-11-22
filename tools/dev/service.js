// Probe script (M2.5): plays the service loop through real taps on the start shop. A customer asks →
// tap them (take the order, marker ၁ shows) → tap them again (brew: the player walks to the counter
// and the pour minigame opens) → pour with Space → tap them (serve) → wait for them to leave → tap the
// cup (clear) → tap the sink (wash). Also checks: a tap on a queued marker cancels it.
// Usage: node tools/dev/probe.mjs <dev-url> shot.png @tools/dev/service.js
// Prefix `window.__shot='queue';` to stop with two jobs queued (markers) for a screenshot.
(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const canvas = document.querySelector('#stage canvas');
  const v = g.view;
  const k = () => g.stage.size.devPerCss / g.stage.size.scale;
  const css = (p) => [(p.x + g.stage.world.x) / k(), (p.y + g.stage.world.y) / k()];
  const until = async (fn, ms = 90000) => {
    const end = performance.now() + ms;
    for (;;) {
      const r = fn();
      if (r) return r;
      if (performance.now() > end) return null;
      await sleep(200);
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
    await sleep(120);
  };
  const head = { x: 0, y: 0 };
  const tapCustomer = (h) => {
    if (!g.npcs.headOf(h, head)) return false;
    head.y -= 4;
    tap(...css(head));
    return true;
  };
  const queueLen = () => g.bridge.player.queue.length;
  const out = {};

  await g.bridge.act({ k: 'openShop' });
  g.camera.centreOn((30 - 15) * 16, (30 + 15) * 8);
  // A customer asking to order (ORDER.ask = 4), seated (anim 2).
  const asking = () => {
    for (let i = 1; i < 248; i++) if (v.npcLive[i] && v.npcOrderState[i] === 4 && v.npcAnim[i] === 2) return v.npcHandle(i);
    return 0;
  };
  const h = await until(asking);
  if (!h) return JSON.stringify({ error: 'no customer asked to order' });
  const slot = h & 0xffff;

  // 1. Take the order.
  tapCustomer(h);
  await sleep(300);
  out.queuedOrder = queueLen();
  out.marker = [...document.querySelectorAll('.qmark')].filter((m) => !m.classList.contains('hidden')).length;
  if (window.__shot === 'queue') {
    const h2 = await until(() => {
      for (let i = 1; i < 248; i++) if (v.npcLive[i] && v.npcOrderState[i] === 4 && v.npcAnim[i] === 2 && v.npcHandle(i) !== h) return v.npcHandle(i);
      return 0;
    }, 30000);
    if (h2) tapCustomer(h2);
    await sleep(400);
    return JSON.stringify({ ...out, queue: queueLen() });
  }
  out.ordered = !!(await until(() => v.npcOrderState[slot] === 1, 30000));

  // 2. Brew: tap them again; the player walks to the counter and the pour opens.
  tapCustomer(h);
  out.pourOpened = !!(await until(() => g.pour.isOpen, 30000));
  await holdSpace(900);
  await holdSpace(500);
  out.cupOnCounter = !!(await until(() => [...Array(v.cupCount + 1).keys()].some((c) => v.cupFor[c] === h && v.cupPlace[c] === 1), 10000));

  // 3. Serve.
  const money0 = g.bridge.player.money;
  tapCustomer(h);
  out.served = !!(await until(() => v.npcOrderState[slot] === 3, 30000));
  out.paid = g.bridge.player.money - money0;

  // 4. They drink and leave; tap the cup on the table, then the sink.
  const cup = [...Array(v.cupCount + 1).keys()].find((c) => c > 0 && v.cupFor[c] === h);
  await until(() => v.cupDirty[cup] === 1, 90000);
  const p = { x: 0, y: 0 };
  g.serviceProps?.cupPoint?.(cup, p);
  if (!g.serviceProps) out.note = 'serviceProps not exposed';
  tap(...css({ x: p.x, y: p.y + 4 }));
  out.cleared = !!(await until(() => v.cupPlace[cup] === 4, 30000));
  g.serviceProps.fixturePoint(3 /* SERVICE.sink */, p);
  tap(...css({ x: p.x, y: p.y + 10 }));
  out.washed = !!(await until(() => v.cupPlace[cup] === 0, 30000));

  // 5. Cancel by tapping a marker: queue a job, tap its marker.
  const h3 = await until(asking, 60000);
  if (h3) {
    tapCustomer(h3);
    await sleep(300);
    const before = queueLen();
    const mark = [...document.querySelectorAll('.qmark')].find((m) => !m.classList.contains('hidden'));
    mark?.click();
    await sleep(300);
    out.cancel = [before, queueLen()];
  }
  out.money = g.bridge.player.money;
  return JSON.stringify(out);
})();
