// The property market (M4, DESIGN §5): every property on the street moves through
// not selling → considering → listed (sale or rent) → sold, once a day, plus business closures and
// urgent sales. The roll for day d uses its own stream seeded from (save seed, d), so it is the same
// whether the day was played or caught up, and nothing else the sim draws can shift it.
// Small plain tables (< 64 rows): runs once a day, never per tick.
import { LISTING, NEWS, PROPERTIES, PROPERTY_KIND, PS, BUILDING_FLAG, type Properties, type PropertyDef } from '../../shared/properties';
import { Rng, STREAM, mixSeed } from '../../shared/rng';

export { NEWS } from '../../shared/properties';

export interface NewsItem {
  id: number;
  day: number;
  kind: number;
  /** Property key ('' = none). */
  prop: string;
  a: string;
  b: string;
  /** The player has heard it (gossip). */
  heard: boolean;
}

export interface PropertyState {
  state: number;
  /** LISTING kind while listed (0 otherwise). */
  listing: number;
  /** Asking price (sale) while listed. */
  price: number;
  /** Days left: considering → listed, or listed → withdrawn. */
  days: number;
  /** Days before anything can happen again (after a sale or a withdrawn listing). */
  cooldown: number;
  /** Owner: a resident key ('' = a landlord off the map). */
  owner: string;
  /** A business with its shutters down. */
  closed: boolean;
  listedOnce: boolean;
  urgent: boolean;
  /** Business fortune 0…1 (mean-reverting); slow = days in a row below rules.slowBelow. */
  fortune: number;
  slow: number;
}

/** What the market needs from the rest of the world. */
export interface MarketHooks {
  /** A house sold: its owner may move away and a newcomer move in. Returns [left, came] keys or null. */
  houseSold(p: PropertyDef): [string, string] | null;
}

/** Most news items kept. */
const NEWS_MAX = 24;
const ROLLS = 6;

export class PropertyMarket {
  readonly props: PropertyState[];
  news: NewsItem[] = [];
  nextNews = 1;
  /** The day last rolled (a day is rolled once). */
  rolledDay = -1;
  changed = false;

  constructor(
    private readonly seed: number,
    owners: (p: PropertyDef) => string,
    readonly data: Properties = PROPERTIES,
  ) {
    this.props = data.defs.map((p) => ({
      state: PS.notSelling,
      listing: 0,
      price: 0,
      days: 0,
      cooldown: 0,
      owner: owners(p),
      closed: false,
      listedOnce: false,
      urgent: false,
      fortune: 0.6,
      slow: 0,
    }));
  }

  /** The roll for day `day` (call once per new day: at Sleep, and per caught-up day). */
  rollDay(day: number, hooks: MarketHooks): void {
    if (day <= this.rolledDay) return;
    this.rolledDay = day;
    const r = new Rng(mixSeed((this.seed ^ Math.imul(day + 1, 0x5bd1e995)) | 0, STREAM.events));
    const R = this.data.rules;
    const u = new Float64Array(ROLLS);
    this.data.defs.forEach((def, i) => {
      // Always the same number of draws per property, whatever happens to it.
      for (let k = 0; k < ROLLS; k++) u[k] = r.next();
      const p = this.props[i]!;
      if (p.state === PS.owned || p.state === PS.rented) return;
      if (def.kind === PROPERTY_KIND.business && !p.closed) {
        p.fortune = Math.min(1, Math.max(0, p.fortune * 0.9 + 0.06 + (u[0]! - 0.5) * 0.3));
        p.slow = p.fortune < R.slowBelow ? p.slow + 1 : 0;
      }
      const span = (v: [number, number], x: number): number => v[0] + Math.floor(x * (v[1] - v[0] + 1));
      switch (p.state) {
        case PS.notSelling: {
          if (p.cooldown > 0) {
            p.cooldown--;
            break;
          }
          if (def.expand) {
            const first = def.firstListing >= 0 && day >= def.firstListing && !p.listedOnce;
            if (first || p.listedOnce) this.list(day, def, p, LISTING.both, def.value, span(R.expiry, u[1]!), false);
            else if (u[2]! < def.considerChance) {
              p.state = PS.considering;
              p.days = span(R.considerDays, u[3]!);
            }
            break;
          }
          if (p.closed) {
            this.list(day, def, p, LISTING.rent, def.value, span(R.expiry, u[1]!), false);
            break;
          }
          if (def.kind === PROPERTY_KIND.business && p.slow >= R.slowDays && day % 7 === 0 && u[4]! < R.closeChance) {
            p.closed = true;
            this.post(day, NEWS.closed, def.key, '', '');
            this.list(day, def, p, LISTING.rent, def.value, span(R.expiry, u[1]!), false);
          } else if (u[5]! < R.urgentChance) {
            const off = R.urgentDiscount[0] + u[3]! * (R.urgentDiscount[1] - R.urgentDiscount[0]);
            this.list(day, def, p, LISTING.sale, Math.round((def.value * (1 - off)) / 1000) * 1000, span(R.urgentExpiry, u[1]!), true);
          } else if (u[2]! < def.considerChance) {
            p.state = PS.considering;
            p.days = span(R.considerDays, u[3]!);
          }
          break;
        }
        case PS.considering:
          if (--p.days <= 0) this.list(day, def, p, def.expand ? LISTING.both : def.kind === PROPERTY_KIND.business ? LISTING.rent : LISTING.sale, def.value, span(R.expiry, u[1]!), false);
          break;
        case PS.listed: {
          // A neighbour may take it first (a space that joins your shop less often).
          const buy = def.expand ? R.npcBuyChance / 2 : R.npcBuyChance;
          if (u[4]! < buy) {
            this.soldToNeighbour(day, def, p, hooks);
            p.cooldown = def.expand ? span(R.relist, u[3]!) : p.listing === LISTING.rent ? R.rentDays : span(R.cooldown, u[3]!);
          } else if (--p.days <= 0) {
            this.unlist(p);
            p.cooldown = span(def.expand ? R.relist : R.cooldown, u[3]!);
            this.post(day, NEWS.withdrawn, def.key, '', '');
          }
          break;
        }
        default:
          break;
      }
    });
  }

  private list(day: number, def: PropertyDef, p: PropertyState, listing: number, price: number, expiry: number, urgent: boolean): void {
    p.state = PS.listed;
    p.listing = listing;
    p.price = price;
    p.days = expiry;
    p.urgent = urgent;
    p.listedOnce = true;
    this.changed = true;
    this.post(day, NEWS.listed, def.key, String(listing), urgent ? 'urgent' : '');
  }

  private unlist(p: PropertyState): void {
    p.state = PS.notSelling;
    p.listing = 0;
    p.price = 0;
    p.days = 0;
    p.urgent = false;
    this.changed = true;
  }

  private soldToNeighbour(day: number, def: PropertyDef, p: PropertyState, hooks: MarketHooks): void {
    const rent = p.listing === LISTING.rent;
    this.unlist(p);
    if (p.closed) {
      p.closed = false;
      p.fortune = 0.6;
      p.slow = 0;
      this.post(day, NEWS.reopened, def.key, '', '');
      return;
    }
    if (rent) return;
    const old = p.owner;
    let came = '';
    if (def.kind === PROPERTY_KIND.house) {
      const moved = hooks.houseSold(def);
      if (moved) {
        came = moved[1];
        this.post(day, NEWS.moved, def.key, moved[0], moved[1]);
      }
    }
    p.owner = came;
    this.post(day, NEWS.sold, def.key, old, came);
  }

  /** Adds a news item (oldest dropped past NEWS_MAX). */
  post(day: number, kind: number, prop: string, a: string, b: string): void {
    this.news.push({ id: this.nextNews++, day, kind, prop, a, b, heard: false });
    if (this.news.length > NEWS_MAX) this.news.splice(0, this.news.length - NEWS_MAX);
    this.changed = true;
  }

  /**
   * The newest piece of news the player hasn't heard, marked heard (gossip). News about your own
   * doings and withdrawn listings aren't worth telling: they're simply marked heard.
   */
  tell(): NewsItem | null {
    for (let k = this.news.length - 1; k >= 0; k--) {
      const n = this.news[k]!;
      if (n.heard) continue;
      n.heard = true;
      this.changed = true;
      if (n.kind === NEWS.yours || n.kind === NEWS.withdrawn) continue;
      return n;
    }
    return null;
  }

  /** Property `key` became yours (bought or rented). */
  take(def: PropertyDef, rented: boolean, day: number): void {
    const p = this.props[def.id]!;
    this.unlist(p);
    p.state = rented ? PS.rented : PS.owned;
    p.owner = '';
    this.post(day, NEWS.yours, def.key, rented ? 'rent' : 'buy', '');
    this.news[this.news.length - 1]!.heard = true; // you were there
  }

  /** A lease you couldn't pay ended: the space goes back to its landlord and comes up again later. */
  endLease(def: PropertyDef, day: number): void {
    const p = this.props[def.id]!;
    this.unlist(p);
    p.cooldown = this.data.rules.relist[0];
    this.post(day, NEWS.yours, def.key, 'ended', '');
  }

  /** Front flags per building (PlayerState.buildings). */
  buildingFlags(): number[] {
    const out = new Array<number>(this.data.ofBuilding.length).fill(0);
    this.data.defs.forEach((def, i) => {
      const p = this.props[i]!;
      let f = 0;
      if (p.state === PS.listed) f |= p.listing === LISTING.rent ? BUILDING_FLAG.forRent : BUILDING_FLAG.forSale;
      if (p.closed) f |= BUILDING_FLAG.shut;
      if (p.state === PS.owned || p.state === PS.rented) f |= BUILDING_FLAG.yours;
      out[def.building] = f;
    });
    return out;
  }
}

