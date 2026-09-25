import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
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
