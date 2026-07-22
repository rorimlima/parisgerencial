// Firebase configuration — lê variáveis do arquivo .env (prefixo VITE_)
// Projeto: paris-dakar-gerencial

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAyPYU3zQB_ptoxoHfjYBISJdAqLJuoSTc",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "paris-dakar-gerencial.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "paris-dakar-gerencial",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "paris-dakar-gerencial.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "358605719811",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:358605719811:web:6e4d632d548fa84e644136",
};

export { firebaseConfig };
