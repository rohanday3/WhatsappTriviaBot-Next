# Architecture and design

## Design goals

1. A player can message the bot directly and receive a private game.
2. The bot can be added to a group, where every participant may answer each question once.
3. Different chats can run games at the same time without sharing timers, questions, scores, or outbound queues.
4. One chat cannot start overlapping games, because two question streams in one WhatsApp conversation are ambiguous.
5. A process crash must not corrupt scores, credentials, or active-game state.
6. A bot failure must be contained so it does not consume the whole server or disturb unrelated applications.

## Message flow

```text
WhatsApp / Baileys
        │
        ▼
Incoming-message normalization
        │
        ├── durable message-ID deduplication
        ├── LID / phone-number identity mapping
        └── player and chat upsert
        │
        ▼
Command router
        │
        ├── chat-scoped settings and permissions
        └── answer or command dispatch
        │
        ▼
Per-chat serialized queue
        │
        ▼
Game state machine
        │
        ├── waiting
        ├── open
        ├── revealing
        └── finished
        │
        ▼
SQLite transaction
        │
        ▼
Per-chat outbound queue → WhatsApp
```

## Concurrency model

The service is a single Node.js process, but it supports many concurrent games because each chat owns independent game state and timers.

A keyed queue serializes actions that target the same chat. This prevents races such as:

- two `/play` commands creating duplicate games;
- an answer arriving while the timeout reveal is running;
- `/stop` and `/skip` mutating the same question concurrently;
- messages being sent to one chat out of order.

Different chat keys run concurrently. Slow work in Group A does not block a private game or Group B.

The database also has a partial unique index that allows only one row with `status = 'active'` for each chat. This is a second, durable guard even if an application-level race is introduced later.

## Game rules

### Private game

- The host is the only participant.
- A correct or wrong answer immediately closes the question.
- Faster correct answers receive more points.
- In one-player games, a player can remove two wrong options once per four-choice question. A hinted correct answer receives a 25% point penalty; hints are unavailable for two-choice questions.

### Group game

- The user who starts the game is the host.
- Anyone in the group may join by answering.
- Each participant gets one answer per question.
- Answers remain open until the timeout or until the host/admin uses `/skip`.
- The reveal shows the correct answer, the fastest correct players, and optional round standings.
- Only the host, a WhatsApp group admin, or a configured bot admin may stop or skip.

### Modes

- **Classic:** chat settings control question count and timeout.
- **Sprint:** five questions with a maximum 12-second timeout and a score multiplier.
- **Daily Run:** five personal questions, one attempt per player per Johannesburg calendar date. Daily Run is direct-message only so attempts remain personal and unambiguous.

## Scoring

A correct answer starts at 100 points.

- Up to 50 additional points are awarded based on remaining time.
- Medium questions multiply the result by 1.2.
- Hard questions multiply the result by 1.5.
- Sprint mode multiplies it by 1.2.
- A used hint multiplies it by 0.75.
- Wrong answers receive zero points and reset the correct-answer streak.

All scores are integer-rounded once at the end.

## Leaderboards

The schema stores both global player totals and materialized per-chat statistics.

- `/leaderboard group` reads `player_chat_stats`.
- `/leaderboard global` reads global player totals.
- Weekly leaderboards aggregate immutable answer rows from the start of the current week.
- Game results preserve player ranks and scores for auditing.

## Identity handling

Modern WhatsApp group messages may identify a sender with a Linked ID (`@lid`) while direct chats use a phone JID. The transport preserves both the primary sender ID and its alternate phone ID when available. The repository resolves either alias to one player record, preventing separate global leaderboard entries for the same person.

## Persistence and restart recovery

The following data is persisted in one SQLite database:

- WhatsApp authentication credentials and signal keys;
- players and aliases;
- chats and settings;
- games and participants;
- the exact question set and correct index for each game;
- answers, response time, and awarded points;
- group/global statistics and achievements;
- used-question history;
- daily attempts;
- processed message IDs.

SQLite runs in WAL mode with foreign keys, a busy timeout, and periodic passive checkpoints.

On startup, active games are reconstructed from the database. Once WhatsApp reconnects:

- an unexpired open question is re-sent with its remaining time;
- an expired question is revealed;
- a waiting question is opened;
- a game already at its end is completed.

## Trivia provider

The provider uses a layered source order:

1. compatible questions already cached in SQLite from The Trivia API;
2. fresh text-choice questions from The Trivia API;
3. compatible OpenTDB cache entries and then an OpenTDB network request;
4. the bundled local question bank.

Reliability and quality controls include:

- separate serialized request queues and rate limits for the primary and fallback providers;
- an API timeout and optional The Trivia API key;
- OpenTDB session-token acquisition and reset;
- durable category/difficulty/source-indexed SQLite caching;
- strict tag validation for narrow categories that share a broad primary category;
- persistent per-chat question-history exclusion;
- a configurable cache-size cap with oldest-entry pruning;
- no relaxation of category or cooldown rules when a provider is unavailable.

The durable cache is global because questions are reusable, while `question_history` remains scoped to each chat. This lets one group reuse a cached question that another group has seen without violating either group's cooldown.

## WhatsApp transport

The transport is isolated from game logic. It provides:

- SQLite-backed Baileys auth state rather than a high-I/O multi-file auth directory;
- QR and pairing-code linking;
- exponential reconnect backoff with jitter;
- duplicate reconnect-timer prevention;
- outbound retry and per-chat ordering;
- group-admin metadata caching;
- LID and phone-JID normalization;
- no Chromium or Puppeteer process.

The Baileys version is pinned exactly. Upgrade it deliberately, run the checks, then pair/test on a non-critical number before production rollout.

## Administrative health reporting

The same in-process health state used by the loopback HTTP endpoint is available through `/health` to numbers explicitly configured in `BOT_ADMINS`. The command adds process and operational diagnostics such as queue depths, memory, CPU average, database size, free disk space, reconnect attempts, and sanitized recent error labels. It does not execute shell commands or expose paths, hostnames, IP addresses, credentials, environment variables, or stack traces.

`/health full` includes at most five in-memory error summaries. These entries are reset on process restart and are operational hints, not a replacement for the systemd journal. WhatsApp group administrators do not inherit server-level access.

## Server containment

The systemd unit runs under an unprivileged account and applies:

- memory high-water and hard limits;
- CPU quota;
- process/thread and file-descriptor limits;
- restart-on-failure with burst limiting;
- read-only system files with write access only to the bot’s `var` directory;
- private `/tmp`;
- no privilege escalation;
- kernel, namespace, and capability restrictions.

Docker Compose provides equivalent non-root, read-only, capability-drop, memory, CPU, and PID controls.

## Extension points

Useful additions can be implemented without replacing the engine:

- team mode and team leaderboards;
- scheduled tournament nights;
- user-submitted question moderation;
- image/audio questions;
- seasonal leagues;
- a small authenticated web dashboard;
- PostgreSQL and a distributed lock for multi-instance scaling.

The current build intentionally remains a single active instance. Running multiple replicas against one WhatsApp account or one SQLite file would require distributed ownership and is not supported.
