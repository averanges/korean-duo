# Browser test record and checklist

Local browser checks on 2026-10-27 using separate, independently opened browser-tab sessions with distinct seat credentials. The first pair exercised gameplay and recovery in the narrow in-app browser; another pair verified the desktop view at 1280 px. This was not a Replit or physical cross-device test.

| Check | Observed result |
| --- | --- |
| Create / join | A gets a visible five-character code; B joins the same code; both show connected |
| Host gate | Start disabled before B joins; only A gets Start |
| Start | Both enter Round 1/1 with a 01:00 countdown |
| Opposite perspectives | A: read/drink/dance known, run/eat/sleep unknown; B sees the reverse |
| Illustrated layout | Supplied WebPs, left green known panel, right blue single-action carousel, yellow timer, green/red choices |
| Incomplete card | Submit disabled with 0/3 selected |
| Navigation | A selected run, apple, sleep, then returned to apple; the saved green choice remained selected |
| Page refresh | B selected all three answers, refreshed, and recovered the same room, seat, running timer and saved answers |
| First submission | A's choices locked and `Ожидаем напарника` appeared |
| Second submission | Both immediately received A 3/3, B 3/3, combined 6/6 and the message confirming completion before timeout |
| Results | All six correct statuses visible; B had no progression controls; A had Replay |
| Automatic expiry | A separate room left unanswered reached 00:00 and showed 0/6 results without any submission |
| Replay | A replayed after timeout; both returned to 01:00 with blank choices and incomplete Submit disabled |
| Desktop | At 1280 px, known and unknown panels measured approximately 32% and 68%; no horizontal overflow |
| Narrow layout | Known actions formed a compact strip above the task; one player's screen remained visible with no horizontal overflow |

Automated tests separately cover third-player rejection, hidden statuses absent from actual Socket.IO payloads, invalid answers, submission locking, deadlines, disconnected partner timeout, stale attempts after restart, full reset, host progression using a second test-only round, and first-round assets/routes.

## Repeat the checks

1. `npm ci`, then `npm start`. Open two fresh browser tabs at `http://localhost:3000` (do not duplicate a tab).
2. A creates a room; B joins using the code. Try a third tab: expect “Комната заполнена”.
3. A starts. Confirm the content and opposite views listed above. Unknown actions show only vocabulary, not a completed correct sentence.
4. Select answers, navigate away/back, change a choice and refresh: saved choices should remain. Submit must enable only with all choices saved.
5. A submits: expect locked choices and waiting. B submits: expect identical shared results and combined score. All-correct choices are A: forbidden/required/required; B: required/forbidden/required.
6. A selects Replay: both should return to a new 60-second attempt, blank choices, and unlocked controls.
7. In another attempt, answer only one action and let time expire: all clients should reveal results; saved choices score and blanks count as incorrect.
8. Temporarily disconnect one browser: its seat stays reserved, partner status changes, and timer keeps running. Reconnect in that original tab: recover the same seat, draft and deadline.
9. Compare a wide desktop view and a narrow browser. Verify that Korean labels, navigation, answer buttons and submission controls remain usable.

Deployment and physical mobile device testing remain outside this local verification.
