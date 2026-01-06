import { downloadMediaMessage } from '@whiskeysockets/baileys';
import db from '../database/initDb.js';
import { handleAutoReply, sendAndSaveMessage } from './aiReply.js';

export async function handleMessage(sock, { messages }) {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;

    // Ignore groups, status, channels
    if (from.endsWith('@g.us') || from === 'status@broadcast' || from.endsWith('@newsletter')) {
        return;
    }

    // --- 1. ANTI-DELETE පද්ධතිය (පරණ කේතය) ---
    if (msg.message.protocolMessage && msg.message.protocolMessage.type === 0) {
        const deletedKey = msg.message.protocolMessage.key;
        const deletedMsgId = deletedKey.id;

        console.log(`🗑️ Delete detected from ${from}`);

        try {
            const backup = await db.collection('deleted_messages_backup').findOne({ message_id: deletedMsgId });
            if (backup && backup.original_message) {
                await sock.sendMessage(from, { text: "🗑️ *කවුරුහරි message එක delete කළා!* 😏\nමම තාම දකිනවා මචන්!\n\n*මෙන්න original එක:* 👇" });
                await sock.sendMessage(from, { forward: { key: deletedKey, message: backup.original_message } });
            } else {
                await sock.sendMessage(from, { text: "🗑️ Delete කළා... නමුත් මටත් දැන් පේන්නේ නෑ 😅" });
            }
        } catch (err) {
            console.error('Anti-delete error:', err.message);
        }
        return;
    }

    // Delete වීමට පෙර Backup කර තබා ගැනීම
    try {
        await db.collection('deleted_messages_backup').updateOne(
            { message_id: msg.key.id },
            { $set: { from_jid: from, original_message: msg.message, timestamp: Date.now() } },
            { upsert: true }
        );
    } catch (err) {
        console.error('Backup error:', err.message);
    }

    await sock.readMessages([msg.key]);
    await sock.presenceSubscribe(from);
    await sock.sendPresenceUpdate('composing', from);

    // --- 2. අලුත් IMAGE SUPPORT සහ TEXT හඳුනාගැනීම ---
    let text = msg.message.conversation || 
               msg.message.extendedTextMessage?.text || 
               msg.message.imageMessage?.caption || '';
    
    let imageBuffer = null;

    // පින්තූරයක් තිබේදැයි පරීක්ෂා කර එය Download කිරීම
    if (msg.message.imageMessage) {
        try {
            imageBuffer = await downloadMediaMessage(msg, 'buffer', {});
            console.log('📸 Image received and buffered');
        } catch (err) {
            console.error('Media download error:', err.message);
        }
    }

    let senderName = from.split('@')[0];
    if (msg.verifiedName) senderName = msg.verifiedName;
    else if (msg.pushName) senderName = msg.pushName;

    console.log(`📬 Message from: ${senderName} (${from})`);

    // පැමිණෙන පණිවිඩය සේව් කිරීම
    try {
        await db.collection('private_messages').insertOne({
            message_id: msg.key.id,
            from_jid: from,
            sender_name: senderName,
            text: text,
            has_image: !!imageBuffer,
            timestamp: msg.messageTimestamp,
            direction: 'incoming',
            createdAt: new Date()
        });
    } catch (err) {
        if (err.code !== 11000) console.error('DB save error:', err.message);
    }

    // --- 3. WELCOME MESSAGE පද්ධතිය (පරණ කේතය) ---
    const existingChat = await db.collection('chats').findOne({ jid: from });
    if (!existingChat) {
        const welcomeText = `👋 සුභ දවසක් ${senderName || 'හිතවත්'}!\n\nමම QUEEN SHENU V1 AI WhatsApp Assistant.\nගගන මංජුල විසින් නිර්මාණය කරන ලදී.\n\nඔයාට ඕනෑම දෙයක් අහන්න පුළුවන් – මම පින්තූර වුණත් අඳුරනවා! 😊`;

        await sendAndSaveMessage(sock, from, welcomeText, 'Bot (Welcome)', 'welcome_' + Date.now());
        await db.collection('chats').insertOne({ jid: from, sender_name: senderName, first_contact: new Date(), welcomed: true });

        await sock.sendPresenceUpdate('paused', from);
        return;
    }

    // --- 4. AI REPLY (නව IMAGE BUFFER එක සමඟ) ---
    // imageBuffer එකක් තිබේ නම් එයද AI එකට ලබා දෙයි
    await handleAutoReply(sock, from, text, senderName, imageBuffer);
    await sock.sendPresenceUpdate('paused', from);
}