import type { ActiveGame, TriviaQuestion } from '../types.js';

const DIFFICULTY_MULTIPLIER: Record<TriviaQuestion['difficulty'], number> = {
  easy: 1,
  medium: 1.2,
  hard: 1.5,
};

export function scoreAnswer(input: {
  game: ActiveGame;
  question: TriviaQuestion;
  responseMs: number;
  usedHint: boolean;
}): number {
  const limitMs = input.game.timeoutSeconds * 1000;
  const remainingRatio = Math.max(0, Math.min(1, 1 - input.responseMs / limitMs));
  // Zen has no timer, so there is no "remaining time" to reward speed against.
  const speedBonus = input.game.mode === 'zen' ? 0 : Math.round(50 * remainingRatio);
  const modeMultiplier = input.game.mode === 'sprint' ? 1.2 : input.game.mode === 'rapidfire' ? 1.15 : 1;
  const hintMultiplier = input.usedHint ? 0.75 : 1;
  return Math.round(
    (100 + speedBonus) * DIFFICULTY_MULTIPLIER[input.question.difficulty] * modeMultiplier * hintMultiplier,
  );
}
