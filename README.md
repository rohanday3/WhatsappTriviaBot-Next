# WhatsApp Trivia Next

A from-scratch WhatsApp trivia service designed for group chats, direct messages, concurrent games, durable leaderboards, and safe operation on a shared server.

## What is included

- **Group and private games** using the same game engine.
- **Many simultaneous games** across different chats, with one active game per chat so question streams never collide.
- **Classic, Sprint, Daily Run, Rapid Fire, Zen, Survival, and Duel** modes.
- **Per-group and global leaderboards**, including weekly views.
- **Speed-based scoring**, difficulty multipliers, streaks, wins, accuracy, and best scores.
- **Adaptive difficulty by default**, drawing a level-scaled mix of easy/medium/hard questions per player (or per group host) via a per-category leveling system.
- **Achievements** across three difficulty tiers, such as Fast Fingers, Flawless, and Renaissance Mind.
- **Optional one-player hints** that remove two wrong options with a point penalty.
- **Per-chat settings** for question count, timeout, difficulty, category, question cooldown, hints, and round standings.
- **Custom category mixes** retained from the previous bot concept.
- **The Trivia API as the primary source**, with strict category/tag validation, OpenTDB emergency fallback, and a bundled local bank.
- **Durable SQLite question cache** so fetched questions survive restarts and remain available during provider outages.
- **SQLite persistence** for games, scores, settings, message deduplication, per-chat question history, and WhatsApp credentials.
- **Restart recovery** for games that were open when the process stopped.
- **Health endpoints, Prometheus-style metrics, and an admin-only WhatsApp health report**.
- **systemd and Docker isolation** with memory, CPU, process, filesystem, and restart limits.
- **One-command Git updates**, automated backups, auth reset, and diagnostics.

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

## Trivia provider setup

The bot works without an API key for non-commercial use. It requests text-choice questions from **The Trivia API** first, stores them in SQLite, and only uses **OpenTDB** or the bundled bank when the primary pool cannot supply enough fresh questions.

For commercial use or paid API features, add the key issued in The Trivia API dashboard:

```env
THE_TRIVIA_API_KEY=your-api-key
```

Provider controls:

```env
TRIVIA_API_ENABLED=true          # master switch
THE_TRIVIA_API_ENABLED=true      # primary provider
OPENTDB_ENABLED=true             # emergency fallback
TRIVIA_CACHE_MAX_QUESTIONS=20000 # durable SQLite cache cap
```

Category correctness and cooldowns are enforced by the bot even when provider-side duplicate sessions are unavailable. Narrow categories such as `film`, `tv`, `computers`, and `animals` must match the primary question's tags; unrelated broad-category results are discarded.

## Main commands

```text
/play [category] [difficulty] [count]
/sprint
/daily
/rapidfire
/zen
/survival
/duel
/hint
/score
/stop
/skip
/leaderboard [group|global] [weekly]
/stats
/achievements
/levels
/categories
/settings
/set cooldown 7d
/help
/health [full]   # configured bot administrators only
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

### One-command server updates

When the first installation is run from a Git clone, the installer detects the `origin` repository and current branch automatically. Future updates are then:

```bash
sudo update-whatsapp-trivia
```

The updater fetches the configured branch, validates the complete test/typecheck/build suite in a temporary directory, creates a SQLite backup, deploys the release, refreshes the systemd unit and updater itself, and restarts only the trivia service.

For an installation made from a downloaded ZIP, configure the repository once:

```bash
sudo ./scripts/install-updater.sh https://github.com/OWNER/REPOSITORY.git main
sudo update-whatsapp-trivia
```

Alternatively, configure it during the first systemd installation:

```bash
sudo REPO_URL=https://github.com/OWNER/REPOSITORY.git UPDATE_BRANCH=main \
  ./scripts/install-systemd.sh
```

Validate the newest repository commit without deploying or restarting:

```bash
sudo update-whatsapp-trivia --check
```

The repository must be accessible to `root` on the server. For a private repository, configure a read-only deploy key or another non-interactive Git credential for the root account.

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

### Health checks from WhatsApp

Configure one or more trusted administrator numbers in `.env` or `/etc/whatsapp-trivia.env`:

```env
BOT_ADMINS=27821234567,27829876543
```

Use the administrators' own WhatsApp numbers, including the country code, with no `+`, spaces, or leading zero. Restart the service after changing the setting. A WhatsApp group administrator is **not** automatically a server administrator.

```text
/health
/health full
```

`/health` reports readiness, WhatsApp and database state, active games, internal queue depth, uptime, memory, average CPU use, free disk space, reconnect attempts, and the last recorded error. `/health full` adds up to five sanitized error summaries and the Node.js runtime version. Paths, IP addresses, credentials, and stack traces are deliberately omitted.

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

The project ships with tests for concurrent chat isolation, same-chat collision prevention, leaderboards, message deduplication, scoring, queue serialization, strict provider category filtering, durable question caching, database migration, and SQLite auth persistence.

## Documentation

- [Architecture and design](docs/ARCHITECTURE.md)
- [Commands and gameplay](docs/COMMANDS.md)
- [Operations and recovery](docs/OPERATIONS.md)
