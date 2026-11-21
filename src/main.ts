import './ui/style.css';
import { translateDom } from './ui/i18n';
import { installTouchGuard } from './platform/touch-guard';
import { installLandscapeLock } from './platform/orientation';
import { createPixelStage } from './render/stage';
import { drawTestPattern } from './render/test-pattern';
import { FrameLoop } from './game/loop';

translateDom();
installTouchGuard();
installLandscapeLock();

const stage = await createPixelStage(document.getElementById('stage')!);
drawTestPattern(stage.world, stage.size);
stage.onResize((s) => drawTestPattern(stage.world, s));
stage.onContextRestored(() => drawTestPattern(stage.world, stage.size));

const loop = new FrameLoop({
  update: () => undefined,
  render: () => stage.render(),
});
loop.start();
