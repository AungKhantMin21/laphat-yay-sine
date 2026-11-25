// The property market's data (M4) from src/data/properties.json: every building on the street that
// can change hands (houses, small businesses, two lots that join your shop) and the rules of the daily
// roll (DESIGN §5). Validated once at load. The four neighbourhood shops are not properties: they
// never close. sim/world/property-market.ts runs the states; render and ui read this for names.
import raw from '../data/properties.json';
import { NEIGHBOURHOOD, type Neighbourhood, type Rect } from './neighbourhood';
import { RESIDENTS, type ResidentRules } from './residents';
import { SHOP } from './street';

export const PROPERTY_KIND = { house: 0, business: 1, lot: 2 } as const;

/** Property states. */
export const PS = {
  notSelling: 0,
  /** The owner is thinking about it (a life event): listed after a while. */
  considering: 1,
  listed: 2,
  /** Yours (bought), or rented by you (rent at Sleep). */
  owned: 3,
  rented: 4,
} as const;

/** Listing kinds (a lot that joins your shop is offered both ways). */
export const LISTING = { sale: 1, rent: 2, both: 3 } as const;

/** A space that joins your shop when you buy or rent it. */
export interface Expansion {
  rect: Rect;
  /** Which side of the space touches the shop: `w` = its west edge is the shop's east wall. */
  join: 'w' | 'e';
  /** Rows of the party wall that open up ([y0, y1)). */
  opening: [number, number];
}

export interface PropertyDef {
  id: number;
  key: string;
  /** NEIGHBOURHOOD.buildings index. */
  building: number;
  kind: number;
  value: number;
  /** Kyat a day (lots you can rent), else 0. */
  rent: number;
  /** Day it is first listed (lots), or −1. */
  firstListing: number;
  considerChance: number;
  /** For houses: the door (NEIGHBOURHOOD.doors index) its residents use; else −1. */
  door: number;
  expand: Expansion | null;
}

export interface PropertyRules {
  considerChance: number;
  considerDays: [number, number];
  expiry: [number, number];
  urgentChance: number;
  urgentDiscount: [number, number];
  urgentExpiry: [number, number];
  npcBuyChance: number;
  cooldown: [number, number];
  relist: [number, number];
  slowBelow: number;
  slowDays: number;
  closeChance: number;
  /** Rent paid ahead for a rental listing taken by a neighbour (days before it can come up again). */
  rentDays: number;
}

export interface Properties {
  rules: PropertyRules;
  defs: PropertyDef[];
  byKey: Map<string, PropertyDef>;
  /** Property id per building index (−1 = not a property). */
  ofBuilding: Int16Array;
}

interface RawProperty {
  key: string;
  building: number;
  kind: string;
  value: number;
  rent?: number;
  firstListing?: number;
  considerChance?: number;
  expand?: { rect: number[]; join: string; opening: number[] };
}
export interface RawProperties {
  rules: Record<string, number | number[]>;
  properties: RawProperty[];
}

const days = (v: unknown, at: string): [number, number] => {
  const a = v as number[];
  if (!(Array.isArray(a) && a.length === 2 && Number.isInteger(a[0]) && Number.isInteger(a[1]) && a[0]! >= 0 && a[1]! >= a[0]!)) throw new Error(`${at}: expected [min, max] whole days`);
  return [a[0]!, a[1]!];
};
const frac = (v: unknown, at: string): number => {
  if (!(typeof v === 'number' && v >= 0 && v <= 1)) throw new Error(`${at}: expected 0…1`);
  return v;
};

export function buildProperties(d: RawProperties, hood: Neighbourhood = NEIGHBOURHOOD, residents: ResidentRules = RESIDENTS): Properties {
  const r = d.rules;
  const rules: PropertyRules = {
    considerChance: frac(r.considerChance, 'rules.considerChance'),
    considerDays: days(r.considerDays, 'rules.considerDays'),
    expiry: days(r.expiry, 'rules.expiry'),
    urgentChance: frac(r.urgentChance, 'rules.urgentChance'),
    urgentDiscount: [frac((r.urgentDiscount as number[])[0], 'rules.urgentDiscount'), frac((r.urgentDiscount as number[])[1], 'rules.urgentDiscount')],
    urgentExpiry: days(r.urgentExpiry, 'rules.urgentExpiry'),
    npcBuyChance: frac(r.npcBuyChance, 'rules.npcBuyChance'),
    cooldown: days(r.cooldown, 'rules.cooldown'),
    relist: days(r.relist, 'rules.relist'),
    slowBelow: frac(r.slowBelow, 'rules.slowBelow'),
    slowDays: Number(r.slowDays),
    closeChance: frac(r.closeChance, 'rules.closeChance'),
    rentDays: Number(r.rentDays),
  };
  if (!(Number.isInteger(rules.slowDays) && rules.slowDays > 0 && Number.isInteger(rules.rentDays) && rules.rentDays > 0)) throw new Error('rules: slowDays and rentDays must be whole days > 0');
  const byKey = new Map<string, PropertyDef>();
  const ofBuilding = new Int16Array(hood.buildings.length).fill(-1);
  const kinds = PROPERTY_KIND as Record<string, number>;
  const defs = d.properties.map((p, id) => {
    const at = `property "${p.key}"`;
    if (!/^[a-z][a-z0-9_]*$/.test(p.key)) throw new Error(`${at}: bad key`);
    if (byKey.has(p.key)) throw new Error(`${at}: duplicate key`);
    const b = hood.buildings[p.building];
    if (!b) throw new Error(`${at}: unknown building ${p.building}`);
    if (ofBuilding[p.building]! >= 0) throw new Error(`${at}: building ${p.building} is already a property`);
    const kind = kinds[p.kind];
    if (kind === undefined) throw new Error(`${at}: unknown kind "${p.kind}"`);
    if (!(Number.isInteger(p.value) && p.value > 0)) throw new Error(`${at}: value must be a whole number > 0`);
    const rent = p.rent ?? 0;
    if (!(Number.isInteger(rent) && rent >= 0)) throw new Error(`${at}: bad rent`);
    const door = kind === PROPERTY_KIND.house ? hood.doors.findIndex((x) => x.building === p.building) : -1;
    if (kind === PROPERTY_KIND.house && door < 0) throw new Error(`${at}: a house needs an entry door`);
    let expand: Expansion | null = null;
    if (p.expand) {
      const [x0, y0, x1, y1] = p.expand.rect as [number, number, number, number];
      const join = p.expand.join;
      if (join !== 'w' && join !== 'e') throw new Error(`${at}: expand.join must be "w" or "e"`);
      if (!(x1 > x0 && y1 > y0 && x0 >= 0 && y0 >= 0 && x1 <= hood.w && y1 <= hood.h)) throw new Error(`${at}: bad expand.rect`);
      // It must sit against the shop: its front on the shop's front row, touching the shop wall.
      if (y1 !== SHOP.y1 || (join === 'w' ? x0 !== SHOP.x1 : x1 !== SHOP.x0)) throw new Error(`${at}: expand.rect must join the shop`);
      const [o0, o1] = p.expand.opening as [number, number];
      if (!(o0 >= y0 && o1 <= y1 && o1 > o0)) throw new Error(`${at}: bad expand.opening`);
      if (!(rent > 0)) throw new Error(`${at}: a space that joins the shop needs a rent`);
      expand = { rect: { x0, y0, x1, y1 }, join, opening: [o0, o1] };
    }
    const def: PropertyDef = {
      id,
      key: p.key,
      building: p.building,
      kind,
      value: p.value,
      rent,
      firstListing: p.firstListing ?? -1,
      considerChance: p.considerChance === undefined ? rules.considerChance : frac(p.considerChance, `${at} considerChance`),
      door,
      expand,
    };
    byKey.set(p.key, def);
    ofBuilding[p.building] = id;
    return def;
  });
  // Every house has someone living there to own it.
  for (const p of defs) if (p.kind === PROPERTY_KIND.house && !residents.residents.some((x) => x.home === p.door)) throw new Error(`property "${p.key}": nobody lives there`);
  return { rules, defs, byKey, ofBuilding };
}

export const PROPERTIES: Properties = buildProperties(raw as unknown as RawProperties);

/** Building flags in PlayerState.buildings (M4): what its front shows. */
export const BUILDING_FLAG = { forSale: 1, forRent: 2, shut: 4, yours: 8 } as const;
