import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { useNavigate } from 'react-router-dom';

const initialForm = (user) => ({
  username: user?.username || '',
  email: user?.email || '',
  profilePicture: user?.profilePicture || '',
  bio: user?.bio || '',
  street: user?.street || '',
  city: user?.city || '',
  zipCode: user?.zipCode || '',
  phone: user?.phone || '',
});

export default function Settings({ section = 'profile' }) {
  const { user, updateUserProfile, requestPasswordChange } = useAuth();
  const { getData } = useData();
  const navigate = useNavigate();
  const [form, setForm] = useState(() => initialForm(user));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function handlePicture(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 500000) {
      setError('Please choose an image smaller than 500 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((current) => ({ ...current, profilePicture: String(reader.result) }));
    reader.readAsDataURL(file);
  }

  async function handleSave(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const result = await updateUserProfile(form);
      setMessage(result.emailChanged ? 'Profile saved. Please verify your new email address.' : 'Profile saved successfully.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordReset() {
    setError('');
    setMessage('');
    try {
      await requestPasswordChange();
      setMessage('Password reset email sent. Please check your inbox.');
    } catch (resetError) {
      setError(resetError.message);
    }
  }

  if (section === 'privacy') {
    return (
      <section className="settings-page">
        <div className="settings-header"><button className="btn btn-outline" onClick={() => navigate(-1)}>← Back</button><h2>Privacy Policy</h2></div>
        <div className="settings-panel"><p>Your profile data is stored in the Firebase users document for your account. Passwords are handled by Firebase Authentication and are never stored in this app.</p><p>Profile information is used to personalize your account and support the production workspace.</p></div>
      </section>
    );
  }

  if (section === 'history') {
    const activity = getData('leave-requests').slice(-20).reverse();
    return (
      <section className="settings-page">
        <div className="settings-header"><button className="btn btn-outline" onClick={() => navigate(-1)}>← Back</button><h2>History</h2></div>
        <div className="settings-panel">
          <p className="hint">Recent activity available for this workspace.</p>
          {activity.length === 0 ? <p className="empty-row">No activity recorded yet.</p> : activity.map((item) => <div className="history-row" key={item.id}>{item.employee || 'Leave request'} <span>{item.status || 'Recorded'}</span></div>)}
        </div>
      </section>
    );
  }

  return (
    <section className="settings-page">
      <div className="settings-header"><button className="btn btn-outline" onClick={() => navigate(-1)}>← Back</button><h2>Settings</h2></div>
      <form className="settings-panel settings-form" onSubmit={handleSave}>
        <div className="settings-profile-head">
          <div className="settings-avatar">{form.profilePicture ? <img src={form.profilePicture} alt="Profile" /> : '🙂'}</div>
          <label className="btn btn-outline upload-control">Change picture<input type="file" accept="image/*" onChange={handlePicture} /></label>
        </div>
        <div className="settings-grid">
          <label className="form-field"><span>Username</span><input name="username" value={form.username} onChange={updateField} required /></label>
          <label className="form-field"><span>Email address</span><input name="email" type="email" value={form.email} onChange={updateField} required /></label>
          <label className="form-field settings-wide"><span>Bio</span><textarea name="bio" value={form.bio} onChange={updateField} rows={3} placeholder="Tell us about yourself" /></label>
          <label className="form-field"><span>Street</span><input name="street" value={form.street} onChange={updateField} /></label>
          <label className="form-field"><span>City</span><input name="city" value={form.city} onChange={updateField} /></label>
          <label className="form-field"><span>Zip Code</span><input name="zipCode" value={form.zipCode} onChange={updateField} /></label>
          <label className="form-field"><span>📞 Phone Number</span><input name="phone" value={form.phone} onChange={updateField} required /></label>
        </div>
        {error && <p className="auth-error">{error}</p>}
        {message && <p className="settings-success">{message}</p>}
        <div className="settings-actions"><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save Profile'}</button><button type="button" className="btn btn-outline" onClick={handlePasswordReset}>Request Password Change</button></div>
      </form>
    </section>
  );
}
