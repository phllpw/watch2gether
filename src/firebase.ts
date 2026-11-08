import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import {
  getAuth,
  setPersistence,
  browserSessionPersistence,
  signInAnonymously,
  type Auth
} from 'firebase/auth';

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
let auth: Auth | null = null;

// Per-tab unique client ID so two tabs on the same browser or different devices never collide,
// even if Firebase Anonymous Auth is disabled in the Firebase Console.
function getOrCreateTabUserId(): string {
  let id = sessionStorage.getItem('watchparty_tab_userid');
  if (!id) {
    id = 'user_' + Math.random().toString(36).substring(2, 11);
    sessionStorage.setItem('watchparty_tab_userid', id);
  }
  return id;
}

export const clientUserId = getOrCreateTabUserId();

// Resolves once auth is attempted (never rejects so the room never blocks if Anonymous Auth is off)
let authReady: Promise<void> = Promise.resolve();

if (isConfigured) {
  try {
    const app = initializeApp(firebaseConfig);
    database = getDatabase(app);
    auth = getAuth(app);
    const authInstance = auth;
    authReady = setPersistence(authInstance, browserSessionPersistence)
      .then(async () => {
        await authInstance.authStateReady();
        if (!authInstance.currentUser) {
          await signInAnonymously(authInstance);
        }
      })
      .catch((err) => {
        console.warn("Aviso: Login anônimo do Firebase não está habilitado no console, usando ID de sessão local:", err?.code || err);
      });
  } catch (error) {
    console.error("Erro ao inicializar Firebase Realtime Database:", error);
  }
} else {
  console.warn(
    "Aviso: O Firebase Realtime Database não está configurado. O aplicativo funcionará em modo DEMO local. Para habilitar a sincronização em tempo real de vídeo e chat, crie um arquivo '.env.local' com as chaves corretas."
  );
}

export { database, isConfigured, auth, authReady };
