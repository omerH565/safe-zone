const SERVER_URL = 'https://safezone-api-uozd.onrender.com';
const socket = io(SERVER_URL);

socket.on('connect', () => {
    console.log("🟢 Socket connected/reconnected!");
    if (currentUserId && currentUserName) {
        connectToServer(); 
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
let stopwatchInterval;
let shelterInterval; // שעון העצר החדש לשהייה בממ"ד

function isRunningAsPWA() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

let tempOnboardingCities = [];
let tempSettingsCities = [];

const onboardingModal = document.getElementById('onboarding-modal');
const authSection = document.getElementById('auth-section');
const setupSection = document.getElementById('setup-section');
const settingsModal = document.getElementById('settings-modal');
const mainApp = document.getElementById('main-app');
const greetingTitle = document.getElementById('greeting-title');
const groupsList = document.getElementById('groups-list');

function renderCityTags(citiesArray, containerId, removeCallback) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    
    if(citiesArray.length === 0) {
        container.innerHTML = '<span style="color: #6b7280;">לא נבחרו אזורים.</span>';
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
    
    if (isRunningAsPWA()) {
        const installBanner = document.getElementById('pwa-install-banner');
        if (installBanner) {
            installBanner.style.display = 'none';
        }
    }
    
    auth.onAuthStateChanged(async user => {
        if (user) {
            currentUserId = user.uid; 
            currentUserName = user.displayName || "משתמש";
            
            try {
                const res = await fetch(`${SERVER_URL}/api/user/${currentUserId}`);
                const result = await res.json();
                if (result.success && result.data) {
                    userGroups = result.data.groups || []; 
                    userCities = result.data.targetCities || [];
                    localStorage.setItem('safeZone_groups', JSON.stringify(userGroups));
                    localStorage.setItem('safeZone_cities', JSON.stringify(userCities));
                }
            } catch (err) {
                console.error("Error fetching user", err);
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
                
                if (joinGroupId) {
                    handleJoinGroup(joinGroupId);
                }
                
                connectToServer();
                
                if (isRunningAsPWA() && Notification.permission !== 'granted') {
                    requestPushPermission();
                }
            }
        } else {
            mainApp.classList.add('hidden'); 
            onboardingModal.classList.remove('hidden');
            authSection.classList.remove('hidden'); 
            setupSection.classList.add('hidden');
        }
    });

    document.getElementById('btn-google-login').addEventListener('click', () => { 
        auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); 
    });
    
    document.getElementById('btn-facebook-login').addEventListener('click', () => { 
        auth.signInWithPopup(new firebase.auth.FacebookAuthProvider()); 
    });

    document.getElementById('btn-add-onboarding-city').addEventListener('click', () => {
        const city = document.getElementById('onboarding-city-input').value.trim();
        if (city && !tempOnboardingCities.includes(city)) {
            tempOnboardingCities.push(city);
            renderCityTags(tempOnboardingCities, 'onboarding-city-tags', (idx) => { 
                tempOnboardingCities.splice(idx, 1); 
                renderCityTags(tempOnboardingCities, 'onboarding-city-tags', arguments.callee); 
            });
            document.getElementById('onboarding-city-input').value = '';
        }
    });

    document.getElementById('btn-start').addEventListener('click', () => {
        if (tempOnboardingCities.length === 0) {
            alert('חובה לבחור עיר אחת לפחות');
            return;
        }
        
        userCities = tempOnboardingCities;
        localStorage.setItem('safeZone_cities', JSON.stringify(userCities));
        
        onboardingModal.classList.add('hidden'); 
        mainApp.classList.remove('hidden');
        
        if (joinGroupId) {
            handleJoinGroup(joinGroupId);
        }
        
        connectToServer();
        
        if (isRunningAsPWA() && Notification.permission !== 'granted') {
            requestPushPermission();
        }
    });
}

document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('settings-username-display').innerText = `מחובר כ: ${currentUserName}`;
    tempSettingsCities = [...userCities]; 
    
    renderCityTags(tempSettingsCities, 'settings-city-tags', (idx) => { 
        tempSettingsCities.splice(idx, 1); 
        renderCityTags(tempSettingsCities, 'settings-city-tags', arguments.callee); 
    });
    
    const pushBtn = document.getElementById('btn-enable-push');
    if (isRunningAsPWA() && Notification.permission !== 'granted') {
        pushBtn.classList.remove('hidden');
    } else {
        pushBtn.classList.add('hidden');
    }
    
    settingsModal.classList.remove('hidden');
});

document.getElementById('btn-home').addEventListener('click', () => {
    document.querySelector('.action-buttons').classList.remove('hidden');
    document.getElementById('status-message').classList.add('hidden');
    document.getElementById('all-clear-banner').classList.add('hidden');
});

document.getElementById('btn-enable-push').addEventListener('click', () => { 
    requestPushPermission(); 
    document.getElementById('btn-enable-push').classList.add('hidden'); 
});

document.getElementById('btn-add-settings-city').addEventListener('click', () => {
    const city = document.getElementById('settings-city-input').value.trim();
    if (city && !tempSettingsCities.includes(city)) {
        tempSettingsCities.push(city);
        renderCityTags(tempSettingsCities, 'settings-city-tags', (idx) => { 
            tempSettingsCities.splice(idx, 1); 
            renderCityTags(tempSettingsCities, 'settings-city-tags', arguments.callee); 
        });
        document.getElementById('settings-city-input').value = '';
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

document.getElementById('btn-save-settings').addEventListener('click', () => {
    if (tempSettingsCities.length === 0) {
        alert('חובה לבחור עיר מועדפת');
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

document.getElementById('btn-dismiss-clear').addEventListener('click', () => {
    document.getElementById('all-clear-banner').classList.add('hidden');
    document.querySelector('.action-buttons').classList.add('hidden');
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
    } catch (e) {
        console.error("Error push permission:", e);
    }
}

messaging.onMessage((payload) => {
    console.log("Foreground Push:", payload);
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
    
    const noGroupsMsg = document.getElementById('no-groups-msg');
    if (noGroupsMsg) {
        noGroupsMsg.style.display = 'none';
    }

    let groupDiv = document.getElementById(`group-${groupId}`);
    if (!groupDiv) {
        groupDiv = document.createElement('div'); 
        groupDiv.id = `group-${groupId}`; 
        groupDiv.className = 'group-card';
        groupDiv.innerHTML = `
            <div class="group-header" style="display: flex; justify-content: space-between; border-bottom: 1px solid #374151; padding-bottom: 5px; margin-bottom: 10px;">
                <h4 style="margin: 0; color: #9ca3af;">${groupId}</h4>
                <div>
                    <button onclick="pingGroup('${groupId}')" style="background: none; border: none; color: #eab308; cursor: pointer;">🔔</button>
                    <button onclick="copyInviteLink('${groupId}')" style="background: none; border: none; color: #3b82f6; cursor: pointer;">🔗</button>
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
    const newGroupName = prompt('שם קבוצה (באנגלית, ללא רווחים):');
    if (newGroupName && newGroupName.trim() !== '') {
        handleJoinGroup(newGroupName.trim().replace(/\s+/g, '_').toLowerCase());
    }
});

window.copyInviteLink = function(groupId) {
    navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?join=${groupId}`).then(() => {
        alert(`הקישור הועתק! ${groupId}`);
    });
};

window.pingGroup = async function(groupId) {
    if(confirm(`בקשת עדכון מכולם בקבוצת ${groupId}?`)) {
        try {
            await fetch(`${SERVER_URL}/api/ping-group`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ groupId: groupId, senderName: currentUserName }) 
            });
            alert('התראה נשלחה!');
        } catch (e) {
            console.error("Error pinging", e);
        }
    }
};

socket.on('new_alert_for_user', (data) => {
    if(data.userId === currentUserId) {
        document.getElementById('alert-banner').classList.remove('hidden');
        document.getElementById('ping-banner').classList.add('hidden');
        document.getElementById('all-clear-banner').classList.add('hidden');
        
        const currentStatusMsg = document.getElementById('status-message');
        if (currentStatusMsg.classList.contains('hidden')) {
            document.querySelector('.action-buttons').classList.remove('hidden');
        }

        if (data.isEarlyWarning) {
            document.getElementById('alert-title').innerText = "⚠️ התרעה מקדימה באזורך";
            document.getElementById('alert-banner').style.backgroundColor = "#eab308"; 
            startStopwatch(data.startTime);
        } else {
            document.getElementById('alert-title').innerText = "🚨 אזעקה באזורך!";
            document.getElementById('alert-banner').style.backgroundColor = "#ef4444"; 
            startTimer(90, data.startTime);
        }
    }
});

socket.on('ping_alert_for_user', (data) => {
    if(data.userId === currentUserId) {
        document.getElementById('ping-banner').classList.remove('hidden');
        document.getElementById('alert-banner').classList.add('hidden');
        document.getElementById('all-clear-banner').classList.add('hidden');
        
        document.getElementById('ping-message').innerText = `${data.senderName} מבקש עדכון ב-${data.groupId}`;
        
        document.querySelector('.action-buttons').classList.remove('hidden');
        document.getElementById('status-message').classList.add('hidden');
        
        if (currentTimer) clearInterval(currentTimer);
        if (stopwatchInterval) clearInterval(stopwatchInterval);
        if (shelterInterval) clearInterval(shelterInterval);
    }
});

const buttons = { 'btn-safe': 'protected', 'btn-on-way': 'on_the_way' };

Object.keys(buttons).forEach(btnId => {
    document.getElementById(btnId).addEventListener('click', () => reportStatus(buttons[btnId]));
});

async function reportStatus(status) {
    try {
        const res = await fetch(`${SERVER_URL}/api/status`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ userId: currentUserId, status: status }) 
        });
        
        if (res.ok) {
            document.querySelector('.action-buttons').classList.add('hidden');
            document.getElementById('ping-banner').classList.add('hidden');
            
            const statusDiv = document.getElementById('status-message');
            const statusText = document.getElementById('final-status-text');
            statusDiv.classList.remove('hidden');
            
            if(status === 'protected') {
                statusText.innerText = "✅ דווחת כמוגן!"; 
                statusText.style.color = "#22c55e";
            } else {
                statusText.innerText = "🏃‍♂️ דווחת כבדרך. עדכן כשתגיע!"; 
                statusText.style.color = "#ef4444";
            }
        }
    } catch (e) {
        console.error("Status error", e);
    }
}

// פונקציה לעדכון תצוגת השהייה בממ"ד
function updateShelterDisplay(startTimeMs, displayElement) {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startTimeMs) / 1000));
    const mins = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
    const secs = String(elapsedSeconds % 60).padStart(2, '0');
    displayElement.innerText = `זמן במרחב המוגן: ${mins}:${secs}`;
}

// הפעלת שעון העצר לשהייה בממ"ד (אחרי סיום ה-90 שניות)
function startShelterStopwatch(shelterStartTimeMs) {
    if (shelterInterval) clearInterval(shelterInterval);
    const timerDisplay = document.getElementById('timer');
    
    // עדכון ראשוני מיידי
    updateShelterDisplay(shelterStartTimeMs, timerDisplay);
    
    shelterInterval = setInterval(() => {
        updateShelterDisplay(shelterStartTimeMs, timerDisplay);
    }, 1000);
}

// טיימר יורד מ-90 שניות ואז עובר אוטומטית לשעון שהייה
function startTimer(durationSeconds, startTimeMs) {
    if (currentTimer) clearInterval(currentTimer); 
    if (stopwatchInterval) clearInterval(stopwatchInterval);
    if (shelterInterval) clearInterval(shelterInterval);
    
    const timerDisplay = document.getElementById('timer');
    const startTimestamp = startTimeMs || Date.now();
    
    // בדיקה מיידית למקרה שהמשתמש נכנס אחרי שכבר עברו 90 שניות
    const initialElapsed = Math.floor((Date.now() - startTimestamp) / 1000);
    if (durationSeconds - initialElapsed <= 0) {
        const exactShelterStartTime = startTimestamp + (durationSeconds * 1000);
        startShelterStopwatch(exactShelterStartTime);
        return; // עוצר את יצירת הטיימר הרגיל
    }
    
    currentTimer = setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - startTimestamp) / 1000);
        const timeLeft = durationSeconds - elapsedSeconds;
        
        if (timeLeft <= 0) {
            clearInterval(currentTimer); 
            // מחשב את הרגע המדויק שבו הסתיימו ה-90 שניות ומתחיל ממנו את שעון השהייה
            const exactShelterStartTime = startTimestamp + (durationSeconds * 1000);
            startShelterStopwatch(exactShelterStartTime);
        } else { 
            timerDisplay.innerText = `זמן להתגוננות: ${timeLeft} שניות`; 
        }
    }, 1000);
}

// שעון עצר שעולה מאפס (עבור התרעות מקדימות בלבד)
function startStopwatch(startTimeMs) {
    if (currentTimer) clearInterval(currentTimer);
    if (stopwatchInterval) clearInterval(stopwatchInterval);
    if (shelterInterval) clearInterval(shelterInterval);
    
    const timerDisplay = document.getElementById('timer');
    const startTimestamp = startTimeMs || Date.now();

    stopwatchInterval = setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - startTimestamp) / 1000);
        const mins = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
        const secs = String(elapsedSeconds % 60).padStart(2, '0');
        timerDisplay.innerText = `זמן שחלף: ${mins}:${secs}`;
    }, 1000);
}

socket.on('clear_alert_for_user', (data) => {
    if(data.userId === currentUserId) {
        document.getElementById('alert-banner').classList.add('hidden');
        document.getElementById('ping-banner').classList.add('hidden');
        document.querySelector('.action-buttons').classList.add('hidden');
        document.getElementById('status-message').classList.add('hidden');
        document.getElementById('all-clear-banner').classList.remove('hidden');
        
        if (currentTimer) clearInterval(currentTimer);
        if (stopwatchInterval) clearInterval(stopwatchInterval);
        if (shelterInterval) clearInterval(shelterInterval);
    }
});

initApp();