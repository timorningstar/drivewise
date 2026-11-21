import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBfolpo2MFWefXt5yOX7QDI3lhG0KmPsrw",
  authDomain: "dtm-housing.firebaseapp.com",
  projectId: "dtm-housing",
  storageBucket: "dtm-housing.firebasestorage.app",
  messagingSenderId: "799535216504",
  appId: "1:799535216504:web:f546aa722e1e2f30497a8d"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
