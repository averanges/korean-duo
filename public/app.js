const $ = id => document.getElementById(id);
const SERVER = String(window.KOREAN_DUO_SERVER || location.origin).replace(/\/$/, '');
const socket = io(SERVER, { transports: ['websocket', 'polling'], tryAllTransports: true });
const imageUrl = path => SERVER + path;
const STORAGE = 'korean-duo-v2-seat:' + SERVER;
let state = null;
let credential = null;
let renderedInstance = null;
let offset = 0;
let answerPending = false;
let controlPending = false;
try { credential = JSON.parse(sessionStorage.getItem(STORAGE)); } catch {}
function notice(text = '') { $('notice').textContent = text; }
function connection(text) { $('connection').textContent = text; $('entry-connection').textContent = text; }
function saveSeat(value) { credential = value; try { sessionStorage.setItem(STORAGE, JSON.stringify(value)); } catch {} }
function element(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
function img(item) { const image = element('img'); image.src = imageUrl(item.image); image.alt = item.labelRu || item.labelKo; return image; }
function objectLabel(item) { const box = element('span', 'object-label', item.labelKo); box.lang = 'ko'; const ru = element('small', 'object-ru', item.labelRu); ru.lang = 'ru'; box.append(ru); return box; }
function showEntry() { state = null; renderedInstance = null; $('game').hidden = true; $('entry').hidden = false; $('leave').hidden = true; }
function enter(data) {
  if (!socket.connected) return notice('Дождитесь подключения к серверу.');
  $('create').disabled = true;
  socket.timeout(7000).emit('enter', data, (error, response) => {
    $('create').disabled = false;
    if (error) return notice('Сервер не ответил. Попробуйте обновить страницу.');
    if (!response.ok) { if (data.mode === 'resume') showEntry(); notice(response.error); return; }
    saveSeat({ code: response.code, token: response.token }); notice();
  });
}
function command(type, extra = {}) {
  if (!socket.connected) return notice('Дождитесь восстановления соединения.');
  const instance = state?.roundInstance;
  if (type === 'answer' || type === 'submit') answerPending = true;
  else controlPending = true;
  renderControls();
  socket.timeout(7000).emit('command', { type, roundId: state?.round?.id, roundInstance: instance, ...extra }, (error, response) => {
    if (state?.roundInstance === instance) answerPending = false;
    controlPending = false;
    renderControls();
    if (error) { notice('Ответ задерживается. Проверяем сохранённое состояние…'); socket.emit('sync'); }
    else if (!response.ok) notice(response.error);
  });
}
socket.on('connect', () => { connection('● Подключено'); if (credential) enter({ mode: 'resume', ...credential }); });
socket.on('connect_error', () => { connection('○ Переподключение…'); notice('Не удаётся подключиться. Сервер может запускаться — пробуем снова автоматически.'); });
socket.on('disconnect', reason => {
  connection('○ Нет соединения'); answerPending = false; controlPending = false; renderControls();
  notice(reason === 'io server disconnect' ? 'Ваше место открыто в другом окне. Обновите страницу, чтобы вернуться сюда.' : 'Соединение потеряно. Место и сохранённый ответ остаются за вами. Переподключаемся…');
});
socket.on('state', value => {
  if (value.protocolVersion !== 2) return notice('Сервер ещё работает на прежней версии. Дождитесь обновления Render и обновите страницу.');
  const changed = state?.roundInstance !== value.roundInstance;
  if (changed) answerPending = false;
  state = value; offset = value.serverNow - Date.now(); notice(); render();
});
$('create').onclick = () => enter({ mode: 'create' });
$('join').onsubmit = event => { event.preventDefault(); enter({ mode: 'join', code: $('code').value }); };
$('resume').hidden = !credential;
$('resume').onclick = () => enter({ mode: 'resume', ...credential });
$('copy').onclick = async () => { try { await navigator.clipboard.writeText(state.code); notice('Код скопирован: ' + state.code); } catch { notice('Код комнаты: ' + state.code); } };
$('leave').onclick = () => {
  credential = null; showEntry(); socket.disconnect();
  try { sessionStorage.removeItem(STORAGE); } catch {}
  $('resume').hidden = true; notice(); socket.connect();
};
$('start').onclick = () => command('start');
$('restart').onclick = () => command('restart');
$('submit').onclick = () => { if (!answerPending) command('submit'); };
function configure(value) { command('configure', { timer: { enabled: value !== 'off', durationSeconds: value === 'off' ? (state?.timer.durationSeconds || 60) : Number(value) } }); }
$('timer-setting').onchange = event => configure(event.target.value);
$('restart-timer-setting').onchange = event => configure(event.target.value);
function makeKnown(round) {
  const task = round.partnerTask;
  $('known-prompt').textContent = task.promptRu;
  $('known-content').className = 'known-content' + (round.type === 'YES_NO' ? ' yes-no' : '');
  if (round.type === 'MULTI_SELECT') {
    $('known-content').replaceChildren(...task.options.map(item => {
      const correct = task.correctAnswer.includes(item.id);
      const row = element('div', 'known-option' + (correct ? ' correct' : ''));
      row.append(img(item), objectLabel(item));
      if (correct) { const mark = element('span', 'known-marker', '✓'); mark.setAttribute('aria-label', 'Есть: верный предмет для напарника'); row.append(mark); }
      else row.setAttribute('aria-label', `${item.labelRu}: не входит в ответ напарника`);
      return row;
    }));
  } else {
    const subject = element('div', 'known-subject'); subject.append(img(task.subject), objectLabel(task.subject));
    const answer = element('div', 'known-answer' + (task.correctAnswer === 'NO' ? ' no' : ''), task.correctAnswer === 'YES' ? 'YES · Да' : 'NO · Нет');
    $('known-content').replaceChildren(subject, answer);
  }
}
function makeTask(round) {
  const task = round.ownTask;
  $('task-prompt').textContent = task.promptRu;
  $('task-kind').textContent = round.type === 'MULTI_SELECT' ? 'Предметы' : 'Да / Нет';
  $('task-instruction').textContent = round.type === 'MULTI_SELECT' ? 'Спроси напарника по-корейски. Отметь всё, что есть. Можно выбрать несколько предметов.' : 'Задай этот вопрос на корейском. Послушай напарника и выбери один ответ.';
  if (round.type === 'MULTI_SELECT') {
    const grid = element('div', 'options-grid'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'Выберите предметы');
    task.options.forEach(item => {
      const button = element('button', 'option-button'); button.type = 'button'; button.dataset.optionId = item.id;
      button.setAttribute('aria-pressed', 'false');
      const check = element('span', 'option-check', '✓'); check.setAttribute('aria-hidden', 'true');
      button.append(img(item), objectLabel(item), check);
      button.onclick = () => {
        if (answerPending || state.players[state.seat].submitted) return;
        const current = state.draft || [];
        command('answer', { answer: current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id] });
      };
      grid.append(button);
    }); $('task-content').replaceChildren(grid);
  } else {
    const subject = element('div', 'yesno-subject'); subject.append(img(task.subject), objectLabel(task.subject));
    const buttons = element('div', 'yesno-buttons'); buttons.setAttribute('role', 'group'); buttons.setAttribute('aria-label', 'Выберите один ответ');
    [['YES', 'Да'], ['NO', 'Нет']].forEach(([answer, text]) => {
      const button = element('button', 'yesno-button', text); button.type = 'button'; button.dataset.answer = answer; button.setAttribute('aria-pressed', 'false');
      button.onclick = () => { if (!answerPending && !state.players[state.seat].submitted) command('answer', { answer }); };
      buttons.append(button);
    }); $('task-content').replaceChildren(subject, buttons);
  }
}
function render() {
  const s = state, partner = s.players[1 - s.seat];
  $('entry').hidden = true; $('game').hidden = false; $('leave').hidden = false;
  $('identity').textContent = `Игрок ${s.seat === 0 ? 'A' : 'B'}`;
  $('avatar').textContent = s.seat === 0 ? 'A' : 'B'; $('avatar').classList.toggle('player-b', s.seat === 1);
  $('partner-avatar').textContent = s.seat === 0 ? 'B' : 'A';
  $('room-code').textContent = s.code;
  $('partner').textContent = !partner ? 'Ожидаем…' : partner.connected ? 'Подключен' : 'Не в сети'; $('partner').classList.toggle('online', !!partner?.connected);
  $('progress-label').textContent = s.phase === 'lobby' ? 'Подготовка' : s.phase === 'completed' ? 'Игра завершена' : `Раунд ${s.roundIndex + 1} / ${s.roundCount}`;
  $('progress-dots').replaceChildren(...Array.from({ length: s.roundCount }, (_, i) => element('span', 'progress-dot' + (i <= s.roundIndex ? ' active' : ''))));
  $('lobby').hidden = s.phase !== 'lobby'; $('play').hidden = s.phase !== 'playing'; $('completion').hidden = s.phase !== 'completed';
  $('timer-box').hidden = !s.timer.enabled || s.phase !== 'playing';
  $('timer-setting').value = $('restart-timer-setting').value = s.timer.enabled ? String(s.timer.durationSeconds) : 'off';
  $('lobby-message').textContent = !partner?.connected ? 'Поделитесь кодом комнаты и дождитесь напарника.' : s.host ? 'Вы оба подключены. Выберите таймер и начинайте, когда готовы.' : 'Вы готовы. Игрок A начнёт упражнение.';
  $('guest-settings').hidden = s.host;
  $('guest-settings').textContent = s.timer.enabled ? `Таймер: ${s.timer.durationSeconds} секунд на раунд.` : 'Таймер выключен. Можно говорить без ограничения времени.';
  if (s.phase === 'playing' && renderedInstance !== s.roundInstance) { makeKnown(s.round); makeTask(s.round); renderedInstance = s.roundInstance; }
  if (s.phase === 'completed') {
    // No old tasks or answer keys are retained on the completion screen.
    $('known-content').replaceChildren(); $('task-content').replaceChildren(); renderedInstance = null;
    const complete = s.completion;
    const item = (label, value) => { const box = element('div', 'completion-stat', label); box.append(element('strong', '', value)); return box; };
    $('completion-stats').replaceChildren(item('Раундов пройдено', `${complete.roundsCompleted} / ${complete.roundCount}`),
      ...complete.players.map(p => item(`Ответы игрока ${p.seat === 0 ? 'A' : 'B'}`, `${p.correct} / ${p.total}`)));
    $('completion-wait').textContent = !partner?.connected ? 'Дождитесь напарника, чтобы начать заново.' : s.host ? 'Можно повторить упражнение с новым таймером или без него.' : 'Игрок A может начать упражнение заново.';
  }
  renderControls(); tick();
}
function renderControls() {
  if (!state) return;
  const s = state, partner = s.players[1 - s.seat], me = s.players[s.seat];
  $('start').hidden = !s.host; $('restart').hidden = !s.host;
  $('timer-settings').hidden = !s.host; $('restart-settings').hidden = !s.host;
  $('start').disabled = $('restart').disabled = !socket.connected || !partner?.connected || controlPending;
  $('timer-setting').disabled = $('restart-timer-setting').disabled = !socket.connected || controlPending;
  if (s.phase !== 'playing') return;
  const expired = s.deadline !== null && Date.now() + offset >= s.deadline;
  const locked = me.submitted || !socket.connected || answerPending || expired;
  document.querySelectorAll('[data-option-id]').forEach(button => {
    button.disabled = locked; button.setAttribute('aria-pressed', String((s.draft || []).includes(button.dataset.optionId)));
  });
  document.querySelectorAll('[data-answer]').forEach(button => { button.disabled = locked; button.setAttribute('aria-pressed', String(s.draft === button.dataset.answer)); });
  const hasAnswer = s.round.type === 'MULTI_SELECT' ? Array.isArray(s.draft) && s.draft.length > 0 : ['YES', 'NO'].includes(s.draft);
  $('submit').disabled = locked || !hasAnswer;
  $('submit').classList.toggle('waiting', me.submitted);
  $('submit').textContent = me.submitted ? 'Ожидаем напарника' : answerPending ? 'Сохраняем…' : 'Готово ✓';
  $('selection-status').textContent = s.round.type === 'MULTI_SELECT' ? `Выбрано предметов: ${(s.draft || []).length}` : hasAnswer ? 'Ответ выбран' : 'Выбери «Да» или «Нет»';
  $('submission-status').textContent = me.submitted ? 'Твой ответ отправлен. Переход — когда напарник тоже будет готов.' : !partner?.connected ? 'Напарник не в сети. Его место сохранено.' : partner.submitted ? 'Напарник уже готов. Выбери и отправь свой ответ.' : 'Ответ можно менять до нажатия «Готово».';
}
function tick() {
  if (!state || !state.timer.enabled || state.phase !== 'playing' || state.deadline === null) return;
  const seconds = Math.max(0, Math.ceil((state.deadline - Date.now() - offset) / 1000));
  $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  $('timer-box').classList.toggle('urgent', seconds <= 10);
  if (seconds === 0) renderControls();
}
setInterval(tick, 200);
setInterval(() => { if (socket.connected && state) socket.emit('sync'); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && socket.connected) socket.emit('sync'); });
