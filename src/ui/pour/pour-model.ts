// Pour minigame state, free of the DOM so it can be tested headless.
// Hold to pour tea, release; hold to pour condensed milk, release → the cup is done.
// No timer: holding only adds while the player holds, and the cup simply stops when full.
import { DRINKS, pourScore, type DrinkDef, type PourFlow, type PourRules } from '../../shared/drinks';

export const STAGE = { tea: 0, milk: 1, done: 2 } as const;
export type Stage = (typeof STAGE)[keyof typeof STAGE];

/** A long stall (tab switch, GC) never pours more than this many seconds at once; slow frames still pour in full. */
const MAX_STEP_S = 0.25;

export class PourModel {
  tea = 0;
  milk = 0;
  stage: Stage = STAGE.tea;
  holding = false;
  /** Poured during the current stage's hold(s). */
  private stagePoured = 0;

  constructor(
    readonly drink: DrinkDef,
    private readonly flow: PourFlow = DRINKS.flow,
    private readonly rules: PourRules = DRINKS.pour,
  ) {}

  /** Cup fill, 0…1. */
  get fill(): number {
    return Math.min(1, this.tea + this.milk);
  }

  /** Milk share of what is in the cup, 0…1. */
  get share(): number {
    const s = this.tea + this.milk;
    return s > 0 ? this.milk / s : 0;
  }

  /** Starts holding the pour button. Returns false when there is nothing to pour into. */
  press(): boolean {
    if (this.stage === STAGE.done || this.holding) return false;
    this.holding = true;
    return true;
  }

  /** Pours for `dt` seconds while held. Returns true when the cup changed. */
  advance(dt: number): boolean {
    if (!this.holding || !(dt > 0)) return false;
    const room = 1 - this.tea - this.milk;
    if (room <= 0) return false;
    const rate = this.stage === STAGE.tea ? this.flow.tea : this.flow.milk;
    const add = Math.min(room, rate * Math.min(dt, MAX_STEP_S));
    if (this.stage === STAGE.tea) this.tea += add;
    else this.milk += add;
    this.stagePoured += add;
    return true;
  }

  /**
   * Lets go. A release after pouring ends the stage (tea → milk → done); a tap that poured
   * nothing changes nothing. A full cup skips straight to done.
   */
  release(): void {
    if (!this.holding) return;
    this.holding = false;
    if (this.stagePoured <= 0 && this.fill < 1) return;
    this.stagePoured = 0;
    this.stage = this.fill >= 1 || this.stage === STAGE.milk ? STAGE.done : STAGE.milk;
  }

  /** The soft target mark for the current stage, as a cup fraction from the bottom. */
  target(): number {
    const full = this.rules.fillTarget;
    return this.stage === STAGE.tea ? full * (1 - this.drink.milk) : full;
  }

  /** Live hint score (the worker's score also includes the customer's own taste). */
  score(): number {
    return pourScore(this.drink, this.tea, this.milk, 0, this.rules);
  }
}
