importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyCQmRJgQ9NbWS2CJIaBxvaAkYUFqgOOXwg",
  authDomain: "safezone-3c456.firebaseapp.com",
  projectId: "safezone-3c456",
  storageBucket: "safezone-3c456.firebasestorage.app",
  messagingSenderId: "497720147146",
  appId: "1:497720147146:web:47ebabd14ec8b3c4110833"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: 'https://cdn-icons-png.flaticon.com/512/763/763073.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/763/763073.png',
    vibrate: [200, 100, 200, 100, 200, 100, 200], // רטט של אזעקה
    requireInteraction: true // ההתראה תישאר על המסך עד שהמשתמש ילחץ
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});