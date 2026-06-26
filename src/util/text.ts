const ANSWER_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function answerLetter(index: number): string {
  return ANSWER_LETTERS[index] ?? '?';
}

export function answerIndex(input: string, optionCount: number): number | null {
  const normalized = input.trim().toUpperCase();
  if (normalized.length !== 1) return null;
  const index = ANSWER_LETTERS.indexOf(normalized);
  return index >= 0 && index < optionCount ? index : null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function safeName(value: string, fallback = 'Player'): string {
  const cleaned = value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 60);
  return cleaned || fallback;
}

export function percentage(correct: number, answered: number): string {
  if (answered <= 0) return '0%';
  return `${Math.round((correct / answered) * 100)}%`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
