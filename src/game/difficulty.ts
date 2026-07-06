import { levelForCorrect } from './levels.js';

export interface DifficultyWeights {
  easy: number;
  medium: number;
  hard: number;
}

/** Indexed by level - 1 (level 1 Novice through level 7 Legend, see levels.ts). Gets harder as the level rises. */
const WEIGHTS_BY_LEVEL: DifficultyWeights[] = [
  { easy: 0.70, medium: 0.25, hard: 0.05 },
  { easy: 0.55, medium: 0.35, hard: 0.10 },
  { easy: 0.40, medium: 0.40, hard: 0.20 },
  { easy: 0.25, medium: 0.45, hard: 0.30 },
  { easy: 0.15, medium: 0.40, hard: 0.45 },
  { easy: 0.10, medium: 0.35, hard: 0.55 },
  { easy: 0.05, medium: 0.25, hard: 0.70 },
];

export function difficultyWeightsForCorrect(correct: number): DifficultyWeights {
  const { tier } = levelForCorrect(correct);
  return WEIGHTS_BY_LEVEL[tier.level - 1] ?? WEIGHTS_BY_LEVEL[0]!;
}

type DifficultyKey = 'easy' | 'medium' | 'hard';

/** Splits a question count into per-difficulty amounts proportional to the given weights, keeping the total exact. */
export function splitCountByWeights(
  total: number,
  weights: DifficultyWeights,
): Record<DifficultyKey, number> {
  const raw = { easy: total * weights.easy, medium: total * weights.medium, hard: total * weights.hard };
  const floored = { easy: Math.floor(raw.easy), medium: Math.floor(raw.medium), hard: Math.floor(raw.hard) };
  let remainder = total - (floored.easy + floored.medium + floored.hard);
  const keys: DifficultyKey[] = ['easy', 'medium', 'hard'];
  const byLeftoverFraction = keys.sort(
    (a, b) => raw[b] - floored[b] - (raw[a] - floored[a]),
  );
  for (const key of byLeftoverFraction) {
    if (remainder <= 0) break;
    floored[key] += 1;
    remainder -= 1;
  }
  return floored;
}
