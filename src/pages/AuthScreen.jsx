import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function AuthScreen() {
  const { login, signup, signupManager, verifyEmail, loginManager, authHint } = useAuth();
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

  function switchTopTab(tab) {
    setTopTab(tab); setManagerMode('create'); setStep('form'); resetForm();
  }

  async function handleSignIn(e) {
    e.preventDefault();
    setError('');
    try {
      await login(identifier, password);
    } catch (err) {
      setError(err.message);
    }
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

  async function handleManagerSignIn(e) {
    e.preventDefault();
    setError('');
    try {
      await loginManager(identifier, password);
    } catch (err) {
      setError(err.message);
    }
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
            <label className="form-field"><span>Email address</span><input required value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="your@email.com" /></label>
            <label className="form-field"><span>Password</span><input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" /></label>
            {error && <p className="auth-error">{error}</p>}
            <button type="submit" className="btn btn-primary auth-submit">Sign In</button>
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
                {error && <p className="auth-error">{error}</p>}
                <button type="submit" className="btn btn-primary auth-submit">Sign In</button>
                <button type="button" className="auth-text-button" onClick={() => { setManagerMode('create'); setStep('form'); resetForm(); }}>
                  Create manager account
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
