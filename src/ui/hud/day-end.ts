// Evening panel and sleep screen (M2.8). Once the last customer leaves, a small panel shows the
// day (served, cups the player poured, earnings, tips, the best reaction) with a Sleep button. Sleeping
// saves (worker) and shows the sleep screen with one teaser line; "morning" closes it.
import './day-end.css';
import { DRINKS, REACTION_NAMES, reactionFor } from '../../shared/drinks';
import { PHASE } from '../../shared/day';
import type { PlayerState } from '../../shared/protocol';
import { STAFF, hireBlock } from '../../shared/staff';
import { t } from '../i18n';

export interface DayEndDeps {
  player: () => PlayerState | null;
  sleep: () => Promise<boolean>;
  /** Hire / let go a staff member (M2.5); resolve to '' or an i18n reason. */
  hire: (role: string) => Promise<string>;
  dismiss: (role: string) => Promise<string>;
  /** The sleep screen opened or closed (music, other HUD). */
  onSleepScreen?: (open: boolean) => void;
}

export interface DayEndUi {
  refresh(): void;
  /** Tomorrow's teaser arrived from the worker (after sleep). */
  teaser(key: string, drink: number): void;
  /** Sleep paid wages (shown on the sleep screen). */
  wages(paid: number, dayOff: number): void;
  readonly sleeping: boolean;
}

const div = (cls: string, text = ''): HTMLDivElement => {
  const e = document.createElement('div');
  e.className = cls;
  e.textContent = text;
  return e;
};

export function installDayEnd(deps: DayEndDeps): DayEndUi {
  const ui = document.getElementById('ui')!;
  const panel = div('evening hidden');
  const title = div('evening-title', t('evening.title'));
  const lines = div('evening-lines');
  const sleepBtn = document.createElement('button');
  sleepBtn.className = 'hud-btn primary evening-sleep';
  sleepBtn.textContent = t('day.sleep');
  // Staff (M2.5): one row per hireable role — locked / hire / hired with wage and dismiss.
  const staffRow = div('evening-staff');
  const staffText = div('evening-line');
  const staffBtn = document.createElement('button');
  staffBtn.className = 'hud-btn evening-staff-btn';
  staffRow.append(staffText, staffBtn);
  panel.append(title, lines, staffRow, sleepBtn);

  const screen = div('sleep-screen hidden');
  const moon = div('sleep-moon');
  const sTitle = div('sleep-title', t('sleep.title'));
  const line = div('sleep-teaser');
  const wake = document.createElement('button');
  wake.className = 'hud-btn primary sleep-wake';
  wake.textContent = t('sleep.wake');
  const wageLine = div('sleep-teaser sleep-wages');
  screen.append(moon, sTitle, line, wageLine, wake);
  ui.append(panel, screen);

  let sleeping = false;
  let busy = false;
  let shownKey = '';

  function statLines(p: PlayerState): void {
    const s = p.today;
    const rows = [
      t('evening.served', { n: s.served }),
      t('evening.poured', { poured: s.poured }),
      t('evening.earned', { n: s.earned }),
    ];
    if (s.tips > 0) rows.push(t('evening.tips', { n: s.tips }));
    if (s.poured > 0) rows.push(t('evening.best', { react: t(`react.${REACTION_NAMES[reactionFor(s.best / 100)]}`) }));
    const key = rows.join('|');
    if (key === shownKey) return;
    shownKey = key;
    lines.replaceChildren(...rows.map((r) => div('evening-line', r)));
  }

  let staffAction: (() => Promise<string>) | null = null;
  let staffShown = '';
  function staffLine(p: PlayerState): void {
    const role = STAFF.roles.find((r) => r.hireable);
    if (!role) {
      staffRow.classList.add('hidden');
      return;
    }
    const name = t(`staff.${role.key}`);
    const hired = p.staff.find((m) => m.role === role.key);
    let text: string;
    let btn = '';
    if (hired) {
      text = t('staff.wage', { role: name, n: role.wage }) + (hired.dayOff ? ` · ${t('staff.off')}` : '');
      btn = 'staff.dismiss';
      staffAction = () => deps.dismiss(role.key);
    } else if (hireBlock(role, p.money, p.seats)) {
      text = t('staff.locked', { role: name, savings: role.unlock.savings, seats: role.unlock.seats });
      staffAction = null;
    } else {
      text = t('staff.wage', { role: name, n: role.wage });
      btn = 'staff.hire';
      staffAction = () => deps.hire(role.key);
    }
    const key = text + btn;
    if (key === staffShown) return;
    staffShown = key;
    staffText.textContent = text;
    staffBtn.textContent = btn ? t(btn) : '';
    staffBtn.classList.toggle('hidden', !btn);
    staffRow.classList.remove('hidden');
  }
  staffBtn.addEventListener('click', async () => {
    if (busy || !staffAction) return;
    busy = true;
    staffBtn.disabled = true;
    try {
      const reason = await staffAction();
      if (reason) staffText.textContent = t(reason);
    } finally {
      busy = false;
      staffBtn.disabled = false;
    }
  });

  function refresh(): void {
    const p = deps.player();
    const evening = !!p && p.phase === PHASE.evening && !sleeping;
    panel.classList.toggle('hidden', !evening);
    if (evening) {
      statLines(p);
      staffLine(p);
    }
  }

  sleepBtn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    sleepBtn.disabled = true;
    try {
      line.textContent = '';
      wageLine.textContent = '';
      if (await deps.sleep()) {
        sleeping = true;
        screen.classList.remove('hidden');
        deps.onSleepScreen?.(true);
        wake.focus();
      }
    } finally {
      busy = false;
      sleepBtn.disabled = false;
      refresh();
    }
  });

  wake.addEventListener('click', () => {
    if (!sleeping) return;
    sleeping = false;
    screen.classList.add('hidden');
    deps.onSleepScreen?.(false);
    refresh();
  });

  return {
    refresh,
    wages(paid, dayOff) {
      wageLine.textContent = dayOff > 0 ? t('staff.offTomorrow', { n: dayOff }) : paid > 0 ? t('staff.paid', { n: paid }) : '';
    },
    teaser(key, drink) {
      const def = DRINKS.defs[drink];
      line.textContent = t(`teaser.${key}`, { drink: def ? t(def.name) : '' });
    },
    get sleeping() {
      return sleeping;
    },
  };
}
