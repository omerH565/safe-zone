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
    console.log("✅ Loaded Firebase credentials from Render Secret File");
} catch (err) {
    try {
        serviceAccount = require('./firebase-adminsdk.json');
        console.log("✅ Loaded Firebase credentials locally");
    } catch (localErr) {
        console.error("❌ CRITICAL ERROR: No firebase credentials!");
        process.exit(1);
    }
}

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

// מגן ספאם במיוחד לחזל"שים (חסימה ל-5 דקות)
const userLastClearTime = new Map();

const usersStatus = new Map();
const userPushTokens = new Map();

// מגן 12 דקות שמחזיק גם את סוג האירוע (התרעה מול אזעקה) כדי לדעת מתי לשדרג
const userLastAlert = new Map(); 

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
// מילון זמנים בסיסי לפי אזורים (בשניות) - תקן פיקוד העורף
const regionAlertTimes = {
    "קו עימות": 0, // מיידי
    "עוטף עזה": 15,
    "גליל עליון": 15,
    "גליל תחתון": 60,
    "חיפה": 60,
    "קריות": 60,
    "כרמל": 60,
    "שרון": 90,
    "דן": 90,
    "השפלה": 90,
    "ירושלים": 90,
    "באר שבע": 60,
    "אילת": 180, // 3 דקות
    "ערבה": 180
};

// מילון חריגים (Overrides): כאן אתה "דורס" זמנים לעיר ספציפית!
// למשל, אם אתה רוצה שאילת תהיה דקה וחצי למרות שהיא באזור של 3 דקות:
const citySpecificTimes = {
    // "אילת": 90,
    // "קריית שמונה": 0 
};

function getShelterTimeForCity(city) {
    // 1. העיר נמצאת ברשימת החריגים? (למשל אילת המקוצרת)
    if (citySpecificTimes[city] !== undefined) {
        return citySpecificTimes[city];
    }
    // 2. לא חריגה? נחפש את האזור שלה וניקח את הזמן שלו
    const region = regionsMap[city];
    if (region && regionAlertTimes[region] !== undefined) {
        return regionAlertTimes[region];
    }
    // 3. עיר שלא מוגדרת בשום מקום? ברירת מחדל בטוחה של דקה וחצי
    return 90;
}
const SECRET_WEBHOOK_TOKEN = 'omer_safezone_secret_2026';

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
            const currentStatus = usersStatus.has(uid) ? usersStatus.get(uid).status : 'pending';
            
            socket.emit('group_member_status', {
                userId: uid,
                name: doc.data().name,
                status: currentStatus,
                groupId: groupId
            });
        });
    } catch (err) {
        console.error("Error fetching group state:", err);
    }
}

io.on('connection', (socket) => {
    console.log('User connected to socket:', socket.id);

    socket.on('update_settings', async (data) => {
        const { userId, name, targetCities } = data;
        try {
            const finalRegions = deriveAlertAreas(targetCities || []);
            await db.collection('users').doc(userId).update({
                name: name,
                targetCities: targetCities,
                targetRegions: finalRegions
            });
            
            if (usersStatus.has(userId)) {
                usersStatus.get(userId).name = name;
            }
        } catch (err) {
            console.error('Error updating settings:', err);
        }
    });

    socket.on('join_groups', async (userData) => {
        const { userId, name, groups, targetCities } = userData;
        try {
            const userRef = db.collection('users').doc(userId);
            const doc = await userRef.get();
            const finalRegions = deriveAlertAreas(targetCities || []);

            if (doc.exists) {
                const existingGroups = doc.data().groups || [];
                const mergedGroups = [...new Set([...existingGroups, ...(groups || [])])];
                await userRef.update({
                    name: name,
                    groups: mergedGroups,
                    targetCities: targetCities,
                    targetRegions: finalRegions
                });
            } else {
                await userRef.set({
                    name: name,
                    groups: groups || [],
                    targetCities: targetCities,
                    targetRegions: finalRegions
                });
            }

            if (groups && Array.isArray(groups)) {
                groups.forEach(group => {
                    socket.join(group);
                    sendGroupStateToSocket(socket, group);
                });
            }
        } catch (err) {
            console.error("Error in join_groups:", err);
        }
    });

    socket.on('join_via_link', async (data) => {
        const { userId, name, groupId, targetCities } = data;
        try {
            const userRef = db.collection('users').doc(userId);
            const doc = await userRef.get();
            const finalRegions = deriveAlertAreas(targetCities || []);

            if (doc.exists) {
                const existingGroups = doc.data().groups || [];
                if (!existingGroups.includes(groupId)) {
                    existingGroups.push(groupId);
                }
                await userRef.update({
                    name: name,
                    groups: existingGroups,
                    targetCities: targetCities,
                    targetRegions: finalRegions
                });
            } else {
                await userRef.set({
                    name: name,
                    groups: [groupId],
                    targetCities: targetCities,
                    targetRegions: finalRegions
                });
            }

            socket.join(groupId);
            
            io.to(groupId).emit('group_member_status', { 
                userId: userId, 
                name: name, 
                status: 'pending', 
                groupId: groupId 
            });

            sendGroupStateToSocket(socket, groupId);
        } catch (err) {
            console.error("Error in join_via_link:", err);
        }
    });
    
    // --- מנגנון התאוששות מאפליקציה סגורה / לחיצה על Push ---
    socket.on('check_active_alert', (userId) => {
        if (!userId) return;
        const lastAlertData = userLastAlert.get(userId);
        const now = Date.now();
        
        // הלוגיקה החדשה: התרעה מקדימה ('warning') נשארת פעילה לנצח עד שמגיע חזל"ש רשמי. אזעקה רגילה פגה אחרי 12 דקות.
        const isActiveAlert = lastAlertData && (
            lastAlertData.type === 'warning' || 
            (now - lastAlertData.time < 12 * 60 * 1000)
        );
        
        if (isActiveAlert) {
            const isEarlyWarning = lastAlertData.type === 'warning';
            // בודק מה הסטטוס העדכני שלך בשרת
            const currentStatus = usersStatus.get(userId)?.status || 'pending'; 
            
            // שולפים עיר ראשונה מההתרעה הקיימת או ברירת מחדל
            const fallbackCity = (lastAlertData.cities && lastAlertData.cities.length > 0) ? lastAlertData.cities[0] : 'תל אביב - יפו';
            
            socket.emit('new_alert_for_user', { 
                userId: userId, 
                cities: ['אזורך'], 
                startTime: lastAlertData.time, 
                isEarlyWarning: isEarlyWarning,
                status: currentStatus,
                timeToShelter: getShelterTimeForCity(fallbackCity) // שולב זמן דינמי לשחזור!
            });
        } else {
            // התיקון הקריטי למסכים תקועים: שולחים פקודת ניקוי עם דגל סנכרון שקט
            socket.emit('clear_alert_for_user', { userId: userId, isSync: true });
        }
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
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/register-push', async (req, res) => {
    const { userId, token } = req.body;
    if (userId && token) {
        userPushTokens.set(userId, token);
        try {
            await db.collection('users').doc(userId).set({ pushToken: token }, { merge: true });
        } catch (error) {
            console.error("Error saving token:", error);
        }
        res.status(200).send({ success: true });
    } else {
        res.status(400).send({ error: 'Missing parameters' });
    }
});

app.post('/api/ping-group', async (req, res) => {
    // קולטים את ה-ID של השולח
    const { groupId, senderName, senderId } = req.body; 
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
            
            // 👈 שולחים פוש רק אם היוזר הנוכחי הוא *לא* השולח
            if (userPushToken && userId !== senderId) {
                admin.messaging().send({
                    notification: {
                        title: `🔔 בדיקת נוכחות: קבוצת ${groupId}`,
                        body: `${senderName} מבקש לדעת שכולם בסדר. היכנסו לעדכן סטטוס!`
                    },
                    token: userPushToken
                }).catch(err => console.error(err));
            }
        });

        res.json({ success: true });
    } catch(e) {
        res.status(500).json({error: e.message});
    }
});

app.post('/api/remove-member', async (req, res) => {
    const { targetUserId, groupId } = req.body;
    if (!targetUserId || !groupId) return res.status(400).json({ error: 'Missing params' });

    try {
        const userRef = db.collection('users').doc(targetUserId);
        const doc = await userRef.get();
        if (doc.exists) {
            const existingGroups = doc.data().groups || [];
            // מסננים החוצה את הקבוצה שהמשתמש הוסר ממנה
            const updatedGroups = existingGroups.filter(g => g !== groupId);
            await userRef.update({ groups: updatedGroups });
            
            // מודיעים לכל מי שפתוח על הקבוצה הזו להעלים את המשתמש מה-UI
            io.to(groupId).emit('member_removed', { userId: targetUserId, groupId: groupId });
            
            // מודיעים למשתמש עצמו כדי שהאפליקציה שלו תתעדכן
            io.emit('you_were_removed', { userId: targetUserId, groupId: groupId });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/webhook-alert', async (req, res) => {
    const { secret, cities, isEarlyWarning } = req.body;
    
    if (secret !== SECRET_WEBHOOK_TOKEN) return res.status(403).json({ error: 'Unauthorized' });
    if (!cities || !Array.isArray(cities)) return res.status(400).json({ error: 'Invalid data' });

    const alertType = isEarlyWarning ? 'warning' : 'siren';
    const now = Date.now();

    try {
        const usersToAlert = new Map();
        
        for (let i = 0; i < cities.length; i += 10) {
            const chunk = cities.slice(i, i + 10);
            const snapshot = await db.collection('users').where('targetCities', 'array-contains-any', chunk).get();
            snapshot.forEach(doc => {
                usersToAlert.set(doc.id, doc.data());
            });
        }
        
        usersToAlert.forEach((userRecord, userId) => {
            const lastAlertData = userLastAlert.get(userId) || { time: 0, type: null };
            const timeSinceLast = now - lastAlertData.time;
            
            let shouldAlert = false;
            let shouldResetStatus = false;
            
            if (timeSinceLast >= 12 * 60 * 1000) {
                shouldAlert = true;
                shouldResetStatus = true;
            } else if (lastAlertData.type === 'warning' && alertType === 'siren') {
                shouldAlert = true;
                shouldResetStatus = false; 
            } else {
                console.log(`[Debounce] Skipping alert for ${userRecord.name}`);
                return;
            }

            userLastAlert.set(userId, { time: now, type: alertType });
            
            // התיקון הכירורגי: מוחקים את ההגנה של החזל"ש כדי שהטסט הבא יעבוד חלק
            userLastClearTime.delete(userId); 
            
            if (shouldResetStatus) {
                usersStatus.set(userId, { name: userRecord.name, status: 'pending', time: new Date() });
            }

            const currentStatus = usersStatus.get(userId)?.status || 'pending';
            
            const userGroups = userRecord.groups || [];
            userGroups.forEach(group => {
                io.to(group).emit('group_member_status', { 
                    userId: userId, 
                    name: userRecord.name, 
                    status: currentStatus, 
                    groupId: group 
                });
            });
            
            // מציאת העיר הספציפית של המשתמש וחישוב הזמן החכם שלה
            const matchedCity = cities.find(c => (userRecord.targetCities || []).includes(c)) || cities[0];
            const shelterTimeSeconds = getShelterTimeForCity(matchedCity);

            io.emit('new_alert_for_user', { 
                userId: userId, 
                cities: cities, 
                startTime: now, 
                isEarlyWarning: isEarlyWarning, 
                status: currentStatus,
                timeToShelter: shelterTimeSeconds // הזרקת הזמן לאפליקציה!
            });

            const userPushToken = userRecord.pushToken || userPushTokens.get(userId);
            if (userPushToken && currentStatus !== 'protected') {
                const title = isEarlyWarning ? '⚠️ התרעה מקדימה באזורך' : '🚨 אזעקה באזורך!';
                admin.messaging().send({ 
                    notification: { 
                        title: title, 
                        body: `היכנסו למרחב מוגן. אזור: ${matchedCity}` 
                    }, 
                    token: userPushToken 
                }).catch(err => console.error(err));
            }
        });

        res.json({ success: true });
    } catch (error) {
        console.error("Error processing alert:", error);
        res.status(500).json({ error: 'Server Error' });
    }
});

app.post('/api/webhook-clear', async (req, res) => {
    const { secret, cities } = req.body; 
    
    if (secret !== SECRET_WEBHOOK_TOKEN) return res.status(403).json({ error: 'Unauthorized' });

    try {
        const usersToClear = new Map();
        
        for (let i = 0; i < cities.length; i += 10) {
            const chunk = cities.slice(i, i + 10);
            
            // מחפש לפי מרחבים (איך שפיקוד העורף שולח)
            const snapshotRegions = await db.collection('users').where('targetRegions', 'array-contains-any', chunk).get();
            snapshotRegions.forEach(doc => usersToClear.set(doc.id, doc.data()));
            
            // מחפש גם לפי עיר מדויקת (עבור הטסטים שלך)
            const snapshotCities = await db.collection('users').where('targetCities', 'array-contains-any', chunk).get();
            snapshotCities.forEach(doc => usersToClear.set(doc.id, doc.data()));
        }
        
       usersToClear.forEach((userRecord, userId) => {
            // הגנת ספאם: מונע כפילויות של חזל"ש באותו מרחב למשך 5 דקות
            const lastClear = userLastClearTime.get(userId) || 0;
            if (Date.now() - lastClear < 5 * 60 * 1000) {
                return; 
            }
            userLastClearTime.set(userId, Date.now()); 

            userLastAlert.delete(userId);
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
            
            // תמיד שולחים סוקט שינקה את המסך באפליקציה מבאגים וטיימרים תקועים!
            io.emit('clear_alert_for_user', { userId: userId });

            const userPushToken = userRecord.pushToken || userPushTokens.get(userId);
            if (userPushToken) {
                admin.messaging().send({ 
                    notification: { 
                        title: '✅ סיום אירוע', 
                        body: 'שמחים שאתם בסדר. ניתן לצאת מהמרחב המוגן.' 
                    }, 
                    token: userPushToken 
                }).catch(err => console.error(err));
            }
        });
        
        res.json({ success: true });
    } catch (error) {
        console.error("Error processing clear:", error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/simulate-alert', async (req, res) => {
    const city = req.query.city || 'תל אביב - מרכז העיר';
    
    try {
        await axios.post(`http://localhost:${process.env.PORT || 3000}/api/webhook-alert`, {
            secret: SECRET_WEBHOOK_TOKEN, 
            cities: [city], 
            isEarlyWarning: false
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/status', async (req, res) => {
    const { userId, status } = req.body;
    
    try {
        const doc = await db.collection('users').doc(userId).get();
        const userName = doc.exists ? doc.data().name : 'משתמש לא ידוע';
        
        usersStatus.set(userId, { name: userName, status: status, time: new Date() });
        io.emit('status_update', { userId: userId, name: userName, status: status });
        
        const userGroups = doc.exists ? (doc.data().groups || []) : [];
        userGroups.forEach(group => {
            io.to(group).emit('group_member_status', { 
                userId: userId, 
                name: userName, 
                status: status, 
                groupId: group 
            });
        });
        
        res.status(200).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'DB error' });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server is running on port ${PORT}`));