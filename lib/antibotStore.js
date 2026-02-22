const fs = require('fs');
const path = require('path');
const STORE = path.join(__dirname, '..', 'data', 'antibot.json');

function _load() {
  try {
    if (!fs.existsSync(STORE)) return {};
    const raw = fs.readFileSync(STORE, 'utf8') || '{}';
    return JSON.parse(raw) || {};
  } catch (e) {
    console.error('Failed to read antibot store:', e?.message || e);
    return {};
  }
}

function _save(obj) {
  try {
    if (!fs.existsSync(path.dirname(STORE))) fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(STORE, JSON.stringify(obj, null, 2));
    return true;
  } catch (e) {
    console.error('Failed to save antibot store:', e?.message || e);
    return false;
  }
}

function isEnabled(chatId) {
  const data = _load();
  return !!data[chatId];
}

function setEnabled(chatId, enabled) {
  const data = _load();
  data[chatId] = !!enabled;
  return _save(data);
}

function listEnabled() {
  const data = _load();
  return Object.keys(data).filter(k => data[k]);
}

module.exports = { isEnabled, setEnabled, listEnabled };
