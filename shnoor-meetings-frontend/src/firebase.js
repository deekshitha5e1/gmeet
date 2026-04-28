import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// Firebase project config (shnoorlogin)
const firebaseConfig = {
  apiKey: "AIzaSyDtEN7O9Pr27ptKTfeehdWgxZ-BCYtLm4Q",
  authDomain: "shnoorlogin.firebaseapp.com",
  projectId: "shnoorlogin",
  storageBucket: "shnoorlogin.firebasestorage.app",
  messagingSenderId: "838182711811",
  appId: "1:838182711811:web:ff0ea56213721135939436",
  measurementId: "G-J2GD52HFZZ"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();