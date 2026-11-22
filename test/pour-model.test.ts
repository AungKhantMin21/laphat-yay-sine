import { describe, expect, it } from 'vitest';
import { DRINKS, pourScore } from '../src/shared/drinks';
import { PourModel, STAGE } from '../src/ui/pour/pour-model';

const drink = (key: string) => DRINKS.byKey.get(key)!;
/** Holds for `seconds` in steps of `dt`. */
const hold = (m: PourModel, seconds: number, dt = 1 / 30) => {
  m.press();
  for (let t = 0; t < seconds - 1e-9; t += dt) m.advance(Math.min(dt, seconds - t));
  m.release();
};

describe('pour model', () => {
  it('pours tea, then milk, then is done', () => {
    const m = new PourModel(drink('pon_man'));
    expect(m.stage).toBe(STAGE.tea);
    hold(m, 1);
    expect(m.tea).toBeCloseTo(DRINKS.flow.tea, 6);
    expect(m.milk).toBe(0);
    expect(m.stage).toBe(STAGE.milk);
    hold(m, 1);
    expect(m.milk).toBeCloseTo(DRINKS.flow.milk, 6);
    expect(m.stage).toBe(STAGE.done);
    expect(m.press()).toBe(false);
  });

  it('a tap that pours nothing does not end the stage', () => {
    const m = new PourModel(drink('pon_man'));
    m.press();
    m.release();
    expect(m.stage).toBe(STAGE.tea);
    expect(m.tea).toBe(0);
  });

  it('pours nothing unless held, and caps each step so a frame hitch cannot flood the cup', () => {
    const m = new PourModel(drink('pon_man'));
    expect(m.advance(1)).toBe(false);
    m.press();
    m.advance(5);
    expect(m.tea).toBeCloseTo(DRINKS.flow.tea * 0.25, 9);
  });

  it('stops at a full cup; a full cup after tea skips the milk stage', () => {
    const m = new PourModel(drink('pon_man'));
    hold(m, 20);
    expect(m.fill).toBe(1);
    expect(m.tea).toBeCloseTo(1, 9);
    expect(m.stage).toBe(STAGE.done);
  });

  it('pouring to the marks scores (nearly) perfect for every preset', () => {
    for (const d of DRINKS.defs) {
      const m = new PourModel(d);
      const dt = 1 / 60;
      m.press();
      while (m.tea < m.target()) m.advance(dt);
      m.release();
      m.press();
      while (m.fill < m.target()) m.advance(dt);
      m.release();
      expect(m.stage).toBe(STAGE.done);
      expect(m.score(), d.key).toBeGreaterThan(DRINKS.reactions.great);
      expect(m.score()).toBe(pourScore(d, m.tea, m.milk));
    }
  });

  it('the tea mark leaves room for the ordered milk share', () => {
    const d = drink('cho_seint');
    const m = new PourModel(d);
    expect(m.target()).toBeCloseTo(DRINKS.pour.fillTarget * (1 - d.milk), 9);
    hold(m, 0.5);
    expect(m.target()).toBeCloseTo(DRINKS.pour.fillTarget, 9);
  });
});
