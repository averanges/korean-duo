// Load the client library from Render, then the synchronized Pages application.
(() => {
  const server = String(window.KOREAN_DUO_SERVER || '').replace(/\/$/, '');
  let valid = false;
  try {
    const url = new URL(server);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    valid = (url.protocol === 'https:' || (url.protocol === 'http:' && local)) && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
  } catch {}
  const error = text => {
    document.getElementById('connection').textContent = text;
    document.getElementById('entry-connection').textContent = text;
    document.getElementById('notice').textContent = text;
  };
  if (!valid || server.includes('REPLACE-ME')) return error('Проверьте адрес Render в docs/config.js.');
  const library = document.createElement('script');
  library.src = server + '/socket.io/socket.io.js';
  library.onload = () => {
    const app = document.createElement('script'); app.src = './app.js';
    app.onerror = () => error('Не удалось загрузить игру. Обновите страницу.');
    document.body.append(app);
  };
  library.onerror = () => error('Не удалось загрузить клиент с Render. Сервер может запускаться — обновите страницу чуть позже.');
  document.head.append(library);
})();
