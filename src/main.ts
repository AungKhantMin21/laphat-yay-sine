import './ui/style.css';
import { translateDom } from './ui/i18n';
import { installTouchGuard } from './platform/touch-guard';
import { installLandscapeLock } from './platform/orientation';
import { createPixelStage } from './render/stage';
import { floorTextures, loadAtlas } from './render/atlas';
import floorFrames from './data/floors.json';
import { FLOOR_TYPES } from './shared/layout';
import { FACADE_FRAMES } from './shared/street';
import { ShopFront } from './render/shopfront';
import { ServiceLayer } from './render/service';
import { TASK_KIND, findTask, firstTask, taskForCustomer } from './game/service-taps';
import { installQueue } from './ui/hud/queue';
import { NavButtons } from './ui/hud/nav';
import { StreetShops } from './render/street-shops';
import { ACCESS, isShopZone, mayEnter } from './shared/rules/access';
import { MAX_TASKS, WALL_COLOURS, WORKER_SLOT0 } from './shared/layout';
import { FloorChunks } from './render/chunks';
import { ObjectLayer } from './render/objects';
import { NpcLayer } from './render/npcs';
import { Recolourer } from './render/recolour';
import { Texture } from 'pixi.js';
import { Ghost } from './render/ghost';
import { HeatLayer } from './render/heat';
import { BuildController } from './game/build-mode';
import { installBuildUi } from './ui/build/build-ui';
import { installBuildKeys, installWalkKeys } from './input/keyboard';
import { BoardPanel } from './ui/board/panel';
import { NeighbourhoodMap } from './ui/hud/map';
import { NEIGHBOURHOOD } from './shared/neighbourhood';
import { ShopPanel } from './ui/shop/panel';
import { ITEM } from './shared/market';
import { installSettings } from './ui/settings';
import { installDayHud } from './ui/hud/day-hud';
import { installTin } from './ui/hud/tin';
import { installStock } from './ui/hud/stock';
import { installDayEnd } from './ui/hud/day-end';
import { installPourUi } from './ui/pour/pour';
import { installReactions } from './ui/pour/reactions';
import { requestPersistentStorage } from './platform/persist';
import { CATALOG, SERVICE, spriteFrame } from './shared/catalog';
import { tileAtX, tileAtY, tileXf, tileYf } from './shared/iso';
import { handleIndex } from './shared/ids';
import { Camera } from './render/camera';
import { installGestures } from './input/pointer';
import { FrameLoop } from './game/loop';
import { WorldView } from './game/view';
import { SimBridge } from './game/bridge';
import { isoX, isoY } from './shared/iso';
import type { Action, Tier } from './shared/protocol';
import { loadTier, runBenchmark, saveTier, deviceHints, decideTier } from './platform/tier';
import { BUDGETS, TIER_NAMES, TIER_SETTINGS } from './platform/tier-policy';
import { DrawCallCounter, estimateTextureBytes } from './render/gl-stats';
import { installPerfOverlay } from './ui/perf-overlay';
import { showFontSample, showTitleCard } from './ui/title-card';
import { MusicPlayer } from './audio/music';
import { trackFor, type TrackId } from './audio/music-policy';
import { installMusicDebug } from './ui/music-debug';
import { installDebugPanel } from './ui/debug-panel';

translateDom();
installTouchGuard();
installLandscapeLock();

const stageEl = document.getElementById('stage')!;
const stage = await createPixelStage(stageEl);
const atlas = await loadAtlas();
const chunks = new FloorChunks(stage.renderer, floorTextures(atlas, floorFrames, FLOOR_TYPES), [
  ...WALL_COLOURS.flatMap((c) => ['n', 'w', 'low_n', 'low_w'].map((k) => atlas.get(`wall/${k}${c ? `_${c}` : ''}`) ?? Texture.EMPTY)),
], FACADE_FRAMES.map((f) => (f ? (atlas.get(f) ?? Texture.EMPTY) : Texture.EMPTY)));
stage.world.addChild(chunks.layer);
stage.onContextRestored(() => chunks.invalidateAll());
const camera = new Camera();

const view = new WorldView();
const objects = new ObjectLayer(view, atlas, new Recolourer(atlas));
const ghost = new Ghost(objects, objects.layer);
const heat = new HeatLayer(view);
const npcs = new NpcLayer(view, atlas, objects.layer);
const shopFront = new ShopFront(atlas, objects.layer);
const streetShops = new StreetShops(atlas, objects.layer);
const serviceProps = new ServiceLayer(view, atlas, objects.layer, npcs);
stage.world.addChild(objects.floorLayer, heat.g, ghost.marks, objects.layer, npcs.bubbles);
// Music starts after the first frame and the first tap; the sample rate follows the tier then.
const music = new MusicPlayer({ sampleRate: () => TIER_SETTINGS[device.tier].audioSampleRate });
let musicPinned: TrackId | null = null;
// The sleep screen plays the night loop; otherwise music follows the game clock.
let nightPinned = false;
const pickMusic = (): void =>
  music.play(musicPinned ?? (nightPinned ? 'night' : trackFor(Math.floor(view.gameMinute / 60) % 24, false)));

let booted = false;
let freeTeaToastAt = -1e9;
const bridge: SimBridge = new SimBridge(view, {
  onState: () => {
    buildUi.refresh();
    settings.refresh();
    dayHud.refresh();
    tin.refresh(bridge.player?.money ?? 0);
    if (bridge.player) stockHud.refresh(bridge.player.cupsLeft, bridge.player.stock);
    view.playerCarry = bridge.player?.carryLoad ?? 0;
    dayEnd.refresh();
    shopPanel.refresh();
    boardPanel.refresh();
  },
  onEvents: (list) => {
    // M2.8 shows the evening summary and sleep screen; for now, log the day for debugging.
    for (const e of list) {
      if (e.k === 'served') reactions.show(e.id, e.reaction, e.price + e.tip);
      else if (e.k === 'brewReady') pour.open(e.id, e.drink);
      else if (e.k === 'freeTea') {
        // Once in a while is enough: it may happen to every customer until the next market trip.
        if (performance.now() - freeTeaToastAt > 60_000) {
          freeTeaToastAt = performance.now();
          queueUi.toast('stock.freeTea');
        }
      } else if (e.k === 'atShop') {
        if (e.shop === NEIGHBOURHOOD.board.id) boardPanel.open();
        else shopPanel.open(e.shop);
        // The panel sits on the left: keep the player in view on the right (inside the follow dead zone).
        const body = npcs.bodyOf(WORKER_SLOT0);
        if (body) camera.centreOn(body.x - stage.size.w * 0.18, body.y - 12);
      }
      else if (e.k === 'putAway') queueUi.toast('market.putAway');
      else if (e.k === 'propertyTaken') queueUi.toast(e.returned > 0 ? 'board.takenReturned' : 'board.taken');
      else if (e.k === 'leaseEnded') queueUi.toast(e.unpaid ? 'board.leaseEnded' : 'board.leaseGivenUp');
      else if (e.k === 'delivered') queueUi.toast('market.delivered');
      else if (e.k === 'text') queueUi.toast(e.key);
      else if (e.k === 'money') tin.paid(e.delta, e.total);
      else if (e.k === 'teaser') dayEnd.teaser(e.key, e.drink);
      else if (e.k === 'wages') {
        dayEnd.wages(e.paid, e.dayOff);
        tin.refresh(e.total);
      }
    }
  },
  onReady: () => {
    chunks.setArea(view.area.floor, view.area.wall, view.area.facade, view.area.paint, view.area.w, view.area.h);
    camera.setArea(view.area.w, view.area.h);
    if (!booted) {
      booted = true;
      showTitleCard();
      centreOnShop();
      requestAnimationFrame(() => {
        pickMusic();
        setInterval(pickMusic, 5000); // follows the game clock (M5 adds weather)
      });
    } else {
      // A save code was loaded: the whole world was replaced.
      build.close();
      pour.close();
    }
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
const settings = installSettings({
  exportSave: () => bridge.exportSave(),
  importSave: (code) => bridge.importSave(code),
  hidden: () => build.open,
});
const dayHud = installDayHud({
  player: () => bridge.player,
  gameMinute: () => view.gameMinute,
  open: async () => (await bridge.act({ k: 'openShop' })).ok,
});
const dayEnd = installDayEnd({
  player: () => bridge.player,
  sleep: async () => (await bridge.act({ k: 'sleep' })).ok,
  hire: async (role) => (await bridge.act({ k: 'hire', role })).reason ?? '',
  dismiss: async (role) => (await bridge.act({ k: 'dismiss', role })).reason ?? '',
  onSleepScreen: (open) => {
    nightPinned = open;
    if (booted) pickMusic();
  },
});
const tin = installTin();
const stockHud = installStock();
const pour = installPourUi({
  // The sim marks the order as pouring itself when the player reaches the counter (M2.5).
  startPour: () => Promise.resolve({ ok: true }),
  cancelPour: (id) => void bridge.act({ k: 'cancelPour', id }),
  serve: (id, tea, milk) => bridge.act({ k: 'serve', id, tea, milk }),
  onChange: (open) => document.body.classList.toggle('pouring', open),
});
const headAt = { x: 0, y: 0 };
/** World px → CSS px (the inverse of toWorld), in place. */
function worldToCss(p: { x: number; y: number }): void {
  const k = stage.size.devPerCss / stage.size.scale;
  p.x = (p.x + stage.world.x) / k;
  p.y = (p.y + stage.world.y) / k;
}

/**
 * A tap outside build mode (M2.5): a customer (take the order / bring the cup / brew it), a used cup
 * on a table (clear it), the counter or kettle (brew the next order), the sink (wash). A tap on a job
 * already queued cancels it. Refusals show a short toast.
 */
async function tapService(wx: number, wy: number): Promise<void> {
  let task = 0;
  const customer = npcs.pickOrder(wx, wy);
  if (customer) task = taskForCustomer(view, customer, handleIndex(customer));
  if (!task) {
    const cup = serviceProps.pickCup(wx, wy);
    if (cup) task = findTask(view, TASK_KIND.clear, cup);
  }
  if (!task) {
    const o = objects.pick(wx, wy);
    const svc = o ? CATALOG.defs[view.state.objects.type[o]!]!.service : 0;
    if (svc === SERVICE.counter || svc === SERVICE.kettle) task = firstTask(view, TASK_KIND.brew);
    else if (svc === SERVICE.sink) task = firstTask(view, TASK_KIND.wash);
  }
  if (!task) {
    // M3: a shop stall visits it; open ground walks there.
    const shop = streetShops.pick(wx, wy);
    if (shop >= 0) {
      task = findTask(view, TASK_KIND.visit, shop);
      if (!task) return actToast({ k: 'visit', shop });
    } else {
      const tx = tileAtX(wx, wy);
      const ty = tileAtY(wx, wy);
      const a = view.area;
      if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h || !mayEnter(ACCESS.staff, a.access[ty * a.w + tx]!)) return;
      return actToast({ k: 'walkTo', x: tx, y: ty });
    }
  }
  const queued = bridge.player?.queue.includes(task) ?? false;
  const r = await bridge.act(queued ? { k: 'cancelTask', task } : { k: 'queueTask', task });
  if (!r.ok && r.reason) queueUi.toast(r.reason);
}

async function actToast(a: Action): Promise<void> {
  const r = await bridge.act(a);
  if (!r.ok && r.reason) queueUi.toast(r.reason);
}

const queueAt = { x: 0, y: 0 };
const queueUi = installQueue({
  queue: () => bridge.player?.queue ?? [],
  anchor: (task, out) => {
    // Find the task in the mirror and put the marker over the place the job happens.
    let ok = false;
    for (let i = 1; i < MAX_TASKS && !ok; i++) {
      if (!view.taskKind[i] || view.taskHandle(i) !== task) continue;
      const kind = view.taskKind[i]!;
      const target = view.taskTarget[i]!;
      if (kind === TASK_KIND.order || kind === TASK_KIND.brew) ok = npcs.headOf(target, queueAt);
      else if (kind === TASK_KIND.serve) ok = npcs.headOf(view.cupFor[target]!, queueAt) || serviceProps.cupPoint(target, queueAt);
      else if (kind === TASK_KIND.clear) ok = serviceProps.cupPoint(target, queueAt);
      else if (kind === TASK_KIND.wash) ok = serviceProps.fixturePoint(SERVICE.sink, queueAt);
      else if (kind === TASK_KIND.go) {
        const W = view.area.w;
        const tx = target % W;
        const ty = (target - tx) / W;
        queueAt.x = isoX(tx + 0.5, ty + 0.5);
        queueAt.y = isoY(tx + 0.5, ty + 0.5) - 2;
        ok = true;
      } else if (kind === TASK_KIND.visit) {
        const k = streetShops.keeperAt[target];
        if (k) {
          queueAt.x = k.x;
          queueAt.y = k.y - 26;
          ok = true;
        }
      }
    }
    if (!ok) return false;
    worldToCss(queueAt);
    out.x = queueAt.x;
    out.y = queueAt.y;
    return true;
  },
  cancel: (task) => void bridge.act({ k: 'cancelTask', task }).then((r) => !r.ok && r.reason && queueUi.toast(r.reason)),
});
const reactions = installReactions({
  anchor: (id) => {
    if (!npcs.headOf(id, headAt)) return null;
    // World px → CSS px (the inverse of toWorld).
    const k = stage.size.devPerCss / stage.size.scale;
    return { x: (headAt.x + stage.world.x) / k, y: (headAt.y + stage.world.y) / k };
  },
});
build.onChange(() => {
  settings.refresh();
  document.body.classList.toggle('building', build.open);
});

/** The shop, with the pavement in front. */
function centreOnShop(): void {
  camera.centreOn(isoX(30, 16), isoY(30, 16));
}
// The camera follows the player while they're out in the street, unless the player just panned.
let lastPanAt = -1e9;
let followOff = false;
const FOLLOW_PAUSE_MS = 2500;
function followPlayer(now: number): void {
  if (build.open || now - lastPanAt < FOLLOW_PAUSE_MS) return;
  const body = npcs.bodyOf(WORKER_SLOT0);
  if (!body) return;
  const a = view.area;
  const tx = tileAtX(body.x, body.y);
  const ty = tileAtY(body.x, body.y);
  if (tx < 0 || ty < 0 || tx >= a.w || ty >= a.h) return;
  const inShop = isShopZone(a.access[ty * a.w + tx]!);
  if (inShop) {
    followOff = false; // back home: follow again next time they go out
    return;
  }
  if (followOff) return;
  camera.follow(body.x, body.y - 12, stage.size);
}
const shopPanel = new ShopPanel(document.getElementById('ui')!, {
  player: () => bridge.player,
  atCounter: (shop) => {
    const s = NEIGHBOURHOOD.shops[shop];
    const p = playerTile();
    return !!s && !!p && p[0] === s.visitX && p[1] === s.visitY;
  },
  act: (a) => bridge.act(a),
  toast: (k) => queueUi.toast(k),
  icon: (kind, id) => {
    if (kind !== ITEM.object) return null;
    const def = CATALOG.defs[id];
    const f = def && atlas.frames.get(spriteFrame(def, 0));
    return f ? { url: atlas.url, x: f[0], y: f[1], w: f[2], h: f[3] } : null;
  },
});

const boardPanel = new BoardPanel(document.getElementById('ui')!, {
  player: () => bridge.player,
  atBoard: () => {
    const b = NEIGHBOURHOOD.board;
    const p = playerTile();
    return !!p && p[0] === b.visitX && p[1] === b.visitY;
  },
  act: (a) => bridge.act(a),
  toast: (k) => queueUi.toast(k),
});

/** The player's tile from their sprite, or null. */
function playerTile(): [number, number] | null {
  const body = npcs.bodyOf(WORKER_SLOT0);
  return body ? [tileAtX(body.x, body.y), tileAtY(body.x, body.y)] : null;
}
const nmap = new NeighbourhoodMap(document.getElementById('ui')!, {
  area: () => view.area,
  player: playerTile,
  visit: (shop) => {
    followOff = false;
    void actToast({ k: 'visit', shop });
  },
});
new NavButtons(document.getElementById('ui')!, {
  home: () => {
    followOff = true;
    centreOnShop();
  },
  map: () => nmap.open(),
});
// Desktop: WASD / arrows walk the player a couple of tiles at a time (screen up/left/down/right).
installWalkKeys({
  active: () => !build.open && !pour.isOpen && !nmap.isOpen,
  step: (dx, dy) => {
    const p = playerTile();
    if (!p) return;
    const x = p[0] + dx * 2;
    const y = p[1] + dy * 2;
    const a = view.area;
    if (x < 0 || y < 0 || x >= a.w || y >= a.h || !mayEnter(ACCESS.staff, a.access[y * a.w + x]!)) return;
    followOff = false;
    void bridge.act({ k: 'walkTo', x, y });
  },
});

installGestures(stageEl, {
  pan: (dx, dy) => {
    const k = stage.size.devPerCss / stage.size.scale; // world px per CSS px
    lastPanAt = performance.now();
    camera.pan(-dx * k, -dy * k);
  },
  zoomStep: (dir) => stage.setZoom(stage.size.zoom + dir),
  tap: (x, y, type) => {
    if (build.open) return build.tap(x, y, type);
    if (pour.isOpen) return;
    const [wx, wy] = toWorld(x, y);
    void tapService(wx, wy);
  },
  hover: (x, y) => build.hover(x, y),
  dragStart: (x, y) => build.dragStart(x, y),
  dragMove: (x, y) => build.dragMove(x, y),
});

const debug = new URLSearchParams(location.search).has('debug');
const draws = debug ? new DrawCallCounter(stage.renderer) : null;

/** Last tile rect sent to the worker (M4 Near LOD); resent when it moves by 2 tiles or more. */
const sentView = [0, 0, -1, -1];
function sendViewport(x0: number, y0: number, x1: number, y1: number): void {
  const tx0 = Math.floor(tileXf(x0, y0));
  const tx1 = Math.ceil(tileXf(x1, y1));
  const ty0 = Math.floor(tileYf(x1, y0));
  const ty1 = Math.ceil(tileYf(x0, y1));
  const s = sentView;
  if (s[2]! >= 0 && Math.abs(tx0 - s[0]!) < 2 && Math.abs(ty0 - s[1]!) < 2 && Math.abs(tx1 - s[2]!) < 2 && Math.abs(ty1 - s[3]!) < 2) return;
  s[0] = tx0;
  s[1] = ty0;
  s[2] = tx1;
  s[3] = ty1;
  bridge.setViewport(tx0, ty0, tx1, ty1);
}

const loop = new FrameLoop({
  update: () => undefined,
  render: (_alpha, now) => {
    if (!bridge.isReady) return;
    dayHud.tick();
    draws?.beginFrame();
    if (!view.tilesDirty.empty) {
      chunks.markDirty(view.tilesDirty);
      view.tilesDirty.clear();
    }
    // The world changed under the ghost (or the selected object moved): re-validate.
    if (objects.sync() && build.open) build.refresh();
    heat.update();
    followPlayer(now);
    camera.apply(stage.world, stage.size);
    const v = camera.view;
    sendViewport(v.x0, v.y0, v.x1, v.y1);
    chunks.update(v.x0, v.y0, v.x1, v.y1);
    npcs.update(now, TIER_SETTINGS[device.tier].maxAnimatedNpcs, v.x0, v.y0, v.x1, v.y1);
    shopFront.update(bridge.player?.phase ?? 0);
    streetShops.setKeepers(bridge.player?.keepers ?? 0);
    serviceProps.update(now, bridge.player?.phase ?? 0);
    queueUi.update();
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
// iOS may kill a backgrounded tab without another visibilitychange: save on pagehide too.
window.addEventListener('pagehide', () => bridge.save('hidden'));

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
  const panel = installDebugPanel();
  installPerfOverlay({
    stats: loop.stats,
    drawCalls: () => draws?.last ?? 0,
    textureBytes: () =>
      estimateTextureBytes({ atlasPx: 2 * 1024 * 1024, // sprite atlas + recolour atlas
        worldW: stage.size.w, worldH: stage.size.h, devW: stage.size.devW, devH: stage.size.devH, chunkBytes: chunks.textureBytes }),
    simWorkMs: () => view.simWorkMs,
    simFramesReceived: () => bridge.framesReceived,
    budget: () => BUDGETS[device.tier],
    info: () => [
      `tier    ${TIER_NAMES[device.tier]} (${device.source}${device.bench ? `, cpu ${device.bench.cpuScore}, p90 ${device.bench.p90FrameMs} ms` : ''})`,
      `view    ${stage.size.w}×${stage.size.h} ×${stage.size.scale} (zoom ${stage.size.zoom}), dpr ${stage.size.devPerCss.toFixed(2)}`,
      `npcs    ${npcs.visible} on screen, ${npcs.animated} animated (cap ${TIER_SETTINGS[device.tier].maxAnimatedNpcs})`,
      `chunks  ${chunks.liveTextures} live · day ${view.day} ${String(Math.floor(view.gameMinute / 60) % 24).padStart(2, '0')}:${String(view.gameMinute % 60).padStart(2, '0')}`,
    ],
  }, panel.body);
  installMusicDebug(
    music,
    (id) => {
      musicPinned = id;
      pickMusic();
    },
    panel.body,
  );
  showFontSample(panel.body);
}

// ?debug=1 in a production build: just enough for tools/dev/gate.mjs (open the shop, fill it, play).
if (debug) Object.assign(window, { __debug: { bridge, view, pour } });
if (import.meta.env.DEV) Object.assign(window, { __game: { view, bridge, loop, stage, camera, chunks, device, music, objects, npcs, build, pour, dayEnd, serviceProps, queueUi, streetShops } });
