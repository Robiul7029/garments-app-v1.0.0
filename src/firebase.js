import { initializeApp } from "firebase/app";
import { browserSessionPersistence, getAuth, setPersistence } from "firebase/auth";
import {
  doc,
  getDoc,
  getFirestore,
  initializeFirestore,
  onSnapshotsInSync,
} from "firebase/firestore";

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

/**
 * Firestore with `experimentalForceLongPolling`.
 *
 * The default WebChannel transport is the usual cause of a Firestore client that
 * silently never reaches the server — it stays in "offline" mode, writes queue in the
 * local cache, and the app reports "Offline — entries are saved on this device only"
 * even though the machine has a working Internet connection. Corporate networks,
 * proxies, some antivirus filters and older WebViews block or break that transport.
 *
 * Long polling goes over ordinary HTTPS requests, is supported everywhere, and costs a
 * little latency in exchange for a connection that actually stays alive. It is applied
 * once, at startup; `initializeFirestore` throws if called twice on the same app, so the
 * fallback to the already-initialised instance is intentional.
 */
function createFirestore() {
  try {
    return initializeFirestore(app, { experimentalForceLongPolling: true });
  } catch {
    return getFirestore(app);
  }
}

export const db = createFirestore();

// Strict session persistence: the Firebase auth token is kept in memory / sessionStorage
// only. Closing the tab, closing the browser, or exiting the app therefore ends the
// session immediately. A normal page refresh inside the same tab keeps the user signed in.
export const authPersistenceReady = setPersistence(auth, browserSessionPersistence).catch((error) => {
  console.error('[Auth] Failed to set browserSessionPersistence', error);
});

/**
 * A real round-trip to the Firestore backend.
 *
 * The SDK hiding in its local cache is exactly what "Offline" looks like from the UI, so
 * this asks the SERVER for the signed-in user's own document (the one document every
 * account may read). It resolves `true` only when the server answered:
 *
 *   - success: the read came from the cloud;
 *   - `permission-denied` / `unauthenticated`: the server DID answer — the connection is
 *     fine and the problem is access, which the screens report separately;
 *   - `unavailable` / `deadline-exceeded`: no connection to the cloud.
 *
 * `onSnapshotsInSync` is a secondary probe on the snapshot channel, so a listener that
 * reaches the server is proof even if the one-shot read is still settling.
 */
export async function probeFirestoreConnection(timeoutMs = 10000) {
  const wait = Math.max(1000, Number(timeoutMs) || 10000);
  const uid = auth.currentUser?.uid;
  if (!uid) return false;

  const attempt = getDoc(doc(db, 'users', uid))
    .then(() => true)
    .catch((error) => {
      const code = String(error?.code || '');
      // The server answered and refused: connected, just not authorised.
      return code === 'permission-denied' || code === 'unauthenticated';
    });

  // A dead transport can leave the promise pending forever; the timeout is a failure, not
  // a reason to keep a "checking" state up.
  const timeout = new Promise((resolve) => { setTimeout(() => resolve(false), wait); });
  if (await Promise.race([attempt, timeout])) return true;

  return new Promise((resolve) => {
    let settled = false;
    let off = () => {};
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { off(); } catch { /* already detached */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), wait);
    try {
      off = onSnapshotsInSync(db, () => finish(true));
      if (settled) off();
    } catch {
      finish(false);
    }
  });
}
