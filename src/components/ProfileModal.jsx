import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';

const emptyForm = (user) => ({
  username: user?.username || '',
  email: user?.email || '',
  profilePicture: user?.profilePicture || '',
  bio: user?.bio || '',
  street: user?.street || '',
  city: user?.city || '',
  zipCode: user?.zipCode || '',
  phone: user?.phone || '',
});

// Opens read-only: every field is locked until "Edit Profile" is pressed, and the email is
// never editable at all. "Save Profile" writes the changes and locks the form again.
export default function ProfileModal({ open, onClose }) {
  // Guarded: the modal is rendered by the header, so a missing auth provider must not be
  // able to blank the whole page.
  const { user, updateUserProfile } = useAuth() || {};
  const [form, setForm] = useState(() => emptyForm(user));
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  // Re-seed from the signed-in user every time the modal is opened, and always read-only.
  useEffect(() => {
    if (!open) return;
    setForm(emptyForm(user));
    setEditing(false);
    setMessage('');
    setError('');
  }, [open, user]);

  if (!open) return null;

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

  async function handleSave() {
    setError('');
    setMessage('');
    setSaving(true);
    try {
      await updateUserProfile(form);
      setMessage('Profile saved successfully.');
      setEditing(false);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  function startEditing() {
    setError('');
    setMessage('');
    setEditing(true);
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="profile-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Profile">
        <div className="profile-modal-head">
          <h2>Profile / Account</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Avatar centred at the top, with a small edit icon on its corner instead of
            a separate "Change Picture" button. */}
        <div className="profile-avatar-wrap">
          <div className="profile-avatar">
            {form.profilePicture ? <img src={form.profilePicture} alt="Profile" /> : '🙂'}
          </div>
          <button
            type="button"
            className="profile-avatar-edit"
            onClick={() => fileRef.current?.click()}
            aria-label="Change profile picture"
            title="Change profile picture"
          >
            ✎
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden-file-input" onChange={handlePicture} />
          <strong className="profile-avatar-name">{form.username || form.email}</strong>
          <small className="profile-avatar-role">{user?.role === 'admin' ? 'Manager / Admin' : 'General User'}</small>
        </div>

        <div className="settings-grid">
          <label className="form-field">
            <span>Username</span>
            <input name="username" value={form.username} onChange={updateField} readOnly={!editing} />
          </label>
          <label className="form-field">
            <span>Email address</span>
            {/* Email stays locked permanently, in both read-only and edit mode. */}
            <input name="email" type="email" value={form.email} readOnly disabled />
          </label>
          <label className="form-field settings-wide">
            <span>Bio</span>
            <textarea name="bio" value={form.bio} onChange={updateField} rows={3} readOnly={!editing} />
          </label>
          <label className="form-field"><span>Street</span><input name="street" value={form.street} onChange={updateField} readOnly={!editing} /></label>
          <label className="form-field"><span>City</span><input name="city" value={form.city} onChange={updateField} readOnly={!editing} /></label>
          <label className="form-field"><span>Zip Code</span><input name="zipCode" value={form.zipCode} onChange={updateField} readOnly={!editing} /></label>
          <label className="form-field"><span>📞 Phone Number</span><input name="phone" value={form.phone} onChange={updateField} readOnly={!editing} /></label>
        </div>

        {error && <p className="auth-error">{error}</p>}
        {message && <p className="settings-success">{message}</p>}

        {/* Edit on the bottom-left, Save on the opposite bottom-right. */}
        <div className="settings-actions profile-modal-actions">
          <div>
            {!editing ? (
              <button type="button" className="btn btn-outline" onClick={startEditing}>Edit Profile</button>
            ) : (
              <button type="button" className="btn btn-outline" disabled={saving} onClick={() => { setForm(emptyForm(user)); setEditing(false); setError(''); setMessage(''); }}>
                Cancel
              </button>
            )}
          </div>
          <button type="button" className="btn btn-primary" disabled={!editing || saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      </div>
    </div>
  );
}
