const SERVER_URL = 'https://safezone-api-uozd.onrender.com';
const socket = io(SERVER_URL);

// תיקון קריטי ל-iOS: התחברות מחדש לחדרי הקבוצות אחרי שהאפליקציה חוזרת מהרקע
socket.on('connect', () => {
    console.log("🟢 Socket connected/reconnected!");
    if (currentUserId && currentUserName) {
        connectToServer(); // שולח מחדש את רשימת הקבוצות לשרת כדי שיצרף אותנו לחדרים
    }
});

const firebaseConfig = {
    apiKey: "AIzaSyCQmRJgQ9NbWS2CJIaBxvaAkYUFqgOOXwg",
    authDomain: "safezone-3c456.firebaseapp.com",
    projectId: "safezone-3c456",
    storageBucket: "safezone-3c456.firebasestorage.app",
    messagingSenderId: "497720147146",
    appId: "1:497720147146:web:47ebabd14ec8b3c4110833"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const messaging = firebase.messaging();

let currentUserId = null;
let currentUserName = null;
let userGroups = JSON.parse(localStorage.getItem('safeZone_groups') || '[]');
let userCities = JSON.parse(localStorage.getItem('safeZone_cities') || '[]');
let currentTimer; 

// משתנים זמניים למסכי ההגדרות
let tempOnboardingCities = [];
let tempSettingsCities = [];

const onboardingModal = document.getElementById('onboarding-modal');
const authSection = document.getElementById('auth-section');
const setupSection = document.getElementById('setup-section');
const settingsModal = document.getElementById('settings-modal');
const mainApp = document.getElementById('main-app');
const greetingTitle = document.getElementById('greeting-title');
const groupsList = document.getElementById('groups-list');
const noGroupsMsg = document.getElementById('no-groups-msg');

// פונקציית עזר לרינדור תגיות הערים
function renderCityTags(citiesArray, containerId, removeCallback) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    
    if(citiesArray.length === 0) {
        container.innerHTML = '<span style="color: #6b7280; font-size: 0.85rem; width: 100%; text-align: center;">לא נבחרו אזורים. הוסף יישוב.</span>';
        return;
    }

    citiesArray.forEach((city, index) => {
        const tag = document.createElement('div');
        tag.className = 'city-tag';
        tag.innerHTML = `
            <span>${city}</span>
            <span class="city-tag-remove" data-index="${index}">&times;</span>
        `;
        container.appendChild(tag);
    });

    container.querySelectorAll('.city-tag-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const index = parseInt(e.target.getAttribute('data-index'));
            removeCallback(index);
        });
    });
}

function initApp() {
    const urlParams = new URLSearchParams(window.location.search);
    const joinGroupId = urlParams.get('join');

    auth.onAuthStateChanged(async user => {
        if (user) {
            currentUserId = user.uid;
            currentUserName = user.displayName || "משתמש";
            
            try {
                const response = await fetch(`${SERVER_URL}/api/user/${currentUserId}`);
                const result = await response.json();
                if (result.success && result.data) {
                    userGroups = result.data.groups || [];
                    userCities = result.data.targetCities || [];
                    localStorage.setItem('safeZone_groups', JSON.stringify(userGroups));
                    localStorage.setItem('safeZone_cities', JSON.stringify(userCities));
                }
            } catch (err) {
                console.error("Error fetching user data from DB:", err);
            }

            if (userCities.length === 0) {
                tempOnboardingCities = [];
                renderCityTags(tempOnboardingCities, 'onboarding-city-tags', (idx) => {
                    tempOnboardingCities.splice(idx, 1);
                    renderCityTags(tempOnboardingCities, 'onboarding-city-tags', arguments.callee);
                });
                onboardingModal.classList.remove('hidden');
                authSection.classList.add('hidden');
                setupSection.classList.remove('hidden');
            } else {
                onboardingModal.classList.add('hidden');
                mainApp.classList.remove('hidden');
                if (joinGroupId) handleJoinGroup(joinGroupId);
                connectToServer();
                requestPushPermission();
            }
        } else {
            mainApp.classList.add('hidden');
            onboardingModal.classList.remove('hidden');
            authSection.classList.remove('hidden');
            setupSection.classList.add('hidden');
        }
    });

    document.getElementById('btn-google-login').addEventListener('click', () => {
        const provider = new firebase.auth.GoogleAuthProvider();
        auth.signInWithPopup(provider).catch(error => {
            console.error("Google Login failed:", error);
            alert("שגיאה בהתחברות גוגל. נסה שוב.");
        });
    });

    document.getElementById('btn-facebook-login').addEventListener('click', () => {
        const provider = new firebase.auth.FacebookAuthProvider();
        auth.signInWithPopup(provider).catch(error => {
            if (error.code === 'auth/account-exists-with-different-credential') {
                alert("המייל הזה כבר מחובר דרך גוגל! אנא התחבר דרך גוגל.");
            } else {
                alert("שגיאה בהתחברות פייסבוק. נסה שוב.");
            }
        });
    });

    // הוספת עיר במסך ההתחלה
    document.getElementById('btn-add-onboarding-city').addEventListener('click', () => {
        const input = document.getElementById('onboarding-city-input');
        const city = input.value.trim();
        if (city && !tempOnboardingCities.includes(city)) {
            tempOnboardingCities.push(city);
            renderCityTags(tempOnboardingCities, 'onboarding-city-tags', (idx) => {
                tempOnboardingCities.splice(idx, 1);
                renderCityTags(tempOnboardingCities, 'onboarding-city-tags', arguments.callee);
            });
            input.value = '';
        }
    });

    // כפתור הסיום במסך ההתחלה
    document.getElementById('btn-start').addEventListener('click', () => {
        if (tempOnboardingCities.length === 0) {
            alert('אנא הוסף לפחות אזור התרעה אחד (למשל: תל אביב, רינתיה)');
            return;
        }
        userCities = tempOnboardingCities;
        localStorage.setItem('safeZone_cities', JSON.stringify(userCities));

        onboardingModal.classList.add('hidden');
        mainApp.classList.remove('hidden');
        
        if (joinGroupId) handleJoinGroup(joinGroupId);
        connectToServer();
        requestPushPermission();
    });
}

// פתיחת מסך הגדרות
document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('settings-username-display').innerText = `מחובר כ: ${currentUserName}`;
    tempSettingsCities = [...userCities]; // העתקת המערך הנוכחי למערך זמני
    
    renderCityTags(tempSettingsCities, 'settings-city-tags', (idx) => {
        tempSettingsCities.splice(idx, 1);
        renderCityTags(tempSettingsCities, 'settings-city-tags', arguments.callee);
    });
    
    settingsModal.classList.remove('hidden');
});

// הוספת עיר במסך ההגדרות
document.getElementById('btn-add-settings-city').addEventListener('click', () => {
    const input = document.getElementById('settings-city-input');
    const city = input.value.trim();
    if (city && !tempSettingsCities.includes(city)) {
        tempSettingsCities.push(city);
        renderCityTags(tempSettingsCities, 'settings-city-tags', (idx) => {
            tempSettingsCities.splice(idx, 1);
            renderCityTags(tempSettingsCities, 'settings-city-tags', arguments.callee);
        });
        input.value = '';
    }
});

document.getElementById('btn-close-settings').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
});

document.getElementById('btn-logout').addEventListener('click', () => {
    auth.signOut().then(() => {
        window.location.reload();
    });
});

// שמירת ההגדרות
document.getElementById('btn-save-settings').addEventListener('click', () => {
    if (tempSettingsCities.length === 0) {
        alert('חובה לבחור לפחות עיר אחת במועדפים');
        return;
    }
    userCities = tempSettingsCities;
    localStorage.setItem('safeZone_cities', JSON.stringify(userCities));
    
    socket.emit('update_settings', {
        userId: currentUserId,
        name: currentUserName,
        targetCities: userCities
    });

    settingsModal.classList.add('hidden');
});

async function requestPushPermission() {
    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            const token = await messaging.getToken({ vapidKey: "BJnoSnDhaKPdrWuM74yrJ9EKGhORjs_n_tWOU_2AvPAXim29RHYJilycEChrjtbpp7boSvIn8PwCj37vjYd9s4M" });
            if (token) {
                await fetch(`${SERVER_URL}/api/register-push`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: currentUserId, token: token })
                });
            }
        }
    } catch (error) { console.error("Error getting push token:", error); }
}

messaging.onMessage((payload) => {
    console.log("Foreground Push received:", payload);
});

function handleJoinGroup(groupId) {
    if (!userGroups.includes(groupId)) {
        userGroups.push(groupId);
        localStorage.setItem('safeZone_groups', JSON.stringify(userGroups));
        
        socket.emit('join_via_link', {
            userId: currentUserId,
            name: currentUserName,
            groupId: groupId,
            targetCities: userCities
        });
        alert(`הצטרפת בהצלחה לקבוצה: ${groupId}`);
    }
    window.history.replaceState({}, document.title, window.location.pathname);
}

function connectToServer() {
    greetingTitle.innerText = `שלום, ${currentUserName}`;
    socket.emit('join_groups', { 
        userId: currentUserId, 
        name: currentUserName,
        groups: userGroups,
        targetCities: userCities
    });
}

socket.on('group_member_status', (data) => {
    const { userId, name, status, groupId } = data;
    if (noGroupsMsg) noGroupsMsg.style.display = 'none';

    let groupDiv = document.getElementById(`group-${groupId}`);
    if (!groupDiv) {
        groupDiv = document.createElement('div');
        groupDiv.id = `group-${groupId}`;
        groupDiv.className = 'group-card';
        groupDiv.innerHTML = `
            <div class="group-header" style="display: flex; justify-content: space-between; border-bottom: 1px solid #374151; padding-bottom: 5px; margin-bottom: 10px;">
                <h4 style="margin: 0; color: #9ca3af;">${groupId}</h4>
                <div>
                    <button onclick="pingGroup('${groupId}')" style="background: none; border: none; color: #eab308; cursor: pointer; font-size: 0.9rem; margin-left: 10px;">🔔 בקש עדכון סטטוס</button>
                    <button onclick="copyInviteLink('${groupId}')" style="background: none; border: none; color: #3b82f6; cursor: pointer; font-size: 0.9rem;">🔗 הזמן חברים</button>
                </div>
            </div>
            <div class="members-container" id="members-${groupId}"></div>
        `;
        groupsList.appendChild(groupDiv);
    }

    const membersContainer = document.getElementById(`members-${groupId}`);
    let memberDiv = document.getElementById(`member-${userId}-${groupId}`);
    
    if (!memberDiv) {
        memberDiv = document.createElement('div');
        memberDiv.id = `member-${userId}-${groupId}`;
        memberDiv.className = 'member-item';
        membersContainer.appendChild(memberDiv);
    }

    const statusClass = status === 'pending' ? 'pending' : status;
    const displayName = userId === currentUserId ? `${name} (אני)` : name;

    memberDiv.innerHTML = `
        <span>${displayName}</span>
        <span class="status-dot ${statusClass}"></span>
    `;
});

document.getElementById('btn-create-group').addEventListener('click', () => {
    const newGroupName = prompt('הכנס שם לקבוצה החדשה (באנגלית, ללא רווחים, למשל: my_family):');
    if (newGroupName && newGroupName.trim() !== '') {
        const cleanName = newGroupName.trim().replace(/\s+/g, '_').toLowerCase();
        handleJoinGroup(cleanName);
    }
});

window.copyInviteLink = function(groupId) {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?join=${groupId}`;
    navigator.clipboard.writeText(inviteUrl).then(() => {
        alert(`הקישור הועתק!\nשלח אותו בוואטסאפ למי שתרצה לצרף ל-${groupId}`);
    });
};

window.pingGroup = async function(groupId) {
    if(confirm(`לשלוח בקשת עדכון סטטוס (Push) לכל חברי קבוצת ${groupId}?`)) {
        try {
            await fetch(`${SERVER_URL}/api/ping-group`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupId: groupId, senderName: currentUserName })
            });
            alert('התראה נשלחה בהצלחה לחברי הקבוצה!');
        } catch (error) { alert('שגיאה בשליחת ההתראה'); }
    }
};

socket.on('new_alert_for_user', (data) => {
    if(data.userId === currentUserId) {
        document.getElementById('alert-banner').classList.remove('hidden');
        document.getElementById('ping-banner').classList.add('hidden');
        
        document.querySelector('.action-buttons').classList.remove('hidden');
        document.getElementById('status-message').classList.add('hidden');
        document.getElementById('btn-arrived').classList.add('hidden');
        
        startTimer(90);
    }
});

socket.on('ping_alert_for_user', (data) => {
    if(data.userId === currentUserId) {
        document.getElementById('ping-banner').classList.remove('hidden');
        document.getElementById('alert-banner').classList.add('hidden');
        document.getElementById('ping-message').innerText = `${data.senderName} מבקש לדעת שכולם בסדר בקבוצה: ${data.groupId}`;
        
        document.querySelector('.action-buttons').classList.remove('hidden');
        document.getElementById('status-message').classList.add('hidden');
        document.getElementById('btn-arrived').classList.add('hidden');
        
        if (currentTimer) clearInterval(currentTimer);
    }
});

const buttons = { 'btn-safe': 'protected', 'btn-on-way': 'on_the_way', 'btn-help': 'needs_help' };

Object.keys(buttons).forEach(btnId => {
    document.getElementById(btnId).addEventListener('click', () => {
        reportStatus(buttons[btnId]);
    });
});

document.getElementById('btn-arrived').addEventListener('click', () => {
    reportStatus('protected');
});

async function reportStatus(status) {
    try {
        const response = await fetch(`${SERVER_URL}/api/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUserId, status: status })
        });

        if (response.ok) {
            document.querySelector('.action-buttons').classList.add('hidden');
            document.getElementById('alert-banner').classList.add('hidden');
            document.getElementById('ping-banner').classList.add('hidden');
            
            const statusDiv = document.getElementById('status-message');
            const statusText = document.getElementById('final-status-text');
            const btnArrived = document.getElementById('btn-arrived'); 
            
            statusDiv.classList.remove('hidden');
            
            if(status === 'protected') {
                statusText.innerText = "✅ דווחת כמוגן!";
                statusText.style.color = "#22c55e";
                btnArrived.classList.add('hidden'); 
            } else if (status === 'on_the_way') {
                statusText.innerText = "🏃‍♂️ דווחת כבדרך. עדכן כשתגיע!";
                statusText.style.color = "#eab308";
                btnArrived.classList.remove('hidden'); 
            } else {
                statusText.innerText = "⚠️ קריאת עזרה נשלחה!";
                statusText.style.color = "#ef4444";
                btnArrived.classList.remove('hidden'); 
            }
        }
    } catch (error) { alert('שגיאת חיבור לשרת.'); }
}

function startTimer(seconds) {
    if (currentTimer) clearInterval(currentTimer); 
    const timerDisplay = document.getElementById('timer');
    let timeLeft = seconds;
    currentTimer = setInterval(() => {
        timeLeft--;
        timerDisplay.innerText = `זמן להתגוננות: ${timeLeft} שניות`;
        if (timeLeft <= 0) {
            clearInterval(currentTimer);
            timerDisplay.innerText = "הישארו במרחב המוגן!";
        }
    }, 1000);
}

initApp();