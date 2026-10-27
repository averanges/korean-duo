# Korean Duo — first playable round

A cooperative two-player Korean grammar game. Node.js + Express + Socket.IO; HTML, CSS, and vanilla JavaScript. Russian interface based on the approved navy/green/blue reference, with six supplied WebP illustrations served as individual files. The reference screenshot is not used as a background.

This version deliberately includes **one 60-second round**. The engine supports additional rounds, but advanced levels are not implemented yet.

## Start locally

Install Node.js 20 or newer. In this folder:

```sh
npm ci
npm start
```

Open **http://localhost:3000** in two independently opened browser tabs/sessions, browsers, or devices. A creates a room and shares the five-character code. B joins, then A starts.

For devices on the same network, use the server computer's local network address and port 3000 instead of localhost. The app listens on `0.0.0.0` and uses `PORT` if configured. No database, accounts, API keys, microphone, speech recognition, AI, or chat service is required.

## Round 1

| Card | Action | Korean vocabulary | Correct status |
| --- | --- | --- | --- |
| 1 | Reading a book | 책을 읽다 | REQUIRED |
| 1 | Drinking water | 물을 마시다 | FORBIDDEN |
| 1 | Dancing | 춤을 추다 | REQUIRED |
| 2 | Running | 달리다 | FORBIDDEN |
| 2 | Eating an apple | 사과를 먹다 | REQUIRED |
| 2 | Sleeping | 자다 | REQUIRED |

A sees Card 1's clues on the left and answers Card 2 on the right. B sees Card 2's clues on the left and answers Card 1 on the right. **Each browser shows one player's interface.**

Talk in person or through your own call. Use **아/어야 돼요** for required actions and **지 마세요** for forbidden actions. Only vocabulary labels, illustrations, and grammar choice labels appear; unknown actions never display the completed correct sentence.

- Use either pair of arrows to switch between unknown actions. Choices are saved on the server and remain selected when returning to an action. Small dots show which actions have answers.
- `Завершить раунд` enables after all unknown actions have a saved choice. Until then, answers can be changed. Submission locks choices and displays `Ожидаем напарника`.
- Both submissions end the round immediately. Otherwise the server ends it at 60 seconds, even with disconnected players or incomplete cards.
- Timeout scores the latest saved choices, including unsubmitted choices; unanswered actions are incorrect.
- Results show A's score, B's score, combined score, whether both submitted before the deadline, and every correct status. All-correct answers and finishing before the deadline are reported separately.
- Results remain until the host acts. With one configured round, the host sees `Сыграть ещё раз`. When more rounds are added, `Следующий раунд` appears automatically. Both players must be connected to restart or advance.

## Files and architecture

```text
server.js                 Rooms, private seat views, validation, timers, scoring
content/rounds.json        One playable round and answer keys; never served publicly
content/PROGRESSION.md     Future content/scene architecture notes
public/index.html         Russian entry, lobby, game, and result views
public/style.css          Dark desktop layout and responsive stacked layout
public/app.js             Carousel, saved choices, Socket.IO client, recovery
public/assets/*.webp      Six supplied first-round illustrations
test/multiplayer.test.js  Real simultaneous Socket.IO client integration tests
MANUAL-TEST.md            Recorded browser checks and repeatable checklist
```

`server.js` serves only `public/`. Personalized snapshots whitelist public action properties and include `status` only for the player's known card, or for all cards after results. Seat tokens, partner drafts, and hidden statuses are absent from pre-reveal snapshots. Answers are not derived from image names, and the browser contains no answer key.

The server chooses the answerable card from the seat, validates action IDs and `REQUIRED`/`FORBIDDEN` statuses, requires complete drafts for submission, and rejects duplicate submissions and edits after locking. Each start/restart creates a fresh `roundInstance` token. Answer events carry both round ID and instance, so delayed events from an earlier attempt cannot modify a restarted round with the same content ID.

The server sets an absolute deadline, schedules expiry, and rechecks the deadline on commands. The client receives `serverNow`, estimates its clock offset, and displays the remaining time. It resynchronizes every 15 seconds and when returning to the tab. Local countdown display never decides acceptance or scoring.

Socket events:

- `enter`: `{mode: 'create' | 'join' | 'resume', code?, token?}`; successful acknowledgement returns `{ok: true, code, token}`.
- `command`: `{type, roundId?, roundInstance?, actionId?, status?}`; types are `start`, `answer`, `submit`, `next`, `restart`.
- `sync`: requests the latest personalized snapshot.
- Server `state`: seat, host role, connection/submission statuses, phase, round, deadline, private own draft, and results when available.
- Entry/command failures return `{ok: false, error}`; the UI translates expected messages into Russian.

## Edit content

Edit `content/rounds.json`, then restart. Content uses an array; each round has exactly two cards. IDs must be unique within their scope, durations positive, and each card must contain at least one action.

```json
[
  {
    "id": "round-1",
    "title": "Первый раунд · 기본 행동",
    "durationSeconds": 60,
    "cards": [
      {
        "id": "card-1",
        "title": "Карточка 1",
        "actions": [
          {
            "id": "read",
            "label": "책을 읽다",
            "english": "Reading a book",
            "image": "/assets/read.webp",
            "status": "REQUIRED"
          }
        ]
      },
      {
        "id": "card-2",
        "title": "Карточка 2",
        "actions": [
          {
            "id": "run",
            "label": "달리다",
            "english": "Running",
            "image": "/assets/run.webp",
            "status": "FORBIDDEN"
          }
        ]
      }
    ]
  }
]
```

The supplied archive's `verb` field was adapted to `label` and lowercase `answer` values to uppercase `status` to reuse the working server schema. No `answer` alias is sent to clients. The actual first round contains three actions in each card, as specified.

Images may be PNG, WebP, or SVG under `public/assets/`, referenced using `/assets/...`. Startup validates required fields, IDs, correct statuses, image paths, and file existence. Existing SVG placeholders remain available for later prototyping; this round uses only the six supplied WebPs.

Optional public `metadata` strings such as `location`, `day`, `date`, `quantity`, or `detail` appear as context. Never put secrets or solutions in metadata. `sceneId` can group multiple independently answerable action records that share the same scene image; the engine still scores by action ID. See `content/PROGRESSION.md` for future plans. New rounds do not require multiplayer logic changes; a future scene-centric UI or new answer type can be implemented separately.

## Reconnection and MVP limits

- Session storage saves the room code and a private random seat token per browser tab. A refresh or network reconnection restores the seat, saved answers, deadline, and submitted status. The carousel returns to its first action on refresh; each action's saved choice remains available.
- Open a **fresh tab**, not a duplicate tab, for the other player. Some browsers copy session storage when duplicating. Using a seat token on a second connection transfers that seat and disconnects its previous connection.
- Disconnected seats remain reserved. A third player cannot take them. If the original browser session is lost, create a new room. A network interruption does not pause the shared timer.
- `Выйти из комнаты` clears the current tab's saved seat and returns to the entry screen so you can create/join another room. The old seat remains reserved until its room expires; leaving does not stop the partner's timer.
- Empty rooms expire after 30 minutes without a connected player, checked each minute. Maximum 1,000 rooms per process.
- Restarting the server clears rooms. The browser reports a missing saved room and offers entry/create controls again. No history is persisted.
- Use one server process/instance. Scaling to several instances requires shared state, Socket.IO coordination, and distributed timer handling. Room codes are small-session access codes, not user authentication.

## Deploy on Replit

1. Create a Node.js app and upload this folder's contents into its root, or import a repository containing them. Include `package-lock.json`, `.replit`, `content/`, and `public/`; omit `node_modules`.
2. Run `npm ci` in the Shell. Use `npm start` as the Run command. The supplied `.replit` includes run/build commands.
3. In Publishing → Adjust settings, select **Reserved VM** and **Web server**. Use a single instance to keep in-memory rooms consistent. Static publishing cannot run this server.
4. Build command: `npm ci --omit=dev`. Run command: `npm start`. Set `PORT=3000` if needed; map internal port 3000 to the external web port. The server also respects a platform-provided `PORT`.
5. Publish, open the public HTTPS URL in two browsers/devices, create a room on A, and join on B. Socket.IO shares the website origin/port; no separate backend URL or CORS setup is required.
6. Republish content/code changes between sessions. Restarting or republishing clears active rooms.

See Replit's official [deployment types](https://docs.replit.com/features/publishing/deployment-types) and [port configuration](https://replit.com/blog/ports) guides. Publishing controls may change. This delivery was tested locally; no Replit deployment or paid resources were created.

## Verify

```sh
npm ci
npm test
```

Tests start isolated real HTTP servers and simultaneous Socket.IO clients. They verify answer privacy, room capacity, host authority, malformed/stale answers, changeable drafts, complete submissions, locking, recovery, shared results, deadlines, actual timeout, restart/reset, first-round content, asset availability, and content-key routes returning 404. A second test-only round checks future progression without shipping advanced levels.

See `MANUAL-TEST.md` for the two-browser-session test record and checklist.
