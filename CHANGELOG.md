# Changelog

## 3.8.0

- Added four new game modes: `/rapidfire` (15 questions, 7s timeout, small scoring multiplier), `/zen` (no timer — the round only advances once it's answered), `/survival` (a wrong answer eliminates you for the rest of the game; in a group, everyone else keeps going until all eliminated), and `/duel` (group-only 1v1, first two players to answer become the duelists, first to 5 correct wins). All four also work as `/play <mode>` tokens.
- Fixed the `perfect_game`/`perfect_10` achievements comparing correct answers against the full fetched question set instead of how many questions the game actually played, which would have made them nearly unreachable in Survival/Duel games that end early.

## 3.7.0

- Added adaptive difficulty: `adaptive` is now the default question difficulty (`/set difficulty adaptive` to opt back in on existing chats), replacing the old flat `mixed` default. It looks up the host's level (per-category if they've played that category before, otherwise overall) and draws a weighted mix of easy/medium/hard questions that gets harder as they level up — mostly easy at Novice, roughly even at Adept, mostly hard at Legend. Works the same way in solo and group games (based on whichever player started the game), and in `/play group:<mix>` and multi-category games. Explicitly requesting a difficulty (e.g. `/play hard`) still overrides it.

## 3.6.0

- Added a per-category leveling system: every correct answer now counts toward that category's level (Novice through Legend), tracked in a new `player_category_stats` table (schema v5). Check progress with the new `/levels` command, which shows your overall level plus a breakdown by category with a progress bar to the next tier.
- Added 9 new achievements across two new difficulty tiers (Moderate, Hard), on top of the original 7 — including long streaks, big point/correct-answer milestones, a flawless 10+ question game, and category-mastery achievements (`Specialist`, `Renaissance Mind`) built on the new per-category levels. `/achievements` now groups badges by difficulty.
- Personalized `/about` with author credit (Rohan Dayaram) and website link.

## 3.5.0

- Reworked the category catalog around what each provider actually supports: OpenTDB's 24 categories are matched by an exact reverse lookup instead of fuzzy name guessing, and a new `food` (Food & Drink) category was added for The Trivia API's category with no OpenTDB equivalent.
- Added support for The Trivia API's `tags` filter: narrow bot categories (Art, Books, Musicals, Gadgets, etc.) now send a curated set of real tags with the request itself, instead of only validating tags after the fact. This improves both accuracy and yield for those categories.
- Added a `/play <category> tag:<word>` option (e.g. `/play art tag:renaissance`) for players to search within (or across) categories by topic. Multiple `tag:` options can be combined. Tag-scoped games only draw from The Trivia API and its cache, since OpenTDB and the bundled question bank have no tag data.
- Questions fetched from The Trivia API now have their tags saved to the durable cache (new `trivia_question_tags` table, schema v4), enabling tag-filtered cache reads.
- Reorganized `/categories` into sections that mirror The Trivia API's own ten broad categories (General Knowledge, Arts & Literature, Film & Television, Music, Society & Culture, Science, Sport & Leisure, Geography, History, Food & Drink) instead of one long flat list, so the menu matches what players will actually get.
- Rewrote chat copy across `/help`, `/categories`, `/settings`, `/set`, `/about`, and `/ping` to be plainer and more concise: no more provider names (The Trivia API/OpenTDB), raw connection states, or millisecond values shown to players; `/help` is now grouped into Play/Progress/Info; `/set` confirmations and errors use plain setting names instead of internal field keys.

## 3.4.0

- Fixed Art and Books questions leaking into each other: The Trivia API's generic `arts_and_literature` tag was substring-matching both categories' alias lists and is now excluded from tag-based category matching.
- Fixed `/play musical` (and other singular forms) not resolving to the Musicals & Theatre category.
- Fixed OpenTDB fallback silently returning zero questions for narrow categories (Gadgets, Musicals, and similar) whenever the requested amount exceeded the category's available question pool; the fetch now steps the amount down instead of failing outright.
- Fixed `/play group:<mix>` only ever drawing questions from one random category in the mix; it now distributes questions across every category in the mix.
- Fixed group achievement announcements (e.g. "Fast Fingers", streaks) appearing at answer time, which could reveal that a player answered correctly before the round's reveal. Achievements are now announced alongside the answer reveal.
- Group games now reveal the answer as soon as everyone who answered the previous question has answered the current one, instead of always waiting for the full timeout.

## 3.3.1

- Fixed `update-whatsapp-trivia` validation failing with `Permission denied` when the unprivileged service account entered the temporary staging directory.
- Kept the updater cache root-owned and non-listable while allowing traversal only (`0711`) to service-owned staging directories.

## 3.3.0

- Added `sudo update-whatsapp-trivia` for one-command Git fetch, validation, backup, deployment, and systemd restart.
- Added automatic updater configuration when installing from a Git clone, plus `install-updater.sh` for ZIP-based installations.
- Added `--check` validation-only and `--force` redeployment modes, an exclusive update lock, exact deployed-commit tracking, and protected repository caching.
- Ensured updates preserve the external environment file and SQLite `var` directory, refresh the systemd unit and updater itself, and restart only after validation succeeds.
- Hardened command discovery for server installations whose `sudo` PATH previously omitted `/usr/sbin` tools such as `useradd`.

## 3.2.0

- Added The Trivia API as the primary network question provider.
- Added strict tag-based validation for narrow categories that share a broad API category, preventing Film/Television and similar cross-category leakage.
- Added a durable SQLite question cache that survives restarts and is isolated from per-chat cooldown history.
- Kept OpenTDB as an emergency fallback and the bundled question bank as the final offline fallback.
- Added optional `THE_TRIVIA_API_KEY` support and separate primary/fallback provider controls.
- Added cache pruning, schema migration v3, provider attribution, and automated primary-provider/cache tests.

## 3.1.1

- Fixed category games falling back to unrelated local questions when the API was unavailable or a category had fewer questions than requested.
- Added local category aliases for Movies, Science, and Technology.
- Added a configurable per-chat question cooldown with `/set cooldown`, defaulting to seven days.
- Cooldown exclusions are now always respected; the bot shortens a game rather than inserting unrelated or recently used questions.

## 3.1.0

- Added admin-only `/health` and `/health full` WhatsApp commands.
- Added readiness, WhatsApp, database, game, queue, uptime, memory, CPU, disk, reconnect, and recent-error diagnostics.
- Added in-memory capture of sanitized WhatsApp operational error labels.
- Added live queue statistics for the game engine and outbound transport.
- Hid the health command from non-admin help output and restricted access to `BOT_ADMINS`.
- Added tests and operator documentation for WhatsApp-based health checks.

## 3.0.1

- Clarified private-game hints and removed hints from group help.
- Disabled hints for two-choice questions.
