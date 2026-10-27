const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkAssets } = require('../scripts/check-assets');
test('approved sheet library: 27 square WebPs, 14 plans, row four excluded', () => {
  const report = checkAssets();
  assert.deepEqual(report, { ids: 27, files: 27, plannedRounds: 14, missing: [], invalid: [] });
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/assets/manifest.json'), 'utf8'));
  assert.equal(Object.values(manifest.assets).filter(a => a.category === 'objects').length, 8);
  assert.equal(Object.values(manifest.assets).filter(a => a.category === 'actions').length, 11);
  assert.equal(Object.values(manifest.assets).filter(a => a.category === 'places').length, 8);
  for (const id of ['key','door','window','box','bed','fridge','table','plant','cabinet']) assert(!manifest.assets[id]);
  const verbs = Object.values(manifest.assets).filter(a => a.category === 'actions').map(a => a.labelKo);
  assert.deepEqual(verbs, ['먹다','공부하다','마시다','만나다','자다','운동하다','일하다','사다','보다','읽다','배우다']);
});
test('active two-round exercise consumes approved object assets without changing multiplayer tasks', () => {
  const rounds = JSON.parse(fs.readFileSync(path.join(__dirname, '../content/rounds.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/assets/manifest.json'), 'utf8'));
  assert.equal(rounds.length, 2);
  for (const round of rounds) for (const task of Object.values(round.tasks)) for (const item of task.options || [task.subject]) assert.equal(item.image, manifest.assets[item.id].path);
});
