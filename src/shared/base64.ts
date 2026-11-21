// base64url without padding, for save codes and (M6) share links. Works in windows and workers.

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Throws on characters outside the base64url alphabet. */
export function fromBase64Url(s: string): Uint8Array {
  const clean = s.trim();
  if (!/^[A-Za-z0-9_-]*$/.test(clean)) throw new Error('not base64url');
  const b64 = clean.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((clean.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
