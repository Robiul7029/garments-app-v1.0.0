import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSecurity } from '../context/SecurityContext';

export default function AuthScreen() {
  const { login, signup, signupManager, verifyEmail, loginManager, loginWithIdentifier, authHint, sendPasswordReset } = useAuth();
  // 2FA, PIN, and fingerprint state. All of it is inactive until the user enables it in
  // Security Settings, so the screen looks and behaves exactly as before by default.
  const { quickLogin, verifyTwoFactorCode, unlockSavedCredential } = useSecurity();
  const [topTab, setTopTab] = useState(authHint || 'signin');
  const [managerMode, setManagerMode] = useState('create');
  const [step, setStep] = useState('form');
  const [email, setEmail] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [sentCode, setSentCode] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [verificationKind, setVerificationKind] = useState('user');
  const [error, setError] = useState('');

  // Quick-login (fingerprint / PIN) and the post-password 2FA step.
  const [quickBusy, setQuickBusy] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [twoFactorFor, setTwoFactorFor] = useState(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');

  // Forgot-password flow, shown underneath the sign-in form.
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotNotice, setForgotNotice] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('verify');
    const emailFromQuery = params.get('email');
    if (!token) return;

    const pending = JSON.parse(sessionStorage.getItem('pendingVerificationAuth') || 'null');
    const pendingEmail = pending?.email || emailFromQuery || '';
    const pendingPassword = pending?.password || '';

    const completeVerification = async () => {
      try {
        const verification = await verifyEmail('', token, pendingEmail, pendingPassword);
        const isManagerRegistration = pending?.kind === 'manager'
          || localStorage.getItem('registrationType') === 'manager'
          || verification.kind === 'manager';
        redirectAfterVerification(isManagerRegistration, pending?.username || '', pendingEmail);
        setStep('form');
        setPassword('');
        setCode('');
        setError('');
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (err) {
        setError(err.message);
      }
    };

    completeVerification();
  }, [verifyEmail]);

  function redirectAfterVerification(isManagerRegistration, registeredUsername, registeredEmail) {
    if (isManagerRegistration) {
      setTopTab('manager');
      setManagerMode('signin');
      setIdentifier(registeredUsername);
    } else {
      setTopTab('signin');
      setManagerMode('create');
      setIdentifier(registeredEmail);
    }
    localStorage.removeItem('registrationType');
  }

  function resetForm() {
    setEmail(''); setIdentifier(''); setPassword(''); setUsername(''); setCode(''); setSentCode(''); setVerificationToken(''); setVerificationKind('user'); setError('');
  }

  // Runs the password sign-in and, when the account has 2FA on, asks for the 6-digit code
  // before letting the session through.
  async function signInWithTwoFactor(signIn) {
    try {
      await signIn();
    } catch (err) {
      if (err?.requiresTwoFactor) {
        setTwoFactorFor({ signIn, message: err.message });
        return;
      }
      throw err;
    }
  }

  async function handleSignIn(e) {
    e.preventDefault();
    setError('');
    try {
      // Accepts an email OR a User ID: `loginWithIdentifier` routes to the ordinary account
      // path for an address and to the manager lookup for a User ID, so a manager or staff
      // member reaches their dashboard without choosing the right tab first.
      await signInWithTwoFactor(() => loginWithIdentifier(identifier, password));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleManagerSignIn(e) {
    e.preventDefault();
    setError('');
    try {
      await signInWithTwoFactor(() => loginManager(identifier, password));
    } catch (err) {
      setError(err.message);
    }
  }

  // Submits the authenticator code for a sign-in that is waiting on 2FA.
  async function handleTwoFactorSubmit(e) {
    e.preventDefault();
    if (!twoFactorFor) return;
    setError('');
    try {
      const ok = await verifyTwoFactorCode(twoFactorCode);
      if (!ok) {
        setError('That code is not valid. Check your authenticator app and try again.');
        return;
      }
      const pending = twoFactorFor;
      setTwoFactorFor(null);
      setTwoFactorCode('');
      await pending.signIn();
    } catch (err) {
      setError(err.message);
    }
  }

  function cancelTwoFactor() {
    setTwoFactorFor(null);
    setTwoFactorCode('');
    setError('');
  }

  // Fingerprint / PIN quick login: unlock the saved sign-in on this device, then run the
  // normal sign-in. Any failure falls back to the password form above.
  async function handleQuickLogin() {
    if (!quickLogin) return;
    setQuickBusy(true);
    setError('');
    try {
      const { identifier: savedIdentifier, password: savedPassword } = await unlockSavedCredential({
        pin: quickLogin.method === 'pin' ? pinValue : undefined,
      });
      setPinValue('');
      setShowPin(false);
      const signIn = quickLogin.method === 'pin'
        ? () => login(savedIdentifier, savedPassword)
        : () => login(savedIdentifier, savedPassword);
      await signInWithTwoFactor(signIn);
    } catch (err) {
      setError(err.message);
    } finally {
      setQuickBusy(false);
    }
  }

  function switchTopTab(tab) {
    setTopTab(tab); setManagerMode('create'); setStep('form'); resetForm();
  }

  function openForgotPassword() {
    setForgotNotice('');
    setError('');
    // Pre-fill with whatever email was typed on the form, so it is usually one tap. A
    // manager User ID is not an address, so it is never pre-filled here.
    const typed = String(identifier || '').trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed)) setForgotEmail(typed);
    setForgotOpen(true);
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    setError('');
    setForgotNotice('');
    try {
      await sendPasswordReset(forgotEmail);
      setForgotNotice(`Password reset link sent to ${forgotEmail.trim()}. Please check your inbox.`);
    } catch (resetError) {
      setError(resetError.message);
    }
  }

  // Shown in both the Sign In tab and the Manager Access sign-in form, right under the
  // password field. Kept as its own component because it holds a <form> of its own and
  // therefore cannot be nested inside the sign-in <form>.
  function forgotPasswordBlock() {
    return (
      <>
        <div className="auth-forgot-row">
          <button type="button" className="auth-text-button" onClick={openForgotPassword}>Forgot Password?</button>
        </div>
        {forgotOpen && (
          <ForgotPasswordForm
            email={forgotEmail}
            notice={forgotNotice}
            onEmailChange={setForgotEmail}
            onSubmit={handleForgotPassword}
            onClose={() => { setForgotOpen(false); setForgotNotice(''); }}
          />
        )}
      </>
    );
  }

  async function handleSignup(e) {
    e.preventDefault();
    setError('');
    try {
      const verification = await signup(email, password);
      localStorage.setItem('registrationType', 'general');
      setVerificationKind('user');
      setSentCode(verification.code);
      setVerificationToken(verification.token);
      setStep('verify');
    } catch (err) { setError(err.message); }
  }

  async function handleManagerCreate(e) {
    e.preventDefault();
    setError('');
    try {
      const verification = await signupManager(username, email, password);
      localStorage.setItem('registrationType', 'manager');
      setVerificationKind('manager');
      setSentCode(verification.code);
      setVerificationToken(verification.token);
      setStep('verify');
    } catch (err) { setError(err.message); }
  }

  async function handleVerify(e) {
    e.preventDefault();
    setError('');
    try {
      const verification = await verifyEmail(code, '', email, password);
      const isManagerRegistration = verificationKind === 'manager'
        || localStorage.getItem('registrationType') === 'manager'
        || verification.kind === 'manager';
      redirectAfterVerification(isManagerRegistration, username.trim().toLowerCase(), email);
      setStep('form');
      setPassword('');
      setCode('');
    } catch (err) { setError(err.message); }
  }

  async function handleUserVerify(e) {
    e.preventDefault();
    setError('');
    try {
      const verification = await verifyEmail(code, '', email, password);
      redirectAfterVerification(false, '', email);
      setStep('form');
      setPassword('');
      setCode('');
      setIdentifier(email);
    } catch (err) { setError(err.message); }
  }

  function goToManagerSignIn() {
    setManagerMode('signin');
    setStep('form');
    setPassword('');
    setCode('');
    setError('');
    setIdentifier(username);
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-logo">AB</div>
          <div className="brand-name">ART BOUTIQUE SRL</div>
        </div>

        <div className="auth-tabs">
          <button className={topTab === 'signin' ? 'auth-tab active' : 'auth-tab'} onClick={() => switchTopTab('signin')}>Sign In</button>
          <button className={topTab === 'signup' ? 'auth-tab active' : 'auth-tab'} onClick={() => switchTopTab('signup')}>Create Account</button>
          <button className={topTab === 'manager' ? 'auth-tab active' : 'auth-tab'} onClick={() => switchTopTab('manager')}>Manager Access</button>
        </div>

        {topTab === 'signin' && (
          <form className="auth-form" onSubmit={handleSignIn}>
            {/* One field for both kinds of account: an email address signs in as an
                ordinary account, a User ID signs in through the manager lookup. Typed as
                plain text (not `type="email"`) because a User ID is not an address. */}
            <label className="form-field"><span>Email address or User ID</span><input required value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="your@email.com or User ID" /></label>
            <label className="form-field"><span>Password</span><input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" /></label>
            {forgotPasswordBlock()}
            {error && <p className="auth-error">{error}</p>}
            <button type="submit" className="btn btn-primary auth-submit">Sign In</button>
            {quickLogin && (
              <QuickLoginPanel
                quickLogin={quickLogin}
                busy={quickBusy}
                pinValue={pinValue}
                showPin={showPin}
                onPinChange={setPinValue}
                onTogglePin={() => setShowPin((open) => !open)}
                onSubmit={handleQuickLogin}
              />
            )}
            <button type="button" className="auth-text-button" onClick={() => switchTopTab('signup')}>
              Don’t have an account? Create one
            </button>
          </form>
        )}

        {topTab === 'signup' && step === 'form' && (
          <form className="auth-form" onSubmit={handleSignup}>
            <label className="form-field"><span>Email</span><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" /></label>
            <label className="form-field"><span>Password</span><input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" /></label>
            {error && <p className="auth-error">{error}</p>}
            <button type="submit" className="btn btn-primary auth-submit">Create Account</button>
            <button type="button" className="auth-text-button" onClick={() => switchTopTab('signin')}>
              Already have an account? Sign in
            </button>
          </form>
        )}
        {topTab === 'signup' && step === 'verify' && (
          <form className="auth-form" onSubmit={handleUserVerify}>
            <p className="hint">Please check your spam mail. You can verify with the 6-digit code below, or click the verification link in your email.</p>
            <label className="form-field"><span>6-digit verification code</span><input required inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" /></label>
            {error && <p className="auth-error">{error}</p>}
            <button type="submit" className="btn btn-primary auth-submit">Verify Email</button>
          </form>
        )}
        {topTab === 'signup' && step === 'verified' && (
          <div className="auth-status">
            <div className="auth-status-icon">✅</div>
            <p>Your email has been verified. You can now sign in.</p>
            <button className="btn btn-primary auth-submit" onClick={() => switchTopTab('signin')}>Go to Sign In</button>
          </div>
        )}

        {topTab === 'manager' && (
          <>
            <div className="auth-subtabs">
              <button className={managerMode === 'create' ? 'auth-subtab active' : 'auth-subtab'} onClick={() => { setManagerMode('create'); setStep('form'); resetForm(); }}>Create Account</button>
              <button className={managerMode === 'signin' ? 'auth-subtab active' : 'auth-subtab'} onClick={() => { setManagerMode('signin'); setStep('form'); resetForm(); }}>Sign In</button>
            </div>

            {managerMode === 'create' && step === 'form' && (
              <form className="auth-form" onSubmit={handleManagerCreate}>
                <label className="form-field"><span>Username</span><input required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Your name" /></label>
                <label className="form-field"><span>Email</span><input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" /></label>
                <label className="form-field"><span>Password</span><input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters, letters + numbers" /></label>
                {error && <p className="auth-error">{error}</p>}
                <button type="submit" className="btn btn-primary auth-submit">Create Manager Account</button>
                <button type="button" className="auth-text-button" onClick={() => { setManagerMode('signin'); setStep('form'); resetForm(); }}>
                  Already created an account? Sign in
                </button>
              </form>
            )}
            {managerMode === 'create' && step === 'verify' && (
              <form className="auth-form" onSubmit={handleVerify}>
                <p className="hint">
                  Please check your spam mail. Use the 6-digit code below, or click the verification link in your email.
                </p>
                <label className="form-field"><span>Verification Code</span><input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" /></label>
                {error && <p className="auth-error">{error}</p>}
                <button type="submit" className="btn btn-primary auth-submit">Verify Email</button>
              </form>
            )}
            {managerMode === 'create' && step === 'verified' && (
              <div className="auth-status">
                <div className="auth-status-icon">✅</div>
                <p>Your Gmail has been verified.</p>
                <p className="hint">Please sign in with the username and password you just created.</p>
                <button className="btn btn-primary auth-submit" onClick={goToManagerSignIn}>Go to Sign In</button>
              </div>
            )}

            {managerMode === 'signin' && (
              <form className="auth-form" onSubmit={handleManagerSignIn}>
                <label className="form-field"><span>User ID</span><input required value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Your manager user ID" /></label>
                <label className="form-field"><span>Password</span><input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" /></label>
                {forgotPasswordBlock()}
                {error && <p className="auth-error">{error}</p>}
                <button type="submit" className="btn btn-primary auth-submit">Sign In</button>
                {quickLogin && (
                  <QuickLoginPanel
                    quickLogin={quickLogin}
                    busy={quickBusy}
                    pinValue={pinValue}
                    showPin={showPin}
                    onPinChange={setPinValue}
                    onTogglePin={() => setShowPin((open) => !open)}
                    onSubmit={handleQuickLogin}
                  />
                )}
                <button type="button" className="auth-text-button" onClick={() => { setManagerMode('create'); setStep('form'); resetForm(); }}>
                  Create manager account
                </button>
              </form>
            )}
            </>
          )}
          {twoFactorFor && (
          <div className="auth-twofactor">
            <form className="auth-form" onSubmit={handleTwoFactorSubmit}>
              <p className="hint">
                {twoFactorFor.message || 'Enter the 6-digit code from your authenticator app.'}
              </p>
              <label className="form-field">
                <span>Verification code</span>
                <input
                  required
                  inputMode="numeric"
                  maxLength={6}
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                />
              </label>
              {error && <p className="auth-error">{error}</p>}
              <button type="submit" className="btn btn-primary auth-submit">Verify</button>
              <button type="button" className="auth-text-button" onClick={cancelTwoFactor}>
                Use password instead
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
    );
  }

  // The reset-link form itself. Rendered next to the sign-in form, never inside it, so
// the two <form> elements do not nest.
function ForgotPasswordForm({ email, notice, onEmailChange, onSubmit, onClose }) {
  return (
    <form className="auth-forgot-form" onSubmit={onSubmit}>
      <label className="form-field">
        <span>Email address for the reset link</span>
        <input type="email" required value={email} onChange={(e) => onEmailChange(e.target.value)} placeholder="your@email.com" />
      </label>
      {notice && <p className="settings-success">{notice}</p>}
      <div className="settings-actions">
        <button type="submit" className="btn btn-primary">Send reset link</button>
        <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

// Shown under the standard email / password form when the account has a quick-login
// method enabled on this device. A failure here always falls back to the password form.
function QuickLoginPanel({ quickLogin, busy, pinValue, showPin, onPinChange, onTogglePin, onSubmit }) {
  const isPin = quickLogin.method === 'pin';
  return (
    <div className="auth-quick">
      <div className="auth-divider"><span>or</span></div>
      {isPin && !showPin ? (
        <button type="button" className="btn btn-outline auth-quick-btn" disabled={busy} onClick={onTogglePin}>
          Sign in with PIN
        </button>
      ) : (
        <div className="auth-quick-form">
          <label className="form-field">
            <span>{isPin ? `PIN${quickLogin.pinHint ? ` — hint: ${quickLogin.pinHint}` : ''}` : quickLogin.biometricLabel}</span>
            {isPin ? (
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                autoFocus
                value={pinValue}
                onChange={(e) => onPinChange(e.target.value.replace(/\D/g, ''))}
                placeholder="••••"
              />
            ) : (
              <p className="hint">Confirm with your {quickLogin.biometricLabel.toLowerCase()} to sign in.</p>
            )}
          </label>
          <button type="button" className="btn btn-outline auth-quick-btn" disabled={busy || (isPin && !pinValue)} onClick={onSubmit}>
            {busy ? 'Checking…' : isPin ? 'Sign in with PIN' : `Sign in with ${quickLogin.biometricLabel}`}
          </button>
          {isPin && (
            <button type="button" className="auth-text-button" onClick={onTogglePin}>
              Back to password
            </button>
          )}
        </div>
      )}
      <p className="hint">Not {quickLogin.label}? Use the password form above.</p>
    </div>
  );
}
