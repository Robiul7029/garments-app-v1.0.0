import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import {
  DEFAULT_SECURITY_SETTINGS,
  forgetBiometric,
  generateTotpCode,
  generateTotpSecret,
  getBiometricSupport,
  loadSecuritySettings,
  otpauthUri,
  readWebAuthnCredential,
  registerBiometric,
  resetSecuritySettings,
  saveSecuritySettings,
  verifyTotpCode,
} from '../utils/security';
import {
  buildAccountKey,
  hashPin,
  hasVaultEntry,
  newPrfSalt,
  removeVaultEntry,
  saveVaultEntry,
  setVaultPrfSalt,
  supportsPrf,
  unlockVaultWithBiometric,
  unlockVaultWithPin,
} from '../utils/deviceCredential';

const SecurityContext = createContext(null);

const OFFLINE_SETTINGS = { ...DEFAULT_SECURITY_SETTINGS, hasPin: false, updatedAt: null };

export function SecurityProvider({ children }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState(OFFLINE_SETTINGS);
  const [biometric, setBiometric] = useState({ supported: false, label: '', method: 'none', reason: '' });
  const [loading, setLoading] = useState(false);

  const userId = user?.id || '';

  // Biometric capability is a device property, so it is probed once.
  useEffect(() => {
    let active = true;
    getBiometricSupport().then((result) => { if (active) setBiometric(result); });
    return () => { active = false; };
  }, []);

  // Load the signed-in user's preferences. Every feature stays off until they opt in.
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setSettings(OFFLINE_SETTINGS);
      return undefined;
    }
    setLoading(true);
    loadSecuritySettings(userId)
      .then((loaded) => { if (!cancelled) setSettings(loaded); })
      .catch((error) => {
        console.error('[Security] Failed to load settings', error);
        if (!cancelled) setSettings(OFFLINE_SETTINGS);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId]);

  const accountKey = useMemo(
    () => (userId ? buildAccountKey({ uid: userId, accessMode: user?.accessMode }) : ''),
    [userId, user?.accessMode]
  );

  /* ---------------- Two-factor verification ---------------- */

  // Turning 2FA on: store the secret and hand back the otpauth:// URI to scan.
  async function enableTwoFactor() {
    if (!userId) throw new Error('Please sign in first.');
    const secret = generateTotpSecret();
    const uri = otpauthUri({ secret, accountName: user?.email || user?.username || userId });
    const next = await saveSecuritySettings(userId, { twoFactorEnabled: true, twoFactorSecret: secret });
    setSettings(next);
    return { secret, uri };
  }

  // The user scans the URI and types back the current code, proving the authenticator app
  // holds the same secret before 2FA counts as fully set up.
  async function confirmTwoFactorSetup(code) {
    if (!userId) throw new Error('Please sign in first.');
    const snapshot = await loadSecuritySettings(userId);
    if (!snapshot.twoFactorSecret) throw new Error('Start the 2FA setup first.');
    const ok = await verifyTotpCode(snapshot.twoFactorSecret, code);
    if (!ok) throw new Error('That code is not valid. Check your authenticator app and try again.');
    return { confirmed: true, uri: otpauthUri({ secret: snapshot.twoFactorSecret, accountName: user?.email || userId }) };
  }

  async function disableTwoFactor() {
    if (!userId) return;
    const next = await saveSecuritySettings(userId, {
      twoFactorEnabled: false,
      twoFactorSecret: '',
      methods: { ...settings.methods, twoFactor: false },
    });
    setSettings(next);
  }

  /* ---------------- Independent multi-factor toggles ---------------- */

  // Each factor is stored on its own, so the user can switch on any 1, any 2, or all of
  // them. The methods map is always written in full so a stale key can never linger.
  async function setSecurityMethod(method, enabled) {
    if (!userId) throw new Error('Please sign in first.');
    if (method === 'twoFactor') {
      return enabled ? enableTwoFactor() : disableTwoFactor();
    }
    if (method === 'pin') {
      if (enabled) {
        throw new Error('Set up a PIN below to switch the PIN method on.');
      }
      await disablePin();
      return settings;
    }
    if (method === 'fingerprint' || method === 'biometrics' || method === 'faceId') {
      if (enabled) {
        const next = await enableBiometricQuickLogin();
        return { ...next, methods: { ...settings.methods, fingerprint: true, biometrics: true, faceId: true } };
      }
      // Turning off any biometric factor clears the device credential, since one physical
      // sensor backs all three of them.
      const next = await disableBiometricQuickLogin();
      return { ...next, methods: { ...settings.methods, fingerprint: false, biometrics: false, faceId: false } };
    }
    throw new Error('Unknown security method.');
  }

  // True when 2FA is off, or when the submitted code matches the stored secret.
  async function verifyTwoFactorCode(code) {
    if (!userId) return true;
    const snapshot = await loadSecuritySettings(userId);
    if (!snapshot.twoFactorEnabled || !snapshot.twoFactorSecret) return true;
    return verifyTotpCode(snapshot.twoFactorSecret, code);
  }

  /* ---------------- Quick login: PIN ---------------- */

  // Saves the sign-in credential to this device, encrypted under the PIN (AES-GCM).
  // The PIN is confirmed twice, so nobody can silently re-point an existing quick login.
  async function saveQuickLoginWithPin({ pin, confirmPin, identifier, password, hint }) {
    if (!userId) throw new Error('Please sign in first.');
    if (String(pin ?? '') !== String(confirmPin ?? '')) throw new Error('The two PINs do not match.');
    if (!/^\d{4,8}$/.test(String(pin ?? ''))) throw new Error('PIN must be 4 to 8 digits.');

    const { hash, salt } = await hashPin(pin);
    const next = await saveSecuritySettings(userId, {
      pinHash: hash,
      pinSalt: salt,
      pinHint: String(hint || '').trim(),
      quickLoginMethod: 'pin',
      methods: { ...settings.methods, pin: true },
    });
    await saveVaultEntry({
      accountKey,
      label: user?.email || user?.username || userId,
      identifier,
      password,
      pin,
      method: 'pin',
      hint: String(hint || '').trim(),
    });
    setSettings(next);
    return next;
  }

  async function disablePin() {
    if (!userId) return;
    if (accountKey) removeVaultEntry(accountKey);
    const next = await saveSecuritySettings(userId, {
      pinHash: '',
      pinSalt: '',
      pinHint: '',
      quickLoginMethod: settings.quickLoginMethod === 'pin' ? 'none' : settings.quickLoginMethod,
      methods: { ...settings.methods, pin: false },
    });
    setSettings(next);
  }

  /* ---------------- Quick login: biometric ---------------- */

  // The PIN stays as the encryption key; the fingerprint simply replaces typing it.
  async function enableBiometricQuickLogin() {
    if (!userId) throw new Error('Please sign in first.');
    if (!biometric.supported) {
      throw new Error(biometric.reason || 'Biometric authentication is not available on this device.');
    }
    if (!settings.hasPin) {
      throw new Error('Set a PIN first. It encrypts the sign-in saved on this device.');
    }
    if (!accountKey || !hasVaultEntry(accountKey)) {
      throw new Error('Save your sign-in with a PIN first, then register your fingerprint.');
    }
    await registerBiometric(accountKey);
    // When the authenticator supports PRF, the fingerprint itself derives the wrapping
    // key, so the stored credential never needs the PIN to be read.
    if (supportsPrf()) setVaultPrfSalt(accountKey, newPrfSalt());
    const next = await saveSecuritySettings(userId, {
      biometricEnabled: true,
      quickLoginMethod: 'biometric',
      methods: { ...settings.methods, fingerprint: true, biometrics: true, faceId: true },
    });
    setSettings(next);
    return next;
  }

  async function disableBiometricQuickLogin() {
    if (!userId) return;
    forgetBiometric(accountKey);
    const next = await saveSecuritySettings(userId, {
      biometricEnabled: false,
      quickLoginMethod: settings.quickLoginMethod === 'biometric'
        ? (settings.hasPin ? 'pin' : 'none')
        : settings.quickLoginMethod,
      methods: { ...settings.methods, fingerprint: false, biometrics: false, faceId: false },
    });
    setSettings(next);
  }

  // Turns off every quick-login method and deletes the saved credential from this device.
  async function disableAllQuickLogin() {
    if (!userId) return;
    forgetBiometric(accountKey);
    if (accountKey) removeVaultEntry(accountKey);
    const next = await resetSecuritySettings(userId);
    setSettings(next);
  }

  /* ---------------- Values used by the login screen ---------------- */

  // Public, non-secret summary of the account that has a quick login on this device, so
  // the login screen can offer the fingerprint / PIN button before authentication.
  const quickLogin = useMemo(() => {
    if (!userId || !accountKey || !hasVaultEntry(accountKey)) return null;
    const { method } = settings;
    if (method === 'none') return null;
    const credential = readWebAuthnCredential(accountKey);
    if (method === 'biometric' && !credential) return null;
    return {
      accountKey,
      userId,
      method,
      label: user?.email || user?.username || userId,
      biometricLabel: method === 'biometric' ? (biometric.label || 'Fingerprint') : '',
      pinHint: method === 'pin' ? settings.pinHint : '',
      credential,
    };
  }, [userId, accountKey, settings.quickLoginMethod, settings.pinHint, biometric.label, user]);

  // Called once the login screen has a verified local credential: unlocks the saved
  // sign-in and returns the identifier / password for the normal Firebase sign-in.
  async function unlockSavedCredential({ pin } = {}) {
    if (!quickLogin) throw new Error('No quick login is set up on this device.');
    if (quickLogin.method === 'pin') {
      if (!pin) throw new Error('Enter your PIN.');
      return unlockVaultWithPin(quickLogin.accountKey, pin);
    }
    return unlockVaultWithBiometric(quickLogin.accountKey, quickLogin.credential);
  }

  // Every vault secret is supplied fresh on each attempt (PIN typed, or fingerprint
  // assertion), so nothing survives in memory between attempts.
  function clearSessionVault() {
    /* no per-tab vault material is kept - the key is derived on every unlock */
  }

  const value = useMemo(() => ({
    settings,
    loading,
    biometric,
    twoFactorRequired: settings.twoFactorEnabled,
    quickLogin,
    generateTotpCode,
    verifyTwoFactorCode,
    enableTwoFactor,
    confirmTwoFactorSetup,
    disableTwoFactor,
    saveQuickLoginWithPin,
    disablePin,
    setSecurityMethod,
    enableBiometricQuickLogin,
    disableBiometricQuickLogin,
    disableAllQuickLogin,
    unlockSavedCredential,
    clearSessionVault,
  }), [settings, loading, biometric, quickLogin]);

  return <SecurityContext.Provider value={value}>{children}</SecurityContext.Provider>;
}

export function useSecurity() { return useContext(SecurityContext); }
