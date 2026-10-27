const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');
const { randomBytes, randomInt } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const STATUSES = ['REQUIRED', 'FORBIDDEN'];
function loadRounds(file) {
  const rounds = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(rounds) || !rounds.length) throw new Error('Content must be a nonempty rounds array');
  const roundIds = new Set();
  for (const r of rounds) {
    if (!r.id || roundIds.has(r.id) || !Number.isFinite(r.durationSeconds) || r.durationSeconds <= 0 || r.cards?.length !== 2) throw new Error('Invalid round: ' + r.id);
    roundIds.add(r.id);
    const ids = new Set();
    for (const c of r.cards) {
      if (!c.id || ids.has(c.id) || !Array.isArray(c.actions) || !c.actions.length) throw new Error('Invalid card');
      ids.add(c.id);
      const actions = new Set();
      for (const a of c.actions) {
        if (!a.id || actions.has(a.id) || !a.label || !STATUSES.includes(a.status) || !/^\/assets\/[\w/-]+\.(svg|png|webp)$/i.test(a.image) || !fs.existsSync(path.join(__dirname, 'public', a.image))) throw new Error('Invalid action: ' + a.id);
        actions.add(a.id);
      }
    }
  }
  return rounds;
}

function createGameServer({ rounds = loadRounds(path.join(__dirname, 'content/rounds.json')), now = Date.now } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(path.join(__dirname, 'public')));
  const server = http.createServer(app);
  const allowedOrigin = process.env.CLIENT_ORIGIN?.trim().replace(/\/$/, '');
  const io = new Server(server, {
    maxHttpBufferSize: 16384,
    cors: {
      origin: allowedOrigin ? [allowedOrigin] : false,
      methods: ['GET', 'POST']
    }
  });
  const rooms = new Map();
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const connected = p => !!p.socketId && !!io.sockets.sockets.get(p.socketId);
  function snapshot(room, seat) {
    const round = rounds[room.roundIndex];
    const player = room.players[seat];
    return {
      code: room.code, seat, host: seat === 0, phase: room.phase,
      roundIndex: room.roundIndex, roundCount: rounds.length,
      serverNow: now(), deadline: room.deadline, roundInstance: room.roundInstance,
      players: room.players.map((p, i) => ({ seat: i, connected: connected(p), submitted: p.submitted })),
      draft: player.draft,
      results: room.results,
      round: room.phase === 'lobby' ? null : {
        id: round.id, title: round.title, durationSeconds: round.durationSeconds,
        cards: round.cards.map((c, i) => ({
          id: c.id, title: c.title, known: i === seat,
          actions: c.actions.map(a => {
            const { status } = a;
            const safe = { id: a.id, image: a.image, label: a.label, english: a.english, metadata: a.metadata, sceneId: a.sceneId };
            return (i === seat || room.phase === 'results') ? { ...safe, status } : safe;
          })
        }))
      }
    };
  }
  function broadcast(room) {
    room.players.forEach((p, seat) => { if (connected(p)) io.to(p.socketId).emit('state', snapshot(room, seat)); });
  }
  function finish(room, reason) {
    if (room.phase !== 'playing') return;
    clearTimeout(room.timer);
    room.phase = 'results';
    room.results = {
      reason, completedAt: now(), finishedBeforeTimeout: reason === 'submitted' && now() < room.deadline,
      players: room.players.map((p, seat) => {
        const card = rounds[room.roundIndex].cards[1 - seat];
        const answers = card.actions.map(a => ({ actionId: a.id, selected: p.draft[a.id] || null, correct: a.status, matched: p.draft[a.id] === a.status }));
        return { seat, submitted: p.submitted, correct: answers.filter(a => a.matched).length, total: answers.length, answers };
      })
    };
    room.results.success = room.results.players.every(p => p.correct === p.total);
    room.results.combinedCorrect = room.results.players.reduce((sum, p) => sum + p.correct, 0);
    room.results.combinedTotal = room.results.players.reduce((sum, p) => sum + p.total, 0);
    broadcast(room);
  }
  function expire(room) {
    if (room.phase === 'playing' && now() >= room.deadline) finish(room, 'timeout');
  }
  function start(room, index) {
    clearTimeout(room.timer);
    room.roundIndex = index;
    room.roundInstance = randomBytes(12).toString('hex');
    room.phase = 'playing';
    room.results = null;
    room.players.forEach(p => { p.draft = {}; p.submitted = false; });
    room.deadline = now() + rounds[index].durationSeconds * 1000;
    room.timer = setTimeout(() => finish(room, 'timeout'), rounds[index].durationSeconds * 1000);
    broadcast(room);
  }
  io.on('connection', socket => {
    let membership = null;
    const replyError = (ack, message) => { if (typeof ack === 'function') ack({ ok: false, error: message }); };
    socket.on('enter', (data, ack) => {
      if (membership) return replyError(ack, 'You already have a seat.');
      if (!data || !['create', 'join', 'resume'].includes(data.mode)) return replyError(ack, 'Invalid room request.');
      let room;
      let seat;
      if (data.mode === 'create') {
        if (rooms.size >= 1000) return replyError(ack, 'Server is full. Try again later.');
        let code;
        do { code = Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (rooms.has(code));
        room = { code, players: [], phase: 'lobby', roundIndex: 0, deadline: null, results: null, touched: now() };
        rooms.set(code, room);
        seat = 0;
      } else {
        const code = typeof data.code === 'string' ? data.code.trim().toUpperCase() : '';
        room = rooms.get(code);
        if (!room) return replyError(ack, 'Room not found. Create a new room or check the code.');
        if (data.mode === 'resume') {
          seat = room.players.findIndex(p => typeof data.token === 'string' && p.token === data.token);
          if (seat < 0) return replyError(ack, 'This saved seat is no longer available.');
          const old = io.sockets.sockets.get(room.players[seat].socketId);
          if (old) old.disconnect(true);
        } else {
          if (room.players.length >= 2) return replyError(ack, 'Room is full. Only two players can join.');
          seat = room.players.length;
        }
      }
      if (!room.players[seat]) room.players.push({ token: randomBytes(24).toString('hex'), draft: {}, submitted: false });
      room.players[seat].socketId = socket.id;
      room.touched = now();
      membership = { room, seat };
      expire(room);
      if (typeof ack === 'function') ack({ ok: true, code: room.code, token: room.players[seat].token });
      broadcast(room);
    });
    socket.on('command', (data, ack) => {
      if (!membership) return replyError(ack, 'Join a room first.');
      const { room, seat } = membership;
      if (room.players[seat].socketId !== socket.id) return replyError(ack, 'Seat moved to another connection.');
      expire(room);
      room.touched = now();
      const p = room.players[seat];
      if (!data || typeof data.type !== 'string') return replyError(ack, 'Invalid command.');
      if (['start', 'restart', 'next'].includes(data.type)) {
        if (seat !== 0) return replyError(ack, 'Only Player A can control rounds.');
        if (room.players.length !== 2 || !room.players.every(connected)) return replyError(ack, 'Both players must be connected.');
        if (data.type === 'start' && room.phase !== 'lobby') return replyError(ack, 'Game already started.');
        if (data.type === 'next' && (room.phase !== 'results' || room.roundIndex + 1 >= rounds.length)) return replyError(ack, 'No next round available.');
        start(room, data.type === 'next' ? room.roundIndex + 1 : 0);
      } else if (['answer', 'submit'].includes(data.type)) {
        if (room.phase !== 'playing' || data.roundId !== rounds[room.roundIndex].id || data.roundInstance !== room.roundInstance) return replyError(ack, 'This round is no longer accepting answers.');
        if (p.submitted) return replyError(ack, 'Your answers are already submitted.');
        const actions = rounds[room.roundIndex].cards[1 - seat].actions;
        if (data.type === 'answer') {
          if (!actions.some(a => a.id === data.actionId) || !STATUSES.includes(data.status)) return replyError(ack, 'Invalid answer.');
          p.draft[data.actionId] = data.status;
        } else {
          if (!actions.every(a => STATUSES.includes(p.draft[a.id]))) return replyError(ack, 'Choose an answer for every action first.');
          p.submitted = true;
        }
        if (room.players.every(p => p.submitted)) finish(room, 'submitted');
        else broadcast(room);
      } else return replyError(ack, 'Unknown command.');
      if (typeof ack === 'function') ack({ ok: true });
    });
    socket.on('sync', () => { if (membership) { expire(membership.room); socket.emit('state', snapshot(membership.room, membership.seat)); } });
    socket.on('disconnect', () => {
      if (!membership) return;
      const { room, seat } = membership;
      if (room.players[seat].socketId === socket.id) room.players[seat].socketId = null;
      room.touched = now();
      broadcast(room);
    });
  });
  const cleanup = setInterval(() => {
    for (const [code, r] of rooms) if (!r.players.some(connected) && now() - r.touched > 30 * 60 * 1000) { clearTimeout(r.timer); rooms.delete(code); }
  }, 60000);
  cleanup.unref();
  return { app, server, io, rooms, close: async () => { clearInterval(cleanup); for (const r of rooms.values()) clearTimeout(r.timer); await new Promise(resolve => io.close(resolve)); } };
}
if (require.main === module) {
  const game = createGameServer();
  game.server.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Korean Duo listening on port ' + (process.env.PORT || 3000)));
}
module.exports = { createGameServer, loadRounds };
