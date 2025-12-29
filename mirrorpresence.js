const fs = require('fs');

async function mirrorPresenceCommand(sock, chatId, message, argsRaw) {
  const args = (argsRaw || '').trim().split(/\s+/).filter(Boolean).map(s=>s.toLowerCase());
  const sub = args[0] || 'status';
  // Only owner can run this command — caller ensures that

  if (sub === 'status') {
    let enabled = false;
    try { enabled = JSON.parse(fs.readFileSync('./data/mirrorPresence.json','utf8')).enabled === true } catch(e) {}
    if (process.env.MIRROR_OWNER_PRESENCE === '1' || enabled || (typeof require('../settings').mirrorOwnerPresence === 'boolean' && require('../settings').mirrorOwnerPresence === true)) {
      await sock.sendMessage(chatId, { text: `✅ Mirror owner presence: *ENABLED*` }, { quoted: message });
    } else {
      await sock.sendMessage(chatId, { text: `❌ Mirror owner presence: *DISABLED*` }, { quoted: message });
    }
    return;
  }

  if (sub === 'on' || sub === 'enable') {
    try {
      fs.writeFileSync('./data/mirrorPresence.json', JSON.stringify({ enabled: true }, null, 2));
      await sock.sendMessage(chatId, { text: '✅ Mirror owner presence *ENABLED*. The bot will appear online when you are online.' }, { quoted: message });
    } catch (e) {
      await sock.sendMessage(chatId, { text: '⚠️ Failed to enable mirror presence.' }, { quoted: message });
    }
    return;
  }

  if (sub === 'off' || sub === 'disable') {
    try {
      fs.writeFileSync('./data/mirrorPresence.json', JSON.stringify({ enabled: false }, null, 2));
      await sock.sendMessage(chatId, { text: '✅ Mirror owner presence *DISABLED*.' }, { quoted: message });
    } catch (e) {
      await sock.sendMessage(chatId, { text: '⚠️ Failed to disable mirror presence.' }, { quoted: message });
    }
    return;
  }

  await sock.sendMessage(chatId, { text: 'Usage: .mirrorpresence on|off|status' }, { quoted: message });
}

module.exports = mirrorPresenceCommand;
