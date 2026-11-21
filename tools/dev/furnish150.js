// Fills the M1 shop with 150 objects through the real worker and returns a save code.
// Use with tools/dev/probe.mjs on the dev server; import the code in a production build for perf gates.
(async () => {
  const g = __game;
  const K = ['stool', 'chair', 'bench', 'table', 'table_long', 'counter', 'shelf', 'rug', 'radio', 'pot_plant', 'teapot', 'wall_clock', 'poster', 'ceiling_fan', 'hanging_lamp'];
  const T = Object.fromEntries(K.map((k, i) => [k, i]));
  for (const k of K) g.bridge.give(T[k], 200);
  let ok = 0;
  const go = async (k, x, y, rot = 0, colour = 0) => {
    if ((await g.bridge.act({ k: 'place', type: T[k], x, y, rot, colour })).ok) ok++;
  };
  for (let y = 10; y <= 17; y += 3)
    for (let x = 25; x <= 34; x += 3) {
      await go('table', x, y, 0, (x + y) % 8);
      await go('teapot', x, y, 0, (x * y) % 8);
      await go('stool', x + 1, y, 0, x % 8);
      await go('stool', x, y + 1, 0, y % 8);
      await go('stool', x + 1, y + 1, 0, 3);
      await go('hanging_lamp', x, y, 0, (x + 1) % 8);
      await go('ceiling_fan', x + 1, y + 1);
    }
  for (let x = 24; x <= 35; x++) await go(x % 2 ? 'poster' : 'wall_clock', x, 9, 1, x % 8);
  for (let y = 10; y <= 18; y++) await go(y % 2 ? 'poster' : 'wall_clock', 24, y, 0, y % 8);
  for (let x = 24; x <= 35; x++) for (let y = 19; y <= 21; y++) await go((x + y) % 3 ? 'stool' : 'pot_plant', x, y, 0, (x + y) % 8);
  for (let y = 10; y <= 18; y++) await go('pot_plant', 24, y, 0, y % 8);
  await new Promise((r) => setTimeout(r, 300));
  return JSON.stringify({ placed: ok, objs: g.view.state.objects.count, code: await g.bridge.exportSave() });
})();
