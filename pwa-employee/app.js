// משיכת המשתמש מהזיכרון המקומי של הדפדפן (אם קיים)
let currentUserId = localStorage.getItem('safeZone_userId');
let currentGroupId = localStorage.getItem('safeZone_groupId');

if (!currentUserId) {
    currentUserId = document.getElementById('user-selector').value;
} else {
    // אם יש משתמש שמור, נעדכן את התפריט או נסתיר אותו
    const selector = document.getElementById('user-selector');
    if (currentUserId.startsWith('user_')) {
        selector.style.display = 'none'; // זה משתמש שנכנס מלינק
    } else {
        selector.value = currentUserId; // זה משתמש רגיל (אבא/אמא)
    }
}

const SERVER_URL = 'http://localhost:3000'; 
const socket = io(SERVER_URL);

// לוגיקת בדיקת קישור הזמנה (URL Parameters)
const urlParams = new URLSearchParams(window.location.search);
const joinGroupId = urlParams.get('join');

if (joinGroupId) {
    // זיהינו שהמשתמש נכנס דרך קישור הזמנה
    setTimeout(() => {
        const userName = prompt(`הוזמנת להצטרף לקבוצה: ${joinGroupId}\nאנא הכנס את שמך:`);
        if (userName && userName.trim() !== '') {
            currentUserId = 'user_' + Math.floor(Math.random() * 100000);
            currentGroupId = joinGroupId;
            
            // שמירה בזיכרון המקומי כדי שהזהות לא תימחק ברענון הדף
            localStorage.setItem('safeZone_userId', currentUserId);
            localStorage.setItem('safeZone_groupId', currentGroupId);
            localStorage.setItem('safeZone_userName', userName);
            
            document.getElementById('user-selector').style.display = 'none';
            
            socket.emit('join_via_link', {
                userId: currentUserId,
                name: userName,
                groupId: joinGroupId,
                targetCities: ['תל אביב - יפו']
            });

            window.history.replaceState({}, document.title, window.location.pathname);
            alert(`הצטרפת בהצלחה לקבוצה ${joinGroupId}!`);
        }
    }, 500); 
}

socket.on('connect', () => {
    console.log('Connected to server!');
    
    // כשהסוקט מתחבר נבדוק מאיפה המשתמש כדי לשלוח לשרת את המידע הנכון
    if (currentUserId.startsWith('user_') && currentGroupId) {
        socket.emit('join_via_link', {
            userId: currentUserId,
            name: localStorage.getItem('safeZone_userName') || 'משתמש חדש',
            groupId: currentGroupId,
            targetCities: ['תל אביב - יפו']
        });
    } else {
        socket.emit('join_groups', { userId: currentUserId });
    }
});

// החלפת משתמש דרך התפריט
document.getElementById('user-selector').addEventListener('change', (e) => {
    currentUserId = e.target.value;
    localStorage.setItem('safeZone_userId', currentUserId);
    document.getElementById('groups-list').innerHTML = ''; 
    socket.emit('join_groups', { userId: currentUserId }); 
});

// קבלת אזעקה אישית
socket.on('new_alert_for_user', (data) => {
    if(data.userId === currentUserId) {
        document.getElementById('alert-banner').classList.remove('hidden');
        startTimer(90);
    }
});

// בניית רשימת החברים בקבוצה
socket.on('group_member_status', (data) => {
    const { userId, name, status, groupId } = data;
    
    let groupDiv = document.getElementById(`group-${groupId}`);
    if (!groupDiv) {
        groupDiv = document.createElement('div');
        groupDiv.id = `group-${groupId}`;
        groupDiv.className = 'group-card';
        groupDiv.innerHTML = `<h4 class="group-title">קבוצה: ${groupId}</h4>`;
        document.getElementById('groups-list').appendChild(groupDiv);
    }

    let memberDiv = document.getElementById(`member-${userId}`);
    if (!memberDiv) {
        memberDiv = document.createElement('div');
        memberDiv.id = `member-${userId}`;
        memberDiv.className = 'member-item';
        groupDiv.appendChild(memberDiv);
    }

    const statusClass = status === 'pending' ? 'pending' : status;

    memberDiv.innerHTML = `
        <span>${name}</span>
        <span class="status-dot ${statusClass}"></span>
    `;
});

// טיפול בלחיצות על כפתורי הסטטוס
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

// --- חדש: האזנה לכפתור "הגעתי למרחב מוגן" מתוך מסך הסיום ---
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
            const btnArrived = document.getElementById('btn-arrived'); // תפיסת הכפתור החדש
            
            statusDiv.classList.remove('hidden');
            
            if(status === 'protected') {
                statusText.innerText = "✅ דווחת כמוגן!";
                statusText.style.color = "#22c55e";
                btnArrived.classList.add('hidden'); // מעלים את הכפתור אם הוא מוגן
            } else if (status === 'on_the_way') {
                statusText.innerText = "🏃‍♂️ דווחת כבדרך. עדכן כשתגיע!";
                statusText.style.color = "#eab308";
                btnArrived.classList.remove('hidden'); // מציג את כפתור ה"הגעתי"
            } else {
                statusText.innerText = "⚠️ קריאת עזרה נשלחה!";
                statusText.style.color = "#ef4444";
                btnArrived.classList.remove('hidden'); // מציג את כפתור ה"הגעתי" גם כאן למקרה שהאירוע נפתר
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

// העתקת קישור הזמנה
document.getElementById('copy-link-btn').addEventListener('click', () => {
    const defaultGroup = currentGroupId || 'family_cohen'; 
    const inviteUrl = `${window.location.origin}${window.location.pathname}?join=${defaultGroup}`;
    
    navigator.clipboard.writeText(inviteUrl).then(() => {
        alert(`קישור ההזמנה הועתק ללוח!\n\n${inviteUrl}\n\nשלח אותו בוואטסאפ למי שתרצה לצרף.`);
    }).catch(err => {
        console.error('Failed to copy: ', err);
        alert('שגיאה בהעתקת הקישור.');
    });
});