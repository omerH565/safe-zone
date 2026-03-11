const express = require('express');
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');

// חיבור למסד הנתונים של פיירבייס!
const serviceAccount = require('./firebase-adminsdk.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// זיכרון זמני רק לסטטוס החירום (כדי לחסוך קריאות כתיבה לדאטה-בייס בזמן אזעקה)
const usersStatus = new Map();
const userPushTokens = new Map();

// פונקציה לשליפת חברי הקבוצה מה-DB
async function sendGroupStateToSocket(socket, groupId) {
    try {
        // שולף מ-Firestore את כל המשתמשים שהקבוצה הזו נמצאת במערך הקבוצות שלהם
        const snapshot = await db.collection('users').where('groups', 'array-contains', groupId).get();
        
        snapshot.forEach(doc => {
            const uid = doc.id;
            const record = doc.data();
            const statusData = usersStatus.get(uid);
            const currentStatus = statusData ? statusData.status : 'pending';
            
            socket.emit('group_member_status', {
                userId: uid,
                name: record.name,
                status: currentStatus,
                groupId: groupId
            });
        });
    } catch (error) {
        console.error("Error fetching group state:", error);
    }
}

io.on('connection', (socket) => {
    console.log('User connected to socket:', socket.id);

    // התחברות של משתמש קיים
    socket.on('join_groups', async (userData) => {
        const { userId, name, groups } = userData;
        try {
            const userRef = db.collection('users').doc(userId);
            const doc = await userRef.get();
            let targetCities = ['תל אביב - יפו'];

            if (doc.exists) {
                const data = doc.data();
                targetCities = data.targetCities || targetCities;
                // מיזוג קבוצות חדשות וישנות
                const existingGroups = data.groups || [];
                const mergedGroups = [...new Set([...existingGroups, ...(groups || [])])];
                await userRef.update({ name, groups: mergedGroups });
            } else {
                await userRef.set({ name, groups: groups || [], targetCities });
            }

            if (groups && Array.isArray(groups)) {
                groups.forEach(group => {
                    socket.join(group);
                    console.log(`User ${name} joined group: ${group}`);
                    sendGroupStateToSocket(socket, group);
                });
            }
        } catch (err) { console.error("Error in join_groups:", err); }
    });

    // הצטרפות לקבוצה חדשה (דרך לינק)
    socket.on('join_via_link', async (data) => {
        const { userId, name, groupId, targetCities } = data;
        try {
            const userRef = db.collection('users').doc(userId);
            const doc = await userRef.get();
            let finalCities = targetCities || ['תל אביב - יפו'];

            if (doc.exists) {
                const existingData = doc.data();
                const existingGroups = existingData.groups || [];
                if (!existingGroups.includes(groupId)) {
                    existingGroups.push(groupId);
                }
                await userRef.update({ name, groups: existingGroups });
            } else {
                await userRef.set({ name, groups: [groupId], targetCities: finalCities });
            }

            socket.join(groupId);
            console.log(`User ${name} (${userId}) dynamically joined group: ${groupId}`);
            
            io.to(groupId).emit('group_member_status', { 
                userId, 
                name, 
                status: 'pending', 
                groupId 
            });

            sendGroupStateToSocket(socket, groupId);
        } catch (err) { console.error("Error in join_via_link:", err); }
    });
});

app.post('/api/register-push', (req, res) => {
    const { userId, token } = req.body;
    if (userId && token) {
        userPushTokens.set(userId, token);
        console.log(`Push token registered for user ${userId}`);
        res.status(200).send({ success: true });
    } else {
        res.status(400).send({ error: 'Missing parameters' });
    }
});

const OREF_API_URL = 'https://www.oref.org.il/WarningMessages/alert/alerts.json';
const OREF_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Referer': 'https://www.oref.org.il/',
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/json'
};

let lastAlertId = 0;

async function pollOrefApi() {
    try {
        const response = await axios.get(OREF_API_URL, { headers: OREF_HEADERS });
        const data = response.data;
        
        if (data && data.id && data.id !== lastAlertId) {
            lastAlertId = data.id;
            const alertCities = data.data; 
            console.log(`🚨 אזעקה זוהתה! אזורים: ${alertCities.join(', ')}`);
            
            // מבצעים חיתוך (לוקחים עד 10 אזורים בגלל מגבלה של פיירבייס בשאילתה)
            const searchCities = alertCities.slice(0, 10);
            
            // שאילתה ישירה ל-DB: תביא רק משתמשים שהאזעקה רלוונטית לעיר שלהם!
            const snapshot = await db.collection('users').where('targetCities', 'array-contains-any', searchCities).get();
            
            snapshot.forEach(doc => {
                const userId = doc.id;
                const userRecord = doc.data();
                
                io.emit('new_alert_for_user', { userId: userId, cities: alertCities });

                const userPushToken = userPushTokens.get(userId);
                if (userPushToken) {
                    const message = {
                        notification: {
                            title: '🚨 אזעקה באזורך!',
                            body: `התרעה הופעלה באזורים: ${alertCities.slice(0, 3).join(', ')}. היכנס מיד למרחב מוגן.`
                        },
                        token: userPushToken,
                        webpush: { fcmOptions: { link: '/' } }
                    };
                    
                    // admin.messaging().send(message).catch(err => console.log(err));
                    console.log(`[Simulation] PUSH notification targeted for user ${userRecord.name}.`);
                }
            });
        }
    } catch (error) {
        // התעלמות משגיאות רשת שוטפות של פיקוד העורף
    }
}

setInterval(pollOrefApi, 1000);

app.post('/api/status', async (req, res) => {
    const { userId, status } = req.body;
    
    if (!userId || !status) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
        // שליפת פרטי המשתמש מה-DB
        const doc = await db.collection('users').doc(userId).get();
        const userName = doc.exists ? doc.data().name : 'משתמש לא ידוע';
        const userGroups = doc.exists ? (doc.data().groups || []) : [];

        usersStatus.set(userId, { name: userName, status, time: new Date() });
        
        io.emit('status_update', { userId, name: userName, status });

        // עדכון כל הקבוצות שהמשתמש חבר בהן
        userGroups.forEach(group => {
            io.to(group).emit('group_member_status', { 
                userId, 
                name: userName, 
                status, 
                groupId: group 
            });
        });

        res.status(200).json({ success: true, message: 'Status updated successfully' });
    } catch (err) {
        console.error("Error in status update:", err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/all-status', (req, res) => {
    const allStatuses = Array.from(usersStatus.entries()).map(([userId, data]) => ({
        userId,
        ...data
    }));
    res.json(allStatuses);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});