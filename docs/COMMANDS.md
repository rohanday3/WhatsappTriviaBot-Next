# Commands and gameplay

The default prefix is `/`. It can be changed with `COMMAND_PREFIX`.

## Starting games

### `/play [options]`

Starts a Classic game.

Options may appear in any order:

- category key, such as `sports`, `history`, `film`, or `science`;
- category mix, such as `group:entertainment`, which draws questions from every category in the mix;
- tag, such as `tag:renaissance`, to search for something more specific within a category (or across all categories if no category is given). Multiple `tag:` options can be combined;
- difficulty: `mixed`, `easy`, `medium`, or `hard`;
- question count from 3 to 30.

Examples:

```text
/play
/play sports
/play sports hard 15
/play group:general medium 10
/play art tag:renaissance
/play tag:world_war_2 tag:france
```

Tags only work with The Trivia API (the primary question source), since OpenTDB and the bundled question bank have no concept of tags. A tag-scoped game draws only from those sources, so it may offer fewer fresh questions than an untagged game.

`/start` is an alias.

### `/sprint [category] [difficulty]`

Starts a five-question speed game. The question timeout is capped at 12 seconds and correct answers receive a Sprint multiplier.

### `/daily`

Starts a five-question direct-message challenge. Each player receives one attempt per Johannesburg calendar day. It is not available inside groups.

## Answering

Reply with the displayed answer letter, normally `A`, `B`, `C`, or `D`. Questions with two choices accept only `A` or `B`.

Each group participant can answer once per question. A second answer is rejected and cannot replace the first.

### `/hint`

In a one-player chat, removes two wrong options from a four-choice question. A correct answer after using a hint is worth 25% fewer points. The command is hidden from group help, and it is unavailable for two-choice questions because it would reveal the answer.

## Game controls

### `/score`

Shows current game standings.

### `/skip` or `/next`

Reveals the answer and advances. In a group, only the host, a group admin, or a configured bot admin may use it.

### `/stop`

Stops the current game. Group permissions are the same as `/skip`.

## Leaderboards and progression

### `/leaderboard [group|global] [weekly]`

Examples:

```text
/leaderboard
/leaderboard group
/leaderboard group weekly
/leaderboard global
/leaderboard global weekly
```

In a group, `/leaderboard` defaults to that group. In a direct chat, it defaults to global.

`/top` is an alias.

### `/stats` or `/profile`

Shows total points, games, wins, accuracy, streaks, best game, and points in the current chat.

### `/achievements` or `/badges`

Shows locked and unlocked achievements.

Current achievements:

- On the Board — first correct answer;
- Fast Fingers — correct in under three seconds;
- Heating Up — five-answer streak;
- Unstoppable — ten-answer streak;
- Four Figures — 1,000 points;
- Champion — first win;
- Flawless — all questions correct in a completed game.

## Categories

### `/categories`

Lists all bot category keys, plus built-in mixes and any custom mixes for the chat. Categories are grouped into sections that mirror The Trivia API's own ten broad categories (General Knowledge, Arts & Literature, Film & Television, Music, Society & Culture, Science, Sport & Leisure, Geography, History, Food & Drink), since that's the primary question source and the menu should match what players will actually get.

OpenTDB, used as a fallback, has its own 24 fixed categories requestable directly by id; those are mapped internally to the same bot category keys and are not shown as a separate list.

Built-in mixes include:

- `group:general`
- `group:entertainment`
- `group:games`
- `group:stem`
- `group:pop`
- `group:nature`

### `/addgroup <key> "<name>" category1,category2`

Creates a custom category mix for the current chat.

```text
/addgroup mymix "My Favourite Mix" film,music,sports
/play group:mymix
```

In groups, only an admin may change mixes.

### `/removegroup <key>`

Deletes a custom category mix.

## Settings

### `/settings`

Shows current per-chat defaults.

### `/set questions <3-30>`

Sets the default Classic game length.

### `/set timeout <8-90>`

Sets seconds per question.

### `/set revealdelay <500-10000>`

Sets milliseconds between an answer reveal and the next question.

### `/set difficulty <mixed|easy|medium|hard>`

Sets the default difficulty.

### `/set category <category|mixed>`

Sets the default category.

### `/set cooldown <hours|days|off>`

Prevents questions from repeating in the same chat until the cooldown expires. The default is seven days.

Examples:

```text
/set cooldown 24
/set cooldown 48h
/set cooldown 7d
/set cooldown off
```

Question history is isolated by chat, so using a question in one group does not block it in another group.

### `/set hints <on|off>`

Enables or disables hints for one-player games in this chat.

### `/set roundscores <on|off>`

Controls whether group standings are shown after every question.

Group settings require a WhatsApp group admin or configured bot admin.

## Information and diagnostics

- `/help` or `/commands` — command summary.
- `/about` — version and connection warning.
- `/ping` — WhatsApp connection state and active game count.
- `/health` — compact server-health report for configured bot administrators only.
- `/health full` — the same report plus up to five sanitized recent error summaries.

Server administrators are configured through `BOT_ADMINS`. WhatsApp group-admin status alone does not grant access. Unauthorized users receive no diagnostic details.

## Easter eggs retained from the previous bot

- `/egg`
- reply `red pill` or `blue pill`
- `/glitch`
