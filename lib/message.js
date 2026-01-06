import { downloadMediaMessage } from '@whiskeysockets/baileys';
import db from '../database/initDb.js';
import { handleAutoReply, sendAndSaveMessage } from './aiReply.js';

export async function handleMessage(sock, { messages }) {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    if (from.endsWith('@g.us') || from === 'status@broadcast') return;

    // ANTI-DELETE logic
    if (msg.message.protocolMessage && msg.message.protocolMessage.type === 0) {
        const deletedMsgId = msg.message.protocolMessage.key.id;
        const backup = await db.collection('deleted_messages_backup').findOne({ message_id: deletedMsgId });
        if (backup) {
            await sock.sendMessage(from, { text: "🗑️ *මම මැකූ පණිවිඩය සොයාගත්තා!*" });
            await sock.sendMessage(from, { forward: { key: msg.message.protocolMessage.key, message: backup.original_message } });
        }
        return;
    }

    // Save for Anti-delete
    await db.collection('deleted_messages_backup').updateOne(
        { message_id: msg.key.id },
        { $set: { from_jid: from, original_message: msg.message, timestamp: Date.now() } },
        { upsert: true }
    );

    let text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || '';
    let imageBuffer = msg.message.imageMessage ? await downloadMediaMessage(msg, 'buffer', {}) : null;

    let senderName = msg.pushName || "User";
    
    // Save Incoming to DB
    await db.collection('private_messages').insertOne({
        message_id: msg.key.id, from_jid: from, text, direction: 'incoming', timestamp: Date.now()
    });

    // Welcome Message
    const existingChat = await db.collection('chats').findOne({ jid: from });
    if (!existingChat) {
        const welcome = `👋 සුභ දවසක් ${senderName}! මම QUEEN SHENU AI.`;
        await sendAndSaveMessage(sock, from, welcome, 'Bot', 'welcome_' + Date.now());
        await db.collection('chats').insertOne({ jid: from, welcomed: true, last_active: new Date().toDateString() });
    }

    await sock.sendPresenceUpdate('composing', from);
    await handleAutoReply(sock, from, text, senderName, imageBuffer);
}
