const { askGPT, askGemini } = require('../lib/aiClient');

const globalCooldown = {};

async function aiCommand(sock, chatId, message, args, isAdmin = false) {
    const sender = message.key.participant;

    if (!args.length) {
        return sock.sendMessage(chatId, { text: 'Usage: ai <gpt|gemini> <your question>' }, { quoted: message });
    }

    const engine = args[0].toLowerCase();  // gpt or gemini
    const prompt = args.slice(1).join(' ');

    if (!prompt) {
        return sock.sendMessage(chatId, { text: 'Please provide a question after specifying AI engine.' }, { quoted: message });
    }

    if (!['gpt', 'gemini'].includes(engine)) {
        return sock.sendMessage(chatId, { text: 'AI engine must be "gpt" or "gemini".' }, { quoted: message });
    }

    // COOLDOWN 10s per user
    if (globalCooldown[sender]) return sock.sendMessage(chatId, { text: '⏱️ Wait 10s before asking again' }, { quoted: message });
    globalCooldown[sender] = true;
    setTimeout(() => delete globalCooldown[sender], 10000);

    await sock.sendMessage(chatId, { text: `🤖 Thinking with ${engine.toUpperCase()}...` }, { quoted: message });

    let reply;
    try {
        if (engine === 'gpt') reply = await askGPT(prompt);
        else reply = await askGemini(prompt);
    } catch (err) {
        reply = `⚠️ AI error: ${err.message || 'Unknown error'}`;
    }

    await sock.sendMessage(chatId, { text: reply }, { quoted: message });
}

module.exports = { aiCommand };
