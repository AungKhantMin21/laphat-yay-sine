import { describe, expect, it } from 'vitest';
import { PHASE, clockHolds, dayPhase, minuteOfDay, nextMorning } from '../src/shared/day';
import { SHOP } from '../src/shared/shop';
import { MINUTES_PER_DAY, START_MINUTE } from '../src/shared/layout';

const day = (d: number, minute: number) => d * MINUTES_PER_DAY + minute;

describe('shop day', () => {
  it('a new save starts at opening time', () => {
    expect(START_MINUTE).toBe(SHOP.open);
  });

  it('shutters closed is morning, whatever the time', () => {
    expect(dayPhase(day(0, SHOP.open), false, 0)).toBe(PHASE.morning);
    expect(dayPhase(day(3, SHOP.close + 30), false, 5)).toBe(PHASE.morning);
  });

  it('open until closing time, then closing while customers remain, then evening', () => {
    expect(dayPhase(day(2, SHOP.open), true, 0)).toBe(PHASE.open);
    expect(dayPhase(day(2, SHOP.close - 1), true, 4)).toBe(PHASE.open);
    expect(dayPhase(day(2, SHOP.close), true, 4)).toBe(PHASE.closing);
    expect(dayPhase(day(2, SHOP.close), true, 0)).toBe(PHASE.evening);
  });

  it('the clock holds only in the morning and the evening', () => {
    expect(clockHolds(PHASE.morning)).toBe(true);
    expect(clockHolds(PHASE.open)).toBe(false);
    expect(clockHolds(PHASE.closing)).toBe(false);
    expect(clockHolds(PHASE.evening)).toBe(true);
  });

  it('sleep goes to the next opening time, exactly one day on', () => {
    expect(nextMorning(day(0, SHOP.close + 10))).toBe(day(1, SHOP.open));
    expect(nextMorning(day(5, 23 * 60 + 59))).toBe(day(6, SHOP.open));
  });

  it('sleeping after midnight opens later that same day, never skipping one', () => {
    expect(nextMorning(day(1, 30))).toBe(day(1, SHOP.open));
  });

  it('minuteOfDay wraps', () => {
    expect(minuteOfDay(day(7, 125))).toBe(125);
  });
});
