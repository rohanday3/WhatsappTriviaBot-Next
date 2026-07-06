# Changelog

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
