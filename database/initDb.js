import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

let db = null;
const mongoUri = process.env.MONGODB_URI;

const client = new MongoClient(mongoUri);

async function initDb() {
    try {
        await client.connect();
        db = client.db('nth_v1_md');

        // Collections create කරනවා (already exist නම් skip)
        await db.createCollection('private_messages').catch(err => {});
        await db.createCollection('bot_settings').catch(err => {});
        await db.createCollection('chats').catch(err => {});
        await db.createCollection('auth_state').catch(err => {});
        await db.createCollection('deleted_messages_backup').catch(err => {});

        // Default settings insert if empty
        const settingsCount = await db.collection('bot_settings').countDocuments();
        if (settingsCount === 0) {
            await db.collection('bot_settings').insertMany([
                { key: 'bot_enabled', value: 'true' },
                { key: 'auto_reply', value: 'true' },
                { key: 'auto_reject_calls', value: 'true' }
            ]);
        }

        console.log('Database ready with all collections 📦');
        return db;
    } catch (err) {
        console.error('MongoDB connection error:', err.message);
        throw err;
    }
}

await initDb();

export default db;
