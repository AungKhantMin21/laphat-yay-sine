// Probe script: furnish a small shop from the start stock, open the shutters, wait for customers,
// zoom in on the shop, and report what the NPC mirror and renderer see.
(async () => {
  const g = window.__game;
  const act = (a) => g.bridge.act(a);
  // Catalog order from objects.json: 0 stool, 1 chair, 2 bench, 3 table.
  const plan = [
    [3, 27, 12], [0, 27, 11], [0, 27, 13], [0, 26, 12],
    [3, 31, 12], [0, 31, 11], [0, 31, 13], [0, 32, 12],
    [2, 28, 16], [3, 28, 17], [0, 33, 16],
  ];
  const results = [];
  for (const [type, x, y] of plan) results.push((await act({ k: 'place', type, x, y, rot: 0, colour: 0 })).ok);
  await act({ k: 'openShop' });
  g.camera.centreOn((30 - 14) * 16, (30 + 14) * 8);
  g.stage.setZoom(1);
  await new Promise((r) => setTimeout(r, Number(window.__wait ?? 45000)));
  const v = g.view;
  let live = 0, sitting = 0, orders = 0;
  for (let i = 1; i < 256; i++) {
    if (!v.npcLive[i]) continue;
    live++;
    if (v.npcAnim[i] === 2) sitting++;
    if (v.npcOrderState[i] === 1 || v.npcOrderState[i] === 2) orders++;
  }
  return JSON.stringify({ placed: results.filter(Boolean).length, live, sitting, orders, drawn: g.npcs.visible, animated: g.npcs.animated, money: g.bridge.player.money, served: g.bridge.player.today.served });
})();
