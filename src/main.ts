import './ui/style.css';
import { translateDom } from './ui/i18n';
import { installTouchGuard } from './platform/touch-guard';
import { installLandscapeLock } from './platform/orientation';
import { createPixelStage } from './render/stage';
import { drawTestPattern } from './render/test-pattern';
import { FrameLoop } from './game/loop';
import { WorldView } from './game/view';
import { SimBridge } from './game/bridge';

translateDom();
installTouchGuard();
installLandscapeLock();

const stage = await createPixelStage(document.getElementById('stage')!);
drawTestPattern(stage.world, stage.size);
stage.onResize((s) => drawTestPattern(stage.world, s));
stage.onContextRestored(() => drawTestPattern(stage.world, stage.size));

const view = new WorldView();
const bridge = new SimBridge(view);
const seed = crypto.getRandomValues(new Uint32Array(1))[0]!; // M1: from the save
bridge.init(seed, 1);

const loop = new FrameLoop({
  update: () => undefined,
  render: () => stage.render(),
  onHidden: () => {
    bridge.setRunning(false);
    bridge.save('hidden');
  },
  onVisible: () => bridge.setRunning(true),
});
loop.start();

if (import.meta.env.DEV) Object.assign(window, { __game: { view, bridge, loop, stage } });
