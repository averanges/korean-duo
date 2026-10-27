const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const fs = require('node:fs');
const path = require('node:path');
const { createGameServer, loadRounds, validateRounds } = require('../server');
const rounds = loadRounds(path.join(__dirname, '../content/rounds.json'));
function event(socket, name) {
  return new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Timeout: ' + name)), 4000); socket.once(name, data => { clearTimeout(timeout); resolve(data); }); });
}
const emit = (socket, name, data) => new Promise((resolve, reject) => socket.timeout(3000).emit(name, data, (error, response) => error ? reject(error) : resolve(response)));
async function setup(t, options = {}) {
  const game = createGameServer(options);
  await new Promise(resolve => game.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${game.server.address().port}`;
  const clients = [];
  t.after(async () => { clients.forEach(c => c.disconnect()); await game.close(); });
  async function client(transports) {
    const socket = io(origin, { forceNew: true, reconnection: false, ...(transports ? { transports } : {}) });
    clients.push(socket); socket.states = []; socket.on('state', s => { socket.latest = s; socket.states.push(s); });
    await event(socket, 'connect'); return socket;
  }
  const a = await client(), b = await client();
  const ca = await emit(a, 'enter', { mode: 'create' });
  const cb = await emit(b, 'enter', { mode: 'join', code: ca.code.toLowerCase() });
  const sync = c => { const next = event(c, 'state'); c.emit('sync'); return next; };
  const command = (c, type, extra = {}) => emit(c, 'command', { type, roundId: c.latest?.round?.id, roundInstance: c.latest?.roundInstance, ...extra });
  const answer = (c, value) => command(c, 'answer', { answer: value });
  return { game, origin, a, b, ca, cb, client, sync, command, answer };
}
async function firstRound({ a, b, command, answer, sync }) {
  await command(a, 'start'); await sync(a); await sync(b);
  assert.equal((await answer(a, ['desk'])).ok, true);
  assert.equal((await answer(b, ['bag'])).ok, true);
  await command(a, 'submit'); await command(b, 'submit');
  await sync(a); await sync(b);
}
test('two seats, host authority, own hidden answers, partner clues, teacher fields omitted', async t => {
  const { a, b, ca, client, sync, command } = await setup(t);
  const third = await client();
  assert.equal((await emit(third, 'enter', { mode: 'join', code: ca.code })).ok, false);
  assert.equal((await emit(third, 'enter', { mode: 'resume', code: ca.code, token: 'fake' })).ok, false);
  assert.equal((await command(b, 'start')).ok, false);
  assert.equal((await command(a, 'start')).ok, true);
  const sa = await sync(a), sb = await sync(b);
  assert.equal(sa.round.type, 'MULTI_SELECT'); assert.equal(sb.round.type, sa.round.type);
  assert.equal(sa.roundInstance, sb.roundInstance); assert.equal(sa.deadline, null);
  assert.deepEqual(sa.round.ownTask.options.map(o => o.id), ['desk', 'chair', 'pen']);
  assert.deepEqual(sb.round.ownTask.options.map(o => o.id), ['book', 'bag', 'apple']);
  assert.deepEqual(sa.round.partnerTask.correctAnswer, ['bag']);
  assert.deepEqual(sb.round.partnerTask.correctAnswer, ['desk']);
  for (const state of [sa, sb]) {
    assert(!('correctAnswer' in state.round.ownTask));
    assert.equal(state.completion, null);
    for (const task of [state.round.ownTask, state.round.partnerTask]) {
      assert(!('targetQuestionKo' in task)); assert(!('suggestedAnswerKo' in task));
    }
    assert(!JSON.stringify(state).includes('token')); assert(!('history' in state));
  }
});
test('multi-select toggling, multiple choices, strict validation, locking and immediate transition', async t => {
  const { a, b, command, answer, sync } = await setup(t);
  await command(a, 'start'); await sync(a); await sync(b);
  assert.equal((await command(a, 'submit')).ok, false);
  for (const invalid of [['bag'], ['desk', 'desk'], 'desk', null, {}, [1], ['desk', 'unknown']]) assert.equal((await answer(a, invalid)).ok, false);
  assert.equal((await answer(a, ['desk', 'chair'])).ok, true);
  assert.deepEqual((await sync(a)).draft, ['desk', 'chair']);
  assert.equal((await answer(a, [])).ok, true);
  assert.equal((await command(a, 'submit')).ok, false);
  await answer(a, ['desk']); const before = await sync(a);
  await command(a, 'submit');
  const waiting = await sync(a); assert.equal(waiting.phase, 'playing'); assert.equal(waiting.players[0].submitted, true);
  assert.equal((await command(a, 'submit')).ok, false);
  assert.equal((await answer(a, ['chair'])).ok, false);
  await answer(b, ['bag']); await command(b, 'submit');
  const sa = await sync(a), sb = await sync(b);
  assert.equal(sa.roundIndex, 1); assert.equal(sa.round.type, 'YES_NO'); assert.equal(sa.roundInstance, sb.roundInstance);
  assert.notEqual(sa.roundInstance, before.roundInstance); assert.equal(sa.deadline, null); assert.equal(sa.completion, null);
  assert(sa.players.every(p => !p.submitted)); assert.equal(sa.draft, null);
  assert(a.states.every(s => !('results' in s) && ['lobby', 'playing'].includes(s.phase)));
  assert.equal((await command(a, 'answer', { answer: ['chair'], roundId: before.round.id, roundInstance: before.roundInstance })).ok, false);
});
test('yes/no is a single answer, completion exposes only totals, restart clears history and draft', async t => {
  const ctx = await setup(t); const { a, b, sync, command, answer } = ctx;
  await firstRound(ctx);
  assert.equal(a.latest.round.ownTask.subject.id, 'book'); assert.equal(b.latest.round.ownTask.subject.id, 'chair');
  assert.equal(a.latest.round.partnerTask.correctAnswer, 'YES'); assert.equal(b.latest.round.partnerTask.correctAnswer, 'NO');
  for (const invalid of [['YES'], ['NO', 'YES'], false, 'required', 'yes', null]) assert.equal((await answer(a, invalid)).ok, false);
  await answer(a, 'YES'); assert.equal((await sync(a)).draft, 'YES');
  await answer(a, 'NO'); await answer(b, 'YES'); await command(a, 'submit'); await command(b, 'submit');
  const sa = await sync(a), sb = await sync(b);
  assert.equal(sa.phase, 'completed'); assert.deepEqual(sa.completion, sb.completion);
  assert.equal(sa.completion.roundsCompleted, 2); assert.deepEqual(sa.completion.players.map(p => p.correct), [2, 2]);
  assert.equal(sa.round, null); assert.equal(sa.draft, null);
  assert(!JSON.stringify(sa).includes('correctAnswer')); assert(!JSON.stringify(sa).includes('selected'));
  const oldInstance = sa.roundInstance;
  assert.equal((await command(b, 'restart')).ok, false);
  assert.equal((await command(a, 'restart')).ok, true);
  const restarted = await sync(a); assert.equal(restarted.roundIndex, 0); assert.equal(restarted.phase, 'playing');
  assert.deepEqual(restarted.draft, []); assert.equal(restarted.completion, null); assert.equal(restarted.deadline, null);
  assert(restarted.players.every(p => !p.submitted));
  assert.equal((await command(a, 'answer', { answer: ['desk'], roundInstance: oldInstance })).ok, false);
});
test('timer OFF waits indefinitely, has no timeout handle, and remains OFF across rounds', async t => {
  let time = 100000;
  const ctx = await setup(t, { now: () => time }); const { a, b, command, answer, sync, game, ca } = ctx;
  await command(a, 'start'); time += 365 * 86400000;
  const s = await sync(a); assert.equal(s.phase, 'playing'); assert.equal(s.deadline, null); assert.equal(game.rooms.get(ca.code).timeout, null);
  await sync(b); await answer(a, ['desk']); await answer(b, ['bag']); await command(a, 'submit'); await command(b, 'submit');
  assert.equal((await sync(a)).deadline, null); assert.equal(a.latest.timer.enabled, false);
});
test('timer options, host-only configuration and no mid-game changes', async t => {
  const { a, b, command, sync } = await setup(t);
  assert.equal((await command(b, 'configure', { timer: { enabled: true, durationSeconds: 30 } })).ok, false);
  for (const invalid of [null, {}, { enabled: 'yes', durationSeconds: 30 }, { enabled: true, durationSeconds: 31 }, { enabled: true, durationSeconds: '60' }]) assert.equal((await command(a, 'configure', { timer: invalid })).ok, false);
  for (const durationSeconds of [30,45,60,90]) {
    assert.equal((await command(a, 'configure', { timer: { enabled: true, durationSeconds } })).ok, true);
    assert.equal((await sync(b)).timer.durationSeconds, durationSeconds);
  }
  await command(a, 'start'); const sa = await sync(a), sb = await sync(b);
  assert.equal(sa.deadline, sb.deadline); assert(sa.deadline - sa.serverNow <= 90000 && sa.deadline - sa.serverNow > 89000);
  assert.equal((await command(a, 'configure', { timer: { enabled: false, durationSeconds: 60 } })).ok, false);
});
test('timeout scores saved answers, advances both clients, rejects stale commands, finishes game', async t => {
  let time = 100000;
  const { a, b, command, answer, sync } = await setup(t, { now: () => time });
  await command(a, 'configure', { timer: { enabled: true, durationSeconds: 30 } });
  await command(a, 'start'); const first = await sync(a); await sync(b);
  await answer(a, ['desk']);
  time = first.deadline;
  assert.equal((await command(a, 'submit')).ok, false);
  const second = await sync(a), secondB = await sync(b);
  assert.equal(second.roundIndex, 1); assert.equal(second.roundInstance, secondB.roundInstance);
  assert.equal(second.deadline, time + 30000); assert.equal(second.completion, null);
  assert.equal((await command(b, 'answer', { answer: ['bag'], roundId: first.round.id, roundInstance: first.roundInstance })).ok, false);
  time = second.deadline;
  const done = await sync(a); assert.equal(done.phase, 'completed'); assert.equal(done.completion.timedOutRounds, 2);
  assert.deepEqual(done.completion.players.map(p => p.correct), [1, 0]);
});
test('real scheduled timeout advances automatically even with partner disconnected', async t => {
  const { a, b, command, sync } = await setup(t);
  await command(a, 'configure', { timer: { enabled: true, durationSeconds: 30 } });
  await command(a, 'start'); await sync(a); b.disconnect();
  const state = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Scheduled expiry failed')), 35000);
    const listener = s => { if (s.roundIndex === 1) { clearTimeout(timeout); a.off('state', listener); resolve(s); } };
    a.on('state', listener);
  });
  assert.equal(state.roundIndex, 1); assert.equal(state.players[1].connected, false);
});
test('reconnection restores draft, submission lock, seat and shared round; offline submitted player does not block advance', async t => {
  const { a, b, ca, client, sync, command, answer } = await setup(t);
  await command(a, 'start'); await sync(a); await sync(b);
  await answer(a, ['desk', 'pen']); const first = await sync(a);
  a.disconnect(); const resumed = await client();
  assert.equal((await emit(resumed, 'enter', { mode: 'resume', code: ca.code, token: ca.token })).ok, true);
  const recovered = await sync(resumed); assert.equal(recovered.seat, 0); assert.deepEqual(recovered.draft, ['desk','pen']); assert.equal(recovered.roundInstance, first.roundInstance);
  await answer(resumed, ['desk']); await command(resumed, 'submit'); resumed.disconnect();
  await answer(b, ['bag']); await command(b, 'submit');
  const next = await sync(b); assert.equal(next.roundIndex, 1); assert.equal(next.players[0].connected, false);
  const again = await client(); await emit(again, 'enter', { mode: 'resume', code: ca.code, token: ca.token });
  assert.equal((await sync(again)).roundInstance, next.roundInstance); assert.equal(again.latest.draft, null);
});
test('Render origin policy, polling and websocket sessions, private routes and assets', async t => {
  const ctx = await setup(t, { allowedOrigin: 'https://averanges.github.io' });
  const { origin, client } = ctx;
  const response = await fetch(origin + '/socket.io/?EIO=4&transport=polling', { headers: { Origin: 'https://averanges.github.io' } });
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://averanges.github.io');
  const denied = await fetch(origin + '/socket.io/?EIO=4&transport=polling', { headers: { Origin: 'https://unrelated.example' } });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  await client(['polling']); await client(['websocket']);
  for (const route of ['/content/rounds.json','/server.js','/docs/config.js','/.env','/test/multiplayer.test.js']) assert.equal((await fetch(origin + route)).status, 404);
  for (const name of ['desk','chair','pen','book','bag','apple']) assert.equal((await fetch(origin + '/assets/objects/' + name + '.webp')).status, 200);
});
test('Pages is synchronized, keeps working Render URL, and contains no answer keys or obsolete gameplay', () => {
  const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  assert.equal(read('docs/app.js'), read('public/app.js')); assert.equal(read('docs/style.css'), read('public/style.css'));
  assert(read('docs/config.js').includes('https://korean-duo.onrender.com'));
  assert(read('docs/index.html').includes('./bootstrap.js'));
  for (const name of ['docs/index.html','docs/app.js']) {
    const text = read(name); assert(!text.includes('REQUIRED')); assert(!text.includes('FORBIDDEN')); assert(!text.includes('targetQuestionKo'));
  }
  assert(!fs.existsSync(path.join(__dirname,'../docs/content')));
});
test('content has only the two specified rounds and validates answer types and unique option IDs', () => {
  assert.equal(rounds.length, 2); assert.deepEqual(rounds.map(r => r.type), ['MULTI_SELECT','YES_NO']);
  assert.deepEqual(rounds[0].tasks.A.correctAnswer, ['desk']); assert.deepEqual(rounds[0].tasks.B.correctAnswer, ['bag']);
  assert.equal(rounds[1].tasks.A.correctAnswer, 'NO'); assert.equal(rounds[1].tasks.B.correctAnswer, 'YES');
  const bad = structuredClone(rounds); bad[0].tasks.A.options.push(bad[0].tasks.A.options[0]);
  assert.throws(() => validateRounds(bad));
  const multi = structuredClone(rounds); multi[0].tasks.A.correctAnswer = ['desk','chair']; assert.doesNotThrow(() => validateRounds(multi));
});
