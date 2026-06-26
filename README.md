# WhatsApp Trivia Next

A from-scratch WhatsApp trivia service designed for group chats, direct messages, concurrent games, durable leaderboards, and safe operation on a shared server.

## What is included

- **Group and private games** using the same game engine.
- **Many simultaneous games** across different chats, with one active game per chat so question streams never collide.
- **Classic, Sprint, and Daily Run** modes.
- **Per-group and global leaderboards**, including weekly views.
- **Speed-based scoring**, difficulty multipliers, streaks, wins, accuracy, and best scores.
- **Achievements** such as Fast Fingers, Flawless, and Champion.
- **Private 50/50 hints** with a point penalty.
- **Per-chat settings** for question count, timeout, difficulty, category, hints, and round standings.
- **Custom category mixes** retained from the previous bot concept.
- **Open Trivia DB** with a serialized request gate, cache, session token, and local fallback bank.
- **SQLite persistence** for games, scores, settings, message deduplication, question history, and WhatsApp credentials.
- **Restart recovery** for games that were open when the process stopped.
- **Health endpoints and Prometheus-style metrics**.
- **systemd and Docker isolation** with memory, CPU, process, filesystem, and restart limits.
- **Automated backups, auth reset, and diagnostics**.

## Important WhatsApp note

This project uses Baileys, an unofficial WhatsApp Web client library. Use a dedicated number, avoid unsolicited or bulk messaging, and keep the pinned Baileys version updated after testing. Running two copies against the same WhatsApp account or database is not supported.

## Requirements

- Node.js **22.13 or newer**; Node.js 24 LTS is recommended for production
- A WhatsApp account that can link another device
- Linux is recommended for production

No browser, Chromium, Puppeteer, Redis, or external database is required.

## Local setup

```bash
unzip WhatsappTriviaBot-Next.zip
cd WhatsappTriviaBot-Next
cp .env.example .env
npm ci
npm run check
npm start
```

For QR linking, open WhatsApp and go to **Settings → Linked devices → Link a device**, then scan the terminal QR.

For a headless server, edit `.env`:

```env
PAIRING_MODE=code
PAIRING_NUMBER=27821234567
```

Then run `npm start` and enter the pairing code shown in the logs. The phone number must contain digits only and include the country code.

## Main commands

```text
/play [category] [difficulty] [count]
/sprint
/daily
/hint
/score
/stop
/skip
/leaderboard [group|global] [weekly]
/stats
/achievements
/categories
/settings
/help
```

Examples:

```text
/play sports hard 10
/play group:entertainment medium
/sprint science
/leaderboard group weekly
/leaderboard global
```

See [docs/COMMANDS.md](docs/COMMANDS.md) for every command and permission rule.

## Production installation with systemd

The installer copies the project to `/opt/whatsapp-trivia`, builds it, creates an unprivileged service account, installs a hardened unit, and starts the bot.

```bash
sudo ./scripts/install-systemd.sh
sudo editor /etc/whatsapp-trivia.env
sudo systemctl restart whatsapp-trivia
sudo journalctl -u whatsapp-trivia -f
```

Recommended for the first server pairing:

```env
PAIRING_MODE=code
PAIRING_NUMBER=27821234567
```

The service is capped by default at:

- 384 MB memory
- 50% of one CPU
- 64 processes/threads
- 4,096 open files

A crash only restarts this service. It does not restart or stop other applications on the server. Repeated startup failures are rate-limited by systemd.

## Docker Compose

```bash
cp .env.example .env
# Edit .env, preferably using pairing-code mode.
docker compose up --build -d
docker compose logs -f trivia-bot
```

The Compose service uses a read-only root filesystem, drops all Linux capabilities, runs as a non-root user, and applies the same basic CPU, memory, and process limits.

## Health and metrics

The server binds to loopback by default:

```bash
curl http://127.0.0.1:8787/health/live
curl http://127.0.0.1:8787/health/ready
curl http://127.0.0.1:8787/metrics
```

- `/health/live` confirms the process and database loop are alive.
- `/health/ready` returns HTTP 200 only when WhatsApp and the database are ready.
- `/metrics` exposes connection, active-game, uptime, and memory gauges.

Do not expose these endpoints publicly without authentication or a protected reverse proxy.

## Backups

```bash
npm run backup
```

Backups are written to `var/backups/` using SQLite `VACUUM INTO`, which produces a consistent snapshot while the service is running. The default retention is 14 backups.

For a systemd deployment:

```bash
sudo -u whatsapp-trivia bash -lc 'cd /opt/whatsapp-trivia && npm run backup'
```

## Reset a logged-out WhatsApp session

Stop the service first, then clear only the auth tables. Scores and settings remain untouched.

```bash
sudo systemctl stop whatsapp-trivia
cd /opt/whatsapp-trivia
sudo -u whatsapp-trivia node --disable-warning=ExperimentalWarning scripts/reset-auth.mjs --yes
sudo systemctl start whatsapp-trivia
sudo journalctl -u whatsapp-trivia -f
```

## Validation

```bash
npm run doctor
npm run typecheck
npm test
npm run build
npm audit
```

The project ships with tests for concurrent chat isolation, same-chat collision prevention, leaderboards, message deduplication, scoring, queue serialization, and SQLite auth persistence.

## Documentation

- [Architecture and design](docs/ARCHITECTURE.md)
- [Commands and gameplay](docs/COMMANDS.md)
- [Operations and recovery](docs/OPERATIONS.md)
