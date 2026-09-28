import { initializeApp } from "firebase/app";
import { browserSessionPersistence, getAuth, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore"; // ১. এটি যুক্ত হয়েছে

const firebaseConfig = {
  apiKey: "AIzaSyCRPw1FC8bzBGwkIOiMkj68Y8Ar78jxYKQ",
  authDomain: "garments-app-1.firebaseapp.com",
  projectId: "garments-app-1",
  storageBucket: "garments-app-1.firebasestorage.app",
  messagingSenderId: "267109128470",
  appId: "1:267109128470:web:54318e22cecb30712a9837"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app); // ২. এটি যুক্ত হয়েছে

// Strict session persistence: the Firebase auth token is kept in memory / sessionStorage
// only. Closing the tab, closing the browser, or exiting the app therefore ends the
// session immediately. A normal page refresh inside the same tab keeps the user signed in.
export const authPersistenceReady = setPersistence(auth, browserSessionPersistence).catch((error) => {
  console.error('[Auth] Failed to set browserSessionPersistence', error);
});
