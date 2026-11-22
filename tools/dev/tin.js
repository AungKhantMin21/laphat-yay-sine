// Probe script (M2.7; M2.5: run after tools/dev/autoplay.js): open the shop, serve a few cups, and
// report the tin (size, fill px, label) against the player's money; then open build mode to check
// the plain readout replaces the tin.
(async () => {
  const g = window.__game;
  const act = (a) => g.bridge.act(a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // M2.5: the start shop has 8 seats; cups are served by the autoplayer (load tools/dev/autoplay.js first).
  window.__autoplay.start();
  const tin = () => {
    const can = document.querySelector('.tin-can');
    return {
      shown: getComputedStyle(document.querySelector('.tin')).display !== 'none',
      w: can.style.width, fill: document.querySelector('.tin-fill').style.height,
      label: document.querySelector('.tin-label').textContent, money: g.bridge.player.money,
    };
  };
  const before = tin();
  await act({ k: 'openShop' });
  let coins = 0;
  const end = performance.now() + Number(window.__wait ?? 90000);
  while (performance.now() < end && g.bridge.player.today.served < 3) {
    coins = Math.max(coins, document.querySelectorAll('.tin-coin:not(.hidden)').length);
    await sleep(100);
  }
  await sleep(200);
  const after = tin();
  g.build.toggle();
  await sleep(200);
  const building = { tin: getComputedStyle(document.querySelector('.tin')).display, money: getComputedStyle(document.querySelector('.money')).display };
  g.build.toggle();
  return JSON.stringify({ before, after, served: g.bridge.player.today.served, coinsSeen: coins, building });
})();
