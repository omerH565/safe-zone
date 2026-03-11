const SERVER_URL = 'https://safezone-api-uozd.onrender.com'; // הכתובת שלך ב-Render
const socket = io(SERVER_URL);

// משתני משתמש גלובליים
let currentUserId = localStorage.getItem('safeZone_userId');
let currentUserName = localStorage.getItem('safeZone_userName');
let userGroups = JSON.parse(localStorage.getItem('safeZone_groups') || '[]');

// אלמנטים ב-DOM
const onboardingModal = document.getElementById('onboarding-modal');
const mainApp = document.getElementById('main-app');
const greetingTitle = document.getElementById('greeting-title');
const groupsList = document.getElementById('groups-list');
const noGroupsMsg = document.getElementById('no-groups-msg');

// לוגיקת Onboarding וכניסה
function initApp() {
    const urlParams = new URLSearchParams(window.location.search);
    const joinGroupId = urlParams.get('join');

    if (!currentUserId || !currentUserName) {
        // משתמש חדש לגמרי
        mainApp.classList.add('hidden');
        onboardingModal.classList.remove('hidden');

        document.getElementById('btn-start').addEventListener('click', () => {
            const nameInput = document.getElementById('setup-username').value.trim();
            if (nameInput === '') {
                alert('אנא הכנס שם כדי להמשיך');
                return;
            }
            
            currentUserId = 'user_' + Math.random().toString(36).substr(2, 9);
            currentUserName = nameInput;
            
            localStorage.setItem('safeZone_userId', currentUserId);
            localStorage.setItem('safeZone_userName', currentUserName);
            localStorage.setItem('safeZone_groups', JSON.stringify(userGroups));

            onboardingModal.classList.add('hidden');
            mainApp.classList.remove('hidden');
            
            if (joinGroupId) {
                handleJoinGroup(joinGroupId);
            }
            
            connectToServer();
            renderUI();
        });
    } else {
        // משתמש קיים
        mainApp.classList.remove('hidden');
        onboardingModal.classList.add('hidden');
        
        if (joinGroupId) {
            handleJoinGroup(joinGroupId);
        }
        
        connectToServer();
        renderUI();
    }
}

function handleJoinGroup(groupId) {
    if (!userGroups.includes(groupId)) {
        userGroups.push(groupId);
        localStorage.setItem('safeZone_groups', JSON.stringify(userGroups));
        
        socket.emit('join_via_link', {
            userId: currentUserId,
            name: currentUserName,
            groupId: groupId,
            targetCities: ['תל אביב - יפו']
        });
        alert(`הצטרפת בהצלחה לקבוצה: ${groupId}`);
    }
    // ניקוי שורת הכתובת
    window.history.replaceState({}, document.title, window.location.pathname);
}

function connectToServer() {
    greetingTitle.innerText = `שלום, ${currentUserName}`;
    socket.emit('join_groups', { 
        userId: currentUserId, 
        name: currentUserName,
        groups: userGroups 
    });
}

// עדכון רשימת הקבוצות במסך
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
                <button onclick="copyInviteLink('${groupId}')" style="background: none; border: none; color: #3b82f6; cursor: pointer; font-size: 0.9rem;">🔗 הזמן חברים</button>
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
    // כשאנחנו מציירים את עצמנו, נוסיף (אני)
    const displayName = userId === currentUserId ? `${name} (אני)` : name;

    memberDiv.innerHTML = `
        <span>${displayName}</span>
        <span class="status-dot ${statusClass}"></span>
    `;
});

// יצירת קבוצה חדשה ידנית
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

// לוגיקת אזעקות וסטטוס
socket.on('new_alert_for_user', (data) => {
    if(data.userId === currentUserId) {
        document.getElementById('alert-banner').classList.remove('hidden');
        startTimer(90);
    }
});

const buttons = {
    'btn-safe': 'protected',
    'btn-on-way': 'on_the_way',
    'btn-help': 'needs_help'
};

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
    } catch (error) {
        alert('שגיאת חיבור לשרת.');
    }
}

function startTimer(seconds) {
    const timerDisplay = document.getElementById('timer');
    let timeLeft = seconds;
    
    const countdown = setInterval(() => {
        timeLeft--;
        timerDisplay.innerText = `זמן להתגוננות: ${timeLeft} שניות`;
        
        if (timeLeft <= 0) {
            clearInterval(countdown);
            timerDisplay.innerText = "הישארו במרחב המוגן!";
        }
    }, 1000);
}

// הדלקת האפליקציה בטעינה
initApp();