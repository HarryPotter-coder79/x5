// 🧹 Fix for ENOSPC / temp overflow in hosted panels
const fs = require('fs');
const path = require('path');

// Redirect temp storage away from system /tmp
const customTemp = path.join(process.cwd(), 'temp');
if (!fs.existsSync(customTemp)) fs.mkdirSync(customTemp, { recursive: true });
process.env.TMPDIR = customTemp;
process.env.TEMP = customTemp;
process.env.TMP = customTemp;

// Auto-cleaner every 3 hours
setInterval(() => {
  fs.readdir(customTemp, (err, files) => {
    if (err) return;
    for (const file of files) {
      const filePath = path.join(customTemp, file);
      fs.stat(filePath, (err, stats) => {
        if (!err && Date.now() - stats.mtimeMs > 3 * 60 * 60 * 1000) {
          fs.unlink(filePath, () => {});
        }
      });
    }
  });
  console.log('🧹 Temp folder auto-cleaned');
}, 3 * 60 * 60 * 1000);

const settings = require('./settings');
require('./config.js');
// Apply persisted prefixes (if present) on startup so runtime honors saved values
try {
    const { loadStoredPrefixes } = require('./commands/prefixes');
    const stored = loadStoredPrefixes();
    if (Array.isArray(stored) && stored.length) {
        const cfg = require('./config');
        cfg.PREFIXES.length = 0;
        for (const p of stored) cfg.PREFIXES.push(p);
        console.log('🔧 Loaded persisted prefixes:', cfg.PREFIXES.join(' '));
    }
} catch (e) {
    // If prefixes module isn't available yet, ignore
}
const { isBanned } = require('./lib/isBanned');
const yts = require('yt-search');
const { fetchBuffer } = require('./lib/myfunc');
const fetch = require('node-fetch');
const ytdl = require('ytdl-core');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const { isSudo } = require('./lib/index');
const isOwnerOrSudo = require('./lib/isOwner');
const { autotypingCommand, isAutotypingEnabled, handleAutotypingForMessage, handleAutotypingForCommand, showTypingAfterCommand } = require('./commands/autotyping');
const { autoreadCommand, isAutoreadEnabled, handleAutoread } = require('./commands/autoread');

// Command imports
let tagAllCommand;
try {
  tagAllCommand = require('./commands/tagall');
} catch (e) {
  console.warn('Optional command tagall failed to load:', e.message);
  // Fallback stub so the bot doesn't crash if the file is missing on the server
  tagAllCommand = async (sock, chatId, senderId, message) => {
    try {
      await sock.sendMessage(chatId, { text: 'The .tagall command is currently unavailable on this deployment.' }, { quoted: message });
    } catch (err) {
      // ignore send errors during fallback
    }
  };
}
const _missingModules = [];
function _safeModule(modulePath, fallback) {
  try {
    return require(modulePath);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    _missingModules.push({ modulePath, error: msg });
    console.warn(`Optional module ${modulePath} failed to load:`, msg);
    return fallback;
  }
}
const helpCommand = _safeModule('./commands/help', async () => {});
const banCommand = _safeModule('./commands/ban', async () => {});
const pairCommand = _safeModule('./commands/pair', async () => {});
// Pair/verify/paired/connect commands removed - website bot pairing disabled
const { promoteCommand } = _safeModule('./commands/promote', { promoteCommand: async () => {} });
const { demoteCommand } = _safeModule('./commands/demote', { demoteCommand: async () => {} });
const muteCommand = _safeModule('./commands/mute', async () => {});
const unmuteCommand = _safeModule('./commands/unmute', async () => {});
const stickerCommand = _safeModule('./commands/sticker', async () => {});
const isAdmin = _safeModule('./lib/isAdmin', async () => { return { isAdmin: async () => ({ isSenderAdmin: false, isBotAdmin: false }) }; });
const warnCommand = _safeModule('./commands/warn', async () => {});
const warningsCommand = _safeModule('./commands/warnings', async () => {});
const ttsCommand = _safeModule('./commands/tts', async () => {});
const { tictactoeCommand, handleTicTacToeMove } = _safeModule('./commands/tictactoe', { tictactoeCommand: async () => {}, handleTicTacToeMove: async () => {} });
const { incrementMessageCount, topMembers } = _safeModule('./commands/topmembers', { incrementMessageCount: async () => {}, topMembers: async () => ({}) });
const ownerCommand = _safeModule('./commands/owner', async () => {});
const deleteCommand = _safeModule('./commands/delete', async () => {});
const { handleAntilinkCommand, handleLinkDetection } = _safeModule('./commands/antilink', { handleAntilinkCommand: async () => {}, handleLinkDetection: async () => {} });
const { handleAntitagCommand, handleTagDetection } = _safeModule('./commands/antitag', { handleAntitagCommand: async () => {}, handleTagDetection: async () => {} });
const { Antilink } = _safeModule('./lib/antilink', { Antilink: class {} });
const { handleMentionDetection, mentionToggleCommand, setMentionCommand } = _safeModule('./commands/mention', { handleMentionDetection: async () => {}, mentionToggleCommand: async () => {}, setMentionCommand: async ()=>{} });
const memeCommand = _safeModule('./commands/meme', async () => {});
const tagCommand = _safeModule('./commands/tag', async () => {});
const tagNotAdminCommand = _safeModule('./commands/tagnotadmin', async () => {});
const hideTagCommand = _safeModule('./commands/hidetag', async () => {});
const jokeCommand = _safeModule('./commands/joke', async () => {});
const quoteCommand = _safeModule('./commands/quote', async () => {});
const factCommand = _safeModule('./commands/fact', async () => {});
const weatherCommand = _safeModule('./commands/weather', async () => {});
const newsCommand = _safeModule('./commands/news', async () => {});
const kickCommand = _safeModule('./commands/kick', async () => {});
const simageCommand = _safeModule('./commands/simage', async () => {});
const attpCommand = _safeModule('./commands/attp', async () => {});
const { startHangman, guessLetter } = _safeModule('./commands/hangman', { startHangman: async () => {}, guessLetter: async () => {} });
const { startTrivia, answerTrivia } = _safeModule('./commands/trivia', { startTrivia: async () => {}, answerTrivia: async () => {} });
const { complimentCommand } = _safeModule('./commands/compliment', { complimentCommand: async () => {} });
const { insultCommand } = _safeModule('./commands/insult', { insultCommand: async () => {} });
const { eightBallCommand } = _safeModule('./commands/eightball', { eightBallCommand: async () => {} });
const { lyricsCommand } = _safeModule('./commands/lyrics', { lyricsCommand: async () => {} });
const { dareCommand } = _safeModule('./commands/dare', { dareCommand: async () => {} });
const { truthCommand } = _safeModule('./commands/truth', { truthCommand: async () => {} });
const { clearCommand } = _safeModule('./commands/clear', { clearCommand: async () => {} });
const pingCommand = _safeModule('./commands/ping', async () => {});
const uptimeCommand = _safeModule('./commands/uptime', async () => {});
const aliveCommand = _safeModule('./commands/alive', async () => {});
const blurCommand = _safeModule('./commands/img-blur', async () => {});
const { welcomeCommand, handleJoinEvent } = _safeModule('./commands/welcome', { welcomeCommand: async () => {}, handleJoinEvent: async () => {} });
const { goodbyeCommand, handleLeaveEvent } = _safeModule('./commands/goodbye', { goodbyeCommand: async () => {}, handleLeaveEvent: async () => {} });
// GitHub command removed to avoid external fetch errors
const { handleAntiBadwordCommand, handleBadwordDetection } = _safeModule('./lib/antibadword', { handleAntiBadwordCommand: async () => {}, handleBadwordDetection: async () => {} });
const antibadwordCommand = _safeModule('./commands/antibadword', async () => {});
const { handleChatbotCommand, handleChatbotResponse } = _safeModule('./commands/chatbot', { handleChatbotCommand: async () => {}, handleChatbotResponse: async () => {} });
const chatCommand = _safeModule('./commands/chat', async () => {});
const youtubeCommand = _safeModule('./commands/youtube', async () => {});
const { antistatusCommand } = _safeModule('./commands/antistatus', { antistatusCommand: async () => {} });
const takeCommand = _safeModule('./commands/take', async () => {});
const { flirtCommand } = _safeModule('./commands/flirt', { flirtCommand: async () => {} });
const characterCommand = _safeModule('./commands/character', async () => {});
const wastedCommand = _safeModule('./commands/wasted', async () => {});
const shipCommand = _safeModule('./commands/ship', async () => {});
const groupInfoCommand = _safeModule('./commands/groupinfo', async () => {});
const resetlinkCommand = _safeModule('./commands/resetlink', async () => {});
const staffCommand = _safeModule('./commands/staff', async () => {});
const unbanCommand = _safeModule('./commands/unban', async () => {});
const emojimixCommand = _safeModule('./commands/emojimix', async () => {});
const { handlePromotionEvent } = _safeModule('./commands/promote', { handlePromotionEvent: async () => {} });
const { handleDemotionEvent } = _safeModule('./commands/demote', { handleDemotionEvent: async () => {} });
const viewOnceCommand = _safeModule('./commands/viewonce', async () => {});
const clearSessionCommand = _safeModule('./commands/clearsession', async () => {});
const { autoStatusCommand, handleStatusUpdate } = _safeModule('./commands/autostatus', { autoStatusCommand: async () => {}, handleStatusUpdate: async () => {} });
const { simpCommand } = _safeModule('./commands/simp', { simpCommand: async () => {} });
const { stupidCommand } = _safeModule('./commands/stupid', { stupidCommand: async () => {} });
const stickerTelegramCommand = _safeModule('./commands/stickertelegram', async () => {});
const textmakerCommand = _safeModule('./commands/textmaker', async () => {});
const { handleAntideleteCommand, handleMessageRevocation, storeMessage } = _safeModule('./commands/antidelete', { handleAntideleteCommand: async () => {}, handleMessageRevocation: async () => {}, storeMessage: async () => {} });
const clearTmpCommand = _safeModule('./commands/cleartmp', async () => {});
const setProfilePicture = _safeModule('./commands/setpp', async () => {});
const { setGroupDescription, setGroupName, setGroupPhoto, addMember } = _safeModule('./commands/groupmanage', { setGroupDescription: async () => {}, setGroupName: async () => {}, setGroupPhoto: async () => {}, addMember: async () => {} });
const instagramCommand = _safeModule('./commands/instagram', async () => {});
const facebookCommand = _safeModule('./commands/facebook', async () => {});
const spotifyCommand = _safeModule('./commands/spotify', async () => {});
const playCommand = _safeModule('./commands/play', async () => {});
const tiktokCommand = _safeModule('./commands/tiktok', async () => {});
const songCommand = _safeModule('./commands/song', async () => {});
const aiModule = _safeModule('./commands/ai', {});
const aiCommand = aiModule?.aiCommand || aiModule || (async (sock, chatId, message, args, isAdmin = false) => {
    try {
        await sock.sendMessage(chatId, { text: '⚠️ AI command is unavailable on this deployment.' }, { quoted: message });
    } catch (e) {}
});
const urlCommand = _safeModule('./commands/url', async () => {});
const { handleTranslateCommand } = _safeModule('./commands/translate', { handleTranslateCommand: async () => {} });
const { handleSsCommand } = _safeModule('./commands/ss', { handleSsCommand: async () => {} });
const { addCommandReaction, handleAreactCommand } = _safeModule('./lib/reactions', { addCommandReaction: async () => {}, handleAreactCommand: async () => {} });
const { goodnightCommand } = _safeModule('./commands/goodnight', { goodnightCommand: async () => {} });
const shayariModule = _safeModule('./commands/shayari', {});
const shayariCommand = shayariModule.shayariCommand || (async () => {});
const rosedayModule = _safeModule('./commands/roseday', {});
const rosedayCommand = rosedayModule.rosedayCommand || (async () => {});
const imagineModule = _safeModule('./commands/imagine', {});
const imagineCommand = imagineModule.imagineCommand || imagineModule || (async () => {});
const videoModule = _safeModule('./commands/video', {});
const videoCommand = videoModule.videoCommand || videoModule || (async () => {});
const sudoModule = _safeModule('./commands/sudo', {});
const sudoCommand = sudoModule || (async () => {});
const miscModule = _safeModule('./commands/misc', {});
const miscCommand = miscModule.miscCommand || (async () => {});
const handleHeart = miscModule.handleHeart || (async () => {});
const animeModule = _safeModule('./commands/anime', {});
const animeCommand = animeModule.animeCommand || (async () => {});
const piesModule = _safeModule('./commands/pies', {});
const piesCommand = piesModule.piesCommand || (async () => {});
const piesAlias = piesModule.piesAlias || (async () => {});
const stickercropCommand = _safeModule('./commands/stickercrop', async () => {});
const updateCommand = _safeModule('./commands/update', async () => {});
const removebgCommand = _safeModule('./commands/removebg', async () => {});
const reminiModule = _safeModule('./commands/remini', {});
const reminiCommand = reminiModule.reminiCommand || (async () => {});
const igsModule = _safeModule('./commands/igs', {});
const igsCommand = igsModule.igsCommand || (async () => {});
const anticallModule = _safeModule('./commands/anticall', {});
const anticallCommand = anticallModule.anticallCommand || (async () => {});
const readAnticallState = anticallModule.readState || (() => {});
const pmblockerModule = _safeModule('./commands/pmblocker', {});
const pmblockerCommand = pmblockerModule.pmblockerCommand || (async () => {});
const readPmBlockerState = pmblockerModule.readState || (() => {});
const settingsCommand = _safeModule('./commands/settings', async () => {});
const soraCommand = _safeModule('./commands/sora', async () => {});

// Global settings
global.packname = settings.packname;
global.author = settings.author;
global.ytch = "X5";

// Startup summary: report any optional modules that failed to load (helpful on case-sensitive filesystems)
if (Array.isArray(_missingModules) && _missingModules.length) {
  console.warn('The following optional modules failed to load. This often indicates missing files or case mismatch on a case-sensitive filesystem (e.g., Windows -> Linux):');
  for (const m of _missingModules) {
    console.warn(` - ${m.modulePath}: ${m.error}`);
  }
  console.warn('Run `ls -la ./commands` and `ls -la ./lib` on the server to verify presence and exact casing.');
}

// Also check for expected json files under ./data referenced by code
(function checkDataFiles() {
  const wanted = ['autoStatus.json', 'owner.json', 'messageCount.json', 'botState.json'];
  const missing = [];
  for (const f of wanted) {
    if (!fs.existsSync(path.join(__dirname, 'data', f))) missing.push(f);
  }
  if (missing.length) {
    console.warn('Missing data files in ./data (may cause optional modules to fail):', missing.join(', '));
  }
})();

// Pair event polling removed - website bot pairing disabled

// QR request/response pipeline removed - website bot pairing disabled

// Channel promotion removed; keep an empty channelInfo for compatibility
const channelInfo = {};

// Bot power state utility
const BOT_STATE_FILE = './data/botState.json';
function getBotState() {
    try {
        const raw = fs.readFileSync(BOT_STATE_FILE, 'utf8');
        const data = JSON.parse(raw);
        return { isOn: typeof data.isOn === 'boolean' ? data.isOn : true };
    } catch (e) {
        return { isOn: true };
    }
}
function setBotState(isOn) {
    try {
        fs.writeFileSync(BOT_STATE_FILE, JSON.stringify({ isOn }, null, 2));
        return true;
    } catch (e) {
        console.error('Failed to write bot state:', e);
        return false;
    }
}
// Log initial bot power state
console.log(`⚡ Bot power state: ${getBotState().isOn ? 'ON' : 'OFF'}`);

async function handleMessages(sock, messageUpdate, printLog) {
    // Expose current connected socket globally for integrations (e.g., pair-web notifier)
    if (!global.__latestSock) global.__latestSock = sock;
    // Declare these here so catch/outer scopes can access them safely
    let chatId = null;
    let senderId = null;
    try {
        const { messages, type } = messageUpdate;
        if (type !== 'notify') return;

        const message = messages[0];
        if (!message?.message) return;

        // Handle autoread functionality
        await handleAutoread(sock, message);

        // Store message for antidelete feature
        if (message.message) {
            storeMessage(sock, message);
        }

        // Handle message revocation
        if (message.message?.protocolMessage?.type === 0) {
            await handleMessageRevocation(sock, message);
            return;
        }

        chatId = message.key.remoteJid;
        senderId = message.key.participant || message.key.remoteJid;
        const isGroup = chatId.endsWith('@g.us');
        const senderIsSudo = await isSudo(senderId);
        const senderIsOwnerOrSudo = await isOwnerOrSudo(senderId, sock, chatId);

        // Handle button responses
        if (message.message?.buttonsResponseMessage) {
            const buttonId = message.message.buttonsResponseMessage.selectedButtonId;
            const chatId = message.key.remoteJid;
            
            if (buttonId === 'owner') {
                const ownerCommand = require('./commands/owner');
                await ownerCommand(sock, chatId);
                return;
            } else if (buttonId === 'support') {
                await sock.sendMessage(chatId, { 
                    text: `X5` 
                }, { quoted: message });
                return;
            }
        }

        // Antibot real-time detection when enabled: if message sender appears bot-like and is not admin, remove them
        try {
            const store = require('./lib/antibotStore');
            if (isGroup && store.isEnabled(chatId) && !message.key.fromMe) {
                const { looksLikeBotFrom } = require('./lib/antibotUtils');
                const pushName = message.pushName || message.message?.extendedTextMessage?.contextInfo?.participant || '';
                const isSus = looksLikeBotFrom({ id: senderId, name: pushName });
                if (isSus) {
                    const adminStatusForSender = await isAdmin(sock, chatId, senderId);
                    if (adminStatusForSender.isSenderAdmin) {
                        // skip admins
                    } else {
                        // remove non-admin bot-like sender if bot is admin
                        if (!adminStatusForSender.isBotAdmin) {
                            await sock.sendMessage(chatId, { text: `Antibot: detected bot-like sender @${senderId.split('@')[0]}, but I am not an admin and cannot remove them.`, contextInfo: { mentionedJid: [senderId] } }, { quoted: message });
                        } else {
                            try {
                                await sock.groupParticipantsUpdate(chatId, [senderId], 'remove');
                                await sock.sendMessage(chatId, { text: `Antibot: removed bot-like sender @${senderId.split('@')[0]}`, contextInfo: { mentionedJid: [senderId] } });
                            } catch (e) {
                                console.error('Antibot removal on message error:', e?.message || e);
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('antibot realtime hook error:', e?.message || e);
        }

        const userMessage = (
            message.message?.conversation?.trim() ||
            message.message?.extendedTextMessage?.text?.trim() ||
            message.message?.imageMessage?.caption?.trim() ||
            message.message?.videoMessage?.caption?.trim() ||
            message.message?.buttonsResponseMessage?.selectedButtonId?.trim() ||
            ''
        ).toLowerCase().replace(/\.\s+/g, '.').trim();

        // Preserve raw message for commands like .tag that need original casing
        const rawText = message.message?.conversation?.trim() ||
            message.message?.extendedTextMessage?.text?.trim() ||
            message.message?.imageMessage?.caption?.trim() ||
            message.message?.videoMessage?.caption?.trim() ||
            '';

        // Only log command usage for messages that begin with a valid prefix
        const { PREFIXES } = require('./config');
        if (PREFIXES.includes(userMessage.charAt(0))) {
            console.log(`📝 Command used in ${isGroup ? 'group' : 'private'}: ${userMessage}`);
            // Block non-owner commands when bot is OFF
            const botState = getBotState();
            if (!botState.isOn) {
                const cmd = (userMessage.split(' ')[0] || '').slice(1);
                if (cmd !== 'bot' && !senderIsOwnerOrSudo) {
                    await sock.sendMessage(chatId, { text: '⚠️ Bot is currently turned OFF by the owner. Only owner can run commands or turn it back on.' }, { quoted: message });
                    return;
                }
            }
        }
        // Read bot mode once; don't early-return so moderation can still run in private mode
        let isPublic = true;
        try {
            const data = JSON.parse(fs.readFileSync('./data/messageCount.json'));
            if (typeof data.isPublic === 'boolean') isPublic = data.isPublic;
        } catch (error) {
            console.error('Error checking access mode:', error);
            // default isPublic=true on error
        }
        const isOwnerOrSudoCheck = message.key.fromMe || senderIsOwnerOrSudo;
        // Check if user is banned (skip ban check for unban command)
        if (isBanned(senderId) && cmd !== 'unban') {
            // Only respond occasionally to avoid spam
            if (Math.random() < 0.1) {
                await sock.sendMessage(chatId, {
                    text: '❌ You are banned from using the bot. Contact an admin to get unbanned.',
                });
            }
            return;
        }

        // First check if it's a game move
        if (/^[1-9]$/.test(userMessage) || userMessage.toLowerCase() === 'surrender') {
            await handleTicTacToeMove(sock, chatId, senderId, userMessage);
            return;
        }

        /*  // Basic message response in private chat
          if (!isGroup && (userMessage === 'hi' || userMessage === 'hello' || userMessage === 'bot' || userMessage === 'hlo' || userMessage === 'hey' || userMessage === 'bro')) {
              await sock.sendMessage(chatId, {
                  text: `Hi, How can I help you?\nYou can use ${PREFIXES[0]}menu for more info and commands.`,"}]}
              });
              return;
          } */

        if (!message.key.fromMe) incrementMessageCount(chatId, senderId);

        // Check for bad words and antilink FIRST, before ANY other processing
        // Always run moderation in groups, regardless of mode
        if (isGroup) {
            if (userMessage) {
                await handleBadwordDetection(sock, chatId, message, userMessage, senderId);
            }
            // Antilink checks message text internally, so run it even if userMessage is empty
            await Antilink(message, sock);

            // Run anti-status message checks for mentions/mass-mentioning
            try {
                const { checkMessageForViolations } = require('./commands/antistatus');
                if (typeof checkMessageForViolations === 'function') {
                    await checkMessageForViolations(sock, message);
                }
            } catch (e) {
                console.error('antistatus-message hook error:', e && e.message ? e.message : e);
            }
        }

        // PM blocker: block non-owner DMs when enabled (do not ban)
        if (!isGroup && !message.key.fromMe && !senderIsSudo) {
            try {
                const pmState = readPmBlockerState();
                if (pmState.enabled) {
                    // Inform user, delay, then block without banning globally
                    await sock.sendMessage(chatId, { text: pmState.message || 'Private messages are blocked. Please contact the owner in groups only.' });
                    await new Promise(r => setTimeout(r, 1500));
                    try { await sock.updateBlockStatus(chatId, 'block'); } catch (e) { }
                    return;
                }
            } catch (e) { }
        }

        // Then check for command prefix (allow configurable single-character prefixes)
        // Use the existing PREFIXES variable (declared earlier) to avoid redeclaration
        const firstChar = userMessage.charAt(0);
        const isCommand = PREFIXES.includes(firstChar);

        // Compute normalized command body (without prefix) and first token (command)
        const cmdBody = isCommand ? userMessage.slice(1).toLowerCase() : userMessage.toLowerCase();
        const cmd = (cmdBody.split(' ')[0] || '').trim();

        if (!isCommand) {
            // Show typing indicator if autotyping is enabled
            await handleAutotypingForMessage(sock, chatId, userMessage);

            if (isGroup) {
                // Always run moderation features (antitag) regardless of mode
                await handleTagDetection(sock, chatId, message, senderId);
                await handleMentionDetection(sock, chatId, message);
                
                // Only run chatbot in public mode or for owner/sudo
                if (isPublic || isOwnerOrSudoCheck) {
                    await handleChatbotResponse(sock, chatId, message, userMessage, senderId);
                }
            }
            return;
        }
        // In private mode, only owner/sudo can run commands —
        // allow group-level mods to run commands in their group even when private
        if (!isPublic && !isOwnerOrSudoCheck) {
            // allow if in a group and sender is configured as group mod
            const groupMods = require('./lib/groupMods');
            if (!(isGroup && groupMods.isGroupMod(chatId, senderId))) {
                return;
            }
        }

        // List of admin commands (without prefix)
        const adminCommands = ['mute', 'unmute', 'ban', 'unban', 'promote', 'demote', 'kick', 'tagall', 'tagnotadmin', 'hidetag', 'antilink', 'antitag', 'setgdesc', 'setgname', 'setgpp'];
        // List of owner commands (without prefix)
        const ownerCommands = ['mode', 'autostatus', 'antidelete', 'cleartmp', 'setpp', 'clearsession', 'areact', 'autoreact', 'autotyping', 'autoread', 'pmblocker', 'bot', 'mirrorpresence', 'setaikey', 'clearaikey', 'testaikey'];

        // Build command matcher using the previously computed `cmdBody`
        const commandMatches = (cmd) => new RegExp(`^${cmd}(\\b|\\s|$)`).test(cmdBody);
        const isAdminCommand = adminCommands.some(commandMatches);
        const isOwnerCommand = ownerCommands.some(commandMatches);

        let isSenderAdmin = false;
        let isBotAdmin = false;

        // Check admin status only for admin commands in groups
        if (isGroup && isAdminCommand) {
            const adminStatus = await isAdmin(sock, chatId, senderId);
            isSenderAdmin = adminStatus.isSenderAdmin;
            isBotAdmin = adminStatus.isBotAdmin;

            if (!isBotAdmin) {
                await sock.sendMessage(chatId, { text: 'Please make the bot an admin to use admin commands.', }, { quoted: message });
                return;
            }

            if (['mute','unmute','ban','unban','promote','demote'].includes(cmd)) {
                if (!isSenderAdmin && !message.key.fromMe) {
                    await sock.sendMessage(chatId, {
                        text: 'Sorry, only group admins can use this command.',
                    }, { quoted: message });
                    return;
                }
            }
        }

        // Check owner status for owner commands
        if (isOwnerCommand) {
            if (!message.key.fromMe && !senderIsOwnerOrSudo) {
                await sock.sendMessage(chatId, { text: '❌ This command is only available for the owner or sudo!' }, { quoted: message });
                return;
            }
        }

        // Command handlers - Execute commands immediately without waiting for typing indicator
        // We'll show typing indicator after command execution if needed
        let commandExecuted = false;

        switch (true) {
            case cmd === 'simage': {
                const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (quotedMessage?.stickerMessage) {
                    await simageCommand(sock, quotedMessage, chatId);
                } else {
                    await sock.sendMessage(chatId, { text: `Please reply to a sticker with the ${PREFIXES[0]}simage command to convert it.`, }, { quoted: message });
                }
                commandExecuted = true;
                break;
            }
            case cmd === 'kick':
                const mentionedJidListKick = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await kickCommand(sock, chatId, senderId, mentionedJidListKick, message);
                break; 
            case cmd === 'mute':
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const muteArg = parts[1];
                    const muteDuration = muteArg !== undefined ? parseInt(muteArg, 10) : undefined;
                    if (muteArg !== undefined && (isNaN(muteDuration) || muteDuration <= 0)) {
                        await sock.sendMessage(chatId, { text: `Please provide a valid number of minutes or use ${PREFIXES[0]}mute with no number to mute immediately.`, }, { quoted: message });
                    } else {
                        await muteCommand(sock, chatId, senderId, message, muteDuration);
                    }
                }
                break;
            case cmd === 'unmute':
                await unmuteCommand(sock, chatId, senderId);
                break;
            case cmd === 'ai':
                {
                    const args = userMessage.split(' ').slice(1);
                    await aiCommand(sock, chatId, message, args, isAdmin);
                }
                break;
            case cmd === 'setaikey':
                {
                    const { setAIKeyCommand } = require('./commands/aikey');
                    await setAIKeyCommand(sock, chatId, message);
                }
                break;
            case cmd === 'clearaikey':
                {
                    const { clearAIKeyCommand } = require('./commands/aikey');
                    await clearAIKeyCommand(sock, chatId, message);
                }
                break;
            case cmd === 'testaikey':
                {
                    const { testAIKeyCommand } = require('./commands/aikey');
                    await testAIKeyCommand(sock, chatId, message);
                }
                break;
            case cmd === 'ban':
                if (!isGroup) {
                    if (!message.key.fromMe && !senderIsSudo) {
                        await sock.sendMessage(chatId, { text: `Only owner/sudo can use ${PREFIXES[0]}ban in private chat.` }, { quoted: message });
                        break;
                    }
                }
                await banCommand(sock, chatId, message);
                break;
            // Pair, verify, paired, connect commands removed - website bot pairing disabled
            case commandMatches('chat'):
                {
                    const parts = rawText.trim().split(/\s+/);
                    const q = parts.slice(1).join(' ');
                    await chatCommand(sock, chatId, message, q);
                }
                break;
            case commandMatches('youtube') || commandMatches('yt'):
                {
                    const parts = rawText.trim().split(/\s+/);
                    const q = parts.slice(1).join(' ');
                    await youtubeCommand(sock, chatId, message, q);
                }
                break;
            case commandMatches('unban'):
                if (!isGroup) {
                    if (!message.key.fromMe && !senderIsSudo) {
                        await sock.sendMessage(chatId, { text: `Only owner/sudo can use ${PREFIXES[0]}unban in private chat.` }, { quoted: message });
                        break;
                    }
                }
                await unbanCommand(sock, chatId, message);
                break;
            case ['help','menu','list'].includes(cmd):
                await helpCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case commandMatches('antistatus'):
                {
                    const parts = rawText.trim().split(/\s+/);
                    const args = parts.slice(1);
                    await antistatusCommand(sock, chatId, message, args);
                }
                break;
                break;
            case ['sticker','s'].includes(cmd):
                await stickerCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case commandMatches('warnings'):
                const mentionedJidListWarnings = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await warningsCommand(sock, chatId, mentionedJidListWarnings);
                break;
            case commandMatches('warn'):
                const mentionedJidListWarn = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await warnCommand(sock, chatId, senderId, mentionedJidListWarn, message);
                break;
            case commandMatches('tts'):
                const text = userMessage.slice(4).trim();
                await ttsCommand(sock, chatId, text, message);
                break;
            case commandMatches('delete') || commandMatches('del'):
                await deleteCommand(sock, chatId, message, senderId);
                break;
            case commandMatches('attp'):
                await attpCommand(sock, chatId, message);
                break;

            case cmd === 'settings':
                await settingsCommand(sock, chatId, message);
                break;
            case commandMatches('mode'):
                // Check if sender is the owner
                if (!message.key.fromMe && !senderIsOwnerOrSudo) {
                    await sock.sendMessage(chatId, { text: 'Only bot owner can use this command!', }, { quoted: message });
                    return;
                }
                // Read current data first
                let data;
                try {
                    data = JSON.parse(fs.readFileSync('./data/messageCount.json'));
                } catch (error) {
                    console.error('Error reading access mode:', error);
                    await sock.sendMessage(chatId, { text: 'Failed to read bot mode status', });
                    return;
                }

                const action = userMessage.split(' ')[1]?.toLowerCase();
                // If no argument provided, show current status
                if (!action) {
                    const currentMode = data.isPublic ? 'public' : 'private';
                    await sock.sendMessage(chatId, {
                        text: `Current bot mode: *${currentMode}*\n\nUsage: ${PREFIXES[0]}mode public/private\n\nExample:\n${PREFIXES[0]}mode public - Allow everyone to use bot\n${PREFIXES[0]}mode private - Restrict to owner only`,
                    }, { quoted: message });
                    return;
                }

                if (action !== 'public' && action !== 'private') {
                    await sock.sendMessage(chatId, {
                        text: `Usage: ${PREFIXES[0]}mode public/private\n\nExample:\n${PREFIXES[0]}mode public - Allow everyone to use bot\n${PREFIXES[0]}mode private - Restrict to owner only`,
                    }, { quoted: message });
                    return;
                }

                try {
                    // Update access mode
                    data.isPublic = action === 'public';

                    // Save updated data
                    fs.writeFileSync('./data/messageCount.json', JSON.stringify(data, null, 2));

                    await sock.sendMessage(chatId, { text: `Bot is now in *${action}* mode`, });
                } catch (error) {
                    console.error('Error updating access mode:', error);
                    await sock.sendMessage(chatId, { text: 'Failed to update bot access mode', });
                }
                break;

            case commandMatches('bot'):
                {
                    const args = userMessage.split(' ').slice(1);
                    const sub = (args[0] || '').toLowerCase();

                    if (sub === 'mirror') {
                        // backward compatibility: .bot mirror on|off
                        const mp = require('./commands/mirrorpresence');
                        await mp(sock, chatId, message, args.slice(1).join(' '));
                        break;
                    }

                    if (!message.key.fromMe && !senderIsOwnerOrSudo) {
                        await sock.sendMessage(chatId, { text: '❌ Only bot owner or sudo can control bot power.' }, { quoted: message });
                        break;
                    }

                    if (!sub || sub === 'status') {
                        const st = getBotState();
                        await sock.sendMessage(chatId, { text: `⚡ Bot power state: *${st.isOn ? 'ON' : 'OFF'}*` }, { quoted: message });
                        break;
                    }

                    if (sub === 'on') {
                        if (setBotState(true)) {
                            await sock.sendMessage(chatId, { text: '✅ Bot turned *ON*. Responding to commands now.' }, { quoted: message });
                        } else {
                            await sock.sendMessage(chatId, { text: '⚠️ Failed to turn bot on.' }, { quoted: message });
                        }
                        break;
                    }

                    if (sub === 'off') {
                        // Prevent turning off while owner is detected online unless '--force' is provided
                        const argsLower = args.map(a => a.toLowerCase());
                        let ownerOnline = false;
                        try {
                            ownerOnline = JSON.parse(fs.readFileSync('./data/ownerPresence.json', 'utf8')).isOnline || false;
                        } catch (e) {}
                        const force = argsLower.includes('--force') || argsLower.includes('force');
                        if (ownerOnline && !force) {
                            await sock.sendMessage(chatId, { text: `⚠️ Cannot turn bot *OFF* while the owner is online. Use \`${PREFIXES[0]}bot off --force\` to override.` }, { quoted: message });
                            break;
                        }
                        if (setBotState(false)) {
                            await sock.sendMessage(chatId, { text: '✅ Bot turned *OFF*. Only owner can turn it back on.' }, { quoted: message });
                        } else {
                            await sock.sendMessage(chatId, { text: '⚠️ Failed to turn bot off.' }, { quoted: message });
                        }
                        break;
                    }

                    await sock.sendMessage(chatId, { text: `Usage: ${PREFIXES[0]}bot on|off|status|mirror` }, { quoted: message });
                }
                break; 
            case commandMatches('mirrorpresence'):
                {
                    const args = userMessage.split(' ').slice(1).join(' ');
                    if (!message.key.fromMe && !senderIsOwnerOrSudo) {
                        await sock.sendMessage(chatId, { text: '❌ Only owner/sudo can manage mirror presence.' }, { quoted: message });
                        break;
                    }
                    const mp = require('./commands/mirrorpresence');
                    await mp(sock, chatId, message, args);
                }
                break; 
            case commandMatches('anticall'):
                if (!message.key.fromMe && !senderIsOwnerOrSudo) {
                    await sock.sendMessage(chatId, { text: 'Only owner/sudo can use anticall.' }, { quoted: message });
                    break;
                }
                {
                    const args = userMessage.split(' ').slice(1).join(' ');
                    await anticallCommand(sock, chatId, message, args);
                }
                break; 
            case commandMatches('pmblocker'):
                {
                    const args = userMessage.split(' ').slice(1).join(' ');
                    await pmblockerCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break; 
            case commandMatches('prefixes') || commandMatches('setprefixes'):
                {
                    const args = userMessage.split(' ').slice(1).join(' ');
                    const senderIdClean = senderId.split(':')[0].split('@')[0];
                    const ownerNum = settings.ownerNumber ? settings.ownerNumber.split(':')[0].split('@')[0] : '';
                    const isOwner = message.key.fromMe || senderIdClean === ownerNum || senderId.includes(ownerNum);
                    const pfx = require('./commands/prefixes');
                    await pfx.prefixesCommand(sock, chatId, message, args, isOwner);
                }
                break;
            case commandMatches('antibot'):
                {
                    const senderIdClean = senderId.split(':')[0].split('@')[0];
                    const ownerNum = settings.ownerNumber ? settings.ownerNumber.split(':')[0].split('@')[0] : '';
                    const isOwner = message.key.fromMe || senderIdClean === ownerNum || senderId.includes(ownerNum);
                    const { antibotCommand } = require('./commands/antibot');
                    await antibotCommand(sock, chatId, senderId, message);
                }
                break;
            case commandMatches('addmod'):
                {
                    const args = userMessage.split(' ').slice(1).join(' ');
                    const senderIdClean = senderId.split(':')[0].split('@')[0];
                    const ownerNum = settings.ownerNumber ? settings.ownerNumber.split(':')[0].split('@')[0] : '';
                    const isOwner = message.key.fromMe || senderIdClean === ownerNum || senderId.includes(ownerNum);
                    const mods = require('./commands/mods');
                    await mods.addmodCommand(sock, chatId, message, args, senderId, isOwner);
                }
                break;
            case commandMatches('delmod'):
                {
                    const args = userMessage.split(' ').slice(1).join(' ');
                    const senderIdClean = senderId.split(':')[0].split('@')[0];
                    const ownerNum = settings.ownerNumber ? settings.ownerNumber.split(':')[0].split('@')[0] : '';
                    const isOwner = message.key.fromMe || senderIdClean === ownerNum || senderId.includes(ownerNum);
                    const mods = require('./commands/mods');
                    await mods.delmodCommand(sock, chatId, message, args, senderId, isOwner);
                }
                break;
            case commandMatches('listmods'):
                {
                    const mods = require('./commands/mods');
                    await mods.listmodsCommand(sock, chatId, message);
                }
                break;
            case commandMatches('getpp') || commandMatches('getprofile'):
                {
                    const getpp = require('./commands/getpp');
                    await getpp(sock, chatId, message);
                }
                break;
            case cmd === 'add':
                {
                    // Add member to group (only group admins)
                    const args = userMessage.split(' ').slice(1).join(' ');
                    await addMember(sock, chatId, senderId, args, message);
                }
                break;
            case cmd === 'owner':
                await ownerCommand(sock, chatId);
                break;
            case cmd === 'pair':
                {
                    const code = rawText.slice(5).trim();
                    await pairCommand(sock, chatId, message, code);
                }
                break; 
             case cmd === 'tagall':
                await tagAllCommand(sock, chatId, senderId, message);
                break; 
            case cmd === 'tagnotadmin':
                await tagNotAdminCommand(sock, chatId, senderId, message);
                break; 
            case commandMatches('hidetag'):
                {
                    const messageText = rawText.slice(8).trim();
                    const replyMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
                    await hideTagCommand(sock, chatId, senderId, messageText, replyMessage, message);
                }
                break; 
            case commandMatches('tag'):
                const messageText = rawText.slice(4).trim();  // use rawText here, not userMessage
                const replyMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
                await tagCommand(sock, chatId, senderId, messageText, replyMessage, message);
                break; 
            case commandMatches('antilink'):
                if (!isGroup) {
                    await sock.sendMessage(chatId, {
                        text: 'This command can only be used in groups.',                  
                    }, { quoted: message });
                    return;
                }
                if (!isBotAdmin) {
                    await sock.sendMessage(chatId, {
                        text: 'Please make the bot an admin first.',
                    }, { quoted: message });
                    return;
                }
                await handleAntilinkCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
                break; 
            case commandMatches('antitag'):
                if (!isGroup) {
                    await sock.sendMessage(chatId, {
                        text: 'This command can only be used in groups.',
                    }, { quoted: message });
                    return;
                }
                if (!isBotAdmin) {
                    await sock.sendMessage(chatId, {
                        text: 'Please make the bot an admin first.',
                    }, { quoted: message });
                    return;
                }
                await handleAntitagCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message);
                break;
            case cmd === 'meme':
                await memeCommand(sock, chatId, message);
                break;
            case cmd === 'joke':
                await jokeCommand(sock, chatId, message);
                break;
            case cmd === 'quote':
                await quoteCommand(sock, chatId, message);
                break;
            case cmd === 'fact':
                await factCommand(sock, chatId, message, message);
                break; 
            case commandMatches('weather'):
                {
                    const city = userMessage.slice(9).trim();
                    if (city) {
                        await weatherCommand(sock, chatId, message, city);
                    } else {
                        await sock.sendMessage(chatId, { text: `Please specify a city, e.g., ${PREFIXES[0]}weather London`,}, { quoted: message });
                    }
                }
                break; 
            case cmd === 'news':
                await newsCommand(sock, chatId);
                break; 
            case commandMatches('ttt') || commandMatches('tictactoe'):
                {
                    const tttText = userMessage.split(' ').slice(1).join(' ');
                    await tictactoeCommand(sock, chatId, senderId, tttText);
                }
                break; 
            case commandMatches('move'):
                {
                    const position = parseInt(userMessage.split(' ')[1]);
                    if (isNaN(position)) {
                        await sock.sendMessage(chatId, { text: 'Please provide a valid position number for Tic-Tac-Toe move.', }, { quoted: message });
                    } else {
                        tictactoeMove(sock, chatId, senderId, position);
                    }
                }
                break; 
            case cmd === 'topmembers':
                topMembers(sock, chatId, isGroup);
                break; 
            case commandMatches('hangman'):
                startHangman(sock, chatId);
                break;
            case commandMatches('guess'):
                {
                    const guessedLetter = userMessage.split(' ')[1];
                    if (guessedLetter) {
                        guessLetter(sock, chatId, guessedLetter);
                    } else {
                        sock.sendMessage(chatId, { text: `Please guess a letter using ${PREFIXES[0]}guess <letter>`, }, { quoted: message });
                    }
                }
                break;
            case commandMatches('trivia'):
                startTrivia(sock, chatId);
                break;
            case commandMatches('answer'):
                {
                    const answer = userMessage.split(' ').slice(1).join(' ');
                    if (answer) {
                        answerTrivia(sock, chatId, answer);
                    } else {
                        sock.sendMessage(chatId, { text: `Please provide an answer using ${PREFIXES[0]}answer <answer>`, }, { quoted: message });
                    }
                }
                break;
            case commandMatches('compliment'):
                await complimentCommand(sock, chatId, message);
                break;
            case commandMatches('insult'):
                await insultCommand(sock, chatId, message);
                break;
            case commandMatches('8ball'):
                {
                    const question = userMessage.split(' ').slice(1).join(' ');
                    await eightBallCommand(sock, chatId, question);
                }
                break;
            case commandMatches('lyrics'):
                {
                    const songTitle = userMessage.split(' ').slice(1).join(' ');
                    await lyricsCommand(sock, chatId, songTitle, message);
                }
                break;
            case commandMatches('simp'):
                {
                    const quotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    const mentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    await simpCommand(sock, chatId, quotedMsg, mentionedJid, senderId);
                }
                break;
            case commandMatches('stupid') || commandMatches('itssostupid') || commandMatches('iss'):
                {
                    const stupidQuotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    const stupidMentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    const stupidArgs = userMessage.split(' ').slice(1);
                    await stupidCommand(sock, chatId, stupidQuotedMsg, stupidMentionedJid, senderId, stupidArgs);
                }
                break;
            case cmd === 'dare':
                await dareCommand(sock, chatId, message);
                break;
            case cmd === 'truth':
                await truthCommand(sock, chatId, message);
                break;
            case cmd === 'clear':
                if (isGroup) await clearCommand(sock, chatId);
                break;
            case commandMatches('promote'):
                {
                    const mentionedJidListPromote = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    await promoteCommand(sock, chatId, mentionedJidListPromote, message);
                }
                break;
            case commandMatches('demote'):
                {
                    const mentionedJidListDemote = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                    await demoteCommand(sock, chatId, mentionedJidListDemote, message);
                }
                break;
            case cmd === 'ping':
                await pingCommand(sock, chatId, message);
                break;
            case cmd === 'uptime':
                await uptimeCommand(sock, chatId, message);
                break;
            case cmd === 'alive':
                await aliveCommand(sock, chatId, message);
                break; 
            case commandMatches('mention'):
                {
                    const args = userMessage.split(' ').slice(1).join(' ');
                    const isOwner = message.key.fromMe || senderIsSudo;
                    await mentionToggleCommand(sock, chatId, message, args, isOwner);
                }
                break;
            case cmd === 'setmention':
                {
                    const isOwner = message.key.fromMe || senderIsSudo;
                    await setMentionCommand(sock, chatId, message, isOwner);
                }
                break;
            case commandMatches('blur'):
                {
                    const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    await blurCommand(sock, chatId, message, quotedMessage);
                }
                break;
            case commandMatches('welcome'):
                {
                    if (isGroup) {
                        // Check admin status if not already checked
                        if (!isSenderAdmin) {
                            const adminStatus = await isAdmin(sock, chatId, senderId);
                            isSenderAdmin = adminStatus.isSenderAdmin;
                        }

                        if (isSenderAdmin || message.key.fromMe) {
                            await welcomeCommand(sock, chatId, message);
                        } else {
                            await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use this command.', }, { quoted: message });
                        }
                    } else {
                        await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', }, { quoted: message });
                    }
                }
                break;
            case commandMatches('goodbye'):
                {
                    if (isGroup) {
                        // Check admin status if not already checked
                        if (!isSenderAdmin) {
                            const adminStatus = await isAdmin(sock, chatId, senderId);
                            isSenderAdmin = adminStatus.isSenderAdmin;
                        }

                        if (isSenderAdmin || message.key.fromMe) {
                            await goodbyeCommand(sock, chatId, message);
                        } else {
                            await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use this command.',}, { quoted: message });
                        }
                    } else {
                        await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', }, { quoted: message });
                    }
                }
                break;
            // GitHub-related commands removed to avoid external API errors
            // (commands: .git, .github, .sc, .script, .repo) - intentionally disabled.
            case commandMatches('antibadword'):
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', }, { quoted: message });
                    return;
                }

                const adminStatus = await isAdmin(sock, chatId, senderId);
                isSenderAdmin = adminStatus.isSenderAdmin;
                isBotAdmin = adminStatus.isBotAdmin;

                if (!isBotAdmin) {
                    await sock.sendMessage(chatId, { text: '*Bot must be admin to use this feature*', }, { quoted: message });
                    return;
                }

                await antibadwordCommand(sock, chatId, message, senderId, isSenderAdmin);
                break;
            case commandMatches('chatbot'):
                // Allow owner to use in private or admins in groups
                if (!isGroup && !(message.key.fromMe || senderIsOwnerOrSudo)) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups, or privately by the bot owner.',}, { quoted: message });
                    return;
                }

                // Check if sender is admin or bot owner
                const chatbotAdminStatus = isGroup ? await isAdmin(sock, chatId, senderId) : { isSenderAdmin: false };
                if (!chatbotAdminStatus.isSenderAdmin && !message.key.fromMe && !senderIsOwnerOrSudo) {
                    await sock.sendMessage(chatId, { text: '*Only admins or bot owner can use this command*',}, { quoted: message });
                    return;
                }

                const match = userMessage.slice(8).trim();
                await handleChatbotCommand(sock, chatId, message, match);
                break;
            case commandMatches('take') || commandMatches('steal'):
                {
                    const isSteal = commandMatches('steal');
                    const sliceLen = isSteal ? 6 : 5; // '.steal' vs '.take' (including prefix char)
                    const takeArgs = rawText.slice(sliceLen).trim().split(' ');
                    await takeCommand(sock, chatId, message, takeArgs);
                }
                break;
            case cmd === 'flirt':
                await flirtCommand(sock, chatId, message);
                break;
            case commandMatches('character'):
                await characterCommand(sock, chatId, message);
                break;
            case commandMatches('waste'):
                await wastedCommand(sock, chatId, message);
                break; 
            case cmd === 'ship':
                {
                    if (!isGroup) {
                        await sock.sendMessage(chatId, { text: 'This command can only be used in groups!',}, { quoted: message });
                        return;
                    }
                    await shipCommand(sock, chatId, message);
                }
                break;
            case cmd === 'groupinfo' || cmd === 'infogp' || cmd === 'infogrupo':
                {
                    if (!isGroup) {
                        await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', }, { quoted: message });
                        return;
                    }
                    await groupInfoCommand(sock, chatId, message);
                }
                break;
            case cmd === 'resetlink' || cmd === 'revoke' || cmd === 'anularlink':
                {
                    if (!isGroup) {
                        await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', }, { quoted: message });
                        return;
                    }
                    await resetlinkCommand(sock, chatId, senderId);
                }
                break;
            case cmd === 'staff' || cmd === 'admins' || cmd === 'listadmin':
                {
                    if (!isGroup) {
                        await sock.sendMessage(chatId, { text: 'This command can only be used in groups!',}, { quoted: message });
                        return;
                    }
                    await staffCommand(sock, chatId, message);
                }
                break;
            case commandMatches('tourl') || commandMatches('url'):
                await urlCommand(sock, chatId, message);
                break;
            case commandMatches('emojimix') || commandMatches('emix'):
                await emojimixCommand(sock, chatId, message);
                break;
            case commandMatches('tg') || commandMatches('stickertelegram') || commandMatches('tgsticker') || commandMatches('telesticker'):
                await stickerTelegramCommand(sock, chatId, message);
                break;

            case cmd === 'vv':
                await viewOnceCommand(sock, chatId, message);
                break;
            case cmd === 'clearsession' || cmd === 'clearsesi':
                await clearSessionCommand(sock, chatId, message);
                break;
            case commandMatches('autostatus'):
                {
                    const autoStatusArgs = userMessage.split(' ').slice(1);
                    await autoStatusCommand(sock, chatId, message, autoStatusArgs);
                }
                break;
            case commandMatches('simp'):
                await simpCommand(sock, chatId, message);
                break;
            case commandMatches('metallic'):
                await textmakerCommand(sock, chatId, message, userMessage, 'metallic');
                break;
            case commandMatches('ice'):
                await textmakerCommand(sock, chatId, message, userMessage, 'ice');
                break;
            case commandMatches('snow'):
                await textmakerCommand(sock, chatId, message, userMessage, 'snow');
                break;
            case commandMatches('impressive'):
                await textmakerCommand(sock, chatId, message, userMessage, 'impressive');
                break;
            case commandMatches('matrix'):
                await textmakerCommand(sock, chatId, message, userMessage, 'matrix');
                break;
            case commandMatches('light'):
                await textmakerCommand(sock, chatId, message, userMessage, 'light');
                break;
            case commandMatches('neon'):
                await textmakerCommand(sock, chatId, message, userMessage, 'neon');
                break;
            case commandMatches('devil'):
                await textmakerCommand(sock, chatId, message, userMessage, 'devil');
                break;
            case commandMatches('purple'):
                await textmakerCommand(sock, chatId, message, userMessage, 'purple');
                break;
            case commandMatches('thunder'):
                await textmakerCommand(sock, chatId, message, userMessage, 'thunder');
                break;
            case commandMatches('leaves'):
                await textmakerCommand(sock, chatId, message, userMessage, 'leaves');
                break;
            case commandMatches('1917'):
                await textmakerCommand(sock, chatId, message, userMessage, '1917');
                break;
            case commandMatches('arena'):
                await textmakerCommand(sock, chatId, message, userMessage, 'arena');
                break;
            case commandMatches('hacker'):
                await textmakerCommand(sock, chatId, message, userMessage, 'hacker');
                break;
            case commandMatches('sand'):
                await textmakerCommand(sock, chatId, message, userMessage, 'sand');
                break;
            case commandMatches('blackpink'):
                await textmakerCommand(sock, chatId, message, userMessage, 'blackpink');
                break;
            case commandMatches('glitch'):
                await textmakerCommand(sock, chatId, message, userMessage, 'glitch');
                break;
            case commandMatches('fire'):
                await textmakerCommand(sock, chatId, message, userMessage, 'fire');
                break;
            case commandMatches('antidelete'):
                {
                    const antideleteMatch = userMessage.slice(11).trim();
                    await handleAntideleteCommand(sock, chatId, message, antideleteMatch);
                }
                break;
            case cmd === 'surrender':
                // Handle surrender command for tictactoe game
                await handleTicTacToeMove(sock, chatId, senderId, 'surrender');
                break;
            case cmd === 'cleartmp':
                await clearTmpCommand(sock, chatId, message);
                break;
            case cmd === 'setpp':
                await setProfilePicture(sock, chatId, message);
                break;
            case commandMatches('setgdesc'):
                {
                    const text = rawText.slice(9).trim();
                    await setGroupDescription(sock, chatId, senderId, text, message);
                }
                break;
            case commandMatches('setgname'):
                {
                    const text = rawText.slice(9).trim();
                    await setGroupName(sock, chatId, senderId, text, message);
                }
                break;
            case commandMatches('setgpp'):
                await setGroupPhoto(sock, chatId, senderId, message);
                break;
            case commandMatches('instagram') || commandMatches('insta') || cmd === 'ig' || commandMatches('ig'):
                await instagramCommand(sock, chatId, message);
                break;
            case commandMatches('igsc'):
                await igsCommand(sock, chatId, message, true);
                break;
            case commandMatches('igs'):
                await igsCommand(sock, chatId, message, false);
                break;
            case commandMatches('fb') || commandMatches('facebook'):
                await facebookCommand(sock, chatId, message);
                break;
            case commandMatches('music'):
                await playCommand(sock, chatId, message);
                break;
            case commandMatches('spotify'):
                await spotifyCommand(sock, chatId, message);
                break;
            case commandMatches('play') || commandMatches('mp3') || commandMatches('ytmp3') || commandMatches('song'):
                await songCommand(sock, chatId, message);
                break;
            case commandMatches('video') || commandMatches('ytmp4'):
                await videoCommand(sock, chatId, message);
                break;
            case commandMatches('tiktok') || commandMatches('tt'):
                await tiktokCommand(sock, chatId, message);
                break;
            case commandMatches('gpt') || commandMatches('gemini'):
                {
                    // Determine which engine was invoked and prepend it to args
                    const parts = userMessage.trim().split(/\s+/);
                    const invoked = (parts[0] || '').slice(1).toLowerCase(); // remove prefix char
                    const rest = parts.slice(1);
                    const args = [invoked, ...rest];
                    await aiCommand(sock, chatId, message, args);
                }
                break;
            case commandMatches('translate') || commandMatches('trt'):
                {
                    const commandLength = commandMatches('translate') ? 10 : 4;
                    await handleTranslateCommand(sock, chatId, message, userMessage.slice(commandLength));
                }
                return;
            case commandMatches('ss') || commandMatches('ssweb') || commandMatches('screenshot'):
                {
                    const ssCommandLength = commandMatches('screenshot') ? 11 : (commandMatches('ssweb') ? 6 : 3);
                    await handleSsCommand(sock, chatId, message, userMessage.slice(ssCommandLength).trim());
                }
                break;
            case commandMatches('areact') || commandMatches('autoreact') || commandMatches('autoreaction'):
                await handleAreactCommand(sock, chatId, message, isOwnerOrSudoCheck);
                break;
            case commandMatches('sudo'):
                await sudoCommand(sock, chatId, message);
                break;
            case cmd === 'goodnight' || cmd === 'lovenight' || cmd === 'gn':
                await goodnightCommand(sock, chatId, message);
                break;
            case cmd === 'shayari' || cmd === 'shayri':
                await shayariCommand(sock, chatId, message);
                break;
            case cmd === 'roseday':
                await rosedayCommand(sock, chatId, message);
                break; 
            case commandMatches('imagine') || commandMatches('flux') || commandMatches('dalle'):
                await imagineCommand(sock, chatId, message);
                break;
            case cmd === 'jid':
                await groupJidCommand(sock, chatId, message);
                break; 
            case commandMatches('autotyping'):
                await autotypingCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case commandMatches('autoread'):
                await autoreadCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case commandMatches('heart'):
                await handleHeart(sock, chatId, message);
                break;
            case commandMatches('horny'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['horny', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case commandMatches('circle'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['circle', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case commandMatches('lgbt'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['lgbt', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case commandMatches('lolice'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['lolice', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case commandMatches('simpcard'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['simpcard', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case commandMatches('tonikawa'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['tonikawa', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case commandMatches('its-so-stupid'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['its-so-stupid', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case commandMatches('namecard'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['namecard', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;

            case commandMatches('oogway2'):
            case commandMatches('oogway'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const sub = commandMatches('oogway2') ? 'oogway2' : 'oogway';
                    const args = [sub, ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case commandMatches('tweet'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['tweet', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case commandMatches('ytcomment'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['youtube-comment', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case commandMatches('comrade'):
            case commandMatches('gay'):
            case commandMatches('glass'):
            case commandMatches('jail'):
            case commandMatches('passed'):
            case commandMatches('triggered'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const sub = cmd; // use normalized cmd
                    const args = [sub, ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                break;
            case commandMatches('animu'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = parts.slice(1);
                    await animeCommand(sock, chatId, message, args);
                }
                break;
            // animu aliases
            case commandMatches('nom'):
            case commandMatches('poke'):
            case commandMatches('cry'):
            case commandMatches('kiss'):
            case commandMatches('pat'):
            case commandMatches('hug'):
            case commandMatches('wink'):
            case commandMatches('facepalm'):
            case commandMatches('face-palm'):
            case commandMatches('animuquote'):
            case commandMatches('quote'):
            case commandMatches('loli'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    let sub = parts[0].slice(1);
                    if (sub === 'facepalm') sub = 'face-palm';
                    if (sub === 'quote' || sub === 'animuquote') sub = 'quote';
                    await animeCommand(sock, chatId, message, [sub]);
                }
                break;
            case cmd === 'crop':
                await stickercropCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case commandMatches('pies'):
                {
                    const parts = rawText.trim().split(/\s+/);
                    const args = parts.slice(1);
                    await piesCommand(sock, chatId, message, args);
                    commandExecuted = true;
                }
                break;
            case cmd === 'china':
                await piesAlias(sock, chatId, message, 'china');
                commandExecuted = true;
                break;
            case cmd === 'indonesia':
                await piesAlias(sock, chatId, message, 'indonesia');
                commandExecuted = true;
                break;
            case cmd === 'japan':
                await piesAlias(sock, chatId, message, 'japan');
                commandExecuted = true;
                break;
            case cmd === 'korea':
                await piesAlias(sock, chatId, message, 'korea');
                commandExecuted = true;
                break;
            case cmd === 'hijab':
                await piesAlias(sock, chatId, message, 'hijab');
                commandExecuted = true;
                break;
            case commandMatches('update'):
                {
                    const parts = rawText.trim().split(/\s+/);
                    const zipArg = parts[1] && parts[1].startsWith('http') ? parts[1] : '';
                    await updateCommand(sock, chatId, message, zipArg);
                }
                commandExecuted = true;
                break;
            case commandMatches('removebg') || commandMatches('rmbg') || commandMatches('nobg'):
                await removebgCommand.exec(sock, message, userMessage.split(' ').slice(1));
                break;
            case commandMatches('remini') || commandMatches('enhance') || commandMatches('upscale'):
                await reminiCommand(sock, chatId, message, userMessage.split(' ').slice(1));
                break;
            case commandMatches('sora'):
                await soraCommand(sock, chatId, message);
                break;
            default:
                if (isGroup) {
                    // Handle non-command group messages
                    if (userMessage) {  // Make sure there's a message
                        await handleChatbotResponse(sock, chatId, message, userMessage, senderId);
                    }
                    await handleTagDetection(sock, chatId, message, senderId);
                    await handleMentionDetection(sock, chatId, message);
                }
                commandExecuted = false;
                break;
        }

        // If a command was executed, show typing status after command execution
        if (commandExecuted !== false) {
            // Command was executed, now show typing status after command execution
            await showTypingAfterCommand(sock, chatId);
        }

        // Function to handle .groupjid command
        async function groupJidCommand(sock, chatId, message) {
            const groupJid = message.key.remoteJid;

            if (!groupJid.endsWith('@g.us')) {
                return await sock.sendMessage(chatId, {
                    text: "❌ This command can only be used in a group."
                });
            }

            await sock.sendMessage(chatId, {
                text: `✅ Group JID: ${groupJid}`
            }, {
                quoted: message
            });
        }

        if (PREFIXES.includes(userMessage.charAt(0))) {
            // After command is processed successfully
            await addCommandReaction(sock, message);
        }
    } catch (error) {
        console.error('❌ Error in message handler:', error.message);
        // Only try to send error message if we have a valid chatId
        if (chatId) {
            await sock.sendMessage(chatId, {
                text: '❌ Failed to process command!',
            });
        }
    }
}

async function handleGroupParticipantUpdate(sock, update) {
    try {
        const { id, participants, action, author } = update;

        // Check if it's a group
        if (!id.endsWith('@g.us')) return;

        // If antibot is enabled for this group, auto-remove bot-like accounts that join (non-admins only)
        try {
            const store = require('./lib/antibotStore');
            if ((action === 'add' || action === 'invite') && store.isEnabled(id)) {
                const metadata = await sock.groupMetadata(id);
                const participantsMeta = metadata.participants || [];
                const meId = sock.user?.id || '';
                for (const pJid of participants) {
                    const found = participantsMeta.find(x => x.id === pJid);
                    if (!found) continue;
                    // simple heuristic
                    const nameParts = `${(found.id||'').toLowerCase()} ${(found.notify||'').toLowerCase()}`;
                    const looks = (nameParts.includes('bot') || nameParts.includes('whatsappbot') || nameParts.includes('wa_bot') || nameParts.includes('auto') || nameParts.includes('automation'));
                    const isPAdmin = found.admin && found.admin !== '';
                    if (found.id === meId) continue; // skip self
                    if (looks && !isPAdmin) {
                        try {
                            await sock.groupParticipantsUpdate(id, [found.id], 'remove');
                            await sock.sendMessage(id, { text: `Removed bot-like account @${found.id.split('@')[0]}`, contextInfo: { mentionedJid: [found.id] } });
                        } catch (e) {
                            console.error('Failed to auto-remove bot-like account on join:', e?.message || e);
                        }
                    }
                }
            }
        } catch (e) {
            console.error('antibot hook error:', e?.message || e);
        }

        // Respect bot mode: only announce promote/demote in public mode
        let isPublic = true;
        try {
            const modeData = JSON.parse(fs.readFileSync('./data/messageCount.json'));
            if (typeof modeData.isPublic === 'boolean') isPublic = modeData.isPublic;
        } catch (e) {
            // If reading fails, default to public behavior
        }

        // Handle promotion events
        if (action === 'promote') {
            if (!isPublic) return;
            await handlePromotionEvent(sock, id, participants, author);
            return;
        }

        // Handle demotion events
        if (action === 'demote') {
            if (!isPublic) return;
            await handleDemotionEvent(sock, id, participants, author);
            return;
        }

        // Handle join events
        if (action === 'add') {
            await handleJoinEvent(sock, id, participants);
        }

        // Handle leave events
        if (action === 'remove') {
            await handleLeaveEvent(sock, id, participants);
        }
    } catch (error) {
        console.error('Error in handleGroupParticipantUpdate:', error);
    }
}

// Instead, export the handlers along with handleMessages
module.exports = {
    handleMessages,
    handleGroupParticipantUpdate,
    handleStatus: async (sock, status) => {
        await handleStatusUpdate(sock, status);
    }
};
