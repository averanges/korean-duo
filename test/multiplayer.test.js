const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { createGameServer, loadRounds } = require('../server');
const path = require('node:path');
const rounds = loadRounds(path.join(__dirname, '../content/rounds.json'));
const event = (socket, name) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('Timed out: ' + name)), 4000); socket.once(name, data => { clearTimeout(t); resolve(data); }); });
const emit = (s, name, data) => new Promise((resolve, reject) => s.timeout(3000).emit(name, data, (err, response) => err ? reject(err) : resolve(response)));
async function setup(t, options) {
  const game = createGameServer(options);
  await new Promise(resolve => game.server.listen(0, '127.0.0.1', resolve));
  const clients = [];
  t.after(async () => { clients.forEach(c => c.disconnect()); await game.close(); });
  async function client() {
    const c = io(`http://127.0.0.1:${game.server.address().port}`, { forceNew: true, reconnection: false });
    clients.push(c); c.on('state', s => { c.latest = s; }); await event(c, 'connect'); return c;
  }
  const a = await client(); const b = await client();
  const ca = await emit(a, 'enter', { mode: 'create' });
  const cb = await emit(b, 'enter', { mode: 'join', code: ca.code });
  const sync = async c => { const p = event(c, 'state'); c.emit('sync'); return p; };
  const command = (c, type, extra) => emit(c, 'command', { type, roundId: c.latest?.round?.id, roundInstance: c.latest?.roundInstance, ...extra });
  return { game, a, b, ca, cb, client, sync, command };
}
test('two simultaneous clients: privacy, validation, submission, results, transitions, reconnect', async t => {
  // Exercise future progression with a second fixture, without shipping advanced levels.
  const future = structuredClone(rounds[0]); future.id = 'future-round';
  const { a, b, ca, cb, client, sync, command } = await setup(t, { rounds: [...rounds, future] });
  assert.equal(ca.ok, true); assert.equal(cb.ok, true);
  const third = await client(); assert.equal((await emit(third, 'enter', { mode: 'join', code: ca.code })).ok, false);
  assert.equal((await command(b, 'start')).ok, false);
  assert.equal((await command(a, 'start')).ok, true);
  const sa = await sync(a), sb = await sync(b);
  assert.equal(sa.deadline, sb.deadline);
  for (const [s, seat] of [[sa, 0], [sb, 1]]) {
    assert(s.round.cards[seat].actions.every(a => a.status));
    assert(s.round.cards[1 - seat].actions.every(a => !('status' in a)));
    assert(s.round.cards[1 - seat].actions.every(a => !('answer' in a)));
    assert.equal(s.results, null);
    assert(!JSON.stringify(s).includes('token'));
  }
  assert.equal((await command(a, 'submit')).ok, false);
  assert.equal((await command(a, 'answer', { actionId: rounds[0].cards[0].actions[0].id, status: 'REQUIRED' })).ok, false);
  assert.equal((await command(a, 'answer', { actionId: rounds[0].cards[1].actions[0].id, status: 'FAKE' })).ok, false);
  for (const [c, seat] of [[a, 0], [b, 1]]) for (const action of rounds[0].cards[1 - seat].actions) assert.equal((await command(c, 'answer', { actionId: action.id, status: action.status })).ok, true);
  // A may change a choice before submitting.
  const action = rounds[0].cards[1].actions[0];
  await command(a, 'answer', { actionId: action.id, status: action.status === 'REQUIRED' ? 'FORBIDDEN' : 'REQUIRED' });
  await command(a, 'answer', { actionId: action.id, status: action.status });
  b.disconnect();
  const resumed = await client();
  assert.equal((await emit(resumed, 'enter', { mode: 'resume', code: cb.code, token: cb.token })).ok, true);
  const recovered = await sync(resumed); assert.equal(recovered.seat, 1); assert.equal(Object.keys(recovered.draft).length, 3); assert.equal(recovered.deadline, sa.deadline);
  assert.equal((await command(a, 'submit')).ok, true);
  assert.equal((await command(a, 'submit')).ok, false);
  assert.equal((await command(a, 'answer', { actionId: action.id, status: action.status })).ok, false);
  assert.equal((await command(resumed, 'submit')).ok, true);
  const results = await sync(a); assert.equal(results.phase, 'results'); assert.equal(results.results.success, true);
  assert.equal(results.results.combinedCorrect, 6); assert.equal(results.results.combinedTotal, 6);
  assert.equal(results.results.finishedBeforeTimeout, true);
  assert(results.round.cards.every(c => c.actions.every(a => a.status)));
  assert.equal((await command(a, 'next')).ok, true); assert.equal((await sync(a)).roundIndex, 1);
  assert.equal((await command(a, 'answer', { roundId: rounds[0].id, actionId: action.id, status: action.status })).ok, false);
  assert.equal((await command(a, 'restart')).ok, true); assert.equal((await sync(a)).roundIndex, 0);
  assert.equal((await command(a, 'answer', { roundInstance: sa.roundInstance, actionId: action.id, status: action.status })).ok, false);
  assert.deepEqual((await sync(a)).draft, {});
});
test('server deadline rejects late answers and reveals identical timeout scores', async t => {
  let time = 100000;
  const { a, b, sync, command } = await setup(t, { now: () => time });
  await command(a, 'start'); const state = await sync(a);
  time = state.deadline;
  assert.equal((await command(a, 'answer', { actionId: rounds[0].cards[1].actions[0].id, status: 'REQUIRED' })).ok, false);
  const sa = await sync(a), sb = await sync(b);
  assert.equal(sa.phase, 'results'); assert.equal(sa.results.reason, 'timeout'); assert.deepEqual(sa.results, sb.results); assert.equal(sa.results.players[0].correct, 0);
  assert.equal(sa.results.finishedBeforeTimeout, false);
});
test('real timer finishes automatically with disconnected partner', async t => {
  const short = structuredClone(rounds); short[0].durationSeconds = 0.15;
  const { a, b, command } = await setup(t, { rounds: short });
  await command(a, 'start'); b.disconnect();
  let s;
  do { s = await event(a, 'state'); } while (s.phase !== 'results');
  assert.equal(s.results.reason, 'timeout'); assert.equal(s.results.success, false);
});
test('single supplied round has exact content and server does not serve solutions', async t => {
  assert.equal(rounds.length, 1); assert.equal(rounds[0].durationSeconds, 60);
  assert.deepEqual(rounds[0].cards.map(c => c.actions.map(a => [a.id, a.status])), [
    [['read', 'REQUIRED'], ['drink', 'FORBIDDEN'], ['dance', 'REQUIRED']],
    [['run', 'FORBIDDEN'], ['eat', 'REQUIRED'], ['sleep', 'REQUIRED']]
  ]);
  const { game, a, b, sync, command } = await setup(t);
  const origin = `http://127.0.0.1:${game.server.address().port}`;
  assert.equal((await fetch(origin + '/content/rounds.json')).status, 404);
  for (const card of rounds[0].cards) for (const action of card.actions) assert.equal((await fetch(origin + action.image)).status, 200);
  await command(a, 'start'); await sync(a); await sync(b);
  for (const c of [a,b]) {
    const seat = c.latest.seat;
    for (const action of rounds[0].cards[1-seat].actions) await command(c,'answer',{actionId:action.id,status:action.status});
    await command(c,'submit');
  }
  assert.equal((await command(a, 'next')).ok, false);
  await command(a, 'restart');
  const restarted = await sync(a);
  assert.deepEqual(restarted.draft, {}); assert.equal(restarted.results, null);
  assert(restarted.players.every(p => !p.submitted));
});
test('partial saved drafts score at timeout without submission', async t => {
  let time = 100000;
  const { a, b, sync, command } = await setup(t, { now: () => time });
  await command(a, 'start'); const before = await sync(a);
  const action = rounds[0].cards[1].actions[0];
  await command(a, 'answer', { actionId: action.id, status: action.status });
  time = before.deadline;
  const sa = await sync(a), sb = await sync(b);
  assert.equal(sa.results.combinedCorrect, 1); assert.equal(sa.results.combinedTotal, 6);
  assert.equal(sa.results.players[0].submitted, false);
  assert.equal(sa.results.players[0].answers.filter(a => a.selected === null).length, 2);
  assert.deepEqual(sa.results, sb.results);
});
