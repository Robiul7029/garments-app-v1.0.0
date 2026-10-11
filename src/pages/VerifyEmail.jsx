import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Landing page for the short link in the verification email:
//   /verify-email?email=user@example.com&code=123456
//
// The link carries the same 6-digit code that was emailed, so opening it is
// equivalent to typing the code on the sign-up screen. If the code is missing
// from the URL, the user can type it in here instead.
export default function VerifyEmail() {
  const { verifyEmail } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('verifying'); // verifying | done | error
  const [message, setMessage] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // The auto-run must fire once; React 18 StrictMode mounts effects twice in dev.
  const started = useRef(false);

  const params = new URLSearchParams(window.location.search);
  const queryEmail = params.get('email') || '';
  const queryCode = params.get('code') || '';

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!queryCode) {
      setStatus('error');
      setMessage('No verification code was found in this link. Enter the 6-digit code from your email below.');
      return;
    }

    const pending = JSON.parse(sessionStorage.getItem('pendingVerificationAuth') || 'null');
    const pendingEmail = pending?.email || queryEmail;
    const pendingPassword = pending?.password || '';

    (async () => {
      try {
        await verifyEmail(queryCode, '', pendingEmail, pendingPassword);
        setStatus('done');
      } catch (error) {
        setStatus('error');
        setMessage(error.message);
      }
    })();
  }, [queryCode, queryEmail, verifyEmail]);

  // Manual fallback when the link had no code, or the automatic attempt failed.
  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    const pending = JSON.parse(sessionStorage.getItem('pendingVerificationAuth') || 'null');
    try {
      await verifyEmail(code, '', pending?.email || queryEmail, pending?.password || '');
      setStatus('done');
    } catch (error) {
      setStatus('error');
      setMessage(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-logo">AB</div>
          <div>
            <h1>Email Verification</h1>
            <p className="hint">Verify your account to continue.</p>
          </div>
        </div>

        {status === 'verifying' && (
          <p className="hint" style={{ textAlign: 'center' }}>Verifying your email…</p>
        )}

        {status === 'done' && (
          <div className="auth-form">
            <p className="hint" style={{ textAlign: 'center', color: '#34d399' }}>
              ✅ Your email has been verified successfully. You can now sign in.
            </p>
            <button type="button" className="btn btn-primary auth-submit" onClick={() => navigate('/login', { replace: true })}>
              Go to Sign In
            </button>
          </div>
        )}

        {status === 'error' && (
          <form className="auth-form" onSubmit={handleSubmit}>
            <p className="auth-error">{message}</p>
            <label className="form-field">
              <span>6-digit verification code</span>
              <input
                required
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="123456"
              />
            </label>
            <button type="submit" className="btn btn-primary auth-submit" disabled={submitting}>
              {submitting ? 'Verifying…' : 'Verify Email'}
            </button>
            <Link className="auth-text-button" to="/login">Back to sign in</Link>
          </form>
        )}
      </div>
    </div>
  );
}
