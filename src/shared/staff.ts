// Staff rules from src/data/staff.json (M2.5): roles, wages, unlocks and how much each role likes
// each kind of job. Validated once at load. Only the waiter can be hired in M2.5; helper (M4),
// tea sayar and cook (M5) are defined so the data shape is settled.
import raw from '../data/staff.json';

/** Job kinds a role may do (sim/service/task-board.ts TASK order). */
export const JOB_KINDS = ['order', 'brew', 'serve', 'clear', 'wash', 'cook'] as const;

export interface RoleDef {
  id: number;
  key: string;
  hireable: boolean;
  /** Kyat per day, paid at Sleep from the savings tin. */
  wage: number;
  unlock: { savings: number; seats: number };
  /** Utility weight per task kind id (index = TASK value; 0 = never does it). */
  weight: Float32Array;
  /** Sprite set (render: npc/k<look>). */
  look: number;
}

export interface StaffRules {
  roles: RoleDef[];
  byKey: Map<string, RoleDef>;
  /** Utility: weight − distance × tiles + age × seconds waited + jitter × random. */
  score: { distance: number; age: number; jitter: number };
}

interface RawRole {
  key: string;
  hireable: boolean;
  wage: number;
  unlock: { savings: number; seats: number };
  jobs: Record<string, number>;
  look: number;
}
export interface RawStaff {
  roles: RawRole[];
  score: StaffRules['score'];
}

export function buildStaff(d: RawStaff): StaffRules {
  const roles: RoleDef[] = [];
  const byKey = new Map<string, RoleDef>();
  d.roles.forEach((r, id) => {
    const at = `staff role "${r.key}"`;
    if (byKey.has(r.key)) throw new Error(`${at}: duplicate key`);
    if (!(Number.isInteger(r.wage) && r.wage > 0)) throw new Error(`${at}: wage must be a whole number > 0`);
    if (!(r.unlock.savings >= 0 && Number.isInteger(r.unlock.seats) && r.unlock.seats >= 0)) throw new Error(`${at}: bad unlock`);
    const weight = new Float32Array(JOB_KINDS.length + 1);
    for (const [k, w] of Object.entries(r.jobs)) {
      const kind = (JOB_KINDS as readonly string[]).indexOf(k);
      if (kind < 0) throw new Error(`${at}: unknown job "${k}"`);
      if (!(w > 0 && w <= 10)) throw new Error(`${at}: job weight must be 0…10`);
      weight[kind + 1] = w;
    }
    if (!weight.some((w) => w > 0)) throw new Error(`${at}: needs at least one job`);
    const def: RoleDef = { id, key: r.key, hireable: r.hireable, wage: r.wage, unlock: { ...r.unlock }, weight, look: r.look };
    roles.push(def);
    byKey.set(r.key, def);
  });
  const s = d.score;
  if (!(s.distance >= 0 && s.age >= 0 && s.jitter >= 0)) throw new Error('staff.score: weights must be ≥ 0');
  return { roles, byKey, score: { ...s } };
}

export const STAFF: StaffRules = buildStaff(raw as unknown as RawStaff);

/** Can this role be hired with these savings and seats? Returns '' or an i18n reason. */
export function hireBlock(role: RoleDef, savings: number, seats: number): string {
  if (!role.hireable) return 'staff.err.notYet';
  if (savings < role.unlock.savings) return 'staff.err.savings';
  if (seats < role.unlock.seats) return 'staff.err.seats';
  return '';
}
