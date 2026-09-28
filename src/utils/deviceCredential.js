// Local device credential vault.
//
// PIN and fingerprint act as a *quick-unlock second factor*: the user verifies locally,
// the encrypted credential is unlocked, and the normal email + password sign-in runs
// afterwards. Nothing is stored in plain text, and the vault stays empty until the user
// explicitly enables a quick-login method in Security Settings.
//
// The saved credential is encrypted under a key the chosen method can supply:
//   - PIN quick login: PBKDF2(pin) -> AES-GCM
//   - fingerprint quick login: a key derived from the WebAuthn PRF when the
//     authenticator supports it, otherwise a device key held in IndexedDB, released only
//     after a successful fingerprint assertion.

import { authenticateBiometric, isNativePlatform, loadNativeBiometrics } from './security';

const VAULT_KEY = 'garmentsDeviceVault';
const PBKDF2_ITERATIONS = 200000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const PRF_SALT_BYTES = 32;

function subtle() {
  const api = globalThis.crypto?.subtle;
  if (!api) {
    throw new Error('Secure storage is unavailable. Open the app over HTTPS (or localhost) to use PIN or fingerprint login.');
  }
  return api;
}

/* ------------------------------------------------------------------ *
 * Base64 helpers
 * ------------------------------------------------------------------ */

function toBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromBase64(value) {
  const binary = atob(String(value));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64Url(bytes) {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

/* ------------------------------------------------------------------ *
 * Vault store
 * ------------------------------------------------------------------ */

function getStore() {
  try {
    return JSON.parse(localStorage.getItem(VAULT_KEY) || '{}');
  } catch {
    return {};
  }
}

function setStore(store) {
  try {
    localStorage.setItem(VAULT_KEY, JSON.stringify(store));
  } catch {
    throw new Error('This browser blocked local storage, so quick login cannot be enabled.');
  }
}

function constantTimeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

export function buildAccountKey({ uid, email, username, accessMode }) {
  return [accessMode || 'general', uid || email || username || 'user'].join('|');
}

export function hasVaultEntry(accountKey) {
  return Boolean(accountKey && getStore()[accountKey]?.ciphertext);
}

export function removeVaultEntry(accountKey) {
  const store = getStore();
  delete store[accountKey];
  setStore(store);
}

/* ------------------------------------------------------------------ *
 * PIN hashing - mirrored in Firestore so a PIN can also gate the 2FA flow
 * ------------------------------------------------------------------ */

export async function hashPin(pin) {
  const value = String(pin ?? '').trim();
  if (!/^\d{4,8}$/.test(value)) throw new Error('PIN must be 4 to 8 digits.');
  const api = subtle();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await api.importKey('raw', new TextEncoder().encode(value), 'PBKDF2', false, ['deriveBits']);
  const bits = await api.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return { salt: toBase64(salt), hash: toBase64(bits) };
}

export async function verifyPinHash(pin, saltB64, hashB64) {
  if (!saltB64 || !hashB64) return false;
  const api = subtle();
  const material = await api.importKey(
    'raw',
    new TextEncoder().encode(String(pin ?? '').trim()),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await api.deriveBits(
    { name: 'PBKDF2', salt: fromBase64(saltB64), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    256
  );
  return constantTimeEqual(toBase64(bits), hashB64);
}

/* ------------------------------------------------------------------ *
 * PIN-encrypted entry
 * ------------------------------------------------------------------ */

async function derivePinKey(pin, salt) {
  const api = subtle();
  const material = await api.importKey(
    'raw',
    new TextEncoder().encode(String(pin ?? '').trim()),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return api.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypts the sign-in credential under the PIN and remembers the account on this device.
export async function saveVaultEntry({ accountKey, label, identifier, password, pin, hint }) {
  const api = subtle();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await derivePinKey(pin, salt);
  const payload = new TextEncoder().encode(JSON.stringify({ identifier, password }));
  const ciphertext = await api.encrypt({ name: 'AES-GCM', iv }, key, payload);

  const store = getStore();
  const previous = store[accountKey] || {};
  store[accountKey] = {
    ...previous,
    accountKey,
    label,
    hint: hint || '',
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    createdAt: new Date().toISOString(),
  };
  setStore(store);
  return store[accountKey];
}

// Unlocks the saved credential with the PIN typed by the user.
export async function unlockVaultWithPin(accountKey, pin) {
  const entry = getStore()[accountKey];
  if (!entry?.ciphertext) throw new Error('No saved login on this device for that account.');
  const api = subtle();
  const key = await derivePinKey(pin, fromBase64(entry.salt));
  try {
    const plaintext = await api.decrypt(
      { name: 'AES-GCM', iv: fromBase64(entry.iv) },
      key,
      fromBase64(entry.ciphertext)
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error('Incorrect PIN.');
  }
}

/* ------------------------------------------------------------------ *
 * Device key (fingerprint path)
 * ------------------------------------------------------------------ */

const DEVICE_KEY_DB = 'garmentsDeviceKeys';
const DEVICE_KEY_STORE = 'keys';
const DEVICE_KEY_ID = 'vault-wrapping-key';

function openKeyDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DEVICE_KEY_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DEVICE_KEY_STORE)) {
        request.result.createObjectStore(DEVICE_KEY_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable.'));
  });
}

function runKeyTransaction(mode, work) {
  return openKeyDb().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(DEVICE_KEY_STORE, mode);
    const request = work(transaction.objectStore(DEVICE_KEY_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB read failed.'));
    transaction.oncomplete = () => database.close();
  }));
}

// A random key for this browser profile. It is only reached after a successful
// fingerprint assertion, so a copied localStorage alone does not reveal the credential.
async function readDeviceKeyBytes() {
  try {
    const existing = await runKeyTransaction('readonly', (store) => store.get(DEVICE_KEY_ID));
    if (existing) return fromBase64(existing);
    const created = crypto.getRandomValues(new Uint8Array(32));
    await runKeyTransaction('readwrite', (store) => store.put(toBase64(created), DEVICE_KEY_ID));
    return created;
  } catch {
    throw new Error('This browser blocked local storage, so fingerprint quick login cannot be enabled.');
  }
}

/* ------------------------------------------------------------------ *
 * PRF salt
 * ------------------------------------------------------------------ */

function prfSupported() {
  return Boolean(globalThis.PublicKeyCredential && 'prf' in PublicKeyCredential.get);
}

export function supportsPrf() {
  return prfSupported();
}

export function newPrfSalt() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(PRF_SALT_BYTES)));
}

// Remembers the PRF salt so a later fingerprint assertion derives the same wrapping key.
export function setVaultPrfSalt(accountKey, prfSalt) {
  const store = getStore();
  if (!store[accountKey]) return;
  store[accountKey].prfSalt = prfSalt;
  setStore(store);
}

/* ------------------------------------------------------------------ *
 * Fingerprint unlock (WebAuthn + native)
 * ------------------------------------------------------------------ */

// Produces the decryption key, but only after a fingerprint assertion has been accepted.
async function deriveBiometricKey(accountKey, credential) {
  const entry = getStore()[accountKey];
  const api = subtle();
  if (!credential?.credentialId) {
    throw new Error('No fingerprint is registered on this device. Use your PIN or password instead.');
  }

  if (entry?.prfSalt && prfSupported()) {
    // PRF is preferred: the authenticator itself derives the wrapping key. A cancelled or
    // refused assertion must fail here rather than fall through to the device key.
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ id: fromBase64Url(credential.credentialId), type: 'public-key' }],
        userVerification: 'required',
        prf: { eval: { first: fromBase64Url(entry.prfSalt) } },
      },
    });
    if (!assertion) throw new Error('Fingerprint authentication was cancelled.');
    const prf = assertion.getClientExtensionResults?.()?.prf?.results?.first;
    if (!prf) {
      throw new Error('This device could not unlock the saved login. Use your PIN or password instead.');
    }
    return api.importKey('raw', prf, { name: 'AES-GCM' }, false, ['decrypt']);
  }

  // No PRF on this device: the assertion is still verified (origin, ceremony type, and
  // user verification) before the device key is used to read the entry.
  await authenticateBiometric(accountKey);
  return api.importKey('raw', await readDeviceKeyBytes(), { name: 'AES-GCM' }, false, ['decrypt']);
}

// Verifies the fingerprint (native or WebAuthn) and unlocks the saved credential.
export async function unlockVaultWithBiometric(accountKey, credential) {
  const entry = getStore()[accountKey];
  if (!entry?.ciphertext) throw new Error('No saved login on this device for that account.');

  if (isNativePlatform()) {
    const native = await loadNativeBiometrics();
    if (native) {
      const result = await native.authenticate({
        reason: 'Sign in to your account',
        title: 'Sign in',
        subtitle: 'Confirm it is you',
        description: 'Use your fingerprint or face to sign in.',
      });
      if (!result?.isAuthenticated) throw new Error('Biometric authentication was not successful.');
    }
  }

  const api = subtle();
  const cryptoKey = await deriveBiometricKey(accountKey, credential);
  try {
    const plaintext = await api.decrypt(
      { name: 'AES-GCM', iv: fromBase64(entry.iv) },
      cryptoKey,
      fromBase64(entry.ciphertext)
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error('Fingerprint verified, but the saved login could not be unlocked. Use your password to sign in.');
  }
}
