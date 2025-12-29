/**
 * X5 Bot - A WhatsApp Bot
 * Copyright (c) 2025 Professor
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 * 
 * Credits:
 * - Baileys Library by @adiwajshing
 * - Pair Code implementation inspired by TechGod143 & DGXEON
 */
require('./settings');

// Enforce Node.js >= 20 for runtime compatibility with modern dependencies
const nodeMajor = parseInt(process.versions.node.split('.')[0], 10) || 0
if (nodeMajor < 20) {
    console.error(`Error: Node ${process.versions.node} detected. This project requires Node >= 20.\nPlease install Node 20 and ensure it's the default (nvm or PATH).`)
    process.exit(1)
}

const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const FileType = require('file-type')
const path = require('path')
const axios = require('axios')
const qrcode = require('qrcode-terminal')

// Defensive: polyfill global File when not defined (some runtimes or older Node binaries used by PM2 may not have it)
if (typeof File === 'undefined') {
    global.File = class File {
        constructor(parts, filename = 'file', options = {}) {
            const buffers = (parts || []).map(p => Buffer.isBuffer(p) ? p : Buffer.from(String(p)))
            this._buf = Buffer.concat(buffers.length ? buffers : [Buffer.alloc(0)])
            this.name = filename
            this.size = this._buf.length
            this.type = options.type || ''
            this.lastModified = options.lastModified || Date.now()
        }
        arrayBuffer() { return this._buf.buffer }
        stream() { const { Readable } = require('stream'); const s = new Readable(); s.push(this._buf); s.push(null); return s }
        text() { return this._buf.toString() }
    }
}

// Verify that all modules required from ./lib in main.js exist (helps on case-sensitive filesystems)
function checkLibDependencies() {
    try {
        const mainSrc = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
        const re = /require\(['"`]\.\/lib\/([a-zA-Z0-9_\/\-]+)['"`]\)/g;
        const required = new Set();
        let m;
        while ((m = re.exec(mainSrc))) required.add(m[1]);
        const missing = [];
        for (const name of required) {
            const candidates = [
                path.join(__dirname, 'lib', `${name}.js`),
                path.join(__dirname, 'lib', `${name}.mjs`),
                path.join(__dirname, 'lib', `${name}.cjs`)
            ];
            if (!candidates.some(p => fs.existsSync(p))) missing.push(name);
        }
        if (missing.length) {
            console.error('Missing lib modules required by main.js:', missing.join(', '));
            console.error('Please ensure these files exist, with exact case, and are committed to the repo.');
            process.exit(1);
        }
    } catch (err) {
        console.error('Failed to verify lib dependencies:', err && err.message ? err.message : err);
    }
}

checkLibDependencies();

let handleMessages, handleGroupParticipantUpdate, handleStatus;
try {
    ({ handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main'));
} catch (err) {
    console.error('Failed to load ./main. This often means a required file under ./lib is missing or has incorrect case on case-sensitive filesystems.');
    console.error('Detailed error:', err && err.message ? err.message : err);
    console.error('Run `ls -la ./lib` in the server to verify that files like isBanned.js exist and are committed.');
    process.exit(1);
}
const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, sleep, reSize } = require('./lib/myfunc')
// @whiskeysockets/baileys is an ES module; it's imported dynamically inside startXeonBotInc() to avoid `require()` errors at module load time.

// Start lightweight health server (useful for container platforms)
try { require('./server/health'); } catch (e) { /* ignore if not present */ }
const NodeCache = require("node-cache")
// Using a lightweight persisted store instead of makeInMemoryStore (compat across versions)
const pino = require("pino")
const readline = require("readline")
const { parsePhoneNumber } = require("libphonenumber-js")
const { rmSync, existsSync } = require('fs')
const { join } = require('path')

// Import lightweight store
const store = require('./lib/lightweight_store')

// Initialize store
store.readFromFile()
const settings = require('./settings');

// Log masked SESSION_ID (helps debug missing env without revealing the secret)
(() => {
    try {
        const sid = process.env.SESSION_ID || ''
        const sidDisplay = sid ? `${sid.slice(0,4)}...(${sid.length} chars)` : 'not set'
        console.log(`🔑 SESSION_ID: ${sidDisplay}`)
    } catch (e) {
        // Defensive: if process.env access fails for any reason, don't crash
        console.log('🔑 SESSION_ID: (unavailable)')
    }
})()

setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

// Memory optimization - Force garbage collection if available
setInterval(() => {
    if (global.gc) {
        global.gc()
        console.log('🧹 Garbage collection completed')
    }
}, 60_000) // every 1 minute

// Memory monitoring - Restart if RAM gets too high
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024
    if (used > 400) {
        console.log('⚠️ RAM too high (>400MB), restarting bot...')
        process.exit(1) // Panel will auto-restart
    }
}, 30_000) // check every 30 seconds

let phoneNumber = "911234567890"
let owner = JSON.parse(fs.readFileSync('./data/owner.json'))

global.botname = "X5 Bot"
global.themeemoji = "•"
const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code")
const useMobile = process.argv.includes("--mobile")

// Only create readline interface if we're in an interactive environment
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => {
    if (rl) {
        return new Promise((resolve) => rl.question(text, resolve))
    } else {
        // In non-interactive environment, use ownerNumber from settings
        return Promise.resolve(settings.ownerNumber || phoneNumber)
    }
}


async function startXeonBotInc() {
    try {
        // Dynamic import of Baileys (ESM) to avoid require() of ES Module at module load time
        const baileys = await import('@whiskeysockets/baileys')
        const {
            default: makeWASocket,
            useMultiFileAuthState,
            DisconnectReason,
            fetchLatestBaileysVersion,
            generateForwardMessageContent,
            prepareWAMessageMedia,
            generateWAMessageFromContent,
            generateMessageID,
            downloadContentFromMessage,
            jidDecode,
            proto,
            jidNormalizedUser,
            makeCacheableSignalKeyStore,
            delay
        } = baileys

        let { version, isLatest } = await fetchLatestBaileysVersion()
        const { state, saveCreds } = await useMultiFileAuthState(`./session`)
        const msgRetryCounterCache = new NodeCache()

        const XeonBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: !pairingCode,
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            getMessage: async (key) => {
                let jid = jidNormalizedUser(key.remoteJid)
                let msg = await store.loadMessage(jid, key.id)
                return msg?.message || ""
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
        })

        // Save credentials when they update
        XeonBotInc.ev.on('creds.update', saveCreds)

    store.bind(XeonBotInc.ev)

    // Message handling
    XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
        try {
            const mek = chatUpdate.messages[0]
            if (!mek.message) return
            mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message
            if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                await handleStatus(XeonBotInc, chatUpdate);
                return;
            }
            // In private mode, only block non-group messages (allow groups for moderation)
            // Note: XeonBotInc.public is not synced, so we check mode in main.js instead
            // This check is kept for backward compatibility but mainly blocks DMs
            if (!XeonBotInc.public && !mek.key.fromMe && chatUpdate.type === 'notify') {
                const isGroup = mek.key?.remoteJid?.endsWith('@g.us')
                if (!isGroup) return // Block DMs in private mode, but allow group messages
            }
            if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return

            // Clear message retry cache to prevent memory bloat
            if (XeonBotInc?.msgRetryCounterCache) {
                XeonBotInc.msgRetryCounterCache.clear()
            }

            try {
                await handleMessages(XeonBotInc, chatUpdate, true)
            } catch (err) {
                console.error("Error in handleMessages:", err)
                // Only try to send error message if we have a valid chatId
                if (mek.key && mek.key.remoteJid) {
                    await XeonBotInc.sendMessage(mek.key.remoteJid, {
                        text: '❌ An error occurred while processing your message.',
                        contextInfo: {
                            forwardingScore: 1,
                            isForwarded: true
                        }
                    }).catch(console.error);
                }
            }
        } catch (err) {
            console.error("Error in messages.upsert:", err)
        }
    })

    // Add these event handlers for better functionality
    XeonBotInc.decodeJid = (jid) => {
        if (!jid) return jid
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {}
            return decode.user && decode.server && decode.user + '@' + decode.server || jid
        } else return jid
    }

    XeonBotInc.ev.on('contacts.update', update => {
        for (let contact of update) {
            let id = XeonBotInc.decodeJid(contact.id)
            if (store && store.contacts) store.contacts[id] = { id, name: contact.notify }
        }
    })

    XeonBotInc.getName = (jid, withoutContact = false) => {
        id = XeonBotInc.decodeJid(jid)
        withoutContact = XeonBotInc.withoutContact || withoutContact
        let v
        if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
            v = store.contacts[id] || {}
            if (!(v.name || v.subject)) v = XeonBotInc.groupMetadata(id) || {}
            resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'))
        })
        else v = id === '0@s.whatsapp.net' ? {
            id,
            name: 'WhatsApp'
        } : id === XeonBotInc.decodeJid(XeonBotInc.user.id) ?
            XeonBotInc.user :
            (store.contacts[id] || {})
        return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
    }

    XeonBotInc.public = true

    XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store)

    // Handle pairing code
    if (pairingCode && !XeonBotInc.authState.creds.registered) {
        if (useMobile) throw new Error('Cannot use pairing code with mobile api')

        let phoneNumber
        if (!!global.phoneNumber) {
            phoneNumber = global.phoneNumber
        } else {
            phoneNumber = await question(chalk.bgBlack(chalk.greenBright(`Please type your WhatsApp number 😍\nFormat: 6281376552730 (without + or spaces) : `)))
        }

        // Clean the phone number - remove any non-digit characters
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '')

        // Validate the phone number using awesome-phonenumber
        const pn = require('awesome-phonenumber');
        if (!pn('+' + phoneNumber).isValid()) {
            console.log(chalk.red('Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK, etc.) without + or spaces.'));
            process.exit(1);
        }

        setTimeout(async () => {
            try {
                let code = await XeonBotInc.requestPairingCode(phoneNumber)
                code = code?.match(/.{1,4}/g)?.join("-") || code
                console.log(chalk.black(chalk.bgGreen(`Your Pairing Code : `)), chalk.black(chalk.white(code)))
                console.log(chalk.yellow(`\nPlease enter this code in your WhatsApp app:\n1. Open WhatsApp\n2. Go to Settings > Linked Devices\n3. Tap "Link a Device"\n4. Enter the code shown above`))
            } catch (error) {
                console.error('Error requesting pairing code:', error)
                console.log(chalk.red('Failed to get pairing code. Please check your phone number and try again.'))
            }
        }, 3000)
    }

    // Connection handling
    XeonBotInc.ev.on('connection.update', async (s) => {
        const { connection, lastDisconnect, qr } = s
        
        if (qr) {
            console.log(chalk.yellow('📱 QR Code generated. Please scan with WhatsApp.'))
            try {
                qrcode.generate(qr, { small: true }, (code) => console.log(code))
            } catch (e) {
                console.error('Error generating terminal QR:', e)
            }

            // Also save QR as PNG to assets for scanning from this machine
            try {
                const QR = require('qrcode')
                const outPath = path.join(__dirname, 'assets', `pair-${Date.now()}.png`)
                await QR.toFile(outPath, qr, { type: 'png', width: 400 })
                console.log(chalk.green(`📁 QR saved to: ${outPath}`))
            } catch (e) {
                console.error('Error saving QR PNG:', e)
            }
        }
        
        if (connection === 'connecting') {
            console.log(chalk.yellow('🔄 Connecting to WhatsApp...'))
        }
        
        if (connection == "open") {
            console.log(chalk.magenta(` `))
            console.log(chalk.yellow(`🌿Connected to => ` + JSON.stringify(XeonBotInc.user, null, 2)))

            try {
                const botNumber = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net';
                await XeonBotInc.sendMessage(botNumber, {
                    text: `🤖 Bot Connected Successfully!\n\n⏰ Time: ${new Date().toLocaleString()}\n✅ Status: Online and Ready!`,
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true
                    }
                });
            } catch (error) {
                console.error('Error sending connection message:', error.message)
            }

            await delay(1999)
            console.log(chalk.yellow(`\n\n                  ${chalk.bold.blue(`[ ${global.botname || 'X5 Bot'} ]`)}\n\n`))
            console.log(chalk.cyan(`< ================================================== >`))
            console.log(chalk.magenta(`\n${global.themeemoji || '•'}`))
            console.log(chalk.magenta(`${global.themeemoji || '•'} `))
            console.log(chalk.magenta(`${global.themeemoji || '•'} WA NUMBER: ${owner}`))
            console.log(chalk.magenta(`${global.themeemoji || '•'} `))
            console.log(chalk.green(`${global.themeemoji || '•'} 🤖 Bot Connected Successfully! ✅`))
            console.log(chalk.blue(`Bot Version: ${settings.version}`))
        }
        
        if (connection === 'close') {
            const errorObj = lastDisconnect?.error
            const errorStr = String(errorObj || '')

            // Explicitly handle Baileys "Stream Errored (conflict)" to avoid rapid reconnect loops
            console.log(chalk.red(`Connection close error string: ${errorStr}`))
            if (errorStr.toLowerCase().includes('conflict') || /stream errored/i.test(errorStr)) {
                console.error(chalk.red('⚠️ Connection closed: Stream Errored (conflict) — another session is using this account.'))
                console.error(chalk.red('Please logout other devices or re-authenticate on this server. The bot will stop to avoid repeated reconnects.'))
                // Try to stop the PM2-managed process to avoid restart loops
                try {
                    const { exec } = require('child_process');
                    exec('pm2 stop x5-bot', (err, stdout, stderr) => {
                        if (err) {
                            console.error('Failed to run `pm2 stop x5-bot`:', err);
                            process.exit(1);
                        } else {
                            console.log('pm2: stopped x5-bot to prevent restart loop.');
                            process.exit(0);
                        }
                    });
                } catch (err) {
                    console.error('Error attempting to stop pm2:', err);
                    process.exit(1);
                }
            }

            const shouldReconnect = (errorObj)?.output?.statusCode !== DisconnectReason.loggedOut
            const statusCode = errorObj?.output?.statusCode

            console.log(chalk.red(`Connection closed due to ${errorObj}, reconnecting ${shouldReconnect}`))

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                try {
                    rmSync('./session', { recursive: true, force: true })
                    console.log(chalk.yellow('Session folder deleted. Please re-authenticate.'))
                } catch (error) {
                    console.error('Error deleting session:', error)
                }
                console.log(chalk.red('Session logged out. Please re-authenticate.'))
            }

            if (shouldReconnect) {
                console.log(chalk.yellow('Reconnecting...'))
                await delay(5000)
                startXeonBotInc()
            }
        }
    })

    // Track recently-notified callers to avoid spamming messages
    const antiCallNotified = new Set();

    // Anticall handler: block callers when enabled
    XeonBotInc.ev.on('call', async (calls) => {
        try {
            const { readState: readAnticallState } = require('./commands/anticall');
            const state = readAnticallState();
            if (!state.enabled) return;
            for (const call of calls) {
                const callerJid = call.from || call.peerJid || call.chatId;
                if (!callerJid) continue;
                try {
                    // First: attempt to reject the call if supported
                    try {
                        if (typeof XeonBotInc.rejectCall === 'function' && call.id) {
                            await XeonBotInc.rejectCall(call.id, callerJid);
                        } else if (typeof XeonBotInc.sendCallOfferAck === 'function' && call.id) {
                            await XeonBotInc.sendCallOfferAck(call.id, callerJid, 'reject');
                        }
                    } catch {}

                    // Notify the caller only once within a short window
                    if (!antiCallNotified.has(callerJid)) {
                        antiCallNotified.add(callerJid);
                        setTimeout(() => antiCallNotified.delete(callerJid), 60000);
                        await XeonBotInc.sendMessage(callerJid, { text: '📵 Anticall is enabled. Your call was rejected and you will be blocked.' });
                    }
                } catch {}
                // Then: block after a short delay to ensure rejection and message are processed
                setTimeout(async () => {
                    try { await XeonBotInc.updateBlockStatus(callerJid, 'block'); } catch {}
                }, 800);
            }
        } catch (e) {
            // ignore
        }
    });

    XeonBotInc.ev.on('group-participants.update', async (update) => {
        await handleGroupParticipantUpdate(XeonBotInc, update);
    });

    XeonBotInc.ev.on('messages.upsert', async (m) => {
        if (m.messages[0].key && m.messages[0].key.remoteJid === 'status@broadcast') {
            await handleStatus(XeonBotInc, m);
        }
    });

    XeonBotInc.ev.on('status.update', async (status) => {
        await handleStatus(XeonBotInc, status);
    });

    XeonBotInc.ev.on('messages.reaction', async (status) => {
        await handleStatus(XeonBotInc, status);
    });

    // --- Owner presence handling: auto-enable bot while owner is online ---
    const OWNER_PRESENCE_FILE = './data/ownerPresence.json';
    function writeOwnerPresence(isOnline) {
        try { fs.writeFileSync(OWNER_PRESENCE_FILE, JSON.stringify({ isOnline }, null, 2)); } catch (e) {}
    }

    function getOwnerNumbers() {
        const owners = new Set();
        try {
            const ownerList = JSON.parse(fs.readFileSync('./data/owner.json', 'utf8'));
            if (Array.isArray(ownerList)) ownerList.forEach(n => owners.add(String(n)));
        } catch (e) {}
        if (settings.ownerNumber) owners.add(String(settings.ownerNumber));
        return Array.from(owners);
    }

    (async () => {
        try {
            const ownerNumbers = getOwnerNumbers();
            const ownerJids = ownerNumbers.map(n => n.includes('@') ? n : `${n}@s.whatsapp.net`);

            // Subscribe to presence for owner JIDs
            for (const jid of ownerJids) {
                try { await XeonBotInc.presenceSubscribe(jid); } catch (e) {}
            }

            XeonBotInc.ev.on('presence.update', async (update) => {
                try {
                    const ownerNumbersSet = new Set(ownerNumbers.map(n => n.split(':')[0].split('@')[0]));
                    // Handle both formats: { presences: { jid: {...} } } or { id: 'jid', ... }
                    let entries = [];
                    if (update && update.presences) entries = Object.entries(update.presences);
                    else if (update && update.id) entries = [[update.id, update]];
                    else entries = Object.entries(update || {});

                    // Helper to manage mirror presence timer
                    const mirrorState = (function(){ try { return JSON.parse(fs.readFileSync('./data/mirrorPresence.json','utf8')).enabled === true } catch(e){ return false } })() || (process.env.MIRROR_OWNER_PRESENCE === '1') || (settings.mirrorOwnerPresence === true);

                    for (const [jid, presenceObj] of entries) {
                        const cleanJid = (jid || '').split(':')[0];
                        const numeric = cleanJid.split('@')[0];
                        if (!ownerNumbersSet.has(numeric) && !ownerJids.includes(cleanJid)) continue;

                        const presence = presenceObj && (presenceObj.presence || presenceObj.lastKnownPresence || (typeof presenceObj === 'string' ? presenceObj : null));
                        const isOnline = presence === 'available' || presence === 'online' || presence === 'present';

                        writeOwnerPresence(isOnline);

                        if (isOnline) {
                            // Ensure the bot is ON while owner is online
                            try { fs.writeFileSync('./data/botState.json', JSON.stringify({ isOn: true }, null, 2)); } catch (e) {}
                            console.log('Owner is online — ensured bot is ON');
                        } else {
                            console.log('Owner presence updated: offline');
                        }

                        // Mirror presence to the owner if enabled
                        try {
                            if (mirrorState && XeonBotInc && typeof XeonBotInc.sendPresenceUpdate === 'function') {
                                // Use a single interval per bot to keep presence alive while owner online
                                if (!global._mirrorPresenceTimer) global._mirrorPresenceTimer = null;

                                async function sendPresenceToOwners(type) {
                                    for (const targetJid of ownerJids) {
                                        try { await XeonBotInc.sendPresenceUpdate(type, targetJid); } catch (e) {}
                                    }
                                }

                                if (isOnline) {
                                    // start or refresh timer
                                    try { sendPresenceToOwners('available'); } catch (e) {}
                                    if (!global._mirrorPresenceTimer) {
                                        global._mirrorPresenceTimer = setInterval(() => {
                                            sendPresenceToOwners('available');
                                        }, 25 * 1000);
                                        console.log('Mirror presence: started keepalive timer');
                                    }
                                } else {
                                    // owner went offline - clear timer and send unavailable
                                    if (global._mirrorPresenceTimer) {
                                        clearInterval(global._mirrorPresenceTimer);
                                        global._mirrorPresenceTimer = null;
                                        console.log('Mirror presence: stopped keepalive timer');
                                    }
                                    try { sendPresenceToOwners('unavailable'); } catch (e) {}
                                }
                            }
                        } catch (e) {
                            // ignore mirror presence errors
                        }

                    }
                } catch (e) {
                    console.error('Error processing presence.update:', e);
                }
            });
        } catch (e) {
            console.error('Error setting up owner presence handling:', e);
        }
    })();

    return XeonBotInc
    } catch (error) {
        console.error('Error in startXeonBotInc:', error)
        await delay(5000)
        startXeonBotInc()
    }
}


// Start the bot with error handling
if (process.env.KATABUMP_MODE === '1' || process.env.SKIP_WHATSAPP === '1') {
    console.log('KATABUMP_MODE is enabled; skipping WhatsApp connection. Set KATABUMP_MODE=0 or unset to start normally.');
} else {
    startXeonBotInc().catch(error => {
        console.error('Fatal error:', error)
        process.exit(1)
    })
}
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err)
})

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err)
})

let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(chalk.redBright(`Update ${__filename}`))
    delete require.cache[file]
    require(file)
})