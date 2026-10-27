// Local cross-origin smoke test of /docs. The deployed config.js stays untouched.
const express = require('express');
const path = require('node:path');
const app = express();
const backend = process.env.PREVIEW_BACKEND || 'http://localhost:3000';
app.get('/korean-duo/config.js', (_req, res) => res.type('js').send('window.KOREAN_DUO_SERVER = ' + JSON.stringify(backend) + ';'));
app.use('/korean-duo', express.static(path.join(__dirname, '../docs')));
app.listen(process.env.PAGES_PREVIEW_PORT || 3002, '127.0.0.1', () => console.log('Pages preview: http://localhost:3002/korean-duo/ (backend: ' + backend + ')'));
