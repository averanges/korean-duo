const $ = id => document.getElementById(id);
const SERVER = String(window.KOREAN_DUO_SERVER || '').replace(/\/$/, '');
if (!/^https:\/\/[^/]+$/.test(SERVER) || SERVER.includes('REPLACE-ME')) {
  document.addEventListener('DOMContentLoaded', () => {
    const target = document.getElementById('connection');
    if (target) target.textContent = 'Настройте адрес Render в docs/config.js';
  });
}
const socket = io(SERVER, { transports: ['websocket', 'polling'] });
const imageUrl = path => /^\/assets\//.test(path || '') ? SERVER + path : path;
let state = null;
let offset = 0;
let credential = null;
let actionIndex = 0;
let roundKey = null;
let answerPending = false;
let submitPending = false;
try { credential = JSON.parse(sessionStorage.getItem('korean-duo-seat')); } catch {}
const translations = {
  'You already have a seat.': 'Вы уже в комнате.',
  'Invalid room request.': 'Не удалось открыть комнату.',
  'Server is full. Try again later.': 'Сервер заполнен. Попробуйте позже.',
  'Room not found. Create a new room or check the code.': 'Комната не найдена. Проверьте код или создайте новую.',
  'This saved seat is no longer available.': 'Сохранённое место недоступно. Создайте комнату или войдите по коду.',
  'Room is full. Only two players can join.': 'Комната заполнена. В ней могут играть только двое.',
  'Both players must be connected.': 'Дождитесь подключения напарника.',
  'Your answers are already submitted.': 'Ответы уже отправлены и заблокированы.',
  'This round is no longer accepting answers.': 'Раунд завершён. Новые ответы не принимаются.',
  'Choose an answer for every action first.': 'Сначала ответьте на все действия.',
  'Only Player A can control rounds.': 'Только игрок A может управлять раундами.'
};
function notice(message = '') { $('notice').textContent = translations[message] || message; }
function connection(text) { $('connection').textContent = text; $('footer-connection').textContent = text; }
function save(value) { credential = value; try { sessionStorage.setItem('korean-duo-seat', JSON.stringify(value)); } catch {} }
function enter(data) {
  if (!socket.connected) return notice('Дождитесь подключения к серверу.');
  $('create').disabled = true;
  socket.timeout(5000).emit('enter', data, (err, result) => {
    $('create').disabled = false;
    if (err) return notice('Сервер не ответил. Обновите страницу и попробуйте снова.');
    if (!result.ok) {
      if (data.mode === 'resume') { state = null; $('entry').hidden = false; $('game').hidden = true; $('leave').hidden = true; }
      notice(result.error); $('resume').hidden = !credential; return;
    }
    save({ code: result.code, token: result.token }); notice();
  });
}
socket.on('connect', () => {
  connection('● Подключено');
  if (credential) enter({ mode: 'resume', ...credential });
});
socket.on('disconnect', reason => {
  connection('○ Нет соединения');
  answerPending = false; submitPending = false;
  if (state) render();
  notice(reason === 'io server disconnect' ? 'Ваше место открыто в другом окне. Обновите страницу, чтобы вернуться сюда.' : 'Соединение потеряно. Переподключаемся… Ваше место и ответы сохранены. Таймер продолжается.');
});
socket.on('connect_error', () => { connection('○ Переподключение…'); notice('Не удаётся связаться с сервером. Пробуем снова…'); });
socket.on('state', value => {
  const key = value.roundInstance;
  if (key !== roundKey) { actionIndex = 0; roundKey = key; answerPending = false; submitPending = false; }
  const showResults = value.phase === 'results' && state?.phase !== 'results';
  state = value; offset = value.serverNow - Date.now(); notice(); render();
  if (showResults) $('results').scrollIntoView({ behavior: 'instant', block: 'start' });
});
function command(type, extra = {}) {
  if (!socket.connected) return notice('Дождитесь восстановления соединения.');
  if (type === 'answer') answerPending = true;
  if (type === 'submit') submitPending = true;
  if (state) renderControls();
  socket.timeout(5000).emit('command', { type, roundId: state?.round?.id, roundInstance: state?.roundInstance, ...extra }, (err, result) => {
    if (type === 'answer') answerPending = false;
    if (type === 'submit') submitPending = false;
    if (state) renderControls();
    if (err) { notice('Ответ задерживается. Проверяем сохранённые данные…'); socket.emit('sync'); }
    else if (!result.ok) notice(result.error);
  });
}
$('create').onclick = () => enter({ mode: 'create' });
$('join').onsubmit = e => { e.preventDefault(); enter({ mode: 'join', code: $('code').value }); };
$('resume').hidden = !credential;
$('resume').onclick = () => enter({ mode: 'resume', ...credential });
$('start').onclick = () => command('start');
$('next').onclick = () => command('next');
$('restart').onclick = () => command('restart');
$('submit').onclick = () => command('submit');
$('leave').onclick = () => {
  credential = null; state = null; roundKey = null;
  try { sessionStorage.removeItem('korean-duo-seat'); } catch {}
  socket.disconnect();
  $('entry').hidden = false; $('game').hidden = true; $('leave').hidden = true; $('resume').hidden = true;
  notice(); socket.connect();
};
$('copy').onclick = async () => { try { await navigator.clipboard.writeText(state.code); notice('Код комнаты скопирован: ' + state.code); } catch { notice('Код комнаты: ' + state.code); } };
function navigate(delta) {
  const actions = state?.round?.cards.find(c => !c.known)?.actions;
  if (!actions) return;
  actionIndex = Math.max(0, Math.min(actions.length - 1, actionIndex + delta));
  renderAction();
}
['prev-small', 'prev-action'].forEach(id => $(id).onclick = () => navigate(-1));
['next-small', 'next-action'].forEach(id => $(id).onclick = () => navigate(1));
['required', 'forbidden'].forEach(id => $(id).onclick = () => {
  if (answerPending) return;
  const action = state.round.cards.find(c => !c.known).actions[actionIndex];
  command('answer', { actionId: action.id, status: id.toUpperCase() });
});
function element(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
function statusIcon(status) {
  const el = element('span', 'status-icon ' + status.toLowerCase(), status === 'REQUIRED' ? '✓' : '⊘');
  el.setAttribute('role', 'img'); el.setAttribute('aria-label', status === 'REQUIRED' ? 'Нужно сделать' : 'Нельзя делать'); return el;
}
function context(action) { return Object.values(action.metadata || {}).filter(v => typeof v === 'string').join(' · '); }
function render() {
  const s = state; const partner = s.players[1 - s.seat];
  $('entry').hidden = true; $('game').hidden = false; $('leave').hidden = false;
  $('room-code').textContent = s.code; $('copy').disabled = false;
  $('identity').textContent = `Игрок ${s.seat === 0 ? 'A' : 'B'}`;
  $('my-avatar').textContent = s.seat === 0 ? 'A' : 'B';
  $('partner-avatar').textContent = s.seat === 0 ? 'B' : 'A';
  $('my-avatar').className = 'avatar avatar-' + (s.seat === 0 ? 'a' : 'b');
  $('partner-avatar').className = 'avatar avatar-' + (s.seat === 0 ? 'b' : 'a');
  $('partner').textContent = partner ? (partner.connected ? 'Подключен' : 'Не в сети') : 'Ожидаем…';
  $('partner').classList.toggle('online', !!partner?.connected);
  $('progress').textContent = s.phase === 'lobby' ? 'Подготовка' : `Раунд ${s.roundIndex + 1} / ${s.roundCount}`;
  $('progress-dots').replaceChildren(...Array.from({ length: s.roundCount }, (_, i) => element('span', 'progress-dot' + (i <= s.roundIndex ? ' active' : ''))));
  $('lobby').hidden = s.phase !== 'lobby'; $('round-area').hidden = s.phase === 'lobby';
  $('start').hidden = !s.host; $('start').disabled = !partner?.connected || !socket.connected;
  $('lobby-message').textContent = !partner?.connected ? 'Поделитесь кодом комнаты с напарником.' : s.host ? 'Напарник здесь. Начинайте, когда оба готовы.' : 'Вы готовы! Игрок A начнёт игру.';
  if (!s.round) { $('timer').textContent = '—:—'; return; }
  const known = s.round.cards.find(c => c.known);
  const unknown = s.round.cards.find(c => !c.known);
  $('known-title').textContent = `${known.title} — открыта`;
  $('unknown-title').textContent = `${unknown.title} — ${s.phase === 'results' ? 'ответы раскрыты' : 'нужно узнать'}`;
  $('unknown-help').textContent = s.phase === 'results' ? 'Обсудите правильные ответы с напарником.' : 'Выберите, нужно ли это делать или нельзя.';
  $('known-actions').replaceChildren(...known.actions.map(action => {
    const row = element('div', 'known-action'); const img = element('img'); img.src = imageUrl(action.image); img.alt = action.english || action.label;
    const copy = element('div'); const label = element('h3', '', action.label); label.lang = 'ko'; copy.append(label);
    if (context(action)) copy.append(element('p', 'small', context(action)));
    row.append(img, copy, statusIcon(action.status)); return row;
  }));
  renderAction();
  $('play-controls').hidden = s.phase !== 'playing'; $('results').hidden = s.phase !== 'results';
  if (s.results) renderResults();
  tick();
}
function renderAction() {
  const card = state.round.cards.find(c => !c.known);
  actionIndex = Math.min(actionIndex, card.actions.length - 1);
  const action = card.actions[actionIndex];
  $('action-count').textContent = `${actionIndex + 1} / ${card.actions.length}`;
  $('action-image').src = imageUrl(action.image); $('action-image').alt = action.english || action.label;
  $('action-label').textContent = action.label;
  $('scene-context').textContent = context(action); $('scene-context').hidden = !context(action);
  ['prev-small', 'prev-action'].forEach(id => $(id).disabled = actionIndex === 0);
  ['next-small', 'next-action'].forEach(id => $(id).disabled = actionIndex === card.actions.length - 1);
  $('action-dots').replaceChildren(...card.actions.map((a, i) => {
    const dot = element('span', 'action-dot' + (state.draft[a.id] ? ' answered' : '') + (i === actionIndex ? ' active' : ''));
    dot.setAttribute('role', 'img'); dot.setAttribute('aria-label', `Действие ${i + 1}: ${state.draft[a.id] ? 'ответ сохранён' : 'нет ответа'}`); return dot;
  }));
  const revealed = state.phase === 'results';
  $('revealed-feedback').hidden = !revealed;
  if (revealed) $('revealed-feedback').textContent = (state.draft[action.id] === action.status ? '✓ Ваш ответ верный.' : state.draft[action.id] ? 'Ваш ответ неверный.' : 'Ответ не выбран.') + ' Правильно: ' + (action.status === 'REQUIRED' ? 'нужно сделать.' : 'нельзя делать.');
  renderControls();
}
function renderControls() {
  if (!state?.round) return;
  const s = state; const me = s.players[s.seat]; const partner = s.players[1 - s.seat];
  const actions = s.round.cards.find(c => !c.known).actions;
  const action = actions[actionIndex];
  const selected = s.phase === 'results' ? action.status : s.draft[action.id];
  ['required', 'forbidden'].forEach(id => {
    $(id).setAttribute('aria-pressed', String(selected === id.toUpperCase()));
    $(id).disabled = s.phase !== 'playing' || me.submitted || !socket.connected || answerPending;
  });
  const answered = actions.filter(a => s.draft[a.id]).length;
  $('submit').disabled = me.submitted || answered !== actions.length || !socket.connected || answerPending || submitPending;
  $('submit').classList.toggle('submitted', me.submitted);
  $('submit').querySelector('strong').textContent = me.submitted ? 'Ожидаем напарника' : submitPending ? 'Отправляем…' : 'Завершить раунд';
  $('submit-detail').textContent = me.submitted ? 'ваши ответы отправлены' : answered === actions.length ? 'все ответы выбраны' : `ответьте на все ${actions.length} действия · ${answered} / ${actions.length}`;
  $('submission-status').textContent = me.submitted ? 'Ответы заблокированы. Пока можно посмотреть свои действия.' : !partner?.connected ? 'Напарник не в сети. Его место сохранено, таймер продолжается.' : partner.submitted ? 'Напарник уже отправил ответы. Завершите свою карточку!' : 'Ответы сохраняются при переключении. Их можно менять до отправки.';
  $('next').hidden = !s.host || s.roundIndex === s.roundCount - 1;
  $('next').disabled = !partner?.connected || !socket.connected;
  $('restart').hidden = !s.host; $('restart').disabled = !partner?.connected || !socket.connected;
}
function renderResults() {
  const s = state, r = s.results;
  $('result-title').textContent = r.success ? '함께 성공! Отличная работа вдвоём!' : 'Ещё немного практики — и всё получится!';
  $('result-detail').textContent = r.finishedBeforeTimeout ? 'Вы оба завершили раунд до конца времени. Обсудите ответы вместе.' : 'Время вышло. Сохранённые ответы проверены, пропуски считаются ошибками.';
  $('scores').replaceChildren(...r.players.map(p => {
    const item = element('div', 'score', `Игрок ${p.seat === 0 ? 'A' : 'B'}`); item.append(element('strong', '', `${p.correct} / ${p.total}`)); return item;
  }), (() => { const item = element('div', 'score team', 'Общий результат'); item.append(element('strong', '', `${r.combinedCorrect} / ${r.combinedTotal}`)); return item; })());
  $('all-answers').replaceChildren(...s.round.cards.map((card, cardIndex) => {
    const box = element('div', 'answer-summary'); box.append(element('h3', '', `${card.title} · отвечал игрок ${cardIndex === 0 ? 'B' : 'A'}`));
    const score = r.players.find(p => p.seat === 1 - cardIndex);
    card.actions.forEach(action => {
      const answer = score.answers.find(a => a.actionId === action.id);
      const row = element('div', 'summary-row'); const img = element('img'); img.src = imageUrl(action.image); img.alt = action.english || action.label;
      row.append(img, element('span', '', action.label), statusIcon(action.status), element('small', '', answer.matched ? '✓ Верно' : !answer.selected ? 'Без ответа' : '✗ Ошибка')); box.append(row);
    }); return box;
  }));
  $('guest-next').textContent = s.host ? 'Ответы останутся на экране до вашего решения.' : 'Игрок A может продолжить или начать заново.';
  if (!s.players[1 - s.seat]?.connected) $('guest-next').textContent = 'Дождитесь возвращения напарника, чтобы продолжить.';
}
function tick() {
  if (!state?.round) return;
  const end = state.phase === 'results' ? state.results.completedAt : Date.now() + offset;
  const seconds = Math.max(0, Math.ceil((state.deadline - end) / 1000));
  $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  $('timer-box').classList.toggle('urgent', seconds <= 10 && state.phase === 'playing');
  if (state.phase === 'playing' && seconds === 0) { $('required').disabled = true; $('forbidden').disabled = true; $('submit').disabled = true; }
}
setInterval(tick, 200);
setInterval(() => { if (socket.connected && state) socket.emit('sync'); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && socket.connected) socket.emit('sync'); });
