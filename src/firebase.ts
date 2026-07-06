import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Check if credentials are set and not the placeholders
const isConfigured = 
  !!firebaseConfig.apiKey && 
  firebaseConfig.apiKey !== '' && 
  firebaseConfig.apiKey !== 'your_api_key_here';

let database: any = null;

if (isConfigured) {
  try {
    const app = initializeApp(firebaseConfig);
    database = getDatabase(app);
  } catch (error) {
    console.error("Erro ao inicializar Firebase Realtime Database:", error);
  }
} else {
  console.warn(
    "Aviso: O Firebase Realtime Database não está configurado. O aplicativo funcionará em modo DEMO local. Para habilitar a sincronização em tempo real de vídeo e chat, crie um arquivo '.env.local' com as chaves corretas."
  );
}

export { database, isConfigured };
