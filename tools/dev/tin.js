// Probe script (M2.7): furnish, open the shop, let customers be auto-served for a while, and
// report the tin (size, fill px, label) against the player's money; then open build mode to check
// the plain readout replaces the tin.
(async () => {
  const g = window.__game;
  const act = (a) => g.bridge.act(a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const plan = [
    [3, 27, 12], [0, 27, 11], [0, 27, 13], [0, 26, 12],
    [3, 31, 12], [0, 31, 11], [0, 31, 13], [0, 32, 12],
  ];
  for (const [type, x, y] of plan) await act({ k: 'place', type, x, y, rot: 0, colour: 0 });
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
