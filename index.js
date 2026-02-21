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
const express = require('express')
const qrcode = require('qrcode-terminal')

// Website pairing removed - only bot terminal pairing is used

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

// PHONE NUMBER - Change this to your number or leave empty to be prompted
let phoneNumber = process.env.PHONE_NUMBER || ""
let owner = JSON.parse(fs.readFileSync('./data/owner.json'))
global.owner = owner  // Make globally accessible

global.botname = "X5 Bot"
global.themeemoji = "•"

// Determine connection mode from command line or phone number
const usePairingCode = !!phoneNumber || process.argv.includes("--pairing-code") || process.argv.includes("--pair")
const useMobile = process.argv.includes("--mobile")
const useQR = process.argv.includes("--qr") || (!usePairingCode && !useMobile)

// Track bot state to prevent repeated restarts while connected
let botConnected = false
let isRestarting = false
let socketReady = false // Track when WebSocket is fully ready for pairing code
let pairingPromptActive = false // Prevent duplicate terminal prompts for pairing
let pairingRequested = false // True once we've requested a pairing code to avoid re-requesting

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

// ========================================
// MULTI-USER SESSION MANAGEMENT
// ========================================
const sessionsFile = path.join(__dirname, 'data', 'sessions.json')

function loadSessions() {
    try {
        if (fs.existsSync(sessionsFile)) {
            return JSON.parse(fs.readFileSync(sessionsFile, 'utf8'))
        }
    } catch (e) {
        console.error('Error loading sessions:', e.message)
    }
    return { activeSessions: [], lastActiveSession: null, sessionHistory: [] }
}

function saveSessions(data) {
    try {
        if (!fs.existsSync(path.dirname(sessionsFile))) {
            fs.mkdirSync(path.dirname(sessionsFile), { recursive: true })
        }
        fs.writeFileSync(sessionsFile, JSON.stringify(data, null, 2), 'utf8')
    } catch (e) {
        console.error('Error saving sessions:', e.message)
    }
}

function addOrUpdateSession(phoneNumber, sessionFolderName) {
    const sessions = loadSessions()
    const sessionIndex = sessions.activeSessions.findIndex(s => s.phoneNumber === phoneNumber)
    
    if (sessionIndex >= 0) {
        sessions.activeSessions[sessionIndex] = {
            phoneNumber,
            sessionFolder: sessionFolderName,
            connectedAt: sessions.activeSessions[sessionIndex].connectedAt,
            lastActive: Date.now()
        }
    } else {
        sessions.activeSessions.push({
            phoneNumber,
            sessionFolder: sessionFolderName,
            connectedAt: Date.now(),
            lastActive: Date.now()
        })
    }
    
    sessions.lastActiveSession = phoneNumber
    saveSessions(sessions)
    console.log(chalk.green(`✅ Session persisted for ${phoneNumber}`))
    
    // Also add to owner.json for multi-user support
    try {
        const ownerFile = path.join(__dirname, 'data', 'owner.json')
        let owners = []
        
        if (fs.existsSync(ownerFile)) {
            try {
                owners = JSON.parse(fs.readFileSync(ownerFile, 'utf8'))
                if (!Array.isArray(owners)) owners = [owners]
            } catch (e) {
                owners = []
            }
        }
        
        // Add if not already present
        if (!owners.includes(phoneNumber)) {
            owners.push(phoneNumber)
            fs.writeFileSync(ownerFile, JSON.stringify(owners, null, 2), 'utf8')
            console.log(chalk.green(`✅ Added ${phoneNumber} to owner.json`))
        }
    } catch (e) {
        console.error('Error updating owner.json:', e.message)
    }
}

function getSessionFolder(phoneNumber) {
    const sessions = loadSessions()
    const existing = sessions.activeSessions.find(s => s.phoneNumber === phoneNumber)
    return existing?.sessionFolder || `./sessions/${phoneNumber}`
}

function getAllActiveSessions() {
    return loadSessions().activeSessions
}

// ========================================

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
            delay: baileyDelay
        } = baileys
        
        // Fallback delay if not available from Baileys
        const delay = baileyDelay || ((ms) => new Promise(resolve => setTimeout(resolve, ms)))

        let { version, isLatest } = await fetchLatestBaileysVersion()
        
        // Multi-user session support: Use last active session or default
        const activeSessions = getAllActiveSessions()
        let sessionPath = path.resolve(`./session`)  // Use absolute path
        
        // PRIORITY 1: If there are active sessions, reconnect to them (regardless of --pair flag)
        if (activeSessions.length > 0 && !phoneNumber) {
            // Reconnect to last active session if available
            const lastActive = activeSessions[activeSessions.length - 1]
            sessionPath = path.resolve(lastActive.sessionFolder)
            console.log(chalk.cyan(`🔄 Reconnecting to previous session: +${lastActive.phoneNumber}`))
            
            if (activeSessions.length > 1) {
                console.log(chalk.yellow(`\n📱 Available sessions (${activeSessions.length}):`))
                activeSessions.forEach((s, i) => console.log(chalk.yellow(`   ${i + 1}. +${s.phoneNumber}`)))
            }
        } else if (phoneNumber) {
            // PRIORITY 2: If a phone number is provided via env, use it
            sessionPath = path.resolve(getSessionFolder(phoneNumber))
        }
        // PRIORITY 3: Otherwise use default session (for new pairing or QR mode)
        
        // Create session directory with proper error handling
        if (!fs.existsSync(sessionPath)) {
            fs.mkdirSync(sessionPath, { recursive: true, mode: 0o755 })
            console.log(chalk.green(`✅ Created session directory: ${sessionPath}`))
        }
        
        // Make session path globally accessible for debug-bridge pairing
        global.currentSessionPath = sessionPath
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath).catch(err => {
            if (err.code === 'ENOENT' || err.message.includes('creds.json')) {
                // Session file is corrupted or missing, delete and recreate
                console.log(chalk.yellow('⚠️ Session corrupted. Clearing and re-authenticating...'))
                try {
                    if (fs.existsSync(sessionPath)) {
                        fs.rmSync(sessionPath, { recursive: true, force: true })
                        fs.mkdirSync(sessionPath, { recursive: true })
                    }
                } catch (e) {
                    // Continue anyway
                }
                return useMultiFileAuthState(sessionPath)
            }
            throw err
        })
        const msgRetryCounterCache = new NodeCache()

        const XeonBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: useQR, // Only print QR if using QR mode
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
            // Optimized timeout values for better connection stability
            defaultQueryTimeoutMs: 90000,        // Increased from 60s to 90s
            connectTimeoutMs: 90000,              // Increased from 60s to 90s
            keepAliveIntervalMs: 15000,           // Increased from 10s to 15s
            retryRequestDelayMs: 5000,            // Retry delay for failed requests
            shouldIgnoreJid: (jid) => jid.includes('@broadcast'), // Ignore broadcast messages
            shouldSyncHistoryMessage: () => false,  // Don't sync history on reconnect
        })

        // Expose the live bot instance to this process so internal APIs can use it
        try { global.XeonBotInc = XeonBotInc } catch (e) {}

        // --- Internal HTTP API for web server to request pairing codes ---
        try {
            const internalPort = process.env.INTERNAL_PORT || 4001;
            const internalApp = express();
            internalApp.use(express.json());

            internalApp.post('/request-pair', async (req, res) => {
                try {
                    const phoneNumber = (req.body && req.body.phoneNumber) || req.query.phoneNumber;
                    if (!phoneNumber) return res.status(400).json({ success: false, message: 'phoneNumber required' });
                    // Clean number
                    const clean = String(phoneNumber).replace(/[^0-9]/g, '');
                    const code = await XeonBotInc.requestPairingCode(clean);
                    return res.json({ success: true, code });
                } catch (err) {
                    console.error('Internal /request-pair error:', err && err.message ? err.message : err);
                    return res.status(500).json({ success: false, message: err && err.message ? err.message : String(err) });
                }
            });

            internalApp.get('/', (req, res) => res.json({ ok: true }));

            internalApp.listen(internalPort, () => {
                console.log(chalk.cyan(`🔒 Internal bot API running on http://127.0.0.1:${internalPort}`));
            });
        } catch (e) {
            console.error('Failed to start internal API:', e && e.message ? e.message : e);
        }

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

    // Connection handling with QR and Pairing Code support
    XeonBotInc.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr, isNewLogin } = update
        
        // Handle QR Code generation
        if (qr && useQR) {
            console.log(chalk.yellow('\n📱 QR Code generated\n'))
            try {
                qrcode.generate(qr, { small: true })
            } catch (e) {
                console.error('Error generating terminal QR:', e)
            }

            // Save QR as PNG
            try {
                const QR = require('qrcode')
                if (!fs.existsSync('./assets')) fs.mkdirSync('./assets', { recursive: true })
                const outPath = path.join(__dirname, 'assets', `qr-${Date.now()}.png`)
                const latestPath = path.join(__dirname, 'assets', `qr-latest.png`)
                await QR.toFile(outPath, qr, { type: 'png', width: 400 })
                // Also write a copy as qr-latest.png for external web server to read
                await QR.toFile(latestPath, qr, { type: 'png', width: 400 })
                // Save raw QR string for fallback
                try { fs.writeFileSync(path.join(__dirname, 'assets', 'latest-qr.txt'), String(qr), 'utf8') } catch (e) {}
                // Make latest QR available globally
                try { global.latestQR = String(qr) } catch (e) {}
                console.log(chalk.green(`📁 QR code saved to: ${outPath}\n`))
            } catch (e) {
                console.error('Error saving QR PNG:', e)
            }
        }

        // Handle Pairing Code
        if (usePairingCode && !XeonBotInc.authState.creds.registered && connection !== 'open') {
            if (useMobile) {
                console.log(chalk.red('❌ Cannot use pairing code with mobile API'))
                process.exit(1)
            }

            let pairNumber = phoneNumber
            
            // If no phone number provided, prompt the user in terminal for their number
            if (!pairNumber) {
                if (pairingPromptActive || pairingRequested) return // already prompting/requested elsewhere
                pairingPromptActive = true
                try {
                    const rlInterface = readline.createInterface({ input: process.stdin, output: process.stdout });
                    const ask = (q) => new Promise(resolve => rlInterface.question(q, ans => resolve(ans.trim())));
                    pairNumber = await ask('📱 Enter phone number (international, without + or spaces): ');
                    rlInterface.close();
                } catch (e) {
                    pairNumber = ''
                }
                if (!pairNumber) {
                    console.log(chalk.yellow('No phone number entered. Falling back to QR mode.'))
                    pairingPromptActive = false
                    return
                }
            }

            // Clean the phone number
            pairNumber = pairNumber.replace(/[^0-9]/g, '')

            // Validate phone number
            const pn = require('awesome-phonenumber')
            if (!pn('+' + pairNumber).isValid()) {
                console.log(chalk.red('\n❌ Invalid phone number format!'))
                console.log(chalk.yellow('Please enter your full international number without + or spaces'))
                console.log(chalk.yellow('Examples:'))
                console.log(chalk.yellow('  • US: 15551234567'))
                console.log(chalk.yellow('  • UK: 447911123456'))
                console.log(chalk.yellow('  • Nigeria: 2348012345678\n'))
                process.exit(1)
            }

            console.log(chalk.cyan(`\n✓ Valid number: +${pairNumber}`))
            console.log(chalk.yellow('⏳ Requesting pairing code...\n'))

            // Request pairing code (don't wait for socket, just try directly)
            const maxAttempts = 3
            let attempts = 0
            
            const requestCode = async () => {
                try {
                    // Just try to request the pairing code directly - no strict socket check
                    // This allows WhatsApp to handle the connection internally
                    attempts++
                    console.log(chalk.yellow(`📱 Requesting pairing code (attempt ${attempts}/${maxAttempts})...\n`))
                    
                    // Add a timeout wrapper to prevent hanging
                    const timeoutPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Pairing code request timeout - WhatsApp server not responding')), 50000)
                    )
                    
                    // Request the pairing code
                    let code = await Promise.race([
                        XeonBotInc.requestPairingCode(pairNumber),
                        timeoutPromise
                    ])
                    code = code?.match(/.{1,4}/g)?.join("-") || code
                    
                    console.log(chalk.green('\n╔════════════════════════════════════════╗'))
                    console.log(chalk.green('║         YOUR PAIRING CODE              ║'))
                    console.log(chalk.green('╠════════════════════════════════════════╣'))
                    console.log(chalk.green('║                                        ║'))
                    console.log(chalk.green(`║          ${chalk.bold.white(code)}           ║`))
                    console.log(chalk.green('║                                        ║'))
                    console.log(chalk.green('╚════════════════════════════════════════╝\n'))
                    
                    console.log(chalk.cyan('📱 To link your device:\n'))
                    console.log(chalk.white('   1. Open WhatsApp on your phone'))
                    console.log(chalk.white('   2. Go to Settings → Linked Devices'))
                    console.log(chalk.white('   3. Tap "Link a Device"'))
                    console.log(chalk.white('   4. Enter the code above\n'))
                    
                    pairingPromptActive = false
                } catch (error) {
                    console.error(chalk.red('\n❌ Pairing code error:'), error.message)
                    
                    if (attempts < maxAttempts) {
                        console.log(chalk.yellow(`\n⏳ Retrying in 5 seconds... (${attempts}/${maxAttempts})\n`))
                        await delay(5000)
                        return requestCode()
                    } else {
                        console.error(chalk.red('\n❌ Failed to get pairing code after 3 attempts'))
                        console.log(chalk.yellow('\n💡 Possible fixes:'))
                        console.log(chalk.yellow('   • Check your phone has active internet'))
                        console.log(chalk.yellow('   • Try again in 30 seconds'))
                        console.log(chalk.yellow('   • Or use QR mode: node index.js --qr\n'))
                        
                        if (!botConnected && !isRestarting) {
                            console.log(chalk.yellow('The bot will continue running and retry periodically...\n'))
                            await delay(30000)
                            isRestarting = true
                            startXeonBotInc()
                        } else {
                            console.log(chalk.yellow('Pairing code request will retry automatically (bot is connected)\n'))
                        }
                    }
                    pairingPromptActive = false
                }
            }

            // Start the pairing code request after a short delay
            pairingRequested = true
            setTimeout(requestCode, 3000)
        }
        
        if (connection === 'connecting') {
            console.log(chalk.yellow('🔄 Connecting to WhatsApp...'))
        }
        
        if (connection == "open") {
            botConnected = true  // Mark bot as successfully connected
            isRestarting = false  // Clear restart flag
            // Clear pairing request state when connection opens
            pairingRequested = false
            pairingPromptActive = false
            console.log(chalk.magenta(` `))
            console.log(chalk.yellow(`🌿 Connected to => ` + JSON.stringify(XeonBotInc.user, null, 2)))

            // Persist session for multi-user support
            try {
                const userPhoneNumber = XeonBotInc.user.id.split(':')[0]
                const currentSessionPath = sessionPath.replace(/\\/g, '/')
                addOrUpdateSession(userPhoneNumber, currentSessionPath)
                console.log(chalk.green(`💾 Session persisted for +${userPhoneNumber}`))
                
                // Update owner variable to reflect currently connected user
                owner = userPhoneNumber
                global.owner = userPhoneNumber
                console.log(chalk.cyan(`📱 Owner updated to: ${userPhoneNumber}`))
            } catch (e) {
                console.error('Error persisting session:', e.message)
            }

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
            botConnected = false  // Mark as disconnected
            const errorObj = lastDisconnect?.error
            const errorStr = String(errorObj || '')

            // Explicitly handle Baileys "Stream Errored (conflict)" to avoid rapid reconnect loops
            console.log(chalk.red(`Connection close error string: ${errorStr}`))
            if (errorStr.toLowerCase().includes('conflict') || /stream errored/i.test(errorStr)) {
                // Silently retry on conflict (another session detected)
                console.log(chalk.yellow('⏳ Reconnecting to WhatsApp (session sync in progress)...'))
                await delay(3000)
                // Only restart if not already connected (avoid double restarts)
                if (!isRestarting && !botConnected) {
                    isRestarting = true
                    startXeonBotInc()
                }
                return
            }

            const shouldReconnect = (errorObj)?.output?.statusCode !== DisconnectReason.loggedOut
            const statusCode = errorObj?.output?.statusCode

            if (shouldReconnect) {
                console.log(chalk.yellow('🔄 Connection closed, will auto-reconnect...'))
            } else {
                console.log(chalk.red(`Connection closed permanently: ${errorObj}`))
            }

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                try {
                    rmSync('./session', { recursive: true, force: true })
                    console.log(chalk.yellow('Session folder deleted. Please re-authenticate.'))
                } catch (error) {
                    console.error('Error deleting session:', error)
                }
                console.log(chalk.red('Session logged out. Please re-authenticate.'))
            }

            if (shouldReconnect && !isRestarting) {
                console.log(chalk.yellow('⏱️ Waiting 5 seconds before reconnection...'))
                isRestarting = true
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


// Display startup banner
console.log(chalk.cyan('\n╔════════════════════════════════════════╗'))
console.log(chalk.cyan('║          X5 WHATSAPP BOT              ║'))
console.log(chalk.cyan('╠════════════════════════════════════════╣'))
console.log(chalk.cyan('║  Choose your connection method:       ║'))
console.log(chalk.cyan('║                                        ║'))

if (usePairingCode) {
    console.log(chalk.green('║  ✓ Pairing Code Mode                  ║'))
} else if (useQR) {
    console.log(chalk.green('║  ✓ QR Code Mode                       ║'))
}

console.log(chalk.cyan('║                                        ║'))
console.log(chalk.cyan('║  To switch modes, use:                 ║'))
console.log(chalk.cyan('║  • QR Code: node index.js --qr        ║'))
console.log(chalk.cyan('║  • Pairing: node index.js --pair      ║'))
console.log(chalk.cyan('╚════════════════════════════════════════╝\n'))

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
