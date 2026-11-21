import './ui/style.css';
import { translateDom } from './ui/i18n';
import { installTouchGuard } from './platform/touch-guard';
import { installLandscapeLock } from './platform/orientation';
import { createPixelStage } from './render/stage';
import { floorTextures, loadAtlas } from './render/atlas';
import floorFrames from './data/floors.json';
import { FLOOR_TYPES } from './shared/layout';
import { FloorChunks } from './render/chunks';
import { Camera } from './render/camera';
import { installGestures } from './input/pointer';
import { FrameLoop } from './game/loop';
import { WorldView } from './game/view';
import { SimBridge } from './game/bridge';
import { isoX, isoY } from './shared/iso';

translateDom();
installTouchGuard();
installLandscapeLock();

const stageEl = document.getElementById('stage')!;
const stage = await createPixelStage(stageEl);
const atlas = await loadAtlas();
const chunks = new FloorChunks(stage.renderer, floorTextures(atlas, floorFrames, FLOOR_TYPES));
stage.world.addChild(chunks.layer);
stage.onContextRestored(() => chunks.invalidateAll());
const camera = new Camera();

const view = new WorldView();
const bridge = new SimBridge(view, {
  onReady: () => {
    chunks.setArea(view.floor, view.areaW, view.areaH);
    camera.setArea(view.areaW, view.areaH);
    camera.centreOn(isoX(30, 18), isoY(30, 18)); // the shop's front
  },
});
const seed = crypto.getRandomValues(new Uint32Array(1))[0]!; // M1: from the save
bridge.init(seed, 1);

installGestures(stageEl, {
  pan: (dx, dy) => {
    const k = stage.size.devPerCss / stage.size.scale; // world px per CSS px
    camera.pan(-dx * k, -dy * k);
  },
  zoomStep: (dir) => stage.setZoom(stage.size.zoom + dir),
});

const loop = new FrameLoop({
  update: () => undefined,
  render: () => {
    if (!bridge.isReady) return;
    if (!view.floorDirty.empty) {
      chunks.markDirty(view.floorDirty);
      view.floorDirty.clear();
    }
    camera.apply(stage.world, stage.size);
    const v = camera.view;
    chunks.update(v.x0, v.y0, v.x1, v.y1);
    stage.render();
  },
  onHidden: () => {
    bridge.setRunning(false);
    bridge.save('hidden');
  },
  onVisible: () => bridge.setRunning(true),
});
loop.start();

if (import.meta.env.DEV) Object.assign(window, { __game: { view, bridge, loop, stage, camera, chunks } });
