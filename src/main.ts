import './ui/style.css';
import { translateDom } from './ui/i18n';
import { installTouchGuard } from './platform/touch-guard';
import { installLandscapeLock } from './platform/orientation';
import { createPixelStage } from './render/stage';
import { floorTextures, loadAtlas } from './render/atlas';
import floorFrames from './data/floors.json';
import { FLOOR_TYPES } from './shared/layout';
import { FloorChunks } from './render/chunks';
import { ObjectLayer } from './render/objects';
import { Recolourer } from './render/recolour';
import { Texture } from 'pixi.js';
import { Ghost } from './render/ghost';
import { HeatLayer } from './render/heat';
import { BuildController } from './game/build-mode';
import { installBuildUi } from './ui/build/build-ui';
import { installBuildKeys } from './input/keyboard';
import { requestPersistentStorage } from './platform/persist';
import { CATALOG, spriteFrame } from './shared/catalog';
import { tileAtX, tileAtY } from './shared/iso';
import { Camera } from './render/camera';
import { installGestures } from './input/pointer';
import { FrameLoop } from './game/loop';
import { WorldView } from './game/view';
import { SimBridge } from './game/bridge';
import { isoX, isoY } from './shared/iso';
import type { Tier } from './shared/protocol';
import { loadTier, runBenchmark, saveTier, deviceHints, decideTier } from './platform/tier';
import { BUDGETS, TIER_NAMES, TIER_SETTINGS } from './platform/tier-policy';
import { DrawCallCounter, estimateTextureBytes } from './render/gl-stats';
import { installPerfOverlay } from './ui/perf-overlay';
import { showFontSample, showTitleCard } from './ui/title-card';
import { MusicPlayer } from './audio/music';
import { trackFor, type TrackId } from './audio/music-policy';
import { installMusicDebug } from './ui/music-debug';

translateDom();
installTouchGuard();
installLandscapeLock();

const stageEl = document.getElementById('stage')!;
const stage = await createPixelStage(stageEl);
const atlas = await loadAtlas();
const chunks = new FloorChunks(stage.renderer, floorTextures(atlas, floorFrames, FLOOR_TYPES), [
  atlas.get('wall/n') ?? Texture.EMPTY,
  atlas.get('wall/w') ?? Texture.EMPTY,
]);
stage.world.addChild(chunks.layer);
stage.onContextRestored(() => chunks.invalidateAll());
const camera = new Camera();

const view = new WorldView();
const objects = new ObjectLayer(view, atlas, new Recolourer(atlas));
const ghost = new Ghost(objects, objects.layer);
const heat = new HeatLayer(view);
stage.world.addChild(objects.floorLayer, heat.g, ghost.marks, objects.layer);
// Music starts after the first frame and the first tap; the sample rate follows the tier then.
const music = new MusicPlayer({ sampleRate: () => TIER_SETTINGS[device.tier].audioSampleRate });
let musicPinned: TrackId | null = null;
const pickMusic = (): void => music.play(musicPinned ?? trackFor(Math.floor(view.gameMinute / 60) % 24, false));

const bridge: SimBridge = new SimBridge(view, {
  onState: () => buildUi.refresh(),
  onReady: () => {
    showTitleCard();
    requestAnimationFrame(() => {
      pickMusic();
      setInterval(pickMusic, 5000); // follows the game clock (M5 adds weather)
    });
    chunks.setArea(view.area.floor, view.area.wall, view.area.w, view.area.h);
    camera.setArea(view.area.w, view.area.h);
    camera.centreOn(isoX(30, 18), isoY(30, 18)); // the shop's front
  },
});
const tierState = await loadTier();
bridge.init(tierState.tier);

/** CSS point → world pixels (the canvas fills the viewport from 0,0). */
const toWorld = (x: number, y: number): [number, number] => {
  const k = stage.size.devPerCss / stage.size.scale;
  return [x * k - stage.world.x, y * k - stage.world.y];
};

const build = new BuildController({
  view,
  bridge,
  objects,
  ghost,
  toWorld,
  centreTile: () => [tileAtX(camera.x, camera.y), tileAtY(camera.x, camera.y)],
  onFirstBuild: () => void requestPersistentStorage(),
  onHeat: (prop) => heat.show(prop),
});
const buildUi = installBuildUi(
  build,
  () => bridge.player,
  (type) => {
    const def = CATALOG.defs[type];
    const f = def && atlas.frames.get(spriteFrame(def, 0));
    return f ? { url: atlas.url, x: f[0], y: f[1], w: f[2], h: f[3] } : null;
  },
);
installBuildKeys(build);

installGestures(stageEl, {
  pan: (dx, dy) => {
    const k = stage.size.devPerCss / stage.size.scale; // world px per CSS px
    camera.pan(-dx * k, -dy * k);
  },
  zoomStep: (dir) => stage.setZoom(stage.size.zoom + dir),
  tap: (x, y, type) => {
    if (build.open) build.tap(x, y, type);
  },
  hover: (x, y) => build.hover(x, y),
  dragStart: (x, y) => build.dragStart(x, y),
  dragMove: (x, y) => build.dragMove(x, y),
});

const debug = new URLSearchParams(location.search).has('debug');
const draws = debug ? new DrawCallCounter(stage.renderer) : null;

const loop = new FrameLoop({
  update: () => undefined,
  render: () => {
    if (!bridge.isReady) return;
    draws?.beginFrame();
    if (!view.tilesDirty.empty) {
      chunks.markDirty(view.tilesDirty);
      view.tilesDirty.clear();
    }
    // The world changed under the ghost (or the selected object moved): re-validate.
    if (objects.sync() && build.open) build.refresh();
    heat.update();
    camera.apply(stage.world, stage.size);
    const v = camera.view;
    chunks.update(v.x0, v.y0, v.x1, v.y1);
    stage.render();
    draws?.endFrame();
  },
  onHidden: () => {
    bridge.setRunning(false);
    bridge.save('hidden');
  },
  onVisible: () => bridge.setRunning(true),
});
loop.start();

const device = { tier: tierState.tier, source: tierState.source as string, bench: tierState.record?.bench ?? null };

function applyTier(t: Tier): void {
  const s = TIER_SETTINGS[t];
  loop.setMaxFps(s.maxFps);
  stage.setRenderScale(Math.min(1, s.maxDevPerCss / (window.devicePixelRatio || 1)));
  chunks.setMaxLive(s.chunkTextures);
  bridge.setTier(t);
  device.tier = t;
}
applyTier(tierState.tier);

if (tierState.needsBench) {
  // Let loading settle, then measure while the street is on screen.
  setTimeout(async () => {
    const bench = await runBenchmark();
    const t = decideTier(deviceHints(), bench);
    await saveTier(t, bench, null);
    device.source = 'benchmark';
    device.bench = bench;
    applyTier(t);
  }, 1000);
}

if (debug) {
  showFontSample();
  installMusicDebug(music, (id) => {
    musicPinned = id;
    pickMusic();
  });
  installPerfOverlay({
    stats: loop.stats,
    drawCalls: () => draws?.last ?? 0,
    textureBytes: () =>
      estimateTextureBytes({ atlasPx: 1024 * 1024, worldW: stage.size.w, worldH: stage.size.h, devW: stage.size.devW, devH: stage.size.devH, chunkBytes: chunks.textureBytes }),
    simWorkMs: () => view.simWorkMs,
    simFramesReceived: () => bridge.framesReceived,
    budget: () => BUDGETS[device.tier],
    info: () => [
      `tier    ${TIER_NAMES[device.tier]} (${device.source}${device.bench ? `, cpu ${device.bench.cpuScore}, p90 ${device.bench.p90FrameMs} ms` : ''})`,
      `view    ${stage.size.w}×${stage.size.h} ×${stage.size.scale} (zoom ${stage.size.zoom}), dpr ${stage.size.devPerCss.toFixed(2)}`,
      `chunks  ${chunks.liveTextures} live · day ${view.day} ${String(Math.floor(view.gameMinute / 60) % 24).padStart(2, '0')}:${String(view.gameMinute % 60).padStart(2, '0')}`,
    ],
  });
}

if (import.meta.env.DEV) Object.assign(window, { __game: { view, bridge, loop, stage, camera, chunks, device, music, objects, build } });
