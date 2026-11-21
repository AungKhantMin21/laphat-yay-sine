// Pointer Events → gestures. One finger or mouse drags to pan; two fingers pinch to zoom
// (and pan by their midpoint); the wheel or a trackpad pinch zooms in whole steps.
// A drag that starts on something draggable (build ghost) is handed to dragStart/dragMove instead.

export interface GestureHandlers {
  /** Pan by a delta in CSS pixels (positive = content moves right/down). */
  pan(dxCss: number, dyCss: number): void;
  /** +1 = zoom in one whole scale step, −1 = out. */
  zoomStep(dir: 1 | -1): void;
  /** A short press without movement. */
  tap?(xCss: number, yCss: number, pointerType: string): void;
  /** Mouse moving with no button pressed. */
  hover?(xCss: number, yCss: number): void;
  /** Return true to take this drag (it won't pan). */
  dragStart?(xCss: number, yCss: number): boolean;
  dragMove?(xCss: number, yCss: number): void;
  dragEnd?(): void;
}

const PINCH_STEP = 1.3;
const WHEEL_STEP = 120;
const TAP_SLOP = 8;

export function installGestures(el: HTMLElement, h: GestureHandlers): void {
  const ids: number[] = [];
  const xs = new Float64Array(2);
  const ys = new Float64Array(2);
  let pinchRef = 0;
  let downX = 0;
  let downY = 0;
  let moved = false;
  let dragging = false;
  let wheelAcc = 0;

  const slot = (id: number): number => ids.indexOf(id);
  const dist = (): number => Math.hypot(xs[0]! - xs[1]!, ys[0]! - ys[1]!);

  el.addEventListener('pointerdown', (e) => {
    if (ids.length >= 2) return;
    el.setPointerCapture(e.pointerId);
    const i = ids.push(e.pointerId) - 1;
    xs[i] = e.clientX;
    ys[i] = e.clientY;
    if (ids.length === 1) {
      downX = e.clientX;
      downY = e.clientY;
      moved = false;
      dragging = h.dragStart?.(e.clientX, e.clientY) ?? false;
    } else {
      if (dragging) h.dragEnd?.();
      dragging = false;
      pinchRef = dist();
      moved = true; // a two-finger gesture is never a tap
    }
  });

  el.addEventListener('pointermove', (e) => {
    const i = slot(e.pointerId);
    if (i < 0) {
      if (e.pointerType === 'mouse' && e.buttons === 0) h.hover?.(e.clientX, e.clientY);
      return;
    }
    if (ids.length === 1) {
      if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > TAP_SLOP) moved = true;
      if (dragging) h.dragMove?.(e.clientX, e.clientY);
      else h.pan(e.clientX - xs[0]!, e.clientY - ys[0]!);
      xs[0] = e.clientX;
      ys[0] = e.clientY;
      return;
    }
    // Two fingers: pan by the midpoint, zoom in whole steps as the spread changes.
    const mx = (xs[0]! + xs[1]!) / 2;
    const my = (ys[0]! + ys[1]!) / 2;
    xs[i] = e.clientX;
    ys[i] = e.clientY;
    h.pan((xs[0]! + xs[1]!) / 2 - mx, (ys[0]! + ys[1]!) / 2 - my);
    const d = dist();
    if (pinchRef > 0 && d / pinchRef > PINCH_STEP) {
      h.zoomStep(1);
      pinchRef = d;
    } else if (pinchRef > 0 && pinchRef / d > PINCH_STEP) {
      h.zoomStep(-1);
      pinchRef = d;
    }
  });

  const up = (e: PointerEvent): void => {
    const i = slot(e.pointerId);
    if (i < 0) return;
    if (ids.length === 1) {
      if (dragging) h.dragEnd?.();
      // A press on the ghost that never moved is still a tap (place / confirm).
      if (!moved && e.type === 'pointerup') h.tap?.(e.clientX, e.clientY, e.pointerType);
      dragging = false;
    }
    ids.splice(i, 1);
    if (i === 0 && ids.length === 1) {
      xs[0] = xs[1]!;
      ys[0] = ys[1]!;
    }
    pinchRef = 0;
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);

  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      // Trackpad pinch arrives as wheel + ctrlKey with small deltas; scale it up.
      wheelAcc += e.ctrlKey ? e.deltaY * 8 : e.deltaY;
      if (Math.abs(wheelAcc) >= WHEEL_STEP) {
        h.zoomStep(wheelAcc < 0 ? 1 : -1);
        wheelAcc = 0;
      }
    },
    { passive: false },
  );
}
