import { GoogleGenerativeAI } from '@google/generative-ai';
import db from '../database/initDb.js';
import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash",
    systemInstruction: `ඔබේ නම QUEEN SHENU. මම ගගන මංජුල විසින් සාදන ලද AI සහායකයෙකි.
සැමවිටම කෙටි, මිත්‍රශීලී සිංහල භාෂාවෙන් පිළිතුරු දෙන්න. හිතවත්කම පෙන්වීමට Emojis භාවිතා කරන්න. 😊`
});

// දිනකට ලබා දෙන මැසේජ් ප්‍රමාණය 100 දක්වා වැඩි කරන ලදී
const quotaManager = {
    dailyLimit: 100, 
    async check(jid) {
        const today = new Date().toDateString();
        const user = await db.collection('chats').findOne({ jid });
        if (user?.last_active === today && user?.usage >= this.dailyLimit) return false;
        
        await db.collection('chats').updateOne(
            { jid },
            { 
                $inc: { usage: user?.last_active === today ? 1 : -user?.usage || 0 },
                $set: { last_active: today }
            },
            { upsert: true }
        );
        return true;
    }
};

async function textToSpeech(text) {
    try {
        const encodedText = encodeURIComponent(text.substring(0, 250));
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=si&client=gtx`;
        const response = await axios.get(ttsUrl, { responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
        return Buffer.from(response.data);
    } catch (err) { return null; }
}

export async function handleAutoReply(sock, from, text, senderName, imageBuffer = null) {
    try {
        if (!(await quotaManager.check(from))) {
            return await sock.sendMessage(from, { text: "⚠️ අද දිනට නියමිත AI සීමාව අවසන්. හෙට නැවත උත්සාහ කරන්න! ⏰" });
        }

        let prompt = [text];
        if (imageBuffer) {
            prompt = [{ inlineData: { data: imageBuffer.toString("base64"), mimeType: "image/jpeg" } }, text || "මේ පින්තූරයේ මොකක්ද තියෙන්නේ?"];
        }

        // Chat History එක ලබා ගැනීම (පෙර මතකය)
        const historyRows = await db.collection('private_messages')
            .find({ from_jid: from })
            .sort({ timestamp: -1 })
            .limit(5)
            .toArray();
        
        const history = historyRows.reverse().map(h => ({
            role: h.direction === 'incoming' ? 'user' : 'model',
            parts: [{ text: h.text }]
        }));

        const chat = model.startChat({ history });
        const result = await chat.sendMessage(prompt);
        const reply = result.response.text().trim();

        const audio = await textToSpeech(reply);
        if (audio) {
            await sock.sendMessage(from, { audio: audio, mimetype: 'audio/mpeg', ptt: true });
        } else {
            await sock.sendMessage(from, { text: reply });
        }

        // DB Save (Outgoing)
        await db.collection('private_messages').insertOne({
            from_jid: 'bot', text: reply, direction: 'outgoing', timestamp: Date.now()
        });

    } catch (err) {
        console.error('AI Error:', err);
    }
}