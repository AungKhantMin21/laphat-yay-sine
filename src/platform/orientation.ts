// Landscape only. Android: fullscreen + orientation lock on the first tap.
// iPhone has neither API, so the CSS rotate screen (#rotate) covers portrait there.

const coarse = (): boolean => matchMedia('(pointer: coarse)').matches;

export function isPortraitPhone(): boolean {
  return coarse() && matchMedia('(orientation: portrait)').matches;
}

type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> };

async function enterLandscape(): Promise<void> {
  const el = document.documentElement;
  if (!document.fullscreenElement && typeof el.requestFullscreen === 'function') {
    await el.requestFullscreen({ navigationUI: 'hide' });
  }
  const orientation = (screen as Screen & { orientation?: LockableOrientation }).orientation;
  if (orientation?.lock) await orientation.lock('landscape');
}

/** Call once at boot. Only touch devices are taken fullscreen; desktop is left alone. */
export function installLandscapeLock(): void {
  if (!coarse()) return;
  const onFirstTap = (): void => {
    window.removeEventListener('pointerup', onFirstTap);
    // Failures are expected (iPhone, iPad, desktop-mode browsers) and harmless.
    enterLandscape().catch(() => undefined);
  };
  window.addEventListener('pointerup', onFirstTap);
}
