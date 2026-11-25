// M4 S2: residents — named neighbours with daily plans (keepers at their stalls, work off the map,
// tea at your shop, the market, a stroll). Deterministic for a seed; never on the road; their tea
// visits replace part of the generic arrivals, so the day's customer count stays about the same.
import { describe, expect, it } from 'vitest';
import { Game } from '../src/sim/game';
import { FrameWriter } from '../src/shared/diff';
import { NONE } from '../src/shared/ids';
import { MINUTES_PER_DAY } from '../src/shared/layout';
import { NEIGHBOURHOOD } from '../src/shared/neighbourhood';
import { TICK_HZ } from '../src/shared/protocol';
import { RE, RESIDENTS, buildResidents, planDay, type RawResidents } from '../src/shared/residents';
import { WZ } from '../src/shared/rules/access';
import { SHOP, arrivalRate } from '../src/shared/shop';
import { CUSTOMERS } from '../src/shared/customers';
import { RS } from '../src/sim/npc/residents';
import raw from '../src/data/residents.json';
import { Bot } from './bot';

const writer = new FrameWriter();
const buf = new ArrayBuffer(1 << 16);
function step(g: Game): void {
  writer.begin(buf, g.sim.tick, g.sim.gameMinute);
  g.step(writer);
}
/** Runs the open shop to closing time; `each` is called every step. */
function dayToClose(g: Game, each?: () => void): void {
  g.act({ k: 'openShop' });
  const end = g.sim.day * MINUTES_PER_DAY + SHOP.close;
  for (let i = 0; i < MINUTES_PER_DAY * TICK_HZ && g.sim.gameMinute < end; i++) {
    step(g);
    each?.();
  }
}

describe('resident data', () => {
  it('validates homes, keepers and habits', () => {
    const d = raw as unknown as RawResidents;
    expect(RESIDENTS.residents).toHaveLength(24);
    expect(RESIDENTS.residents.filter((r) => r.keeper >= 0)).toHaveLength(NEIGHBOURHOOD.shops.length);
    const bad = (f: (x: RawResidents) => void): (() => void) => () => {
      const c = JSON.parse(JSON.stringify(d)) as RawResidents;
      f(c);
      buildResidents(c);
    };
    expect(bad((c) => (c.residents[0]!.home = 99))).toThrow(/home/);
    expect(bad((c) => (c.residents[1]!.keeper = 'market'))).toThrow(/already has a keeper/);
    expect(bad((c) => (c.residents[13]!.tea = ['05:00', '07:00', 0.5, 'pon_man']))).toThrow(/opening hours/);
    expect(bad((c) => (c.residents[13]!.tea = ['06:00', '07:00', 0.5, 'nope']))).toThrow(/unknown drink/);
  });

  it('plans are the same for the same seed and day, and outings never fall in work hours', () => {
    for (const def of RESIDENTS.residents) {
      for (let day = 0; day < 10; day++) {
        const a = planDay(7, day, def);
        expect(planDay(7, day, def)).toEqual(a);
        const go = a.find((e) => e.kind === RE.toWork || e.kind === RE.toStall);
        const back = a.find((e) => e.kind === RE.home);
        for (const e of a) {
          if (e.kind < RE.tea || !go || !back) continue;
          expect(e.minute < go.minute || e.minute >= back.minute).toBe(true);
        }
      }
    }
  });
});

describe('residents on the street', () => {
  it('a new morning: keepers of shops already open stand at their stalls, everyone else is indoors', () => {
    const g = Game.create(3);
    const res = g.residents;
    for (let r = 0; r < res.capacity; r++) {
      const d = res.who[r];
      if (!d) continue;
      const site = d.keeper >= 0 ? NEIGHBOURHOOD.shops[d.keeper]! : null;
      // 06:00: the wet market opened at 05:00; the other stalls open later.
      if (site && site.key === 'market') expect(res.state[r]).toBe(RS.standing);
      else expect(res.state[r]).toBe(RS.inside);
    }
  });

  it('they walk out during the day, never on the road or filler, and the day is deterministic', () => {
    const run = (): { trace: number[]; maxOut: number } => {
      const g = Game.create(11);
      const res = g.residents;
      const a = g.world.state.area.access;
      const trace: number[] = [];
      let maxOut = 0;
      let k = 0;
      dayToClose(g, () => {
        if (++k % 20) return;
        maxOut = Math.max(maxOut, res.outside());
        for (let r = 0; r < res.capacity; r++) {
          if (!res.shown[r] || res.state[r] !== RS.walking) continue;
          const z = a[res.tile[r]!]!;
          expect(z === WZ.road || z === WZ.blocked).toBe(false);
          trace.push(r, res.tile[r]!);
        }
      });
      return { trace, maxOut };
    };
    const a = run();
    expect(a.maxOut).toBeGreaterThan(2);
    expect(a.trace.length).toBeGreaterThan(100);
    expect(run().trace).toEqual(a.trace);
  });

  it('tea visits: residents come in as customers, are counted when served, and go back home', () => {
    const g = Game.create(5);
    const bot = new Bot(g, 0);
    let residentsIn = 0;
    dayToClose(g, () => {
      bot.tick();
      for (let i = 1; i < g.npcs.capacity; i++) if (g.npcs.alive[i] && g.npcs.resident[i]! >= 0) residentsIn++;
    });
    expect(residentsIn).toBeGreaterThan(0);
    let visits = 0;
    for (let r = 0; r < g.residents.capacity; r++) visits += g.residents.visits[r]!;
    expect(visits).toBeGreaterThan(2);
    g.act({ k: 'sleep' }); // may refuse while the last ones finish; Sleep clears the street either way below
    for (let i = 0; i < 20000 && g.act({ k: 'sleep' }).ok === false; i++) {
      bot.tick();
      step(g);
    }
    for (let r = 0; r < g.residents.capacity; r++) expect(g.residents.state[r]).not.toBe(RS.visiting);
  });

  it('a full shop turns a resident away calmly (no customer slot): they stay home', () => {
    const g = Game.create(9);
    const res = g.residents;
    res.hooks = { teaVisit: () => NONE };
    dayToClose(g);
    for (let r = 0; r < res.capacity; r++) expect(res.state[r]).not.toBe(RS.visiting);
  });

  it('generic plus resident arrivals stay within ±10 % of the usual daily customer count', () => {
    let seen = 0;
    let expected = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const g = Game.create(seed);
      const appeal = g.npcs.appeal();
      for (let m = SHOP.open; m < SHOP.close; m++) expected += (arrivalRate(m) * appeal) / 60;
      const n = g.npcs;
      const spawn = n.spawn.bind(n);
      const spawnResident = n.spawnResident.bind(n);
      n.spawn = (o?: number) => {
        seen++;
        return spawn(o);
      };
      n.spawnResident = (r, f, d, l) => {
        seen++;
        return spawnResident(r, f, d, l);
      };
      dayToClose(g);
    }
    expect(CUSTOMERS.residentShare).toBeGreaterThan(0);
    expect(seen / expected).toBeGreaterThan(0.9);
    expect(seen / expected).toBeLessThan(1.1);
  });
});
