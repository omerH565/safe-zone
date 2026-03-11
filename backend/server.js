const express = require('express');
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');

// כאן בהמשך נכניס את קובץ המפתחות של Firebase
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

// מסד נתונים דינמי עם ערים וקבוצות
const userGroupsDB = {
    'emp_1': { name: 'אבא', groups: ['family_cohen', 'dev_team'], targetCities: ['תל אביב - יפו', 'רמת גן'] },
    'emp_2': { name: 'אמא', groups: ['family_cohen'], targetCities: ['תל אביב - יפו'] },
    'emp_3': { name: 'דני (מפתח)', groups: ['dev_team'], targetCities: ['חיפה'] }
};

// --- חדש: פונקציה ששולחת למשתמש ספציפי את כל החברים בקבוצה שלו כדי למלא את המסך ---
function sendGroupStateToSocket(socket, groupId) {
    for (const [uid, record] of Object.entries(userGroupsDB)) {
        if (record.groups.includes(groupId)) {
            const statusData = usersStatus.get(uid);
            const currentStatus = statusData ? statusData.status : 'pending';
            
            // שליחה ישירות לסוקט שהרגע התחבר
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

    // הצטרפות רגילה
    socket.on('join_groups', (userData) => {
        const { userId } = userData;
        const userRecord = userGroupsDB[userId];
        
        if (userRecord && userRecord.groups) {
            userRecord.groups.forEach(group => {
                socket.join(group);
                console.log(`User ${userRecord.name} joined group: ${group}`);
                
                // --- התיקון: ממלא את המסך של המשתמש ברגע שהוא מתחבר ---
                sendGroupStateToSocket(socket, group);
            });
        }
    });

    // הצטרפות דינמית דרך לינק הזמנה
    socket.on('join_via_link', (data) => {
        const { userId, name, groupId, targetCities } = data;
        
        // יצירת המשתמש החדש במסד הנתונים של השרת
        userGroupsDB[userId] = {
            name: name,
            groups: [groupId],
            targetCities: targetCities || ['תל אביב - יפו'] 
        };
        
        socket.join(groupId);
        console.log(`New user ${name} (${userId}) dynamically joined group: ${groupId}`);
        
        // מודיע לשאר חברי הקבוצה (כמו אמא במסך הימני) שהצטרף חבר חדש
        io.to(groupId).emit('group_member_status', { 
            userId, 
            name: name, 
            status: 'pending', 
            groupId 
        });

        // --- התיקון: שולח למשתמש החדש את כל מי שכבר בקבוצה (כדי שהמסך השמאלי לא יהיה ריק) ---
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

// לוגיקת סינון לפי עיר
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