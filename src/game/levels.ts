export interface LevelTier {
  level: number;
  name: string;
  icon: string;
  minCorrect: number;
}

/** Thresholds are in correct answers, and apply both to a player's overall level and to each category's level. */
export const LEVEL_TIERS: LevelTier[] = [
  { level: 1, name: 'Novice', icon: '🌱', minCorrect: 0 },
  { level: 2, name: 'Apprentice', icon: '📘', minCorrect: 5 },
  { level: 3, name: 'Adept', icon: '⚔️', minCorrect: 15 },
  { level: 4, name: 'Expert', icon: '🎓', minCorrect: 30 },
  { level: 5, name: 'Master', icon: '🏅', minCorrect: 50 },
  { level: 6, name: 'Grandmaster', icon: '💫', minCorrect: 80 },
  { level: 7, name: 'Legend', icon: '👑', minCorrect: 120 },
];

/**
 * There is no max level: past the named tiers above, levels keep generating with each
 * threshold requiring PRESTIGE_GROWTH times the previous tier's span, so long-term players
 * always have a next level to chase instead of capping out.
 */
const PRESTIGE_GROWTH = 1.5;

function tierForLevel(level: number): LevelTier {
  const named = LEVEL_TIERS[level - 1];
  if (named) return named;
  const last = LEVEL_TIERS[LEVEL_TIERS.length - 1]!;
  let span = last.minCorrect - LEVEL_TIERS[LEVEL_TIERS.length - 2]!.minCorrect;
  let minCorrect = last.minCorrect;
  for (let l = LEVEL_TIERS.length + 1; l <= level; l++) {
    span = Math.round(span * PRESTIGE_GROWTH);
    minCorrect += span;
  }
  return { level, name: `Legend +${level - LEVEL_TIERS.length}`, icon: '👑', minCorrect };
}

export interface LevelProgress {
  tier: LevelTier;
  next: LevelTier;
  correct: number;
  progressInTier: number;
  tierSpan: number;
}

export function levelForCorrect(correct: number): LevelProgress {
  let level = 1;
  let tier = tierForLevel(1);
  let next = tierForLevel(2);
  while (correct >= next.minCorrect) {
    level += 1;
    tier = next;
    next = tierForLevel(level + 1);
  }
  return { tier, next, correct, progressInTier: correct - tier.minCorrect, tierSpan: next.minCorrect - tier.minCorrect };
}

export function levelProgressBar(progress: LevelProgress, width = 10): string {
  const filled = Math.round((progress.progressInTier / progress.tierSpan) * width);
  return '▓'.repeat(Math.min(width, Math.max(0, filled))) + '░'.repeat(Math.max(0, width - filled));
}
