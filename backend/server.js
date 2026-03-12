const express = require('express');
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');

// --- הלוגיקה לטעינת הפיירבייס מ-Secret Files ב-Render ---
let serviceAccount;

try {
    serviceAccount = require('/etc/secrets/firebase-adminsdk.json');
    console.log("✅ Loaded Firebase credentials from Render Secret File (/etc/secrets/)");
} catch (err) {
    try {
        serviceAccount = require('./firebase-adminsdk.json');
        console.log("✅ Loaded Firebase credentials from local file");
    } catch (localErr) {
        console.error("❌ CRITICAL ERROR: Could not find firebase credential file anywhere!");
        process.exit(1);
    }
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
// ----------------------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const usersStatus = new Map();
const userPushTokens = new Map();

// --- מילון המרחבים של פיקוד העורף (ניתן להוסיף עוד בהמשך) ---
const regionsMap = {
    "תל אביב - דרום העיר ויפו": "דן",
    "תל אביב - מזרח": "דן",
    "תל אביב - מרכז העיר": "דן",
    "תל אביב - עבר הירקון": "דן",
    "רמת גן - מזרח": "דן",
    "רמת גן - מערב": "דן",
    "גבעתיים": "דן",
    "בני ברק": "דן",
    "חולון": "דן",
    "בת ים": "דן",
    "אור יהודה": "דן",
    "יהוד מונוסון": "דן",
    "קרית אונו": "דן",
    "פתח תקווה": "ירקון",
    "רינתיה": "ירקון",
    "ראש העין": "ירקון",
    "אלעד": "ירקון",
    "הרצליה - מערב": "דן",
    "הרצליה - מרכז וגליל ים": "דן",
    "רמת השרון": "דן",
    "ראשון לציון - מזרח": "השפלה",
    "ראשון לציון - מערב": "השפלה",
    "רחובות": "השפלה",
    "נס ציונה": "השפלה",
    "לוד": "השפלה",
    "רמלה": "השפלה"
};

const SECRET_WEBHOOK_TOKEN = 'omer_safezone_secret_2026';

// פונקציה שממירה רשימת ערים מדויקות לרשימת מרחבים כלליים
function deriveAlertAreas(cities) {
    if (!cities || !Array.isArray(cities)) return [];
    const areas = new Set();
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

    socket.on('update_settings', async (data) => {
        const { userId, name, targetCities } = data;
        try {
            const finalCities = targetCities || [];
            const finalRegions = deriveAlertAreas(finalCities); // גוזרים את המרחבים

            await db.collection('users').doc(userId).update({
                name: name,
                targetCities: finalCities,
                targetRegions: finalRegions
            });
            
            if (usersStatus.has(userId)) {
                usersStatus.get(userId).name = name;
            }
            console.log(`Settings updated for user ${name}. Regions set to: ${finalRegions.join(', ')}`);
        } catch (err) { console.error('Error updating settings:', err); }
    });

    socket.on('join_groups', async (userData) => {
        const { userId, name, groups, targetCities } = userData;
        try {
            const userRef = db.collection('users').doc(userId);
            const doc = await userRef.get();
            const finalCities = targetCities || [];
            const finalRegions = deriveAlertAreas(finalCities);

            if (doc.exists) {
                const data = doc.data();
                const existingGroups = data.groups || [];
                const mergedGroups = [...new Set([...existingGroups, ...(groups || [])])];
                await userRef.update({ name, groups: mergedGroups, targetCities: finalCities, targetRegions: finalRegions });
            } else {
                await userRef.set({ name, groups: groups || [], targetCities: finalCities, targetRegions: finalRegions });
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
            const finalCities = targetCities || [];
            const finalRegions = deriveAlertAreas(finalCities);

            if (doc.exists) {
                const existingData = doc.data();
                const existingGroups = existingData.groups || [];
                if (!existingGroups.includes(groupId)) {
                    existingGroups.push(groupId);
                }
                await userRef.update({ name, groups: existingGroups, targetCities: finalCities, targetRegions: finalRegions });
            } else {
                await userRef.set({ name, groups: [groupId], targetCities: finalCities, targetRegions: finalRegions });
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

app.get('/api/user/:userId', async (req, res) => {
    try {
        const doc = await db.collection('users').doc(req.params.userId).get();
        if (doc.exists) {
            res.json({ success: true, data: doc.data() });
        } else {
            res.json({ success: true, data: null });
        }
    } catch (err) {
        console.error("Error fetching user:", err);
        res.status(500).json({ error: 'Database error' });
    }
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

app.post('/api/ping-group', async (req, res) => {
    const { groupId, senderName } = req.body;
    if (!groupId || !senderName) return res.status(400).json({ error: 'Missing params' });

    try {
        const snapshot = await db.collection('users').where('groups', 'array-contains', groupId).get();
        
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
            
            io.emit('ping_alert_for_user', { userId: userId, senderName: senderName, groupId: groupId });

            const userPushToken = userRecord.pushToken || userPushTokens.get(userId);
            if (userPushToken) {
                const message = {
                    notification: {
                        title: `🔔 בדיקת נוכחות: קבוצת ${groupId}`,
                        body: `${senderName} מבקש לדעת שכולם בסדר. היכנסו לעדכן סטטוס!`
                    },
                    token: userPushToken
                };
                admin.messaging().send(message)
                    .then(r => console.log(`Ping Push sent to ${userRecord.name}`))
                    .catch(err => console.error('Error sending Ping Push:', err));
            }
        });

        res.json({ success: true });
    } catch(e) {
        console.error("Error pinging group:", e);
        res.status(500).json({error: e.message});
    }
});

// --- נתיב 1: הדלקת האזעקה (חסין למגבלת ה-10 פריטים של פיירבייס!) ---
app.post('/api/webhook-alert', async (req, res) => {
    const { secret, cities } = req.body;
    
    if (secret !== SECRET_WEBHOOK_TOKEN) return res.status(403).json({ error: 'Unauthorized' });
    if (!cities || !Array.isArray(cities)) return res.status(400).json({ error: 'Invalid data' });

    console.log(`🚨 [WEBHOOK] אזעקה התקבלה! סך הכל ערים: ${cities.length}`);

    try {
        const usersToAlert = new Map(); // אוסף ייחודי של משתמשים

        // חותך את הרשימה לקבוצות של 10 כדי לעקוף את המגבלה של פיירבייס
        for (let i = 0; i < cities.length; i += 10) {
            const chunk = cities.slice(i, i + 10);
            const snapshot = await db.collection('users').where('targetCities', 'array-contains-any', chunk).get();
            snapshot.forEach(doc => {
                usersToAlert.set(doc.id, doc.data());
            });
        }
        
        console.log(`נמצאו ${usersToAlert.size} משתמשים להתרעה.`);

        usersToAlert.forEach((userRecord, userId) => {
            usersStatus.set(userId, { name: userRecord.name, status: 'pending', time: new Date() });
            
            const userGroups = userRecord.groups || [];
            userGroups.forEach(group => {
                io.to(group).emit('group_member_status', { userId, name: userRecord.name, status: 'pending', groupId: group });
            });
            
            io.emit('new_alert_for_user', { userId: userId, cities: cities });

            const userPushToken = userRecord.pushToken || userPushTokens.get(userId);
            if (userPushToken) {
                const matchedCity = cities.find(c => (userRecord.targetCities || []).includes(c)) || cities[0];
                const message = {
                    notification: {
                        title: '🚨 אזעקה באזורך!',
                        body: `התרעה הופעלה ב: ${matchedCity}. היכנס מיד למרחב מוגן.`
                    },
                    token: userPushToken
                };
                admin.messaging().send(message).catch(err => console.error(err));
            }
        });

        res.json({ success: true, message: 'Alert processed successfully' });
    } catch (error) {
        console.error("Error processing webhook alert:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- נתיב 2: חזל"ש (עובד לפי מרחבים במקום ערים) ---
app.post('/api/webhook-clear', async (req, res) => {
    const { secret, cities } = req.body; // במקרה של חזל"ש, המשתנה 'cities' מכיל בפועל את המרחבים (למשל 'דן', 'ירקון')
    
    if (secret !== SECRET_WEBHOOK_TOKEN) return res.status(403).json({ error: 'Unauthorized' });
    if (!cities || !Array.isArray(cities)) return res.status(400).json({ error: 'Invalid data' });

    console.log(`🟢 [WEBHOOK] חזל"ש התקבל! משחרר את המרחבים: ${cities.join(', ')}`);

    try {
        const usersToClear = new Map();

        // מחפש משתמשים שה-targetRegions שלהם תואם לחזל"ש (בקבוצות של 10)
        for (let i = 0; i < cities.length; i += 10) {
            const chunk = cities.slice(i, i + 10);
            const snapshot = await db.collection('users').where('targetRegions', 'array-contains-any', chunk).get();
            snapshot.forEach(doc => {
                usersToClear.set(doc.id, doc.data());
            });
        }
        
        usersToClear.forEach((userRecord, userId) => {
            usersStatus.set(userId, { name: userRecord.name, status: 'pending', time: new Date() });
            
            const userGroups = userRecord.groups || [];
            userGroups.forEach(group => {
                io.to(group).emit('group_member_status', { userId, name: userRecord.name, status: 'pending', groupId: group });
            });
            
            io.emit('clear_alert_for_user', { userId: userId });
        });

        res.json({ success: true, message: 'All Clear processed successfully' });
    } catch (error) {
        console.error("Error processing all-clear:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/test-oref', async (req, res) => {
    const OREF_API_URL = 'https://www.oref.org.il/WarningMessages/alert/alerts.json';
    const OREF_HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://www.oref.org.il/',
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json'
    };
    try {
        const response = await axios.get(OREF_API_URL, { headers: OREF_HEADERS, timeout: 5000 });
        res.json({ success: true, status: response.status, data: response.data, message: "✅ Connected to Oref API!" });
    } catch (error) {
        res.json({ success: false, status: error.response ? error.response.status : 'No Response', message: "❌ Failed." });
    }
});

app.get('/api/simulate-alert', async (req, res) => {
    const city = req.query.city || 'תל אביב - מרכז העיר';
    try {
        const snapshot = await db.collection('users').where('targetCities', 'array-contains-any', [city]).get();
        snapshot.forEach(doc => {
            const userId = doc.id;
            const userRecord = doc.data();
            
            usersStatus.set(userId, { name: userRecord.name, status: 'pending', time: new Date() });
            
            (userRecord.groups || []).forEach(group => {
                io.to(group).emit('group_member_status', { userId, name: userRecord.name, status: 'pending', groupId: group });
            });
            
            io.emit('new_alert_for_user', { userId, cities: [city] });

            const userPushToken = userRecord.pushToken || userPushTokens.get(userId);
            if (userPushToken) {
                admin.messaging().send({
                    notification: { title: '🚨 אזעקה באזורך (סימולציה)!', body: `התרעה: ${city}` },
                    token: userPushToken
                }).catch(err => console.error(err));
            }
        });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/status', async (req, res) => {
    const { userId, status } = req.body;
    if (!userId || !status) return res.status(400).json({ error: 'Missing params' });

    try {
        const doc = await db.collection('users').doc(userId).get();
        const userName = doc.exists ? doc.data().name : 'משתמש לא ידוע';
        const userGroups = doc.exists ? (doc.data().groups || []) : [];

        usersStatus.set(userId, { name: userName, status, time: new Date() });
        io.emit('status_update', { userId, name: userName, status });

        userGroups.forEach(group => {
            io.to(group).emit('group_member_status', { userId, name: userName, status, groupId: group });
        });
        res.status(200).json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.get('/api/all-status', (req, res) => {
    res.json(Array.from(usersStatus.entries()).map(([userId, data]) => ({ userId, ...data })));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});