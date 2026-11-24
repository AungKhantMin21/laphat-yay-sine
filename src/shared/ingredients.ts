// Ingredients (M3) from src/data/ingredients.json: what the kitchen stock holds, counted in cup
// portions. A pack (bought at the wet market) holds `pack` portions for `price` kyat. Each drink's
// `uses` (src/data/drinks.json) says how many portions of each a cup takes. Validated once at load.
import raw from '../data/ingredients.json';

export interface IngredientDef {
  id: number;
  key: string;
  /** i18n key for the display name. */
  name: string;
  /** Portions in one pack. */
  pack: number;
  /** Base kyat per pack (the market's daily price factor applies). */
  price: number;
}

export interface Ingredients {
  defs: IngredientDef[];
  byKey: Map<string, IngredientDef>;
  /** Fewer cups than this left at Sleep: tomorrow's teaser says so. */
  lowCups: number;
}

export interface RawIngredients {
  ingredients: { key: string; pack: number; price: number }[];
  lowCups: number;
}

export function buildIngredients(d: RawIngredients): Ingredients {
  const defs: IngredientDef[] = [];
  const byKey = new Map<string, IngredientDef>();
  if (d.ingredients.length === 0 || d.ingredients.length > 16) throw new Error('ingredients: need 1…16');
  d.ingredients.forEach((r, id) => {
    const at = `ingredient "${r.key}"`;
    if (!/^[a-z0-9_]+$/.test(r.key)) throw new Error(`${at}: key must be lower_snake_case`);
    if (byKey.has(r.key)) throw new Error(`${at}: duplicate key`);
    if (!(Number.isInteger(r.pack) && r.pack > 0 && r.pack <= 1000)) throw new Error(`${at}: pack must be a whole number 1…1000`);
    if (!(Number.isInteger(r.price) && r.price > 0)) throw new Error(`${at}: price must be a whole number > 0`);
    const def = { id, key: r.key, name: `ingredient.${r.key}`, pack: r.pack, price: r.price };
    defs.push(def);
    byKey.set(r.key, def);
  });
  if (!(Number.isInteger(d.lowCups) && d.lowCups >= 0)) throw new Error('ingredients.lowCups: whole number ≥ 0');
  return { defs, byKey, lowCups: d.lowCups };
}

export const INGREDIENTS: Ingredients = buildIngredients(raw as RawIngredients);
