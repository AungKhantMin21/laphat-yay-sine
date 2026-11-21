// Stops the page itself from zooming or scrolling; the game handles all gestures.

export function installTouchGuard(): void {
  // iOS Safari ignores user-scalable=no; pinch arrives as non-standard gesture events.
  const block = (e: Event): void => e.preventDefault();
  document.addEventListener('gesturestart', block, { passive: false });
  document.addEventListener('gesturechange', block, { passive: false });
  // Double-tap zoom and the long-press callout.
  document.addEventListener('dblclick', block, { passive: false });
  document.addEventListener('contextmenu', block);
  // Multi-finger touchmove would still pan/zoom the visual viewport on some browsers.
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
}
