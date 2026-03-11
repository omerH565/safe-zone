const express = require('express');
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');

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

const usersStatus = new Map();
const userPushTokens = new Map();

const regionsMap = {
    "תל אביב - מרכז": "דן",
    "תל אביב - מזרח": "דן",
    "תל אביב - דרום": "דן",
    "תל אביב - עבר הירקון": "דן",
    "רמת גן": "דן",
    "גבעתיים": "דן"
};

function deriveAlertAreas(cities) {
    if (!cities || !Array.isArray(cities)) return [];
    const areas = new Set(cities);
    cities.forEach(city => {
        if (regionsMap[city]) {
            areas.add(regionsMap[city]);
        }
    });
    return Array.from(areas);
}

async function sendGroupStateToSocket(socket, groupId) {
    try {
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

    socket.on('join_groups', async (userData) => {
        const { userId, name, groups, targetCities } = userData;
        try {
            const userRef = db.collection('users').doc(userId);
            const doc = await userRef.get();
            const finalCities = deriveAlertAreas(targetCities || ['תל אביב - מרכז']);

            if (doc.exists) {
                const data = doc.data();
                const existingGroups = data.groups || [];
                const mergedGroups = [...new Set([...existingGroups, ...(groups || [])])];
                await userRef.update({ name, groups: mergedGroups, targetCities: finalCities });
            } else {
                await userRef.set({ name, groups: groups || [], targetCities: finalCities });
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

    socket.on('join_via_link', async (data) => {
        const { userId, name, groupId, targetCities } = data;
        try {
            const userRef = db.collection('users').doc(userId);
            const doc = await userRef.get();
            const finalCities = deriveAlertAreas(targetCities || ['תל אביב - מרכז']);

            if (doc.exists) {
                const existingData = doc.data();
                const existingGroups = existingData.groups || [];
                if (!existingGroups.includes(groupId)) {
                    existingGroups.push(groupId);
                }
                await userRef.update({ name, groups: existingGroups, targetCities: finalCities });
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

app.post('/api/register-push', async (req, res) => {
    const { userId, token } = req.body;
    if (userId && token) {
        userPushTokens.set(userId, token);
        console.log(`Push token registered in memory for user ${userId}`);
        try {
            await db.collection('users').doc(userId).set({ pushToken: token }, { merge: true });
            console.log(`Push token saved to Firestore for user ${userId}`);
        } catch (error) {
            console.error("Error saving token to DB:", error);
        }
        res.status(200).send({ success: true });
    } else {
        res.status(400).send({ error: 'Missing parameters' });
    }
});

// --- שימוש ב-Proxy כדי לעקוף את החסימה מחו"ל ---
const OREF_BASE_URL = 'https://www.oref.org.il/WarningMessages/alert/alerts.json';
const OREF_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Referer': 'https://www.oref.org.il/',
    'X-Requested-With': 'XMLHttpRequest'
};

let lastAlertId = 0;

async function pollOrefApi() {
    try {
        // הוספת Timestamp כדי שהפרוקסי לא יחזיר לנו גרסת מטמון (Cache) ישנה
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(OREF_BASE_URL)}&t=${Date.now()}`;
        
        const response = await axios.get(proxyUrl, { headers: OREF_HEADERS, timeout: 3000 });
        const data = response.data;
        
        if (data && data.id && data.id !== lastAlertId) {
            lastAlertId = data.id;
            const alertCities = data.data; 
            console.log(`🚨 אזעקה זוהתה (דרך הפרוקסי)! אזורים: ${alertCities.join(', ')}`);
            
            const searchCities = alertCities.slice(0, 10);
            const snapshot = await db.collection('users').where('targetCities', 'array-contains-any', searchCities).get();
            
            snapshot.forEach(doc => {
                const userId = doc.id;
                const userRecord = doc.data();
                
                usersStatus.set(userId, { name: userRecord.name, status: 'pending', time: new Date() });
                
                const userGroups = userRecord.groups || [];
                userGroups.forEach(group => {
                    io.to(group).emit('group_member_status', { 
                        userId: userId, 
                        name: userRecord.name, 
                        status: 'pending', 
                        groupId: group 
                    });
                });
                
                io.emit('new_alert_for_user', { userId: userId, cities: alertCities });

                const userPushToken = userRecord.pushToken || userPushTokens.get(userId);
                if (userPushToken) {
                    const message = {
                        notification: {
                            title: '🚨 אזעקה באזורך!',
                            body: `התרעה הופעלה באזורים: ${alertCities.slice(0, 3).join(', ')}. היכנס מיד למרחב מוגן.`
                        },
                        token: userPushToken
                    };
                    admin.messaging().send(message)
                        .then(res => console.log(`Push sent successfully to ${userRecord.name}`))
                        .catch(err => console.error('Error sending Push:', err));
                }
            });
        }
    } catch (error) {
        // שגיאות מוסתרות כדי לא להציף את הלוג, נשתמש בנתיב הטסט
    }
}

setInterval(pollOrefApi, 1000);

app.get('/api/test-oref', async (req, res) => {
    console.log("[TEST] Attempting to connect to Oref API via Proxy...");
    try {
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(OREF_BASE_URL)}&t=${Date.now()}`;
        const response = await axios.get(proxyUrl, { 
            headers: OREF_HEADERS,
            timeout: 5000 
        });
        
        res.json({
            success: true,
            status: response.status,
            data: response.data || "Empty (No current alerts, which is good!)",
            message: "✅ Server successfully connected to Oref API via Proxy!"
        });
    } catch (error) {
        res.json({
            success: false,
            status: error.response ? error.response.status : 'No Response / Timeout',
            message: "❌ Proxy failed to fetch data.",
            error: error.message
        });
    }
});

app.get('/api/simulate-alert', async (req, res) => {
    const city = req.query.city || 'תל אביב - מרכז';
    console.log(`[SIMULATOR] Triggering fake alert for: ${city}`);

    try {
        const alertCities = [city];
        const snapshot = await db.collection('users').where('targetCities', 'array-contains-any', alertCities).get();
        
        snapshot.forEach(doc => {
            const userId = doc.id;
            const userRecord = doc.data();
            
            usersStatus.set(userId, { name: userRecord.name, status: 'pending', time: new Date() });
            
            const userGroups = userRecord.groups || [];
            userGroups.forEach(group => {
                io.to(group).emit('group_member_status', { 
                    userId: userId, 
                    name: userRecord.name, 
                    status: 'pending', 
                    groupId: group 
                });
            });
            
            io.emit('new_alert_for_user', { userId: userId, cities: alertCities });

            const userPushToken = userRecord.pushToken || userPushTokens.get(userId);
            if (userPushToken) {
                const message = {
                    notification: {
                        title: '🚨 אזעקה באזורך (סימולציה)!',
                        body: `התרעה הופעלה באזורים: ${alertCities.join(', ')}. היכנס מיד למרחב מוגן.`
                    },
                    token: userPushToken
                };
                admin.messaging().send(message)
                    .then(r => console.log(`Push sent successfully to ${userRecord.name}`))
                    .catch(err => console.error('Error sending Push:', err));
            }
        });

        res.json({ success: true, message: `🚨 Simulated alert triggered successfully for ${city}` });
    } catch (error) {
        console.error("Error in simulator:", error);
        res.status(500).json({ error: 'Failed to trigger simulation' });
    }
});

app.post('/api/status', async (req, res) => {
    const { userId, status } = req.body;
    
    if (!userId || !status) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
        const doc = await db.collection('users').doc(userId).get();
        const userName = doc.exists ? doc.data().name : 'משתמש לא ידוע';
        const userGroups = doc.exists ? (doc.data().groups || []) : [];

        usersStatus.set(userId, { name: userName, status, time: new Date() });
        io.emit('status_update', { userId, name: userName, status });

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