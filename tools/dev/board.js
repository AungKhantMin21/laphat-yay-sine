// Probe script (M4): growing the shop through the UI path. Plays three quick days (open, jump to
// closing, Sleep) so the east lot is listed on day 3, taps the board on the map (the player walks
// there and the board panel opens), rents the lot with the panel's button, walks home, places a
// stool in the new space and reports the tiles, the panel rows and any customer who sits there.
// Usage: node tools/dev/probe.mjs <dev-url> shot.png @tools/dev/board.js   (prefix window.__shot='board' to stop at the open panel)
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
  const out = {};
  // Three days pass (debug catch-up): the east lot is listed on day 3.
  g.bridge.skipDays(3);
  await until(() => (g.bridge.player.day >= 3 && document.querySelector('.away:not(.hidden) .hud-btn:not(.hidden)')) || null, 30000);
  out.awayCard = [...document.querySelectorAll('.away .away-title, .away .away-line')].map((e) => e.textContent);
  document.querySelector('.away .hud-btn').click();
  out.day = g.bridge.player.day;
  out.listed = g.bridge.player.listings.map((l) => `${l.key}:${l.state}`);
  document.querySelector('.nav-map').click();
  await sleep(300);
  document.querySelector('.nmap-board').click();
  const opened = await until(() => !document.querySelector('.board-panel').classList.contains('hidden') || null, 60000);
  out.panelOpened = !!opened;
  out.rows = [...document.querySelectorAll('.board-panel li')].map((li) => li.textContent);
  if (window.__shot === 'board') return JSON.stringify(out);
  // The east lot's row: its buttons are buy, then rent.
  const k = g.bridge.player.listings.findIndex((l) => l.key === 'east_lot');
  const rentBtn = document.querySelectorAll('.board-panel li')[k]?.querySelectorAll('button')[1];
  rentBtn?.click();
  await until(() => g.bridge.player.listings.some((l) => l.key === 'east_lot' && l.state === 4) || null, 5000);
  out.rented = g.bridge.player.listings.find((l) => l.key === 'east_lot')?.state === 4;
  const a = v.area;
  out.access38_16 = a.access[16 * a.w + 38];
  // Walk home and place a stool in the new space.
  await g.bridge.act({ k: 'walkTo', x: 34, y: 16 });
  await until(() => {
    const b = g.npcs.bodyOf(248);
    return b && Math.abs(b.x - (34 - 16) * 16) < 24 || null;
  }, 60000);
  const types = await import('/games/laphat-yay-sine/src/shared/catalog.ts');
  const st = types.CATALOG.byKey.get('stool').id;
  g.bridge.give(st, 1);
  await sleep(300);
  const placed = await g.bridge.act({ k: 'place', type: st, x: 39, y: 15, rot: 0, colour: 0 });
  out.placed = placed.ok || placed.reason;
  document.querySelector('.nav-home')?.click(); // camera stops following the player
  await sleep(300);
  g.camera.centreOn((37 - 15) * 16, (37 + 15) * 8);
  await sleep(1500);
  return JSON.stringify(out);
})();
