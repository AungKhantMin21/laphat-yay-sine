// Probe script (M3): the errand loop through the UI. Taps the map button and the wet market on the
// map (the player walks there, the camera follows, the shop panel opens), buys a pack of tea with
// the panel's carry button, taps the home button, walks home by tapping the shop floor, and checks
// the shelf grew. Then jumps to 09:00, visits the furniture shop, buys one item with delivery and
// waits for it to arrive in the inventory (2 game hours ≈ 2 real minutes).
// Usage: node tools/dev/probe.mjs <dev-url> shot.png @tools/dev/errand.js   (prefix window.__quick=1; to skip the delivery wait)
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
  const tapTile = (x, y) => {
    const o = { clientX: ((x - y) * 16 + g.stage.world.x) / k(), clientY: ((x + y) * 8 + 8 + g.stage.world.y) / k(), pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true, button: 0 };
    canvas.dispatchEvent(new PointerEvent('pointerdown', o));
    canvas.dispatchEvent(new PointerEvent('pointerup', o));
  };
  const out = {};
  const t0 = performance.now();
  document.querySelector('.nav-map').click();
  await sleep(300);
  out.mapOpen = !!document.querySelector('.nmap:not(.hidden)');
  document.querySelector('.nmap-shop').click(); // the first shop: the wet market
  out.panel = !!(await until(() => document.querySelector('.shop-panel:not(.hidden)'), 60000));
  out.walkSecs = Math.round((performance.now() - t0) / 1000);
  const body = g.npcs.bodyOf(248);
  out.cameraFollowed = Math.abs(g.camera.x - body.x) < g.stage.size.w / 2 && Math.abs(g.camera.y - body.y) < g.stage.size.h / 2;
  const tea0 = g.bridge.player.stock[0];
  document.querySelector('.shop-rows li .hud-btn').click(); // carry one pack of tea
  out.carrying = !!(await until(() => g.bridge.player.carry.length > 0, 5000));
  document.querySelector('.nav-home').click();
  await sleep(300);
  tapTile(31, 18); // the shop's front row: walk home
  out.putAway = !!(await until(() => g.bridge.player.carry.length === 0, 60000));
  out.teaGain = g.bridge.player.stock[0] - tea0;
  out.panelClosed = !document.querySelector('.shop-panel:not(.hidden)');
  if (window.__quick) return JSON.stringify(out);
  // Delivery: furniture at 09:00 arrives 2 game hours later.
  await g.bridge.act({ k: 'openShop' });
  g.bridge.jump(v.day * 1440 + 9 * 60);
  await sleep(300);
  await g.bridge.act({ k: 'visit', shop: 2 });
  await until(() => document.querySelector('.shop-panel:not(.hidden)'), 60000);
  const row = g.bridge.player.market[2].findIndex((r) => r.kind === 1 && r.qty > 0);
  const type = g.bridge.player.market[2][row].id;
  const inv0 = g.bridge.player.inventory[type];
  document.querySelectorAll('.shop-rows li')[row].querySelectorAll('.hud-btn')[1].click(); // deliver
  out.ordered = !!(await until(() => g.bridge.player.deliveries.length > 0, 5000));
  out.delivered = !!(await until(() => g.bridge.player.inventory[type] > inv0, 200000));
  return JSON.stringify(out);
})();
