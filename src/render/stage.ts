// Pixel stage: the world draws into a small RenderTexture (BASE_H rows high, width by aspect),
// then one sprite upscales it by a whole number into a canvas whose backing store is exactly
// CSS size × devicePixelRatio. No browser scaling ever touches the pixels.
import { autoDetectRenderer, Container, RenderTexture, Sprite, type Renderer } from 'pixi.js';
import { BASE_H, computeSize, type StageSize } from './size';

export { BASE_H, type StageSize };

export interface PixelStage {
  readonly renderer: Renderer;
  /** Everything in the world goes here, positioned in world pixels. */
  readonly world: Container;
  /** Full-screen container drawn after the world (upscaled view + future grade pass). */
  readonly screen: Container;
  readonly size: StageSize;
  render(): void;
  /** Recompute sizes now (also runs automatically on resize/orientation change). */
  resize(): void;
  onResize(cb: (size: StageSize) => void): void;
  /** Render textures lose their contents on context loss; redraw cached layers here. */
  onContextRestored(cb: () => void): void;
  /** Device tiers: < 1 renders fewer device pixels and lets CSS upscale (pixelated). */
  setRenderScale(s: number): void;
  /** Whole-scale zoom offset; clamped. Returns the applied value. */
  setZoom(z: number): number;
}

function viewportCss(): { w: number; h: number } {
  // visualViewport tracks the real visible area on iOS when bars show/hide.
  const vv = window.visualViewport;
  return { w: vv ? vv.width : window.innerWidth, h: vv ? vv.height : window.innerHeight };
}

export async function createPixelStage(parent: HTMLElement, background = 0x1b1411): Promise<PixelStage> {
  const renderer = await autoDetectRenderer({
    preference: 'webgl',
    width: 1,
    height: 1,
    resolution: 1,
    autoDensity: false,
    antialias: false,
    background,
    powerPreference: 'low-power',
    roundPixels: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  });

  const canvas = renderer.canvas as HTMLCanvasElement;
  canvas.style.imageRendering = 'pixelated';
  parent.appendChild(canvas);

  const world = new Container();
  const screen = new Container();
  // dynamic: the upscaled sprite must follow the texture when zoom or resize changes its size.
  const target = RenderTexture.create({ width: BASE_H, height: BASE_H, scaleMode: 'nearest', resolution: 1, antialias: false, dynamic: true });
  const view = new Sprite(target);
  view.roundPixels = true;
  screen.addChild(view);

  const size: StageSize = { w: 1, h: 1, scale: 1, devW: 1, devH: 1, devPerCss: 1, zoom: 0 };
  const resizeCbs: Array<(s: StageSize) => void> = [];
  const restoreCbs: Array<() => void> = [];
  let lost = false;
  let renderScale = 1;
  let zoom = 0;

  function resize(): void {
    const css = viewportCss();
    const dpr = window.devicePixelRatio || 1;
    const next = computeSize(css.w, css.h, dpr, renderScale, zoom);
    Object.assign(size, next);
    renderer.resize(size.devW, size.devH, 1);
    // CSS size derived from the backing size so the ratio is exact.
    canvas.style.width = `${size.devW / dpr / renderScale}px`;
    canvas.style.height = `${size.devH / dpr / renderScale}px`;
    target.resize(size.w, size.h, 1);
    view.scale.set(size.scale);
    for (const cb of resizeCbs) cb(size);
  }

  let pending = 0;
  const scheduleResize = (): void => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      resize();
    });
  };
  window.addEventListener('resize', scheduleResize);
  window.visualViewport?.addEventListener('resize', scheduleResize);
  window.addEventListener('orientationchange', scheduleResize);

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // allows the browser to restore the context
    lost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    resize();
    for (const cb of restoreCbs) cb();
  });

  resize();

  return {
    renderer,
    world,
    screen,
    size,
    render(): void {
      if (lost) return;
      renderer.render({ container: world, target, clear: true });
      renderer.render({ container: screen });
    },
    resize,
    onResize(cb): void {
      resizeCbs.push(cb);
    },
    onContextRestored(cb): void {
      restoreCbs.push(cb);
    },
    setRenderScale(s: number): void {
      renderScale = s;
      resize();
    },
    setZoom(z: number): number {
      zoom = z;
      resize();
      zoom = size.zoom;
      return zoom;
    },
  };
}
