// Building materials (M3) from src/data/materials.json: floor tiles and wall paint, sold by the
// pack at the hardware stall and used one unit per tile by the build-mode paint tool. `finish` names
// the floor finish (shared/layout.ts FLOOR key) or wall colour it paints. Validated once at load.
import raw from '../data/materials.json';

export const MATERIAL_KIND = { floor: 0, wall: 1 } as const;

export interface MaterialDef {
  id: number;
  key: string;
  /** i18n key for the display name. */
  name: string;
  kind: number;
  finish: string;
  /** Tiles one pack covers. */
  pack: number;
  /** Base kyat per pack. */
  price: number;
}

export interface Materials {
  defs: MaterialDef[];
  byKey: Map<string, MaterialDef>;
}

export interface RawMaterials {
  materials: { key: string; kind: string; finish: string; pack: number; price: number }[];
}

export function buildMaterials(d: RawMaterials): Materials {
  const defs: MaterialDef[] = [];
  const byKey = new Map<string, MaterialDef>();
  if (d.materials.length > 64) throw new Error('materials: at most 64');
  d.materials.forEach((r, id) => {
    const at = `material "${r.key}"`;
    if (!/^[a-z0-9_]+$/.test(r.key)) throw new Error(`${at}: key must be lower_snake_case`);
    if (byKey.has(r.key)) throw new Error(`${at}: duplicate key`);
    const kind = (MATERIAL_KIND as Record<string, number>)[r.kind];
    if (kind === undefined) throw new Error(`${at}: kind must be floor or wall`);
    if (!r.finish) throw new Error(`${at}: needs a finish`);
    if (!(Number.isInteger(r.pack) && r.pack > 0 && r.pack <= 1000)) throw new Error(`${at}: pack must be a whole number 1…1000`);
    if (!(Number.isInteger(r.price) && r.price > 0)) throw new Error(`${at}: price must be a whole number > 0`);
    const def = { id, key: r.key, name: `material.${r.key}`, kind, finish: r.finish, pack: r.pack, price: r.price };
    defs.push(def);
    byKey.set(r.key, def);
  });
  return { defs, byKey };
}

export const MATERIALS: Materials = buildMaterials(raw as RawMaterials);
