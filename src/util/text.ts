const ANSWER_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function answerLetter(index: number): string {
  return ANSWER_LETTERS[index] ?? '?';
}

export function answerIndex(input: string, optionCount: number): number | null {
  const normalized = input.trim().toUpperCase();
  if (normalized.length !== 1) return null;
  // Digits 1-9 are a faster alternative to letters on a phone keyboard: A-D etc. are
  // scattered across the QWERTY layout, while 1-9 sit together in one row.
  if (normalized >= '1' && normalized <= '9') {
    const digitIndex = Number(normalized) - 1;
    return digitIndex < optionCount ? digitIndex : null;
  }
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
