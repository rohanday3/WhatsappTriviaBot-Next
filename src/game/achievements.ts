import { Repository } from '../db/repository.js';
import { LEVEL_TIERS } from './levels.js';

export type AchievementTier = 'easy' | 'moderate' | 'hard';

export const ACHIEVEMENT_TIER_LABELS: Record<AchievementTier, string> = {
  easy: '🟢 Easy',
  moderate: '🟠 Moderate',
  hard: '🔴 Hard',
};

/** The level a category/overall correct-count must reach to count as "specialist" territory for achievements. */
const SPECIALIST_LEVEL = 3;
const POLYGLOT_CATEGORY_COUNT = 5;

export const ACHIEVEMENTS: Record<string, { icon: string; name: string; description: string; tier: AchievementTier }> = {
  first_correct: { icon: '🎯', name: 'On the Board', description: 'Answer your first question correctly', tier: 'easy' },
  fast_fingers: { icon: '⚡', name: 'Fast Fingers', description: 'Answer correctly in under 3 seconds', tier: 'easy' },
  streak_5: { icon: '🔥', name: 'Heating Up', description: 'Reach a 5-answer correct streak', tier: 'easy' },
  points_1000: { icon: '💎', name: 'Four Figures', description: 'Earn 1,000 total points', tier: 'easy' },
  first_win: { icon: '🏆', name: 'Champion', description: 'Win your first completed game', tier: 'easy' },
  streak_10: { icon: '🌋', name: 'Unstoppable', description: 'Reach a 10-answer correct streak', tier: 'moderate' },
  perfect_game: { icon: '👑', name: 'Flawless', description: 'Get every answer right in a completed game', tier: 'moderate' },
  games_25: { icon: '🎮', name: 'Regular', description: 'Play 25 games', tier: 'moderate' },
  correct_250: { icon: '📖', name: 'Well Read', description: 'Answer 250 questions correctly', tier: 'moderate' },
  points_10000: { icon: '🪙', name: 'High Roller', description: 'Earn 10,000 total points', tier: 'moderate' },
  category_specialist: {
    icon: '🎓',
    name: 'Specialist',
    description: 'Reach level 3 (Adept) in any single category',
    tier: 'moderate',
  },
  streak_20: { icon: '🌠', name: 'Untouchable', description: 'Reach a 20-answer correct streak', tier: 'hard' },
  correct_1000: { icon: '🏛️', name: 'Trivia Sage', description: 'Answer 1,000 questions correctly', tier: 'hard' },
  points_100000: { icon: '💰', name: 'Fortune', description: 'Earn 100,000 total points', tier: 'hard' },
  perfect_10: {
    icon: '🎖️',
    name: 'Untarnished',
    description: 'Get every answer right in a completed game of 10+ questions',
    tier: 'hard',
  },
  polyglot: {
    icon: '🌐',
    name: 'Renaissance Mind',
    description: `Reach level 3 (Adept) in ${POLYGLOT_CATEGORY_COUNT} different categories`,
    tier: 'hard',
  },
};

export function checkAnswerAchievements(
  repository: Repository,
  playerId: number,
  gameId: string,
  correct: boolean,
  responseMs: number,
): string[] {
  const facts = repository.achievementFacts(playerId);
  const candidates: string[] = [];
  if (correct && (facts.correct_answers ?? 0) >= 1) candidates.push('first_correct');
  if (correct && responseMs < 3000) candidates.push('fast_fingers');
  if ((facts.current_streak ?? 0) >= 5) candidates.push('streak_5');
  if ((facts.current_streak ?? 0) >= 10) candidates.push('streak_10');
  if ((facts.current_streak ?? 0) >= 20) candidates.push('streak_20');
  if ((facts.total_points ?? 0) >= 1000) candidates.push('points_1000');
  if ((facts.total_points ?? 0) >= 10000) candidates.push('points_10000');
  if ((facts.total_points ?? 0) >= 100000) candidates.push('points_100000');
  if ((facts.correct_answers ?? 0) >= 250) candidates.push('correct_250');
  if ((facts.correct_answers ?? 0) >= 1000) candidates.push('correct_1000');

  if (correct) {
    const specialistThreshold = LEVEL_TIERS.find((tier) => tier.level === SPECIALIST_LEVEL)?.minCorrect ?? Infinity;
    const categoryRows = repository.categoryStats(playerId);
    const specialistCategories = categoryRows.filter((row) => row.correct >= specialistThreshold);
    if (specialistCategories.length >= 1) candidates.push('category_specialist');
    if (specialistCategories.length >= POLYGLOT_CATEGORY_COUNT) candidates.push('polyglot');
  }

  return candidates.filter((key) => repository.unlockAchievement(playerId, key, gameId));
}

export function checkGameAchievements(
  repository: Repository,
  playerId: number,
  gameId: string,
  won: boolean,
  correct: number,
  totalQuestions: number,
): string[] {
  const facts = repository.achievementFacts(playerId);
  const candidates: string[] = [];
  if (won) candidates.push('first_win');
  if (correct === totalQuestions && totalQuestions > 0) candidates.push('perfect_game');
  if (correct === totalQuestions && totalQuestions >= 10) candidates.push('perfect_10');
  if ((facts.games_played ?? 0) >= 25) candidates.push('games_25');
  return candidates.filter((key) => repository.unlockAchievement(playerId, key, gameId));
}
