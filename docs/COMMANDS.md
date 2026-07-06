# Commands and gameplay

The default prefix is `/`. It can be changed with `COMMAND_PREFIX`.

## Starting games

### `/play [options]`

Starts a Classic game.

Options may appear in any order:

- category key, such as `sports`, `history`, `film`, or `science`;
- category mix, such as `group:entertainment`, which draws questions from every category in the mix;
- tag, such as `tag:renaissance`, to search for something more specific within a category (or across all categories if no category is given). Multiple `tag:` options can be combined;
- difficulty: `adaptive` (default — scales with the host's level, see below), `mixed`, `easy`, `medium`, or `hard`;
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

#### Adaptive difficulty

`adaptive` is the default difficulty for any chat that hasn't set a specific one with `/set difficulty`. Instead of a fixed easy/medium/hard/mixed split, it looks up the host's level (see [`/levels`](#levels-or-progress)) — using their level in the specific category being played if they have one, otherwise their overall level — and draws a weighted mix of easy/medium/hard questions that gets harder as they level up: mostly easy with a little medium at Novice, roughly even at Adept, mostly hard at Legend. In a group game, the mix is based on whichever player started the game (the host), and is fixed for the whole game — it isn't recalculated per player as they answer. `/play group:<mix>` and multi-category games use the same mix for every category drawn. Explicitly choosing a difficulty (e.g. `/play hard`) always overrides adaptive for that game.

### `/sprint [category] [difficulty]`

Starts a five-question speed game. The question timeout is capped at 12 seconds and correct answers receive a Sprint multiplier.

### `/daily`

Starts a five-question direct-message challenge. Each player receives one attempt per Johannesburg calendar day. It is not available inside groups.

### `/rapidfire [category] [difficulty]`

Starts a 15-question game with the timeout capped at 7 seconds and a small Rapid Fire scoring multiplier — an endurance test rather than Sprint's short burst.

### `/zen [category] [difficulty]`

Starts an untimed game. Each question stays open until it's answered — solo games reveal immediately after your answer, group games reveal once as many players have answered as answered the previous question (or just one, on the first question). There's no speed bonus, so points depend only on the question's difficulty. Because there's no timer, use `/skip` (host or admin) to move on if someone stalls.

### `/survival [category] [difficulty]`

Starts a game where a wrong answer eliminates you for the rest of that game — in a group, everyone else keeps playing. The game ends as soon as everyone who's played so far is eliminated, or the questions run out, whichever comes first.

### `/duel [category] [difficulty]`

Starts a group-only 1v1: the first two players to answer a question become the duelists, and anyone else is turned away. First to 5 correct answers wins; if nobody reaches 5 before the questions run out, whoever's ahead wins. Not available in a direct message (there's no second player).

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

Shows locked and unlocked achievements, grouped by difficulty.

🟢 Easy:

- On the Board — first correct answer;
- Fast Fingers — correct in under three seconds;
- Heating Up — five-answer streak;
- Four Figures — 1,000 points;
- Champion — first win.

🟠 Moderate:

- Unstoppable — ten-answer streak;
- Flawless — all questions correct in a completed game;
- Regular — play 25 games;
- Well Read — 250 correct answers;
- High Roller — 10,000 points;
- Specialist — reach level 3 (Adept) in any single category.

🔴 Hard:

- Untouchable — twenty-answer streak;
- Trivia Sage — 1,000 correct answers;
- Fortune — 100,000 points;
- Untarnished — all questions correct in a completed game of 10+ questions;
- Renaissance Mind — reach level 3 (Adept) in 5 different categories.

### `/levels` or `/progress`

Shows your overall level (Novice through Legend, based on total correct answers) plus a per-category breakdown with a progress bar toward the next level in each category you've played. Levels are driven by how many questions you get correct — the same tiers used for the `category_specialist` and `polyglot` achievements above.

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

### `/set difficulty <adaptive|mixed|easy|medium|hard>`

Sets the default difficulty. `adaptive` (the default) scales question difficulty with the host's level instead of a fixed split — see [Adaptive difficulty](#adaptive-difficulty) above.

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
