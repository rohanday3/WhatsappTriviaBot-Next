# Changelog

## 3.10.6

- Fixed some recipients (most often on iOS) seeing "Waiting for this message. This may take a while." in place of the bot's replies. When a recipient's device fails to decrypt a message it asks the bot to re-send it via a retry receipt, but the socket's `getMessage` callback always returned `undefined`, so Baileys had nothing to re-send and the message stayed stuck. Outbound messages are now cached briefly (10 min, keyed by message ID) so these decryption retries can be answered.

## 3.10.5

- Fixed the 3.10.4 category-label fix overriding the display category for local fallback questions too, which broke their intentional display aliases (e.g. "Movies" for the `film` category, "Technology" for `computers`). The override now only applies to The Trivia API's cached questions, where the staleness problem actually occurs.

## 3.10.4

- Fixed the category name shown above a question sometimes not matching what was actually requested (e.g. "Art" showing for a Books game). The Trivia API's cached questions can legitimately belong to more than one bot category (e.g. an arts_and_literature question tagged both "art" and "books"), but the cache only stored one label, which got overwritten each time the question was refetched under a different category — so a later request could inherit a stale label from an earlier, unrelated one. The displayed label is now always the category actually requested for that game.

## 3.10.3

- Fixed group games basing the early answer reveal on how many players answered the *previous* question instead of who's actually in the chat. It now fetches the live WhatsApp group participant list and only reveals early once every participant has answered; if the list can't be fetched, the question waits the full timeout as before.

## 3.10.2

- Search results and "did you mean" suggestions (`/categories <query>`, `/play`, `/set category`) are now numbered — reply `/play #1` or `/set category #1` to pick one directly instead of retyping its name. Picks are remembered per chat for 10 minutes.
- Lists that were capped (8 for real search hits, 5 for suggestions) now show a `+N more` hint underneath instead of silently cutting off with no indication more matches exist.

## 3.10.1

- Fixed tag matching only knowing about the ~40 tags curated for narrowing specific categories (e.g. `superheroes` for Comics), so a real, exact tag like `culture` wasn't found by `/categories`, `/play`, or `/set category` even though The Trivia API supports it. Tag search/suggestions now match against the API's full ~900-tag vocabulary (`src/trivia/tag-vocabulary.ts`, snapshotted from `https://the-trivia-api.com/v2/tags`); tags outside the curated set aren't tied to one bot category, so selecting one narrows by topic without forcing a category.

## 3.10.0

- "Did you mean" suggestions for an unrecognized category (`/play`, `/set category`, `/categories <query>`) now list up to 5 closest categories and, separately, up to 5 matching tags (with the category each belongs to) whenever a tag is at least as close a match as the best category — previously it was a single merged list capped at 3 names with no way to tell a category suggestion from a tag one.

## 3.9.0

- Removed the level cap: levels 1-7 (Novice through Legend) keep their original thresholds, but past Legend, new "Legend +1", "Legend +2", ... tiers now keep generating indefinitely, each requiring 1.5x the correct answers of the last, so long-term players always have a next level to chase instead of getting stuck at "max level!".
- Fixed adaptive difficulty silently resetting to the easiest question weights for any level beyond Legend; it was only masked by the previous level cap and would have surfaced as soon as levels became uncapped. Difficulty now holds at Legend's hardest weights for all prestige levels.
- Added digit shortcuts (`1`, `2`, `3`, `4`) as a faster alternative to `A`/`B`/`C`/`D` for submitting an answer — on a phone's QWERTY keyboard the number row is easier to hit quickly than hunting for scattered letter keys.

## 3.8.1

- Updated "about" message.

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
