// Load Socket.IO client from the same Render server that runs the multiplayer backend.
const server = String(window.KOREAN_DUO_SERVER || '').replace(/\/$/, '');
if (!server.includes('REPLACE-ME') && /^https:\/\/[^/]+$/.test(server)) {
  const s = document.createElement('script');
  s.src = server + '/socket.io/socket.io.js';
  s.onload = () => { const app = document.createElement('script'); app.src = './app.js'; document.body.append(app); };
  s.onerror = () => { document.getElementById('connection').textContent = 'Не удалось загрузить клиент Socket.IO с Render'; };
  document.head.append(s);
}
