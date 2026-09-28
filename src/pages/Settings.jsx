import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSecurity } from '../context/SecurityContext';
import { useNavigate } from 'react-router-dom';

const TABS = [
  { key: 'privacy', label: '🔒 Privacy Policy' },
  { key: 'security', label: '🛡️ Security' },
  { key: 'password', label: '🔑 Password' },
];

export default function Settings({ section = 'privacy' }) {
  const [tab, setTab] = useState(TABS.some((item) => item.key === section) ? section : 'privacy');
  const navigate = useNavigate();

  return (
    <section className="settings-page">
      <div className="settings-header">
        <button className="btn btn-outline" onClick={() => navigate(-1)}>← Back</button>
        <h2>Settings</h2>
      </div>

      <div className="settings-tabs">
        {TABS.map((item) => (
          <button
            key={item.key}
            className={tab === item.key ? 'settings-tab active' : 'settings-tab'}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'privacy' && <PrivacyPolicy />}
      {tab === 'security' && <SecurityTab />}
      {tab === 'password' && <PasswordTab />}
    </section>
  );
}

function PrivacyPolicy() {
  return (
    <div className="settings-panel">
      <h3>Privacy Policy</h3>
      <p>Your profile data is stored in the Firebase users document for your account. Passwords are handled by Firebase Authentication and are never stored in this app.</p>
      <p>Profile information is used to personalize your account and support the production workspace.</p>
      <h4>What we store</h4>
      <ul className="settings-list">
        <li>Name, phone number, address and profile photo you enter on your Profile page.</li>
        <li>Your email address, used for sign-in and verification — it cannot be edited inside the app.</li>
        <li>Security preferences: which verification factors (PIN, fingerprint, biometrics, Face ID, 2FA) you switched on.</li>
        <li>The production data typed into each department screen, and the History log of who entered what.</li>
      </ul>
      <h4>What we never do</h4>
      <ul className="settings-list">
        <li>Your password is never readable by this app — Firebase handles it for you.</li>
        <li>Your PIN and saved sign-in are encrypted on your own device; only a hash reaches Firestore.</li>
        <li>Your biometric credential never leaves the device.</li>
      </ul>
      <h4>Who can see your data</h4>
      <p>Managers and admins can view and edit every department screen. General users get read-only access to those screens and can edit only their own Profile page (except the email address, which stays locked).</p>
    </div>
  );
}

function PasswordTab() {
  const { requestPasswordChange } = useAuth();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleRequest() {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await requestPasswordChange();
      setMessage('A password reset link is on its way to your email address. Open it on this device to set a new password.');
    } catch (resetError) {
      setError(resetError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-panel">
      <h3>Request Password Change</h3>
      <p className="hint">
        Firebase sends the reset link to your registered email address. Your old password keeps
        working until you complete the reset, and your session ends the moment you do.
      </p>
      {error && <p className="auth-error">{error}</p>}
      {message && <p className="settings-success">{message}</p>}
      <div className="settings-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={handleRequest}>
          {busy ? 'Sending…' : 'Send password reset email'}
        </button>
      </div>
    </div>
  );
}

// Each factor is an independent switch: any 1, any 2, or all of them may be on, and the
// sign-in flow enforces exactly the ones that are enabled.
const FACTOR_ROWS = [
  { key: 'twoFactor', icon: '🛡️', title: 'Two-Factor Authentication (2FA)', hint: 'Require a 6-digit code from your authenticator app after your password.' },
  { key: 'fingerprint', icon: '☝️', title: 'Fingerprint', hint: 'Confirm with the fingerprint sensor registered on this device.' },
  { key: 'biometrics', icon: '🫆', title: 'Biometrics', hint: 'Use the device biometric sensor — fingerprint, iris or Touch ID.' },
  { key: 'faceId', icon: '😀', title: 'Face ID', hint: 'Confirm with face recognition on devices that support it.' },
  { key: 'pin', icon: '🔢', title: 'PIN', hint: 'Use a 4–8 digit PIN instead of typing your password on this device.' },
];

function SecurityTab() {
  const { user } = useAuth();
  const {
    settings, biometric,
    enableTwoFactor, confirmTwoFactorSetup, disableTwoFactor,
    saveQuickLoginWithPin, setSecurityMethod, disableAllQuickLogin,
  } = useSecurity();

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState('');
  const [twoFactorUri, setTwoFactorUri] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinPassword, setPinPassword] = useState('');
  const [pinHint, setPinHint] = useState(settings.pinHint || '');

  async function run(action, successMessage) {
    setBusy(true);
    setFailure('');
    setStatus('');
    try {
      const result = await action();
      if (successMessage) setStatus(successMessage);
      return result;
    } catch (err) {
      setFailure(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  // Switching 2FA on has a confirmation step, so it is handled apart from the plain toggles.
  async function startTwoFactor() {
    const result = await run(enableTwoFactor);
    if (result) {
      setTwoFactorUri(result.uri);
      setStatus('Scan this in your authenticator app, then enter the 6-digit code below.');
    }
  }

  async function confirmTwoFactor() {
    const result = await run(() => confirmTwoFactorSetup(twoFactorCode));
    if (result) {
      setTwoFactorUri('');
      setTwoFactorCode('');
      setStatus('Two-factor authentication is now active on your account.');
    }
  }

  async function toggleFactor(row, enabled) {
    if (row.key === 'twoFactor' && enabled) {
      await startTwoFactor();
      return;
    }
    await run(
      () => setSecurityMethod(row.key, enabled),
      `${row.title} turned ${enabled ? 'on' : 'off'}.`
    );
  }

  async function savePinSettings() {
    const result = await run(() => saveQuickLoginWithPin({
      pin,
      confirmPin,
      identifier: user?.email || user?.username,
      password: pinPassword,
      hint: pinHint,
    }));
    if (result) {
      setPin('');
      setConfirmPin('');
      setPinPassword('');
      setStatus('PIN set. You can now sign in quickly with it on this device.');
    }
  }

  const enabledCount = FACTOR_ROWS.filter((row) => settings.methods?.[row.key]).length;

  return (
    <div className="settings-panel settings-security">
      <div className="settings-security-head">
        <h3>Security</h3>
        <span className="security-method">{enabledCount === 0 ? 'None active' : `${enabledCount} of ${FACTOR_ROWS.length} active`}</span>
      </div>

      <p className="hint">
        Switch on any one, any two, or all of these methods — whichever are on are the ones you are
        asked for when signing in. Your session always ends when you close the browser tab or the app.
      </p>

      {status && <p className="settings-success">{status}</p>}
      {failure && <p className="auth-error">{failure}</p>}

      <section className="security-block">
        {FACTOR_ROWS.map((row) => {
          const on = Boolean(settings.methods?.[row.key]);
          const isBiometric = row.key === 'fingerprint' || row.key === 'biometrics' || row.key === 'faceId';
          const unavailable = isBiometric && !biometric.supported && !on;
          return (
            <div className="security-row" key={row.key}>
              <div>
                <strong>{row.icon} {row.title}</strong>
                <p className="hint">
                  {row.hint}
                  {unavailable ? ` ${biometric.reason || 'This device has no biometric sensor.'}` : ''}
                </p>
              </div>
              <label className="security-switch">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy || unavailable}
                  onChange={(event) => toggleFactor(row, event.target.checked)}
                />
                <span>{on ? 'On' : 'Off'}</span>
              </label>
            </div>
          );
        })}
      </section>

      {twoFactorUri && (
        <div className="security-setup">
          <p className="hint">Add this account in Google Authenticator, Authy, or any TOTP app:</p>
          <textarea className="security-uri" readOnly rows={3} value={twoFactorUri} />
          <label className="form-field">
            <span>Enter the current 6-digit code to confirm</span>
            <input
              inputMode="numeric"
              maxLength={6}
              value={twoFactorCode}
              onChange={(event) => setTwoFactorCode(event.target.value.replace(/\D/g, ''))}
              placeholder="123456"
            />
          </label>
          <div className="settings-actions">
            <button type="button" className="btn btn-primary" disabled={busy || twoFactorCode.length !== 6} onClick={confirmTwoFactor}>
              Confirm and activate
            </button>
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => run(disableTwoFactor, 'Two-factor setup cancelled.')}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* A PIN is created once, with the account password to prove it really is you. */}
      {!settings.hasPin ? (
        <div className="security-setup">
          <p className="hint">
            To switch the PIN method on, create a PIN first. It encrypts your sign-in on this device.
          </p>
          <div className="settings-grid">
            <label className="form-field"><span>New PIN (4-8 digits)</span><input type="password" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" /></label>
            <label className="form-field"><span>Confirm PIN</span><input type="password" inputMode="numeric" maxLength={8} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" /></label>
            <label className="form-field settings-wide"><span>Confirm your account password</span><input type="password" value={pinPassword} onChange={(e) => setPinPassword(e.target.value)} placeholder="Your account password" /></label>
            <label className="form-field settings-wide"><span>PIN hint (optional)</span><input value={pinHint} onChange={(e) => setPinHint(e.target.value)} placeholder="e.g. last 2 digits of your phone" /></label>
          </div>
          <div className="settings-actions">
            <button type="button" className="btn btn-primary" disabled={busy || !pin || !confirmPin || !pinPassword} onClick={savePinSettings}>
              Create PIN
            </button>
          </div>
        </div>
      ) : (
        <div className="settings-setup">
          {settings.pinHint && <p className="hint">PIN hint: {settings.pinHint}</p>}
          <div className="settings-actions">
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => run(disableAllQuickLogin, 'All security methods turned off and the saved sign-in was deleted from this device.')}>
              Turn everything off
            </button>
          </div>
        </div>
      )}

      {settings.twoFactorEnabled && settings.twoFactorSecret && (
        <p className="hint">
          Keep your authenticator app accessible. Without it you would need a manager to reset 2FA.
        </p>
      )}
      <details className="security-help">
        <summary>How this protects your account</summary>
        <ul>
          <li>Closing the tab or the app signs you out immediately — the session is not kept.</li>
          <li>Your PIN and saved sign-in are encrypted on this device; Firestore only stores a hash.</li>
          <li>Turning a method off deletes the stored secret from both Firestore and this device.</li>
        </ul>
      </details>
    </div>
  );
}

