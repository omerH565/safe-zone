const express = require('express');
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');

// const serviceAccount = require('./firebase-adminsdk.json');
// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount)
// });

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const usersStatus = new Map();
const userPushTokens = new Map();

// מסד נתונים דינמי - מתחיל ריק לחלוטין! (בשלב 2 נחליף את זה במסד נתונים אמיתי)
const userGroupsDB = {};

function sendGroupStateToSocket(socket, groupId) {
    for (const [uid, record] of Object.entries(userGroupsDB)) {
        if (record.groups.includes(groupId)) {
            const statusData = usersStatus.get(uid);
            const currentStatus = statusData ? statusData.status : 'pending';
            
            socket.emit('group_member_status', {
                userId: uid,
                name: record.name,
                status: currentStatus,
                groupId: groupId
            });
        }
    }
}

io.on('connection', (socket) => {
    console.log('User connected to socket:', socket.id);

    // התחברות של משתמש קיים עם מערך הקבוצות שלו
    socket.on('join_groups', (userData) => {
        const { userId, name, groups } = userData;
        
        // יצירה או עדכון של המשתמש בזיכרון השרת
        if (!userGroupsDB[userId]) {
            userGroupsDB[userId] = { name: name, groups: [], targetCities: ['תל אביב - יפו'] };
        }
        userGroupsDB[userId].name = name;
        
        if (groups && Array.isArray(groups)) {
            groups.forEach(group => {
                if (!userGroupsDB[userId].groups.includes(group)) {
                    userGroupsDB[userId].groups.push(group);
                }
                socket.join(group);
                console.log(`User ${name} joined group: ${group}`);
                sendGroupStateToSocket(socket, group);
            });
        }
    });

    // הצטרפות לקבוצה חדשה (דרך לינק)
    socket.on('join_via_link', (data) => {
        const { userId, name, groupId, targetCities } = data;
        
        if (!userGroupsDB[userId]) {
            userGroupsDB[userId] = { name: name, groups: [], targetCities: targetCities || ['תל אביב - יפו'] };
        }
        
        if (!userGroupsDB[userId].groups.includes(groupId)) {
            userGroupsDB[userId].groups.push(groupId);
        }
        
        socket.join(groupId);
        console.log(`User ${name} (${userId}) dynamically joined group: ${groupId}`);
        
        io.to(groupId).emit('group_member_status', { 
            userId, 
            name: name, 
            status: 'pending', 
            groupId 
        });

        sendGroupStateToSocket(socket, groupId);
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
            
            for (const [userId, userRecord] of Object.entries(userGroupsDB)) {
                
                const isRelevantForUser = userRecord.targetCities.some(city => alertCities.includes(city));
                
                if (isRelevantForUser) {
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
                }
            }
        }
    } catch (error) {
        // התעלמות משגיאות רשת שוטפות
    }
}

setInterval(pollOrefApi, 1000);

app.post('/api/status', (req, res) => {
    const { userId, status } = req.body;
    
    if (!userId || !status) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const userName = userGroupsDB[userId] ? userGroupsDB[userId].name : 'משתמש לא ידוע';
    usersStatus.set(userId, { name: userName, status, time: new Date() });
    
    io.emit('status_update', { userId, name: userName, status });

    const userRecord = userGroupsDB[userId];
    if (userRecord && userRecord.groups) {
        userRecord.groups.forEach(group => {
            io.to(group).emit('group_member_status', { 
                userId, 
                name: userName, 
                status, 
                groupId: group 
            });
        });
    }

    res.status(200).json({ success: true, message: 'Status updated successfully' });
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