const fs = require('fs');
const path = require('path');
const { loadGame } = require('./load');

const htmlPath = path.join(__dirname, '..', 'game', 'index.html');
const { api } = loadGame(htmlPath);

const payload = {
  schemaVersion: 1,
  exportedAt: new Date().toISOString().slice(0, 10),
  level: api.LEVEL,
  terrain: api.TERRAIN,
  crt: api.CRT,
  tierLabels: api.TIER_LABEL
};

const outPath = path.join(__dirname, '..', 'data', (api.LEVEL.id || 'level') + '-' + 'airport.json');
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
console.log('已导出 ' + outPath);
console.log('单位 ' + api.LEVEL.units.length + ' 个 · 地图 ' + api.LEVEL.rows + '×' + api.LEVEL.cols);
