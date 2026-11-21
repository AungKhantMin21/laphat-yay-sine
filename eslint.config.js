import tseslint from 'typescript-eslint';

const layer = (dir, banned) => ({
  files: [`src/${dir}/**/*.ts`],
  rules: {
    'no-restricted-imports': ['error', { patterns: banned }],
  },
});

const ui = ['**/sim/**'];

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  layer('shared', [
    { group: ['pixi.js', 'pixi.js/*'], message: 'shared/ is pure TS: no Pixi.' },
    { group: ['**/sim/**', '**/game/**', '**/render/**', '**/ui/**', '**/input/**', '**/audio/**', '**/platform/**'], message: 'shared/ imports only shared/.' },
  ]),
  layer('sim', [
    { group: ['pixi.js', 'pixi.js/*'], message: 'sim/ runs in the Worker: no Pixi.' },
    { group: ['**/game/**', '**/render/**', '**/ui/**', '**/input/**', '**/audio/**', '**/platform/**'], message: 'sim/ imports only shared/.' },
  ]),
  layer('render', [{ group: ui, message: 'Talk to the sim through game/bridge.ts.' }]),
  layer('ui', [
    { group: ui, message: 'Talk to the sim through game/bridge.ts.' },
    { group: ['pixi.js', 'pixi.js/*'], message: 'Pixi lives only in render/.' },
  ]),
  layer('input', [
    { group: ui, message: 'Talk to the sim through game/bridge.ts.' },
    { group: ['pixi.js', 'pixi.js/*'], message: 'Pixi lives only in render/.' },
  ]),
  layer('audio', [
    { group: ui, message: 'Talk to the sim through game/bridge.ts.' },
    { group: ['pixi.js', 'pixi.js/*'], message: 'Pixi lives only in render/.' },
  ]),
  layer('platform', [
    { group: ui, message: 'Talk to the sim through game/bridge.ts.' },
    { group: ['pixi.js', 'pixi.js/*'], message: 'Pixi lives only in render/.' },
  ]),
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use shared/rng.ts streams.' }],
    },
  },
);
