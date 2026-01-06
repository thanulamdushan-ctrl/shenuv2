import dotenv from 'dotenv';
dotenv.config();

import { default as makeWASocket, DisconnectReason, BufferJSON, initAuthCreds } from '@whiskeysockets/baileys';
import pino from 'pino';
import readline from 'node:readline';

import './database/initDb.js';
import { handleMessage } from './lib/message.js';
import { handleCallRejectReply } from './lib/aiReply.js';
import db from './database/initDb.js';

let sock = null;
let lastConnectionState = null;

// Global settings
let botEnabled = true;
let autoReply = true;
let autoRejectCalls = true;

// Persistent MongoDB Auth State
async function useMongoAuthState() {
    const collection = db.collection('auth_state');

    const writeData = async (data, file) => {
        try {
            await collection.updateOne(
                { _id: file },
                { $set: { data: JSON.stringify(data, BufferJSON.replacer) } },
                { upsert: true }
            );
        } catch (err) {
            console.error('Auth write error:', err.message);
        }
    };

    const readData = async (file) => {
        try {
            const result = await collection.findOne({ _id: file });
            return result ? JSON.parse(result.data, BufferJSON.reviver) : null;
        } catch (err) {
            console.error('Auth read error:', err.message);
            return null;
        }
    };

    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        const value = await readData(`${type}-${id}`);
                        if (value) data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    await Promise.all(Object.keys(data).map(async (type) => {
                        await Promise.all(Object.keys(data[type]).map(async (id) => {
                            await writeData(data[type][id], `${type}-${id}`);
                        }));
                    }));
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds')
    };
}

// Load settings
async function loadSettings() {
    try {
        const botSettings = db.collection('bot_settings');
        const settings = await botSettings.find({}).toArray();
        settings.forEach(setting => {
            if (setting.key === 'bot_enabled') botEnabled = setting.value === 'true';
            if (setting.key === 'auto_reply') autoReply = setting.value === 'true';
            if (setting.key === 'auto_reject_calls') autoRejectCalls = setting.value === 'true';
        });
        console.log(`Settings loaded: Bot=${botEnabled}, AutoReply=${autoReply}, RejectCalls=${autoRejectCalls}`);
    } catch (err) {
        console.error('Failed to load settings:', err.message);
    }
}

// Start bot
async function startBot() {
    console.log('Starting WhatsApp bot... 🚀');

    const { state, saveCreds } = await useMongoAuthState();

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('call', async (calls) => {
        if (!autoRejectCalls || !botEnabled) return;
        try {
            for (const call of calls) {
                if (call.status === 'offer' && !call.isGroup) {
                    const callFrom = call.from;
                    console.log(`📞 Auto rejecting call from ${callFrom}`);
                    await sock.rejectCall(call.id, callFrom);
                    await handleCallRejectReply(sock, callFrom);
                }
            }
        } catch (err) {
            console.error('Call reject error:', err.message);
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === lastConnectionState) return;
        lastConnectionState = connection;

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;

            if (statusCode === DisconnectReason.loggedOut) {
                console.log('Logged out permanently.');
                return;
            }

            console.log(`Connection lost (code: ${statusCode}). Reconnecting in 3s...`);
            setTimeout(startBot, 3000);
        } else if (connection === 'open') {
            await loadSettings();
            console.log('Bot connected & running! 🎉');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        if (botEnabled && autoReply) {
            await handleMessage(sock, m);
        }
    });

    if (!state.creds.registered) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question('Number එක දාන්න (9471...): ', async (phone) => {
            const code = await sock.requestPairingCode(phone.trim());
            console.log(`🔗 Pairing Code: ${code}`);
            console.log('Phone එකේ WhatsApp → Linked Devices → Link with phone number → Code එක දාන්න');
            rl.close();
        });
    }
}

// Init & start
await loadSettings();
startBot().catch(console.error);

console.log('🚀 Bot ready! 24/7 auto run වෙනවා');
console.log('   First time එකේ pairing code එක බලාගෙන ඉන්න...');
