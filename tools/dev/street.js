// Probe script (M4): the living street. Opens the shop, jumps to 07:30, then looks at the tea shop,
// the wet market and the lane in turn and reports the NPCs on the mirror (customers, residents) and
// the keepers behind their counters. With Near LOD only NPCs around the view should be mirrored.
// Usage: node tools/dev/probe.mjs <dev-url> shot.png @tools/dev/street.js   (prefix window.__look='market'|'lane' to end the screenshot there)
(async () => {
  const g = window.__game;
  const v = g.view;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const iso = (x, y) => [(x - y) * 16, (x + y) * 8];
  const count = () => {
    const by = { customer: 0, resident: 0, worker: 0 };
    for (let i = 1; i < v.npcLive.length; i++) {
      if (!v.npcLive[i]) continue;
      const d = v.npcDef[i];
      if (d === 0) by.customer++;
      else if (d === 3) by.resident++;
      else by.worker++;
    }
    return by;
  };
  await g.bridge.act({ k: 'openShop' });
  g.bridge.jump(7 * 60 + 30);
  const out = { keepers: 0 };
  const looks = { shop: [30, 18], market: [66, 40], lane: [92, 52] };
  for (const [name, [x, y]] of Object.entries(looks)) {
    g.camera.centreOn(...iso(x, y));
    await sleep(8000);
    out[name] = count();
    if (window.__look === name) break;
  }
  out.keepers = g.bridge.player.keepers;
  if (window.__look) g.camera.centreOn(...iso(...looks[window.__look]));
  await sleep(500);
  return JSON.stringify(out);
})();
