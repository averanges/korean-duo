// Publish only the browser application. Never copy content/ or server answer data.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
html = html.replace('href="/style.css"', 'href="./style.css"')
  .replace('<script src="/socket.io/socket.io.js" defer></script><script src="/app.js" defer></script>', '<script src="./config.js" defer></script><script src="./bootstrap.js" defer></script>');
fs.writeFileSync(path.join(root, 'docs/index.html'), html);
for (const name of ['app.js', 'style.css']) fs.copyFileSync(path.join(root, 'public', name), path.join(root, 'docs', name));
console.log('Pages frontend synchronized. docs/config.js was preserved.');
