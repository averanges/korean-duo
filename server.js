const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');
const { randomBytes, randomInt } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const DURATIONS = [30, 45, 60, 90];
const SEATS = ['A', 'B'];
const validId = value => typeof value === 'string' && /^[a-z][a-z0-9-]*$/i.test(value);
function validateRounds(rounds) {
  if (!Array.isArray(rounds) || !rounds.length) throw new Error('Content must be a nonempty array');
  const ids = new Set();
  const checkPicture = item => {
    if (!item || !validId(item.id) || typeof item.labelKo !== 'string' || !item.labelKo.trim() ||
      typeof item.image !== 'string' || !/^\/assets\/[\w/-]+\.(svg|png|webp)$/i.test(item.image) ||
      !fs.existsSync(path.join(__dirname, 'public', item.image))) throw new Error('Invalid illustrated object');
  };
  for (const round of rounds) {
    if (!validId(round.id) || ids.has(round.id) || typeof round.title !== 'string' || !['MULTI_SELECT', 'YES_NO'].includes(round.type)) throw new Error('Invalid round');
    ids.add(round.id);
    for (const seat of SEATS) {
      const task = round.tasks?.[seat];
      if (!task || !validId(task.id) || typeof task.promptRu !== 'string' || !task.promptRu.trim()) throw new Error('Invalid task');
      if (round.type === 'MULTI_SELECT') {
        if (!Array.isArray(task.options) || !task.options.length) throw new Error('Missing options');
        task.options.forEach(checkPicture);
        const optionIds = task.options.map(o => o.id);
        if (new Set(optionIds).size !== optionIds.length || !Array.isArray(task.correctAnswer) || !task.correctAnswer.length || new Set(task.correctAnswer).size !== task.correctAnswer.length || !task.correctAnswer.every(id => optionIds.includes(id))) throw new Error('Invalid multi-select answer');
      } else {
        checkPicture(task.subject);
        if (!['YES', 'NO'].includes(task.correctAnswer)) throw new Error('Invalid yes/no answer');
      }
    }
    if (round.tasks.A.id === round.tasks.B.id) throw new Error('Task IDs must be distinct');
  }
  return rounds;
}
function loadRounds(file) { return validateRounds(JSON.parse(fs.readFileSync(file, 'utf8'))); }
function createGameServer({ rounds = loadRounds(path.join(__dirname, 'content/rounds.json')), now = Date.now, allowedOrigin = process.env.CLIENT_ORIGIN?.trim().replace(/\/$/, '') } = {}) {
  validateRounds(rounds);
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.json({ ok: true, version: '2.0.0' }));
  app.use(express.static(path.join(__dirname, 'public')));
  const server = http.createServer(app);
  // Preserve the deployed CLIENT_ORIGIN policy and the Render/Pages split.
  const io = new Server(server, { maxHttpBufferSize: 16384, cors: { origin: allowedOrigin ? [allowedOrigin] : false, methods: ['GET', 'POST'] } });
  const rooms = new Map();
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const connected = p => !!p.socketId && !!io.sockets.sockets.get(p.socketId);
  const picture = p => ({ id: p.id, labelKo: p.labelKo, labelRu: p.labelRu, image: p.image });
  function publicTask(task, type, known) {
    const result = { id: task.id, promptRu: task.promptRu };
    if (type === 'MULTI_SELECT') result.options = task.options.map(picture);
    else result.subject = picture(task.subject);
    // Teacher-only Korean questions/answers and arbitrary content fields never cross this boundary.
    if (known) result.correctAnswer = task.correctAnswer;
    return result;
  }
  function summary(room) {
    return { roundsCompleted: room.history.length, roundCount: rounds.length,
      players: SEATS.map((_, seat) => ({ seat, correct: room.history.filter(r => r.players[seat].correct).length, total: room.history.length })),
      timedOutRounds: room.history.filter(r => r.reason === 'timeout').length };
  }
  function snapshot(room, seat) {
    const round = rounds[room.roundIndex];
    return {
      protocolVersion: 2, code: room.code, seat, host: seat === 0, phase: room.phase,
      roundIndex: room.roundIndex, roundCount: rounds.length, roundInstance: room.roundInstance,
      serverNow: now(), deadline: room.deadline, timer: { ...room.timerConfig },
      players: room.players.map((p, i) => ({ seat: i, connected: connected(p), submitted: p.submitted })),
      draft: room.phase === 'playing' ? room.players[seat].draft : null,
      round: room.phase === 'playing' ? {
        id: round.id, title: round.title, type: round.type,
        ownTask: publicTask(round.tasks[SEATS[seat]], round.type, false),
        partnerTask: publicTask(round.tasks[SEATS[1 - seat]], round.type, true)
      } : null,
      completion: room.phase === 'completed' ? summary(room) : null
    };
  }
  function broadcast(room) { room.players.forEach((p, seat) => { if (connected(p)) io.to(p.socketId).emit('state', snapshot(room, seat)); }); }
  function validAnswer(round, task, answer, allowEmpty) {
    if (round.type === 'YES_NO') return ['YES', 'NO'].includes(answer);
    return Array.isArray(answer) && (allowEmpty || answer.length > 0) && answer.length <= task.options.length &&
      new Set(answer).size === answer.length && answer.every(id => typeof id === 'string' && task.options.some(o => o.id === id));
  }
  function beginRound(room, index) {
    clearTimeout(room.timeout);
    room.phase = 'playing'; room.roundIndex = index; room.roundInstance = randomBytes(12).toString('hex');
    room.players.forEach(p => { p.draft = rounds[index].type === 'MULTI_SELECT' ? [] : null; p.submitted = false; });
    room.deadline = room.timerConfig.enabled ? now() + room.timerConfig.durationSeconds * 1000 : null;
    room.timeout = null;
    if (room.timerConfig.enabled) {
      const instance = room.roundInstance;
      const schedule = () => {
        if (room.phase !== 'playing' || room.roundInstance !== instance) return;
        const remaining = room.deadline - now();
        if (remaining > 0) room.timeout = setTimeout(schedule, remaining);
        else finishRound(room, 'timeout');
      };
      room.timeout = setTimeout(schedule, room.timerConfig.durationSeconds * 1000);
    }
  }
  function finishRound(room, reason) {
    if (room.phase !== 'playing') return;
    clearTimeout(room.timeout);
    const round = rounds[room.roundIndex];
    room.history.push({ roundId: round.id, instance: room.roundInstance, reason, completedAt: now(),
      players: room.players.map((p, seat) => {
        const task = round.tasks[SEATS[seat]];
        const valid = validAnswer(round, task, p.draft, false);
        const correct = valid && (round.type === 'YES_NO' ? p.draft === task.correctAnswer :
          p.draft.length === task.correctAnswer.length && task.correctAnswer.every(id => p.draft.includes(id)));
        return { correct, selected: structuredClone(p.draft), submitted: p.submitted };
      }) });
    if (room.roundIndex + 1 < rounds.length) beginRound(room, room.roundIndex + 1);
    else { room.phase = 'completed'; room.deadline = null; room.timeout = null; room.players.forEach(p => { p.draft = null; }); }
    broadcast(room);
  }
  function expire(room) { if (room.phase === 'playing' && room.deadline !== null && now() >= room.deadline) finishRound(room, 'timeout'); }
  io.on('connection', socket => {
    let membership = null;
    const fail = (ack, error) => { if (typeof ack === 'function') ack({ ok: false, error }); };
    socket.on('enter', (data, ack) => {
      if (membership) return fail(ack, 'Вы уже в комнате.');
      if (!data || !['create', 'join', 'resume'].includes(data.mode)) return fail(ack, 'Некорректный запрос комнаты.');
      let room, seat;
      if (data.mode === 'create') {
        if (rooms.size >= 1000) return fail(ack, 'Сервер заполнен. Попробуйте позже.');
        let code;
        do { code = Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (rooms.has(code));
        room = { code, players: [], phase: 'lobby', roundIndex: 0, roundInstance: null, deadline: null,
          timerConfig: { enabled: false, durationSeconds: 60 }, history: [], touched: now() };
        rooms.set(code, room); seat = 0;
      } else {
        const code = typeof data.code === 'string' ? data.code.trim().toUpperCase() : '';
        room = rooms.get(code);
        if (!room) return fail(ack, 'Комната не найдена. Проверьте код или создайте новую.');
        if (data.mode === 'resume') {
          seat = room.players.findIndex(p => typeof data.token === 'string' && p.token === data.token);
          if (seat < 0) return fail(ack, 'Сохранённое место недоступно.');
          const old = io.sockets.sockets.get(room.players[seat].socketId);
          if (old) old.disconnect(true);
        } else {
          if (room.players.length >= 2) return fail(ack, 'Комната заполнена. В ней могут играть только двое.');
          seat = room.players.length;
        }
      }
      if (!room.players[seat]) room.players.push({ token: randomBytes(24).toString('hex'), draft: null, submitted: false });
      room.players[seat].socketId = socket.id; room.touched = now(); membership = { room, seat };
      expire(room);
      if (typeof ack === 'function') ack({ ok: true, code: room.code, token: room.players[seat].token });
      broadcast(room);
    });
    socket.on('command', (data, ack) => {
      if (!membership) return fail(ack, 'Сначала войдите в комнату.');
      const { room, seat } = membership;
      if (room.players[seat].socketId !== socket.id) return fail(ack, 'Это место открыто в другом окне.');
      expire(room); room.touched = now();
      if (!data || typeof data.type !== 'string') return fail(ack, 'Некорректная команда.');
      const player = room.players[seat];
      if (['configure', 'start', 'restart'].includes(data.type)) {
        if (seat !== 0) return fail(ack, 'Только игрок A управляет упражнением.');
        if (data.type === 'configure') {
          if (!['lobby', 'completed'].includes(room.phase)) return fail(ack, 'Таймер настраивается перед началом игры.');
          if (!data.timer || typeof data.timer.enabled !== 'boolean' || !DURATIONS.includes(data.timer.durationSeconds)) return fail(ack, 'Выберите таймер: выкл. или 30, 45, 60, 90 секунд.');
          room.timerConfig = { enabled: data.timer.enabled, durationSeconds: data.timer.durationSeconds };
          broadcast(room);
        } else {
          if (room.players.length !== 2 || !room.players.every(connected)) return fail(ack, 'Дождитесь подключения напарника.');
          if ((data.type === 'start' && room.phase !== 'lobby') || (data.type === 'restart' && room.phase !== 'completed')) return fail(ack, 'Начать заново можно после завершения игры.');
          room.history = []; beginRound(room, 0); broadcast(room);
        }
      } else if (['answer', 'submit'].includes(data.type)) {
        const round = rounds[room.roundIndex];
        if (room.phase !== 'playing' || data.roundId !== round.id || data.roundInstance !== room.roundInstance) return fail(ack, 'Это задание уже не принимает ответы.');
        if (player.submitted) return fail(ack, 'Ответ уже отправлен и заблокирован.');
        const task = round.tasks[SEATS[seat]];
        if (data.type === 'answer') {
          if (!validAnswer(round, task, data.answer, true)) return fail(ack, 'Некорректный ответ.');
          player.draft = structuredClone(data.answer);
        } else {
          if (!validAnswer(round, task, player.draft, false)) return fail(ack, 'Сначала выберите ответ.');
          player.submitted = true;
        }
        if (room.players.every(p => p.submitted)) finishRound(room, 'submitted');
        else broadcast(room);
      } else return fail(ack, 'Неизвестная команда.');
      if (typeof ack === 'function') ack({ ok: true });
    });
    socket.on('sync', () => {
      if (!membership || membership.room.players[membership.seat].socketId !== socket.id) return;
      expire(membership.room); socket.emit('state', snapshot(membership.room, membership.seat));
    });
    socket.on('disconnect', () => {
      if (!membership) return;
      const { room, seat } = membership;
      if (room.players[seat].socketId === socket.id) room.players[seat].socketId = null;
      room.touched = now(); broadcast(room);
    });
  });
  const cleanup = setInterval(() => {
    for (const [code, room] of rooms) if (!room.players.some(connected) && now() - room.touched > 30 * 60 * 1000) { clearTimeout(room.timeout); rooms.delete(code); }
  }, 60000);
  cleanup.unref();
  return { app, server, io, rooms, close: async () => { clearInterval(cleanup); for (const r of rooms.values()) clearTimeout(r.timeout); await new Promise(resolve => io.close(resolve)); } };
}
if (require.main === module) {
  const game = createGameServer();
  game.server.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Korean Duo 2.0 listening on port ' + (process.env.PORT || 3000)));
}
module.exports = { createGameServer, loadRounds, validateRounds };
