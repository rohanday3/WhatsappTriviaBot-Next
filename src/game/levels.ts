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

export interface LevelProgress {
  tier: LevelTier;
  next: LevelTier | null;
  correct: number;
  progressInTier: number;
  tierSpan: number | null;
}

export function levelForCorrect(correct: number): LevelProgress {
  let tier = LEVEL_TIERS[0];
  for (const candidate of LEVEL_TIERS) {
    if (correct >= candidate.minCorrect) tier = candidate;
  }
  const next = LEVEL_TIERS.find((candidate) => candidate.minCorrect > correct) ?? null;
  const tierSpan = next ? next.minCorrect - tier.minCorrect : null;
  const progressInTier = next ? correct - tier.minCorrect : 0;
  return { tier, next, correct, progressInTier, tierSpan };
}

export function levelProgressBar(progress: LevelProgress, width = 10): string {
  if (!progress.next || !progress.tierSpan) return '▓'.repeat(width);
  const filled = Math.round((progress.progressInTier / progress.tierSpan) * width);
  return '▓'.repeat(Math.min(width, Math.max(0, filled))) + '░'.repeat(Math.max(0, width - filled));
}
