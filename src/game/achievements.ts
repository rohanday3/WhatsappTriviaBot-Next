import { Repository } from '../db/repository.js';

export const ACHIEVEMENTS: Record<string, { icon: string; name: string; description: string }> = {
  first_correct: { icon: '🎯', name: 'On the Board', description: 'Answer your first question correctly' },
  fast_fingers: { icon: '⚡', name: 'Fast Fingers', description: 'Answer correctly in under 3 seconds' },
  streak_5: { icon: '🔥', name: 'Heating Up', description: 'Reach a 5-answer correct streak' },
  streak_10: { icon: '🌋', name: 'Unstoppable', description: 'Reach a 10-answer correct streak' },
  points_1000: { icon: '💎', name: 'Four Figures', description: 'Earn 1,000 total points' },
  first_win: { icon: '🏆', name: 'Champion', description: 'Win your first completed game' },
  perfect_game: { icon: '👑', name: 'Flawless', description: 'Get every answer right in a completed game' },
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
  if ((facts.total_points ?? 0) >= 1000) candidates.push('points_1000');
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
  const candidates: string[] = [];
  if (won) candidates.push('first_win');
  if (correct === totalQuestions && totalQuestions > 0) candidates.push('perfect_game');
  return candidates.filter((key) => repository.unlockAchievement(playerId, key, gameId));
}
