import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRole } from '../context/RoleContext';
import { useData } from '../context/DataContext';
import { useNavigate } from 'react-router-dom';

const COMPANY_NAME = 'ART BOUTIQUE SRL';

export default function Header() {
  const { user, logout, pendingManagers, approveManager } = useAuth();
  const { isAdmin } = useRole();
  const { getData } = useData();
  const navigate = useNavigate();
  const [accountOpen, setAccountOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const pendingLeave = getData('leave-requests').filter((r) => r.status === 'Pending');
  const pendingMgrs = user?.isSuperAdmin ? pendingManagers() : [];
  const notifCount = pendingLeave.length + pendingMgrs.length;

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <div className="brand-logo">AB</div>
          <div className="brand-name">{COMPANY_NAME}</div>
        </div>

        <div className="header-actions">
          <button className="account-btn" onClick={() => setNotifOpen(true)}>
            🔔
            {notifCount > 0 && <span className="notif-badge">{notifCount}</span>}
          </button>

          <div className="account-menu">
            <button className="account-btn" onClick={() => setAccountOpen(!accountOpen)}>
              {user?.profilePicture ? <img className="account-avatar-image" src={user.profilePicture} alt="Profile" /> : <span className="account-avatar">{isAdmin ? '🧑‍💼' : '🙂'}</span>}
            </button>
            {accountOpen && (
              <div className="account-dropdown">
                <div className="account-dropdown-profile">
                  {user?.profilePicture ? <img src={user.profilePicture} alt="Profile" /> : <span>{isAdmin ? '🧑‍💼' : '🙂'}</span>}
                  <strong>{user?.username || 'User'}</strong>
                  <small>{user?.email}</small>
                </div>
                <button className="account-dropdown-item" onClick={() => { setAccountOpen(false); navigate('/settings'); }}>⚙️ <span>Settings</span></button>
                <button className="account-dropdown-item" onClick={() => { setAccountOpen(false); navigate('/privacy'); }}>🔒 <span>Privacy Policy</span></button>
                <button className="account-dropdown-item" onClick={() => { setAccountOpen(false); navigate('/history'); }}>📜 <span>History</span></button>
                <button className="account-dropdown-item" onClick={() => { setAccountOpen(false); logout('signin'); }}>🔄 <span>Add / Switch Another Account</span></button>
                <button className="account-dropdown-item account-dropdown-logout" onClick={() => { setAccountOpen(false); logout('signin'); }}>🚪 <span>Log Out</span></button>
              </div>
            )}
          </div>
        </div>
      </header>

      {notifOpen && (
        <div className="notif-page">
          <div className="notif-page-header">
            <button className="notif-back-btn" onClick={() => setNotifOpen(false)}>← Back</button>
            <h2>Notifications</h2>
          </div>
          <div className="notif-page-body">
            {notifCount === 0 && <p className="hint">Nothing new right now.</p>}
            {pendingLeave.map((r) => (
              <div key={r.id} className="notif-page-item">🗓️ Leave request from {r.employee} is pending</div>
            ))}
            {pendingMgrs.map((m) => (
              <div key={m.id} className="notif-page-item notif-approve">
                <span>🧑‍💼 {m.username} requested manager access</span>
                <button className="btn btn-primary notif-approve-btn" onClick={() => approveManager(m.id)}>Approve</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
