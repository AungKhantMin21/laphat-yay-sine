// Probe script (M2.8): furnish, open, serve a while, jump to closing time, wait for the evening
// panel, sleep, read the teaser line on the sleep screen, then wake. Set window.__shot = 'evening'
// or 'sleep' to stop there for the screenshot.
(async () => {
  const g = window.__game;
  const act = (a) => g.bridge.act(a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 120000) => {
    const end = performance.now() + ms;
    while (!fn()) {
      if (performance.now() > end) return false;
      await sleep(200);
    }
    return true;
  };
  const plan = [
    [3, 27, 12], [0, 27, 11], [0, 27, 13], [0, 26, 12],
    [3, 31, 12], [0, 31, 11], [0, 31, 13], [0, 32, 12],
  ];
  for (const [type, x, y] of plan) await act({ k: 'place', type, x, y, rot: 0, colour: 0 });
  await act({ k: 'openShop' });
  await until(() => g.bridge.player.today.served >= 2, 90000);
  const day = Math.floor(g.view.gameMinute / 1440);
  g.bridge.jump(day * 1440 + 17 * 60);
  const evening = await until(() => g.bridge.player.phase === 3 && !document.querySelector('.evening').classList.contains('hidden'));
  const panel = document.querySelector('.evening')?.innerText.split('\n').filter(Boolean);
  const openBtnHidden = document.querySelector('.day-btn').classList.contains('hidden');
  if (window.__shot === 'evening') return JSON.stringify({ evening, panel });
  document.querySelector('.evening-sleep').click();
  await until(() => !document.querySelector('.sleep-screen').classList.contains('hidden'), 5000);
  await sleep(500);
  const teaser = document.querySelector('.sleep-teaser').textContent;
  const sleepPhase = g.bridge.player.phase;
  if (window.__shot === 'sleep') return JSON.stringify({ evening, panel, teaser });
  document.querySelector('.sleep-wake').click();
  await sleep(300);
  return JSON.stringify({
    evening, panel, openBtnHidden, teaser, sleepPhase,
    after: { screenHidden: document.querySelector('.sleep-screen').classList.contains('hidden'), openBtn: document.querySelector('.day-btn').textContent, minute: g.view.gameMinute, day: g.bridge.player.day },
  });
})();
