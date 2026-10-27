const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
function dimensions(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') throw new Error('Not a WebP');
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const type = buffer.toString('ascii', offset, offset + 4), size = buffer.readUInt32LE(offset + 4), p = offset + 8;
    if (type === 'VP8X') return [buffer.readUIntLE(p + 4, 3) + 1, buffer.readUIntLE(p + 7, 3) + 1];
    if (type === 'VP8L') { const bits = buffer.readUInt32LE(p + 1); return [(bits & 16383) + 1, ((bits >>> 14) & 16383) + 1]; }
    if (type === 'VP8 ') return [buffer.readUInt16LE(p + 6) & 16383, buffer.readUInt16LE(p + 8) & 16383];
    offset = p + size + (size % 2);
  }
  throw new Error('WebP dimensions missing');
}
function checkAssets() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/assets/manifest.json'), 'utf8'));
  const missing = [], invalid = [];
  const entries = Object.entries(manifest.assets);
  for (const [id, item] of entries) {
    if (!/^\/assets\/(objects|actions|places)\/[a-z-]+\.webp$/.test(item.path)) { invalid.push(id + ': invalid path'); continue; }
    const file = path.join(root, 'public', item.path);
    if (!fs.existsSync(file)) { missing.push(id); continue; }
    try { const size = dimensions(fs.readFileSync(file)); if (size[0] !== 512 || size[1] !== 512) invalid.push(id + ': ' + size.join('x')); } catch (e) { invalid.push(id + ': ' + e.message); }
  }
  const resolveIds = value => {
    if (Array.isArray(value)) value.forEach(resolveIds);
    else if (value && typeof value === 'object') Object.values(value).forEach(resolveIds);
    else if (typeof value === 'string' && value.startsWith('asset:') && !manifest.assets[value.slice(6)]) invalid.push('Unknown plan asset: ' + value);
  };
  resolveIds(manifest.plannedRounds);
  const raw = JSON.stringify(manifest);
  if (/correctAnswer|targetQuestionKo|suggestedAnswerKo|REQUIRED|FORBIDDEN/.test(raw)) invalid.push('Manifest contains private/obsolete content');
  return { ids: entries.length, files: new Set(entries.map(([, item]) => item.path)).size, plannedRounds: manifest.plannedRounds.length, missing, invalid };
}
if (require.main === module) {
  const report = checkAssets(); console.log(JSON.stringify(report, null, 2));
  if (report.missing.length || report.invalid.length) process.exitCode = 1;
}
module.exports = { checkAssets, dimensions };
