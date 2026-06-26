# Changelog

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
