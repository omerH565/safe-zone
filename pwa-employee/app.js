// --- CTO Trick: Deferred Deep Linking (שמירת הקישור להתקנה) ---
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

function preserveJoinLinkForInstall() {
    const urlParams = new URLSearchParams(window.location.search);
    const joinGroupId = urlParams.get('join');
    
    if (joinGroupId) {
        localStorage.setItem('pending_join_group', joinGroupId);
        const manifestLink = document.getElementById('manifest-link');
        if (manifestLink) {
            fetch('manifest.json')
                .then(res => res.json())
                .then(manifest => {
                    manifest.start_url = window.location.pathname + "?join=" + joinGroupId;
                    const blob = new Blob([JSON.stringify(manifest)], {type: 'application/json'});
                    manifestLink.href = URL.createObjectURL(blob);
                })
                .catch(e => console.error("Error updating manifest", e));
        }
    }
}

preserveJoinLinkForInstall();

const SERVER_URL = 'https://safezone-api.online';
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
let shelterInterval; 

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

// הוספת פונקציית עדכון ה-Dashboard האישי
window.updateMyStatusUI = function(status) {
    const dot = document.getElementById('my-status-dot');
    const text = document.getElementById('my-status-text');
    if (!dot || !text) return;

    dot.className = 'status-dot'; // ניקוי קלאסים
    
    if (status === 'protected') {
        dot.classList.add('protected');
        text.innerText = 'במרחב מוגן';
        text.style.color = '#22c55e'; // ירוק טיילוינד
        dot.style.backgroundColor = '#22c55e';
        dot.style.boxShadow = '0 0 12px #22c55e'; // 🌟 אפקט הזוהר הירוק!
    } else if (status === 'on_the_way') {
        dot.classList.add('on_the_way');
        text.innerText = 'בדרך למרחב';
        text.style.color = '#ef4444'; // אדום
        dot.style.backgroundColor = '#ef4444';
        dot.style.boxShadow = '0 0 12px #ef4444'; // 🌟 אפקט הזוהר האדום!
    } else {
        dot.classList.add('pending');
        text.innerText = 'לא נבחר';
        text.style.color = '#9ca3af'; // אפור
        dot.style.backgroundColor = '#4b5563';
        dot.style.boxShadow = 'none'; // ללא זוהר במצב המתנה
    }
};

window.checkSystemRequirements = function() {
    const installBanner = document.getElementById('banner-install');
    const pushBanner = document.getElementById('banner-push');
    
    if (!installBanner || !pushBanner) return;

    if (!isRunningAsPWA()) {
        installBanner.style.display = 'flex';
        installBanner.onclick = async () => {
            if (typeof deferredPrompt !== 'undefined' && deferredPrompt) {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    installBanner.style.display = 'none';
                }
                deferredPrompt = null;
            } else {
                alert('להתקנה מלאה:\n\nבאייפון (Safari): לחץ על כפתור השיתוף ⍗ למטה, ואז בחר "הוסף למסך הבית".\n\nבאנדרואיד (Chrome): פתח את תפריט 3 הנקודות למעלה ובחר "התקן אפליקציה".');
            }
        };
    } else {
        installBanner.style.display = 'none';
    }

    // 2. ניהול התראות PUSH
    if ('Notification' in window) {
        if (Notification.permission !== 'granted') {
            pushBanner.style.display = 'flex';
            pushBanner.querySelector('span:nth-child(2)').innerText = 'לקבלת התראות Push';
            pushBanner.onclick = async () => {
                await requestPushPermission();
                setTimeout(checkSystemRequirements, 1000); 
            };
        } else {
            pushBanner.style.display = 'none';
            // 🌟 מנגנון ריפוי עצמי: אם אישרנו בעבר, נבדוק שקט שהטוקן מעודכן בשרת
            if (currentUserId) {
                requestPushPermission();
            }
        }
    } else {
        pushBanner.style.display = 'none';
    }
};

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
    const joinGroupId = urlParams.get('join') || localStorage.getItem('pending_join_group');
    
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
                checkSystemRequirements();
            }
        } else {
            mainApp.classList.add('hidden'); 
            onboardingModal.classList.remove('hidden');
            authSection.classList.remove('hidden'); 
            setupSection.classList.add('hidden');
        }
    });

    document.getElementById('btn-google-login').addEventListener('click', () => { 
        auth.signInWithPopup(new firebase.auth.GoogleAuthProvider())
            .catch(error => {
                console.error("Google Login Error:", error);
                alert("שגיאת התחברות (גוגל): " + error.message);
            }); 
    });
    
    window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
        'size': 'invisible',
        'callback': (response) => {}
    });

    document.getElementById('btn-send-sms').addEventListener('click', () => {
        const phoneInput = document.getElementById('phone-number').value.trim();
        if (!phoneInput || phoneInput.length < 9) {
            alert("אנא הזן מספר טלפון תקין");
            return;
        }
        
        let formattedPhone = phoneInput.startsWith('0') ? phoneInput.substring(1) : phoneInput;
        const phoneNumber = "+972" + formattedPhone;

        const appVerifier = window.recaptchaVerifier;
        
        document.getElementById('btn-send-sms').innerText = "שולח...";
        document.getElementById('btn-send-sms').disabled = true;

        auth.signInWithPhoneNumber(phoneNumber, appVerifier)
            .then((confirmationResult) => {
                window.confirmationResult = confirmationResult;
                document.getElementById('phone-input-section').classList.add('hidden');
                document.getElementById('otp-input-section').classList.remove('hidden');
                document.getElementById('btn-send-sms').innerText = "שלח קוד ב-SMS";
                document.getElementById('btn-send-sms').disabled = false;
            }).catch((error) => {
                console.error("SMS Error:", error);
                alert("שגיאה בשליחת SMS. ודא שאישרת Phone ב-Firebase.");
                window.recaptchaVerifier.render().then(function(widgetId) {
                    grecaptcha.reset(widgetId);
                });
                document.getElementById('btn-send-sms').innerText = "שלח קוד ב-SMS";
                document.getElementById('btn-send-sms').disabled = false;
            });
    });

    document.getElementById('btn-verify-otp').addEventListener('click', () => {
        const code = document.getElementById('otp-code').value.trim();
        if (!code) return;

        document.getElementById('btn-verify-otp').innerText = "מאמת...";
        document.getElementById('btn-verify-otp').disabled = true;

        window.confirmationResult.confirm(code).then((result) => {
            if (!result.user.displayName) {
                const tempName = "משתמש_" + result.user.phoneNumber.slice(-4);
                result.user.updateProfile({ displayName: tempName }).then(() => {
                    currentUserName = tempName;
                });
            }
        }).catch((error) => {
            console.error("OTP Verification Error:", error);
            alert("קוד שגוי, אנא נסה שוב.");
            document.getElementById('btn-verify-otp').innerText = "אמת קוד והיכנס";
            document.getElementById('btn-verify-otp').disabled = false;
        });
    });
    
    document.getElementById('btn-back-to-phone').addEventListener('click', () => {
         document.getElementById('phone-input-section').classList.remove('hidden');
         document.getElementById('otp-input-section').classList.add('hidden');
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
        const enteredName = document.getElementById('setup-name-input').value.trim();
        if (tempOnboardingCities.length === 0) {
            alert('חובה לבחור עיר אחת לפחות');
            return;
        }
        if (!enteredName) {
            alert('חובה להזין שם תצוגה');
            return;
        }
        
        currentUserName = enteredName;
        auth.currentUser.updateProfile({ displayName: currentUserName });
        
        userCities = tempOnboardingCities;
        localStorage.setItem('safeZone_cities', JSON.stringify(userCities));
        
        onboardingModal.classList.add('hidden'); 
        mainApp.classList.remove('hidden');
        
        if (joinGroupId) {
            handleJoinGroup(joinGroupId);
        }
        
        connectToServer();
        checkSystemRequirements();
    });
} 

document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('settings-name-input').value = (currentUserName && currentUserName.startsWith('משתמש_')) ? '' : currentUserName;
    
    tempSettingsCities = [...userCities]; 
    renderCityTags(tempSettingsCities, 'settings-city-tags', (idx) => { 
        tempSettingsCities.splice(idx, 1); 
        renderCityTags(tempSettingsCities, 'settings-city-tags', arguments.callee); 
    });
    
    settingsModal.classList.remove('hidden');
});

// פתיחה מחדש של כפתורי הסטטוס בשגרה
document.getElementById('btn-manual-status').addEventListener('click', () => {
    document.querySelector('.action-buttons').classList.remove('hidden');
    document.getElementById('all-clear-banner').classList.add('hidden');
});

document.getElementById('btn-save-settings').addEventListener('click', () => {
    const enteredName = document.getElementById('settings-name-input').value.trim();
    if (tempSettingsCities.length === 0) {
        alert('חובה לבחור עיר מועדפת');
        return;
    }
    if (!enteredName) {
        alert('חובה להזין שם תצוגה');
        return;
    }
    
    currentUserName = enteredName;
    auth.currentUser.updateProfile({ displayName: currentUserName });
    
    userCities = tempSettingsCities;
    localStorage.setItem('safeZone_cities', JSON.stringify(userCities));
    
    socket.emit('update_settings', { 
        userId: currentUserId, 
        name: currentUserName, 
        targetCities: userCities 
    });
    
    document.getElementById('greeting-title').innerText = `שלום, ${currentUserName}`;
    settingsModal.classList.add('hidden');
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

document.getElementById('btn-refresh-push').addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh-push');
    const originalText = btn.innerHTML;
    
    // חיווי ויזואלי של טעינה
    btn.innerHTML = '<span>⏳</span> מחדש חיבור מול השרת...';
    btn.disabled = true;

    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            // 1. מוחקים את הטוקן הישן והתקוע
            await messaging.deleteToken();
            console.log("🗑️ Old push token deleted");
            
            // 2. מושכים טוקן חדש ונקי
            const newToken = await messaging.getToken({ vapidKey: "BJnoSnDhaKPdrWuM74yrJ9EKGhORjs_n_tWOU_2AvPAXim29RHYJilycEChrjtbpp7boSvIn8PwCj37vjYd9s4M" });
            
            if (newToken) {
                console.log("✨ Fresh token generated:", newToken.substring(0, 15) + "...");
                
                // 3. מסנכרנים מול השרת שלנו
                await fetch(`${SERVER_URL}/api/register-push`, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ userId: currentUserId, token: newToken }) 
                });
                
                localStorage.setItem('safezone_push_token', newToken);
                
                // 4. חיווי הצלחה ירוק
                btn.innerHTML = '<span>✅</span> החיבור חודש בהצלחה!';
                btn.style.background = 'rgba(34, 197, 94, 0.1)'; 
                btn.style.borderColor = '#22c55e';
                btn.style.color = '#22c55e';
                
                // מחזירים למצב הרגיל אחרי 3 שניות
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.style.background = 'rgba(59, 130, 246, 0.1)';
                    btn.style.borderColor = '#3b82f6';
                    btn.style.color = '#3b82f6';
                    btn.disabled = false;
                }, 3000);
            }
        } else {
            alert('הדפדפן שלך חוסם התראות. עליך לאפשר התראות בהגדרות הדפדפן כדי להשתמש בפיצ׳ר זה.');
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    } catch (e) {
        console.error("Error force-refreshing push:", e);
        alert('שגיאה ברענון ההתראות. אנא נסה שוב.');
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
});

document.getElementById('btn-logout').addEventListener('click', () => { 
    auth.signOut().then(() => {
        window.location.reload();
    });
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
                const savedToken = localStorage.getItem('safezone_push_token');
                // התיקון: מעדכן את השרת רק אם הטוקן השתנה או חסר!
                if (savedToken !== token) {
                    await fetch(`${SERVER_URL}/api/register-push`, { 
                        method: 'POST', 
                        headers: { 'Content-Type': 'application/json' }, 
                        body: JSON.stringify({ userId: currentUserId, token: token }) 
                    });
                    localStorage.setItem('safezone_push_token', token);
                    console.log("✅ Push Token synced securely with server");
                }
            }
        } else {
            console.warn("❌ Push permission was denied by user");
        }
    } catch (e) {
        console.error("❌ Error getting push token:", e);
    }
}

messaging.onMessage((payload) => {
    console.log("Foreground Push Received:", payload);
    
    // מציג התראת פוש רשמית של המערכת גם כשהאפליקציה פתוחה
    if (Notification.permission === 'granted') {
        new Notification(payload.notification.title, {
            body: payload.notification.body,
            icon: 'https://cdn-icons-png.flaticon.com/512/1164/1164323.png',
            requireInteraction: true
        });
    }
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
        }, (response) => {
            // אם השרת ענה לנו עם השם האמיתי של הקבוצה
            if (response && response.success) {
                alert(`הצטרפת בהצלחה לקבוצה: ${response.groupName}`);
            } else {
                alert(`הצטרפת בהצלחה לקבוצה!`);
            }
        });
    } else {
        alert('אתה כבר חבר בקבוצה זו.');
    }
    
    localStorage.removeItem('pending_join_group');
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
    socket.emit('check_active_alert', currentUserId);
}

socket.on('group_member_status', (data) => {
    const { userId, name, status, groupId, groupName } = data;
    
    // מעדכן את הפאנל האישי למעלה ברגע שהשרת מחזיר את הסטטוס שלנו!
    if (userId === currentUserId) {
        updateMyStatusUI(status);
    }
    
    const noGroupsMsg = document.getElementById('no-groups-msg');
    if (noGroupsMsg) {
        noGroupsMsg.style.display = 'none';
    }

    let groupDiv = document.getElementById(`group-${groupId}`);
    if (!groupDiv) {
        groupDiv = document.createElement('div'); 
        groupDiv.id = `group-${groupId}`; 
        groupDiv.className = 'group-card';
        const displayTitle = groupName || groupId;
        groupDiv.innerHTML = `
            <div class="group-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #374151; padding-bottom: 8px; margin-bottom: 10px;">
                <h4 onclick="toggleGroup('${groupId}')" style="margin: 0; color: #9ca3af; cursor: pointer; flex-grow: 1; display: flex; align-items: center; gap: 5px;">
            <span id="arrow-${groupId}">▼</span> ${displayTitle}
        </h4>
                
                <div style="display: flex; gap: 12px; align-items: center;">
                    <button onclick="pingGroup('${groupId}', '${groupName}')" style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef9a44; color: #ef9a44; padding: 6px 12px; border-radius: 6px; font-size: 0.8rem; font-family: inherit; cursor: pointer; display: flex; align-items: center; gap: 6px; transition: all 0.2s;">
                        <span>🔔</span> שלח התראה
                    </button>
                    
                    <div style="position: relative;">
                        <button onclick="toggleDropdown('${groupId}', event)" style="background: none; border: none; color: #9ca3af; cursor: pointer; font-size: 1.2rem; padding: 0 5px; font-weight: bold;">⋮</button>
                        
                        <div id="dropdown-${groupId}" class="dropdown-menu" style="display: none; position: absolute; left: 0; top: 100%; background: #1f2937; border: 1px solid #4b5563; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); z-index: 50; min-width: 150px; flex-direction: column; overflow: hidden; margin-top: 8px;">
                            <button onclick="toggleEditMode('${groupId}'); closeAllDropdowns();" style="background: none; border: none; border-bottom: 1px solid #374151; color: white; padding: 12px 15px; text-align: right; cursor: pointer; font-size: 0.95rem; display: flex; align-items: center; gap: 8px; width: 100%;">
                                ✏️ ערוך חברים
                            </button>
                            <button onclick="copyInviteLink('${groupId}'); closeAllDropdowns();" style="background: none; border: none; color: white; padding: 12px 15px; text-align: right; cursor: pointer; font-size: 0.95rem; display: flex; align-items: center; gap: 8px; width: 100%;">
                                🔗 העתק קישור
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="members-container" id="members-${groupId}" style="display: block; transition: all 0.3s ease;"></div>
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
        <div style="display: flex; align-items: center; gap: 10px;">
            <button class="delete-member-btn hidden" onclick="removeMember('${userId}', '${groupId}', '${displayName}')" style="background: #ef4444; color: white; border: none; border-radius: 50%; width: 22px; height: 22px; font-size: 12px; cursor: pointer; display: none; align-items: center; justify-content: center; font-weight: bold;">✕</button>
            <span>${displayName}</span>
        </div>
        <span class="status-dot ${statusClass}"></span>
    `;
});

document.getElementById('btn-create-group').addEventListener('click', () => {
    const newGroupName = prompt('הכנס שם לקבוצה החדשה (למשל: המשפחה של עומר):');
    if (newGroupName && newGroupName.trim() !== '') {
        // שולחים בקשה לשרת לייצר קבוצה עם מזהה מוצפן
        socket.emit('create_group_secure', {
            userId: currentUserId,
            name: currentUserName,
            groupDisplayName: newGroupName.trim(),
            targetCities: userCities
        }, (response) => {
            if (response && response.success) {
                userGroups.push(response.groupId);
                localStorage.setItem('safeZone_groups', JSON.stringify(userGroups));
                alert(`הקבוצה "${response.groupName}" נוצרה בהצלחה!`);
            } else {
                alert('שגיאה ביצירת הקבוצה. ודא חיבור לאינטרנט ונסה שוב.');
            }
        });
    }
});

window.copyInviteLink = function(groupId) {
    navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?join=${groupId}`).then(() => {
        alert(`הקישור הועתק! ${groupId}`);
    });
};

window.pingGroup = async function(groupId, groupName = groupId) {
    // 👇 כאן החלפנו ל-groupName כדי שהפופ-אפ יהיה יפה
    if(confirm(`בקשת עדכון מכולם בקבוצת ${groupName}?`)) {
        try {
            await fetch(`${SERVER_URL}/api/ping-group`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ 
                    groupId: groupId, 
                    senderName: currentUserName,
                    senderId: currentUserId 
                }) 
            });
            alert('התראה נשלחה!');
        } catch (e) {
            console.error("Error pinging", e);
        }
    }
};

window.toggleGroup = function(groupId) {
    const container = document.getElementById(`members-${groupId}`);
    const arrow = document.getElementById(`arrow-${groupId}`);
    if (container.style.display === 'none') {
        container.style.display = 'block';
        arrow.innerText = '▼';
    } else {
        container.style.display = 'none';
        arrow.innerText = '◀';
    }
};

window.toggleDropdown = function(groupId, event) {
    event.stopPropagation(); 
    const dropdown = document.getElementById(`dropdown-${groupId}`);
    const isCurrentlyOpen = dropdown.style.display === 'flex';
    
    closeAllDropdowns(); 
    
    if (!isCurrentlyOpen) {
        dropdown.style.display = 'flex';
    }
};

window.closeAllDropdowns = function() {
    const dropdowns = document.querySelectorAll('.dropdown-menu');
    dropdowns.forEach(menu => {
        menu.style.display = 'none';
    });
};

document.addEventListener('click', () => {
    closeAllDropdowns();
});

window.toggleEditMode = function(groupId) {
    const container = document.getElementById(`members-${groupId}`);
    const deleteBtns = container.querySelectorAll('.delete-member-btn');
    
    if (container.style.display === 'none') {
        toggleGroup(groupId);
    }
    
    deleteBtns.forEach(btn => {
        btn.classList.remove('hidden');
        btn.style.display = (btn.style.display === 'none' || btn.style.display === '') ? 'flex' : 'none';
    });
};

window.removeMember = async function(targetUserId, groupId, displayName) {
    if(confirm(`האם אתה בטוח שברצונך להסיר את ${displayName} מקבוצת ${groupId}?`)) {
        try {
            await fetch(`${SERVER_URL}/api/remove-member`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetUserId: targetUserId, groupId: groupId })
            });
        } catch (e) {
            console.error("Error removing member", e);
        }
    }
};

socket.on('member_removed', (data) => {
    const memberDiv = document.getElementById(`member-${data.userId}-${data.groupId}`);
    if (memberDiv) memberDiv.remove();
    
    const membersContainer = document.getElementById(`members-${data.groupId}`);
    if (membersContainer && membersContainer.children.length === 0) {
        const groupDiv = document.getElementById(`group-${data.groupId}`);
        if (groupDiv) groupDiv.remove();
    }
});

socket.on('you_were_removed', (data) => {
    if (data.userId === currentUserId) {
        userGroups = userGroups.filter(g => g !== data.groupId);
        localStorage.setItem('safeZone_groups', JSON.stringify(userGroups));
        alert(`הוסרת מקבוצת ${data.groupId}`);
        window.location.reload(); 
    }
});

socket.on('new_alert_for_user', (data) => {
    if(data.userId === currentUserId) {
        document.getElementById('alert-banner').classList.remove('hidden');
        document.getElementById('ping-banner').classList.add('hidden');
        document.getElementById('all-clear-banner').classList.add('hidden');
        
        document.getElementById('alert-banner').style.animation = 'pulse 1.5s infinite';
        
        const userStatus = data.status || 'pending'; 
        
        // תיקון באג 3: ציור הסטטוס (ירוק/אדום) מיד כשהאפליקציה נטענת מחדש!
        updateMyStatusUI(userStatus);

        if (userStatus === 'pending') {
            document.querySelector('.action-buttons').classList.remove('hidden');
        } else {
            document.querySelector('.action-buttons').classList.add('hidden');
        }

        if (data.isEarlyWarning) {
            document.getElementById('alert-title').innerText = "⚠️ התרעה מקדימה באזורך";
            document.getElementById('alert-banner').style.backgroundColor = "#eab308"; 
            document.getElementById('shelter-instruction-text').innerText = "שמור על עצמך. יש להישאר במרחב המוגן עד לקבלת הודעת שחרור מפיקוד העורף.";
            startStopwatch(data.startTime);
        } else {
            document.getElementById('alert-title').innerText = "🚨 אזעקה באזורך!";
            document.getElementById('alert-banner').style.backgroundColor = "#ef4444"; 
            
            // המוח מתחבר: מקבלים את הזמן המדויק מהשרת
            const shelterTime = data.timeToShelter || 90;
            document.getElementById('shelter-instruction-text').innerText = `שמור על עצמך. יש להישאר במרחב המוגן עד הודעת פיקוד העורף.`;
            startTimer(shelterTime, data.startTime);
        }
    }
});

socket.on('ping_alert_for_user', (data) => {
    if(data.userId === currentUserId) {
        document.getElementById('ping-banner').classList.remove('hidden');
        // התיקון העיצובי: לא מסתירים יותר את הבאנר של האזעקה!
        document.getElementById('all-clear-banner').classList.add('hidden');
        
        // 🚨 התיקון הכירורגי: משתמשים ב-data.groupName במקום data.groupId!
        const displayName = data.groupName || data.groupId;
        document.getElementById('ping-message').innerText = `${data.senderName} מבקש עדכון ב-${displayName}`;
        
        // מציגים את כפתורי הדיווח (ירוק/אדום)
        document.querySelector('.action-buttons').classList.remove('hidden');
        
        // 🚨 התיקון הקריטי: מחקנו מפה את כל פקודות ה-clearInterval!
        // ככה שאם המשתמש באמצע אזעקה עם טיימר רץ - הפינג לא יעצור לו את השעון בטעות.
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
            // העדכון המיידי של הממשק הויזואלי!
            updateMyStatusUI(status);
        }
    } catch (e) {
        console.error("Status error", e);
    }
}

function updateShelterDisplay(startTimeMs, displayElement) {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startTimeMs) / 1000));
    const mins = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
    const secs = String(elapsedSeconds % 60).padStart(2, '0');
    displayElement.innerText = `זמן במרחב המוגן: ${mins}:${secs}`;
}

function startShelterStopwatch(shelterStartTimeMs) {
    if (shelterInterval) clearInterval(shelterInterval);
    const timerDisplay = document.getElementById('timer');
    document.getElementById('alert-banner').style.animation = 'none';
    updateShelterDisplay(shelterStartTimeMs, timerDisplay);
    
    shelterInterval = setInterval(() => {
        updateShelterDisplay(shelterStartTimeMs, timerDisplay);
    }, 1000);
}

function startTimer(durationSeconds, startTimeMs) {
    if (currentTimer) clearInterval(currentTimer); 
    if (stopwatchInterval) clearInterval(stopwatchInterval);
    if (shelterInterval) clearInterval(shelterInterval);
    
    const timerDisplay = document.getElementById('timer');
    const startTimestamp = startTimeMs || Date.now();
    
    const initialElapsed = Math.floor((Date.now() - startTimestamp) / 1000);
    if (durationSeconds - initialElapsed <= 0) {
        const exactShelterStartTime = startTimestamp + (durationSeconds * 1000);
        startShelterStopwatch(exactShelterStartTime);
        return; 
    }
    
    currentTimer = setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - startTimestamp) / 1000);
        const timeLeft = durationSeconds - elapsedSeconds;
        
        if (timeLeft <= 0) {
            clearInterval(currentTimer); 
            const exactShelterStartTime = startTimestamp + (durationSeconds * 1000);
            startShelterStopwatch(exactShelterStartTime);
        } else { 
            timerDisplay.innerText = `זמן להתגוננות: ${timeLeft} שניות`; 
        }
    }, 1000);
}

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
        const wasAlertActive = !document.getElementById('alert-banner').classList.contains('hidden') || 
                               !document.getElementById('ping-banner').classList.contains('hidden');

        document.getElementById('alert-banner').classList.add('hidden');
        document.getElementById('ping-banner').classList.add('hidden');
        document.querySelector('.action-buttons').classList.add('hidden');
        
        // התיקון הכירורגי: מאפס את הנקודה הזוהרת למעלה חזרה ל"לא נבחר" (אפור)
        updateMyStatusUI('pending');

        if (!data.isSync || wasAlertActive) {
            document.getElementById('all-clear-banner').classList.remove('hidden');
        } else {
            document.getElementById('all-clear-banner').classList.add('hidden');
        }
        
        if (currentTimer) clearInterval(currentTimer);
        if (stopwatchInterval) clearInterval(stopwatchInterval);
        if (shelterInterval) clearInterval(shelterInterval);
    }
});

initApp();