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

export type CategoryKey = (typeof CATEGORIES)[number]['key'];

export const CATEGORY_GROUPS: Record<string, { name: string; categories: string[] }> = {
  general: { name: 'General Mix', categories: ['general', 'history', 'geography', 'politics'] },
  entertainment: { name: 'Entertainment', categories: ['film', 'music', 'tv', 'books', 'musicals'] },
  games: { name: 'Games', categories: ['videogames', 'boardgames'] },
  stem: { name: 'STEM', categories: ['science', 'computers', 'mathematics', 'gadgets'] },
  pop: { name: 'Pop Culture', categories: ['celebrities', 'music', 'tv', 'film'] },
  nature: { name: 'Nature', categories: ['animals', 'science', 'geography'] },
};

const CATEGORY_KEY_ALIASES: Record<string, string> = {
  movie: 'film',
  movies: 'film',
  tech: 'computers',
  technology: 'computers',
  sport: 'sports',
  maths: 'mathematics',
  math: 'mathematics',
  videogame: 'videogames',
  video_games: 'videogames',
  boardgame: 'boardgames',
  board_games: 'boardgames',
};

const QUESTION_CATEGORY_ALIASES: Partial<Record<CategoryKey, string[]>> = {
  general: ['General Knowledge'],
  film: ['Film', 'Movies', 'Movie'],
  science: ['Science & Nature', 'Science'],
  computers: ['Computers', 'Technology', 'Tech'],
  gadgets: ['Gadgets', 'Technology', 'Tech'],
};

/** The Trivia API uses ten broad categories. Narrow bot categories are validated by tags. */
const THE_TRIVIA_CATEGORY_MAP: Record<CategoryKey, string[]> = {
  general: ['general_knowledge'],
  books: ['arts_and_literature'],
  film: ['film_and_tv'],
  music: ['music'],
  musicals: ['arts_and_literature', 'film_and_tv'],
  tv: ['film_and_tv'],
  videogames: ['general_knowledge', 'society_and_culture'],
  boardgames: ['general_knowledge', 'society_and_culture'],
  science: ['science'],
  computers: ['science'],
  mathematics: ['science'],
  mythology: ['society_and_culture', 'arts_and_literature'],
  sports: ['sport_and_leisure'],
  geography: ['geography'],
  history: ['history'],
  politics: ['society_and_culture'],
  art: ['arts_and_literature'],
  celebrities: ['society_and_culture', 'film_and_tv', 'music'],
  animals: ['science'],
  vehicles: ['general_knowledge', 'science'],
  comics: ['arts_and_literature', 'film_and_tv'],
  gadgets: ['science'],
  anime: ['film_and_tv', 'arts_and_literature'],
  cartoons: ['film_and_tv'],
};

const DIRECT_THE_TRIVIA_CATEGORY_KEYS: Record<string, CategoryKey[]> = {
  general_knowledge: ['general'],
  music: ['music'],
  sport_and_leisure: ['sports'],
  science: ['science'],
  geography: ['geography'],
  history: ['history'],
};

const THE_TRIVIA_TAG_ALIASES: Record<CategoryKey, string[]> = {
  general: ['general knowledge'],
  books: ['book', 'books', 'literature', 'novel', 'novels', 'author', 'authors', 'poetry'],
  film: ['film', 'films', 'movie', 'movies', 'cinema'],
  music: ['music', 'musicians', 'bands', 'songs'],
  musicals: ['musical', 'musicals', 'theatre', 'theater', 'broadway', 'west end'],
  tv: ['television', 'tv', 'tv shows', 'television shows'],
  videogames: ['video game', 'video games', 'videogame', 'videogames', 'gaming'],
  boardgames: ['board game', 'board games', 'tabletop'],
  science: ['science'],
  computers: ['computer', 'computers', 'computing', 'computer science', 'technology', 'software', 'programming'],
  mathematics: ['mathematics', 'math', 'maths'],
  mythology: ['mythology', 'myth', 'myths'],
  sports: ['sport', 'sports'],
  geography: ['geography'],
  history: ['history'],
  politics: ['politics', 'political', 'government', 'elections'],
  art: ['art', 'arts', 'painting', 'paintings', 'artists', 'sculpture'],
  celebrities: ['celebrity', 'celebrities', 'actors', 'actresses', 'famous people'],
  animals: ['animal', 'animals', 'zoology', 'wildlife'],
  vehicles: ['vehicle', 'vehicles', 'cars', 'automobiles', 'motoring', 'transport'],
  comics: ['comic', 'comics', 'comic books', 'superheroes'],
  gadgets: ['gadget', 'gadgets', 'electronics', 'consumer technology'],
  anime: ['anime', 'manga'],
  cartoons: ['cartoon', 'cartoons', 'animation', 'animated'],
};

const THE_TRIVIA_CATEGORY_LABELS: Record<string, string> = {
  music: 'Music',
  sport_and_leisure: 'Sport & Leisure',
  film_and_tv: 'Film & Television',
  arts_and_literature: 'Arts & Literature',
  history: 'History',
  society_and_culture: 'Society & Culture',
  science: 'Science',
  geography: 'Geography',
  food_and_drink: 'Food & Drink',
  general_knowledge: 'General Knowledge',
};

export function categoryByKey(value: string | null | undefined) {
  if (!value) return null;
  const normalized = normalizeKey(value);
  const canonical = CATEGORY_KEY_ALIASES[normalized] ?? normalized;
  return CATEGORIES.find(
    (category) =>
      normalizeKey(category.key) === canonical ||
      normalizeKey(category.name) === canonical,
  ) ?? null;
}

export function categoryByOpenTdbId(apiId: number) {
  return CATEGORIES.find((category) => category.apiId === apiId) ?? null;
}

export function categoryByOpenTdbName(name: string) {
  return CATEGORIES.find((category) => questionMatchesCategory(name, category.key)) ?? null;
}

export function questionMatchesCategory(questionCategory: string, categoryKey: string): boolean {
  const category = categoryByKey(categoryKey);
  if (!category) return false;
  const allowedNames = QUESTION_CATEGORY_ALIASES[category.key] ?? [category.name];
  const normalizedQuestionCategory = normalizeKey(questionCategory);
  return allowedNames.some((name) => normalizeKey(name) === normalizedQuestionCategory);
}

export function theTriviaRequestCategories(categoryKey: string): string[] {
  const category = categoryByKey(categoryKey);
  return category ? THE_TRIVIA_CATEGORY_MAP[category.key] : [];
}

export function theTriviaCategoryLabel(value: string): string {
  return THE_TRIVIA_CATEGORY_LABELS[normalizeApiValue(value)] ?? titleCase(value);
}

export function categoryKeysForTheTrivia(categoryValue: string, tags: string[]): CategoryKey[] {
  const sourceCategory = normalizeApiValue(categoryValue);
  const keys = new Set<CategoryKey>(DIRECT_THE_TRIVIA_CATEGORY_KEYS[sourceCategory] ?? []);
  const normalizedTags = tags.map(normalizePhrase).filter(Boolean);

  for (const category of CATEGORIES) {
    const aliases = THE_TRIVIA_TAG_ALIASES[category.key].map(normalizePhrase);
    if (normalizedTags.some((tag) => aliases.some((alias) => phraseContains(tag, alias)))) {
      keys.add(category.key);
    }
  }
  return [...keys];
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeApiValue(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizePhrase(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function phraseContains(value: string, phrase: string): boolean {
  return value === phrase || value.startsWith(`${phrase} `) || value.endsWith(` ${phrase}`) || value.includes(` ${phrase} `);
}

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
