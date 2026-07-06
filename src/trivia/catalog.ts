import { rankFuzzyMatches } from '../util/fuzzy.js';

// Bot categories are a curated superset that tries to line up with what each
// provider can actually serve:
//  - OpenTDB has 24 fixed categories, each requestable directly by numeric id
//    (https://opentdb.com/api_category.php), so no guessing is needed there.
//  - The Trivia API only exposes 10 broad categories; anything narrower than
//    that (e.g. Art vs Books, both under "arts_and_literature") is resolved
//    with its `tags` filter and validated against the tags a question is
//    actually returned with.
export const CATEGORIES = [
  { key: 'general', name: 'General Knowledge', apiId: 9, openTdbName: 'General Knowledge' },
  { key: 'books', name: 'Books', apiId: 10, openTdbName: 'Entertainment: Books' },
  { key: 'film', name: 'Film', apiId: 11, openTdbName: 'Entertainment: Film' },
  { key: 'music', name: 'Music', apiId: 12, openTdbName: 'Entertainment: Music' },
  { key: 'musicals', name: 'Musicals & Theatre', apiId: 13, openTdbName: 'Entertainment: Musicals & Theatres' },
  { key: 'tv', name: 'Television', apiId: 14, openTdbName: 'Entertainment: Television' },
  { key: 'videogames', name: 'Video Games', apiId: 15, openTdbName: 'Entertainment: Video Games' },
  { key: 'boardgames', name: 'Board Games', apiId: 16, openTdbName: 'Entertainment: Board Games' },
  { key: 'science', name: 'Science & Nature', apiId: 17, openTdbName: 'Science & Nature' },
  { key: 'computers', name: 'Computers', apiId: 18, openTdbName: 'Science: Computers' },
  { key: 'mathematics', name: 'Mathematics', apiId: 19, openTdbName: 'Science: Mathematics' },
  { key: 'mythology', name: 'Mythology', apiId: 20, openTdbName: 'Mythology' },
  { key: 'sports', name: 'Sports', apiId: 21, openTdbName: 'Sports' },
  { key: 'geography', name: 'Geography', apiId: 22, openTdbName: 'Geography' },
  { key: 'history', name: 'History', apiId: 23, openTdbName: 'History' },
  { key: 'politics', name: 'Politics', apiId: 24, openTdbName: 'Politics' },
  { key: 'art', name: 'Art', apiId: 25, openTdbName: 'Art' },
  { key: 'celebrities', name: 'Celebrities', apiId: 26, openTdbName: 'Celebrities' },
  { key: 'animals', name: 'Animals', apiId: 27, openTdbName: 'Animals' },
  { key: 'vehicles', name: 'Vehicles', apiId: 28, openTdbName: 'Vehicles' },
  { key: 'comics', name: 'Comics', apiId: 29, openTdbName: 'Entertainment: Comics' },
  { key: 'gadgets', name: 'Gadgets', apiId: 30, openTdbName: 'Science: Gadgets' },
  { key: 'anime', name: 'Anime & Manga', apiId: 31, openTdbName: 'Entertainment: Japanese Anime & Manga' },
  { key: 'cartoons', name: 'Cartoons & Animation', apiId: 32, openTdbName: 'Entertainment: Cartoon & Animations' },
  // The Trivia API's own category; OpenTDB has no equivalent.
  { key: 'food', name: 'Food & Drink', apiId: null, openTdbName: null },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]['key'];
export type Category = (typeof CATEGORIES)[number];

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
  musical: 'musicals',
  drink: 'food',
  drinks: 'food',
  foodanddrink: 'food',
};

// Every question is also tagged with its own broad category (e.g. "arts_and_literature"),
// which spuriously substring-matches unrelated alias words like "arts" or "literature" below.
const THE_TRIVIA_BROAD_CATEGORY_TAGS = new Set(
  ['general_knowledge', 'arts_and_literature', 'film_and_tv', 'food_and_drink', 'geography',
    'history', 'music', 'science', 'society_and_culture', 'sport_and_leisure'].map(normalizePhrase),
);

// Used only to match the local bundled question bank's plain-text categories
// (data/questions.json), which predates both network providers.
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
  videogames: ['general_knowledge', 'society_and_culture', 'sport_and_leisure'],
  boardgames: ['general_knowledge', 'society_and_culture', 'sport_and_leisure'],
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
  food: ['food_and_drink'],
};

const DIRECT_THE_TRIVIA_CATEGORY_KEYS: Record<string, CategoryKey[]> = {
  general_knowledge: ['general'],
  music: ['music'],
  sport_and_leisure: ['sports'],
  science: ['science'],
  geography: ['geography'],
  history: ['history'],
  food_and_drink: ['food'],
};

/**
 * Tags confirmed against The Trivia API's live `/tags` vocabulary. Used both to
 * narrow the `tags` request parameter (so we ask for the right questions up
 * front instead of discarding wrong ones after the fact) and to validate the
 * tags a returned question actually carries. Categories not listed here either
 * map 1:1 onto a broad category already (see DIRECT_THE_TRIVIA_CATEGORY_KEYS)
 * or have no supporting tag in the API's vocabulary (e.g. anime/celebrities
 * beyond "actors"), so they rely on OpenTDB/local instead.
 */
const THE_TRIVIA_TAGS: Partial<Record<CategoryKey, string[]>> = {
  books: ['books', 'literature', 'novels', 'novel', 'authors', 'poetry', 'classic_novels'],
  film: ['film', 'films', 'movies', 'movie', 'cinema'],
  musicals: ['musicals', 'theatre', 'theater'],
  tv: ['tv'],
  videogames: ['video_games'],
  boardgames: ['board_games'],
  computers: ['computing', 'computer_science', 'software_engineering', 'technology'],
  mathematics: ['mathematics', 'math'],
  mythology: ['mythology', 'myths', 'mythological_creatures'],
  politics: ['politics', 'government', 'elections'],
  art: ['art', 'painting', 'sculpture', 'artists'],
  celebrities: ['actors'],
  animals: ['animals', 'zoology'],
  vehicles: ['cars', 'motoring', 'motor_racing', 'transportation'],
  comics: ['comics', 'superheroes'],
  gadgets: ['electronics'],
  cartoons: ['cartoons'],
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

// `/categories` groups our categories the same way our main question source (The
// Trivia API) organizes its own ten broad categories, so the menu matches what
// players will actually get. Each bot category is placed under the first broad
// category listed for it in THE_TRIVIA_CATEGORY_MAP above.
const SECTION_ORDER = [
  'general_knowledge', 'arts_and_literature', 'film_and_tv', 'music',
  'society_and_culture', 'science', 'sport_and_leisure', 'geography',
  'history', 'food_and_drink',
];

export const CATEGORY_SECTIONS: Array<{ title: string; categories: CategoryKey[] }> = SECTION_ORDER.map(
  (broadCategory) => ({
    title: THE_TRIVIA_CATEGORY_LABELS[broadCategory] ?? titleCase(broadCategory),
    categories: CATEGORIES
      .map((category) => category.key)
      .filter((key) => THE_TRIVIA_CATEGORY_MAP[key][0] === broadCategory),
  }),
).filter((section) => section.categories.length > 0);

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

// Reverse of CATEGORY_KEY_ALIASES: canonical key -> alias words users might type,
// used so aliases also take part in fuzzy/search matching, not just exact lookup.
const CATEGORY_ALIASES_BY_KEY: Partial<Record<CategoryKey, string[]>> = {};
for (const [alias, key] of Object.entries(CATEGORY_KEY_ALIASES)) {
  (CATEGORY_ALIASES_BY_KEY[key as CategoryKey] ??= []).push(alias);
}

// Every tag known to belong to a category, so a bare word like "superheroes"
// can resolve straight to its category (comics) instead of coming back empty.
const TAG_INDEX: Array<{ tag: string; categoryKey: CategoryKey }> = Object.entries(THE_TRIVIA_TAGS).flatMap(
  ([key, tags]) => tags!.map((tag) => ({ tag, categoryKey: key as CategoryKey })),
);

const CATEGORY_SEARCH_CANDIDATES: Array<{ item: Category; text: string }> = CATEGORIES.flatMap((category) => [
  { item: category, text: category.key },
  { item: category, text: category.name },
  ...(CATEGORY_ALIASES_BY_KEY[category.key] ?? []).map((alias) => ({ item: category, text: alias })),
]);

const TAG_SEARCH_CANDIDATES: Array<{ item: (typeof TAG_INDEX)[number]; text: string }> = TAG_INDEX.map((entry) => ({
  item: entry,
  text: entry.tag,
}));

export type TagSuggestion = { tag: string; category: Category };

export type CategoryResolution =
  | { kind: 'category'; category: Category; exact: boolean }
  | { kind: 'tag'; category: Category; tag: string; exact: boolean }
  | { kind: 'suggestions'; categories: Category[]; tags: TagSuggestion[] }
  | { kind: 'none' };

const MAX_CATEGORY_SUGGESTIONS = 5;
const MAX_TAG_SUGGESTIONS = 5;

/**
 * Forgiving lookup for anything a user might type where a category is expected:
 * the canonical key/name, a known alias, a typo of any of those (fuzzy-matched),
 * or even a tag word that belongs to exactly one category (e.g. "superheroes"
 * resolves to comics). Falls back to up to five close-looking category
 * suggestions rather than a bare "not found" so a typo never dead-ends the
 * user; tags are included too whenever they match at least as closely as the
 * best category match, since they can point at a more precise answer.
 */
export function resolveCategoryInput(rawInput: string): CategoryResolution {
  const input = rawInput.trim();
  if (!input) return { kind: 'none' };

  const exact = categoryByKey(input);
  if (exact) return { kind: 'category', category: exact, exact: true };

  const normalizedTag = normalizeUserTag(input);
  const exactTag = TAG_INDEX.find((entry) => entry.tag === normalizedTag);
  if (exactTag) {
    return { kind: 'tag', category: categoryByKey(exactTag.categoryKey)!, tag: exactTag.tag, exact: true };
  }

  const categoryMatches = rankFuzzyMatches(input, CATEGORY_SEARCH_CANDIDATES);
  const bestCategoryDistance = categoryMatches[0]?.distance;
  const topCategories =
    bestCategoryDistance === undefined
      ? []
      : uniqueCategories(categoryMatches.filter((match) => match.distance === bestCategoryDistance).map((match) => match.item));
  if (bestCategoryDistance !== undefined && bestCategoryDistance <= 1 && topCategories.length === 1) {
    return { kind: 'category', category: topCategories[0]!, exact: false };
  }

  const tagMatches = rankFuzzyMatches(input, TAG_SEARCH_CANDIDATES);
  const bestTagDistance = tagMatches[0]?.distance;
  const topTags =
    bestTagDistance === undefined
      ? []
      : uniqueTags(tagMatches.filter((match) => match.distance === bestTagDistance).map((match) => match.item));
  if (bestTagDistance !== undefined && bestTagDistance <= 1 && topTags.length === 1) {
    const match = topTags[0]!;
    return { kind: 'tag', category: categoryByKey(match.categoryKey)!, tag: match.tag, exact: false };
  }

  const suggestedCategories = uniqueCategories(categoryMatches.map((match) => match.item)).slice(0, MAX_CATEGORY_SUGGESTIONS);

  const suggestedTags: TagSuggestion[] =
    bestTagDistance !== undefined && (bestCategoryDistance === undefined || bestTagDistance <= bestCategoryDistance)
      ? uniqueTags(tagMatches.map((match) => match.item))
          .slice(0, MAX_TAG_SUGGESTIONS)
          .map((entry) => ({ tag: entry.tag, category: categoryByKey(entry.categoryKey)! }))
      : [];

  return suggestedCategories.length || suggestedTags.length
    ? { kind: 'suggestions', categories: suggestedCategories, tags: suggestedTags }
    : { kind: 'none' };
}

export interface CatalogSearchResult {
  categories: Category[];
  tagHits: Array<{ category: Category; tag: string }>;
  /** Populated only when there were zero real matches, for a "did you mean" nudge. */
  suggestions: { categories: Category[]; tags: TagSuggestion[] };
}

/** Powers `/categories <query>` — a browsing search, so it surfaces every reasonably close hit rather than just the best one. */
export function searchCatalog(query: string): CatalogSearchResult {
  const input = query.trim();
  const noSuggestions = { categories: [], tags: [] };
  if (!input) return { categories: [], tagHits: [], suggestions: noSuggestions };

  const categoryMatches = rankFuzzyMatches(input, CATEGORY_SEARCH_CANDIDATES, 2);
  const categories = uniqueCategories(categoryMatches.map((match) => match.item)).slice(0, 8);

  const tagMatches = rankFuzzyMatches(input, TAG_SEARCH_CANDIDATES, 2);
  const tagHits = uniqueTags(tagMatches.map((match) => match.item))
    .slice(0, 8)
    .map((entry) => ({ category: categoryByKey(entry.categoryKey)!, tag: entry.tag }));

  if (categories.length || tagHits.length) {
    return { categories, tagHits, suggestions: noSuggestions };
  }

  const wideCategoryMatches = rankFuzzyMatches(input, CATEGORY_SEARCH_CANDIDATES, 4);
  const wideTagMatches = rankFuzzyMatches(input, TAG_SEARCH_CANDIDATES, 4);
  const bestWideCategoryDistance = wideCategoryMatches[0]?.distance;
  const bestWideTagDistance = wideTagMatches[0]?.distance;

  const suggestedCategories = uniqueCategories(wideCategoryMatches.map((match) => match.item)).slice(0, MAX_CATEGORY_SUGGESTIONS);
  const suggestedTags: TagSuggestion[] =
    bestWideTagDistance !== undefined && (bestWideCategoryDistance === undefined || bestWideTagDistance <= bestWideCategoryDistance)
      ? uniqueTags(wideTagMatches.map((match) => match.item))
          .slice(0, MAX_TAG_SUGGESTIONS)
          .map((entry) => ({ tag: entry.tag, category: categoryByKey(entry.categoryKey)! }))
      : [];

  return { categories: [], tagHits: [], suggestions: { categories: suggestedCategories, tags: suggestedTags } };
}

function uniqueCategories(categories: Category[]): Category[] {
  const seen = new Set<CategoryKey>();
  const result: Category[] = [];
  for (const category of categories) {
    if (!seen.has(category.key)) {
      seen.add(category.key);
      result.push(category);
    }
  }
  return result;
}

function uniqueTags(entries: Array<{ tag: string; categoryKey: CategoryKey }>): Array<{ tag: string; categoryKey: CategoryKey }> {
  const seen = new Set<string>();
  const result: Array<{ tag: string; categoryKey: CategoryKey }> = [];
  for (const entry of entries) {
    const id = `${entry.categoryKey}:${entry.tag}`;
    if (!seen.has(id)) {
      seen.add(id);
      result.push(entry);
    }
  }
  return result;
}

export function categoryByOpenTdbId(apiId: number) {
  return CATEGORIES.find((category) => category.apiId === apiId) ?? null;
}

/** Exact match against OpenTDB's own category name strings (e.g. "Entertainment: Books"). */
export function categoryByOpenTdbName(name: string) {
  const normalized = name.trim().toLowerCase();
  return CATEGORIES.find((category) => category.openTdbName?.toLowerCase() === normalized) ?? null;
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

/** Curated tags to send as the `tags` request param to narrow a broad category, if any. */
export function theTriviaRequestTags(categoryKey: string): string[] {
  const category = categoryByKey(categoryKey);
  return category ? THE_TRIVIA_TAGS[category.key] ?? [] : [];
}

export function theTriviaCategoryLabel(value: string): string {
  return THE_TRIVIA_CATEGORY_LABELS[normalizeApiValue(value)] ?? titleCase(value);
}

export function categoryKeysForTheTrivia(categoryValue: string, tags: string[]): CategoryKey[] {
  const sourceCategory = normalizeApiValue(categoryValue);
  const keys = new Set<CategoryKey>(DIRECT_THE_TRIVIA_CATEGORY_KEYS[sourceCategory] ?? []);
  const normalizedTags = tags
    .map(normalizePhrase)
    .filter(Boolean)
    .filter((tag) => !THE_TRIVIA_BROAD_CATEGORY_TAGS.has(tag));

  for (const category of CATEGORIES) {
    const aliases = (THE_TRIVIA_TAGS[category.key] ?? []).map(normalizePhrase);
    if (normalizedTags.some((tag) => aliases.some((alias) => phraseContains(tag, alias)))) {
      keys.add(category.key);
    }
  }
  return [...keys];
}

/** Normalizes a free-form user-supplied tag (e.g. from `/play tag:renaissance`) for the API. */
export function normalizeUserTag(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
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
