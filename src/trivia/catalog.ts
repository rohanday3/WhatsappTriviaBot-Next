export const CATEGORIES = [
  { key: 'general', name: 'General Knowledge', apiId: 9 },
  { key: 'books', name: 'Books', apiId: 10 },
  { key: 'film', name: 'Film', apiId: 11 },
  { key: 'music', name: 'Music', apiId: 12 },
  { key: 'musicals', name: 'Musicals & Theatre', apiId: 13 },
  { key: 'tv', name: 'Television', apiId: 14 },
  { key: 'videogames', name: 'Video Games', apiId: 15 },
  { key: 'boardgames', name: 'Board Games', apiId: 16 },
  { key: 'science', name: 'Science & Nature', apiId: 17 },
  { key: 'computers', name: 'Computers', apiId: 18 },
  { key: 'mathematics', name: 'Mathematics', apiId: 19 },
  { key: 'mythology', name: 'Mythology', apiId: 20 },
  { key: 'sports', name: 'Sports', apiId: 21 },
  { key: 'geography', name: 'Geography', apiId: 22 },
  { key: 'history', name: 'History', apiId: 23 },
  { key: 'politics', name: 'Politics', apiId: 24 },
  { key: 'art', name: 'Art', apiId: 25 },
  { key: 'celebrities', name: 'Celebrities', apiId: 26 },
  { key: 'animals', name: 'Animals', apiId: 27 },
  { key: 'vehicles', name: 'Vehicles', apiId: 28 },
  { key: 'comics', name: 'Comics', apiId: 29 },
  { key: 'gadgets', name: 'Gadgets', apiId: 30 },
  { key: 'anime', name: 'Anime & Manga', apiId: 31 },
  { key: 'cartoons', name: 'Cartoons & Animation', apiId: 32 },
] as const;

export const CATEGORY_GROUPS: Record<string, { name: string; categories: string[] }> = {
  general: { name: 'General Mix', categories: ['general', 'history', 'geography', 'politics'] },
  entertainment: { name: 'Entertainment', categories: ['film', 'music', 'tv', 'books', 'musicals'] },
  games: { name: 'Games', categories: ['videogames', 'boardgames'] },
  stem: { name: 'STEM', categories: ['science', 'computers', 'mathematics', 'gadgets'] },
  pop: { name: 'Pop Culture', categories: ['celebrities', 'music', 'tv', 'film'] },
  nature: { name: 'Nature', categories: ['animals', 'science', 'geography'] },
};

export function categoryByKey(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  return CATEGORIES.find(
    (category) =>
      category.key.replace(/[\s_-]+/g, '') === normalized ||
      category.name.toLowerCase().replace(/[\s&_-]+/g, '') === normalized,
  ) ?? null;
}
