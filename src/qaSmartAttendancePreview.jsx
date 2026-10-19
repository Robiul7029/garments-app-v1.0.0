/**
 * QA PREVIEW — temporary. Mounts the real Smart Attendance form with its
 * Firestore-backed helpers stubbed, so the sequential validation tooltip can be
 * exercised in a headless browser without a live backend.
 *
 * The module under test is the REAL `SmartAttendance` component (imported
 * through `./pages/SmartAttendance`); only its data layer is faked here, via a
 * module alias resolved in `qa-smartattendance.html`'s Vite config.
 */
import React from 'react';
import SmartAttendance from './pages/SmartAttendance';

export default function QaSmartAttendancePreview() {
  return (
    <div className="app-content" style={{ padding: 20, background: '#0b0f14', minHeight: '100vh' }}>
      <SmartAttendance />
    </div>
  );
}
