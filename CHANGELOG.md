# Changelog

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
