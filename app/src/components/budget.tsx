import { Pill } from '@/components/badges';
import { Note } from '@/components/chat';
import type { Budget, BudgetFlag } from '@/domain/budget';
import { peso } from '@/domain/prices';

/** Small label on a dish card. Never hides the dish (UC-3.8). */
export function BudgetPill({ flag }: { flag: BudgetFlag | null }) {
  if (!flag) return null;
  return flag === 'over' ? (
    <Pill label="Over budget" tone={{ fg: 'danger', bg: 'dangerSoft' }} />
  ) : (
    <Pill label="Tight on budget" tone={{ fg: 'amber', bg: 'amberSoft' }} />
  );
}

/** Why a dish is flagged, shown on the recipe detail. The user can still cook it. */
export function BudgetNote({ flag, toBuy, budget }: { flag: BudgetFlag | null; toBuy: number; budget: Budget | null }) {
  if (!flag || !budget) return null;
  const text =
    flag === 'over'
      ? `${peso(toBuy)} to buy is more than the ${peso(budget.left)} left in this week's budget. You can still cook it: try fewer servings or a cheaper dish.`
      : `${peso(toBuy)} to buy uses most of the ${peso(budget.left)} left in this week's budget.`;
  return (
    <Note icon="wallet-outline" tone={flag === 'over' ? 'danger' : 'amber'}>
      {text}
    </Note>
  );
}
