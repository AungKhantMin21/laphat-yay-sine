// Ask the browser to keep our storage (IndexedDB saves). Matters most on iOS Safari, which deletes
// site data after 7 days without a visit unless the site is persisted or added to the Home Screen.
let asked = false;

export async function requestPersistentStorage(): Promise<boolean> {
  if (asked) return false;
  asked = true;
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
