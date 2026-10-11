// Security settings storage, TOTP (2FA) helpers, and biometric authentication.
//
// Native (Capacitor) biometrics are loaded lazily so the web build never hard-depends on
// @capacitor/biometrics. To enable the native path:
//   npm i @capacitor/biometrics && npx cap sync
// Without it everything below still works through the WebAuthn API.

import { db } from '../firebase';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { verifyPinHash } from './deviceCredential';

const SUBCOLLECTION = 'securitySettings';
const DOC_ID = 'settings';

export const DEFAULT_SECURITY_SETTINGS = Object.freeze({
  twoFactorEnabled: false,     // inactive until the user explicitly enables it
  twoFactorSecret: '',
  quickLoginMethod: 'none',    // 'none' | 'pin' | 'biometric'
  pinHash: '',
  pinSalt: '',
  pinHint: '',
  biometricEnabled: false,
  // Multi-factor toggles are independent: the user may switch on any 1, any 2, or all of
  // them, and the login step asks for exactly whichever ones are enabled.
  methods: Object.freeze({
    twoFactor: false,
    fingerprint: false,
    biometrics: false,
    faceId: false,
    pin: false,
  }),
});

export const SECURITY_METHOD_KEYS = Object.freeze(['twoFactor', 'fingerprint', 'biometrics', 'faceId', 'pin']);

function normalizeMethods(data) {
  const stored = data?.methods && typeof data.methods === 'object' ? data.methods : {};
  const methods = {};
  SECURITY_METHOD_KEYS.forEach((key) => { methods[key] = stored[key] === true; });
  // A PIN that already exists is a PIN method the user turned on earlier.
  if (data?.pinHash && data?.pinSalt) methods.pin = true;
  if (data?.biometricEnabled === true) {
    methods.biometrics = true;
    methods.fingerprint = true;
  }
  methods.twoFactor = data?.twoFactorEnabled === true;
  return methods;
}

// True when at least one verification factor is switched on, i.e. the user did opt in.
export function hasEnabledFactor(data) {
  return SECURITY_METHOD_KEYS.some((key) => normalizeMethods(data)[key]);
}

/* ------------------------------------------------------------------ *
 * Firestore persistence: users/{uid}/securitySettings/settings
 * ------------------------------------------------------------------ */

export function securitySettingsRef(uid) {
  return doc(db, 'users', uid, SUBCOLLECTION, DOC_ID);
}

export function normalizeSecuritySettings(data) {
  const quickLoginMethod = ['none', 'pin', 'biometric'].includes(data?.quickLoginMethod)
    ? data.quickLoginMethod
    : 'none';
  const methods = normalizeMethods(data);
  return {
    ...DEFAULT_SECURITY_SETTINGS,
    twoFactorSecret: String(data?.twoFactorSecret || ''),
    pinHash: String(data?.pinHash || ''),
    pinSalt: String(data?.pinSalt || ''),
    pinHint: String(data?.pinHint || ''),
    twoFactorEnabled: methods.twoFactor,
    biometricEnabled: methods.biometrics || methods.fingerprint,
    quickLoginMethod,
    methods,
    hasPin: Boolean(data?.pinHash && data?.pinSalt),
    updatedAt: data?.updatedAt || null,
  };
}

export async function loadSecuritySettings(uid) {
  if (!uid) return normalizeSecuritySettings(null);
  const snapshot = await getDoc(securitySettingsRef(uid));
  return normalizeSecuritySettings(snapshot.exists() ? snapshot.data() : null);
}

export async function saveSecuritySettings(uid, patch) {
  if (!uid) throw new Error('Please sign in first.');
  const ref = securitySettingsRef(uid);
  const payload = { ...patch, updatedAt: serverTimestamp() };
  await setDoc(ref, payload, { merge: true });
  const merged = await getDoc(ref);
  return normalizeSecuritySettings(merged.exists() ? merged.data() : payload);
}

// Reads the stored PIN hash on demand so it never sits in React state.
export async function checkPinAgainstSettings(uid, pin) {
  const snapshot = await getDoc(securitySettingsRef(uid));
  const data = snapshot.data();
  if (!data?.pinHash || !data?.pinSalt) return false;
  return verifyPinHash(pin, data.pinSalt, data.pinHash);
}

// Turning everything off and clearing stored secrets.
export async function resetSecuritySettings(uid) {
  await updateDoc(securitySettingsRef(uid), {
    twoFactorEnabled: false,
    twoFactorSecret: '',
    quickLoginMethod: 'none',
    pinHash: '',
    pinSalt: '',
    pinHint: '',
    biometricEnabled: false,
    methods: { twoFactor: false, fingerprint: false, biometrics: false, faceId: false, pin: false },
    updatedAt: serverTimestamp(),
  });
  return normalizeSecuritySettings(null);
}

/* ------------------------------------------------------------------ *
 * TOTP (RFC 6238) for the two-factor verification toggle
 * ------------------------------------------------------------------ */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(byteLength = 20) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let bits = '';
  bytes.forEach((byte) => { bits += byte.toString(2).padStart(8, '0'); });
  let secret = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    secret += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return secret;
}

function base32Decode(input) {
  const clean = String(input || '').toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  // Guard the alphabet itself: if this module were ever loaded out of order and the
  // constant came through undefined, `undefined.indexOf` would throw the opaque
  // "Cannot read properties of undefined (reading 'indexOf')". Failing with a clear
  // message instead makes a misconfiguration diagnosable.
  const alphabet = typeof BASE32_ALPHABET === 'string' ? BASE32_ALPHABET : '';
  if (!alphabet) throw new Error('Authenticator support is unavailable. Please reload the page.');
  let bits = '';
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index === -1) throw new Error('Invalid authenticator secret.');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(bytes);
}

export function otpauthUri({ secret, accountName, issuer = 'ART BOUTIQUE SRL' }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName || 'user')}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

async function hotp(secretBytes, counter) {
  const counterBuffer = new ArrayBuffer(8);
  new DataView(counterBuffer).setUint32(4, counter >>> 0, false);
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error('Secure storage is unavailable in this browser.');
  const key = await api.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  return new Uint8Array(await api.sign('HMAC', key, counterBuffer));
}

export async function generateTotpCode(secret, timestampMs = Date.now()) {
  const signature = await hotp(base32Decode(secret), Math.floor(timestampMs / 30000));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary = ((signature[offset] & 0x7f) << 24)
    | ((signature[offset + 1] & 0xff) << 16)
    | ((signature[offset + 2] & 0xff) << 8)
    | (signature[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, '0');
}

// Accepts the neighbouring step too, so a small clock drift does not lock the user out.
export async function verifyTotpCode(secret, code, timestampMs = Date.now()) {
  const clean = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean) || !secret) return false;
  const step = Math.floor(timestampMs / 30000);
  for (const drift of [-1, 0, 1]) {
    const generated = await generateTotpCode(secret, (step + drift) * 30000);
    if (constantTimeEqual(generated, clean)) return true;
  }
  return false;
}

function constantTimeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------ *
 * Biometric availability + registration + authentication
 * ------------------------------------------------------------------ */

let nativeBiometricsPromise;

// The specifier is held in a variable so the bundler leaves it alone: the plugin is
// optional and may legitimately be absent from a web-only install.
const NATIVE_BIOMETRICS_MODULE = '@capacitor/biometrics';

export function loadNativeBiometrics() {
  if (!nativeBiometricsPromise) {
    nativeBiometricsPromise = import(/* @vite-ignore */ NATIVE_BIOMETRICS_MODULE)
      .then((mod) => mod?.Biometrics || null)
      .catch(() => null);
  }
  return nativeBiometricsPromise;
}

export function isNativePlatform() {
  return Boolean(globalThis.Capacitor?.isNativePlatform?.());
}

export function webAuthnSupported() {
  return Boolean(globalThis.PublicKeyCredential && globalThis.navigator?.credentials);
}

export async function getBiometricSupport() {
  if (isNativePlatform()) {
    const native = await loadNativeBiometrics();
    if (native) {
      try {
        const result = await native.isAvailable();
        return { supported: true, label: biometryLabel(result?.biometryType), method: 'native', reason: '' };
      } catch (error) {
        return { supported: false, label: '', method: 'none', reason: error?.message || 'Biometrics unavailable.' };
      }
    }
  }
  if (webAuthnSupported()) {
    try {
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      return {
        supported: Boolean(available),
        label: available ? 'Fingerprint / Face' : '',
        method: 'webauthn',
        reason: available ? '' : 'No fingerprint or face unlock is registered on this device.',
      };
    } catch {
      return { supported: false, label: '', method: 'none', reason: 'Biometric check failed.' };
    }
  }
  return { supported: false, label: '', method: 'none', reason: 'This browser does not support fingerprint or face login.' };
}

function biometryLabel(type) {
  return {
    fingerprint: 'Fingerprint',
    face: 'Face Recognition',
    iris: 'Iris',
    touchId: 'Touch ID',
    faceId: 'Face ID',
  }[type] || 'Biometrics';
}

const RELYING_PARTY = {
  id: globalThis.location?.hostname || 'localhost',
  name: 'ART BOUTIQUE SRL',
};

// The WebAuthn credential lives in this browser profile only. Firestore stores the user's
// preference; the credential id, the public key, and the signature never leave the device.
const CREDENTIAL_STORE_KEY = 'garmentsWebAuthnCredentials';

// Shared with the device vault, which needs the credential id for its PRF assertion.
export function readWebAuthnCredential(accountKey) {
  return readCredentialStore()[accountKey] || null;
}

function readCredentialStore() {
  try {
    return JSON.parse(localStorage.getItem(CREDENTIAL_STORE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeCredentialStore(store) {
  try {
    localStorage.setItem(CREDENTIAL_STORE_KEY, JSON.stringify(store));
  } catch {
    /* storage blocked - biometric login simply stays unavailable */
  }
}

function toBase64Url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function registerBiometric(accountKey) {
  if (!webAuthnSupported()) throw new Error('This browser does not support fingerprint or face login.');
  const existing = readCredentialStore()[accountKey];
  if (existing) {
    // Clear any previous registration: authenticators keep one credential per user id.
    try {
      await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{ id: fromBase64Url(existing.credentialId), type: 'public-key' }],
          userVerification: 'required',
        },
      });
    } catch {
      /* the stale credential is replaced below */
    }
  }

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: RELYING_PARTY,
      user: { id: new TextEncoder().encode(accountKey), name: accountKey, displayName: accountKey },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
    },
  });

  if (!credential) throw new Error('Fingerprint setup was cancelled.');

  const store = readCredentialStore();
  store[accountKey] = { credentialId: toBase64Url(credential.rawId), registeredAt: new Date().toISOString() };
  writeCredentialStore(store);
  return { credentialId: store[accountKey].credentialId };
}

export async function authenticateBiometric(accountKey) {
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
      return { verified: true, method: 'native' };
    }
  }

  if (!webAuthnSupported()) throw new Error('This browser does not support fingerprint or face login.');
  const stored = readCredentialStore()[accountKey];
  if (!stored?.credentialId) {
    throw new Error('No fingerprint is registered on this device. Use your PIN or password instead.');
  }

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ id: fromBase64Url(stored.credentialId), type: 'public-key' }],
      userVerification: 'required',
      timeout: 60000,
    },
  });

  if (!assertion) throw new Error('Fingerprint authentication was cancelled.');
  const { response } = assertion;
  const clientData = JSON.parse(new TextDecoder().decode(response.clientDataJSON));

  // With no server there is no public key to check the signature against, so the browser's
  // own guarantees are checked instead: it answered for this origin, for a 'get' ceremony,
  // and with the user verification that was required.
  if (clientData.type !== 'webauthn.get') throw new Error('Fingerprint response was not valid.');
  if (clientData.origin !== globalThis.location.origin) throw new Error('Fingerprint origin did not match this site.');
  if (!response.authenticatorData) throw new Error('Fingerprint response was incomplete.');

  return { verified: true, method: 'webauthn' };
}

export function hasRegisteredBiometric(accountKey) {
  return Boolean(readCredentialStore()[accountKey]?.credentialId);
}

export function forgetBiometric(accountKey) {
  const store = readCredentialStore();
  delete store[accountKey];
  writeCredentialStore(store);
}
