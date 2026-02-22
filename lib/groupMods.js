const fs = require('fs');
const path = require('path');

const STORE = path.join(__dirname, '..', 'data', 'groupMods.json');

function _load() {
  try {
    if (!fs.existsSync(STORE)) return {};
    const raw = fs.readFileSync(STORE, 'utf8') || '{}';
    const data = JSON.parse(raw);
    return data || {};
  } catch (e) {
    console.error('Failed to load groupMods store:', e?.message || e);
    return {};
  }
}

function _save(obj) {
  try {
    if (!fs.existsSync(path.dirname(STORE))) fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(STORE, JSON.stringify(obj, null, 2));
    return true;
  } catch (e) {
    console.error('Failed to save groupMods store:', e?.message || e);
    return false;
  }
}

function _normalizeNumber(id) {
  if (!id) return '';
  // Accept forms like '12345@s.whatsapp.net' or '12345:0@s.whatsapp.net' or plain number
  const bare = (id.split(':')[0] || '').split('@')[0];
  return bare || '';
}

function getMods(chatId) {
  const store = _load();
  const arr = store[chatId];
  if (!Array.isArray(arr)) return [];
  return arr.slice();
}

function isGroupMod(chatId, senderId) {
  const mods = getMods(chatId);
  const bare = _normalizeNumber(senderId);
  return mods.includes(bare);
}

function addMod(chatId, userId) {
  const store = _load();
  const bare = _normalizeNumber(userId);
  if (!bare) return false;
  const arr = Array.isArray(store[chatId]) ? store[chatId] : [];
  if (arr.includes(bare)) return true; // already present
  arr.push(bare);
  store[chatId] = arr;
  return _save(store);
}

function removeMod(chatId, userId) {
  const store = _load();
  const bare = _normalizeNumber(userId);
  if (!bare) return false;
  const arr = Array.isArray(store[chatId]) ? store[chatId] : [];
  const newArr = arr.filter(x => x !== bare);
  store[chatId] = newArr;
  return _save(store);
}

module.exports = { getMods, isGroupMod, addMod, removeMod };
