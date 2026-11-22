// Dev-only autoplayer (M2.5), loaded before another probe script:
//   node tools/dev/probe.mjs <dev-url> shot.png @tools/dev/autoplay.js,tools/dev/tin.js
// Plays like a busy player through the real UI: keeps up to three jobs queued (serve > brew > order
// > clear > wash; wash and clear first when no clean cup is left) and pours with Space when the pour
// minigame opens. window.__autoplay.start() / .stop().
window.__autoplay = (() => {
  const g = window.__game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const key = (type) => document.dispatchEvent(new KeyboardEvent(type, { key: ' ', code: 'Space', bubbles: true }));
  const hold = async (ms) => {
    key('keydown');
    await sleep(ms);
    key('keyup');
    await sleep(120);
  };
  let on = false;
  let pouring = false;
  const pick = (kinds) => {
    const v = g.view;
    for (const kind of kinds) for (let i = 1; i < 128; i++) if (v.taskKind[i] === kind && !v.taskQueue[i]) return v.taskHandle(i);
    return 0;
  };
  const cleanCups = () => {
    const v = g.view;
    let n = 0;
    for (let c = 1; c <= v.cupCount; c++) if (v.cupPlace[c] === 0) n++;
    return n;
  };
  async function tick() {
    if (!on) return;
    try {
      if (g.pour.isOpen && !pouring) {
        pouring = true;
        await hold(900);
        await hold(500);
        pouring = false;
      }
      const p = g.bridge.player;
      if (p && !g.pour.isOpen) {
        for (let n = p.queue.length; n < 3; n++) {
          const order = cleanCups() === 0 ? [5, 4, 3, 1] : [3, 2, 1, 4, 5];
          const t = pick(order);
          if (!t) break;
          const r = await g.bridge.act({ k: 'queueTask', task: t });
          if (!r.ok) break;
        }
      }
    } finally {
      setTimeout(tick, 300);
    }
  }
  return {
    start() {
      if (on) return;
      on = true;
      void tick();
    },
    stop() {
      on = false;
    },
  };
})();
