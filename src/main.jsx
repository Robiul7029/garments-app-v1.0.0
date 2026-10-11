import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
// The ERP design system is a separate, `erp-` prefixed stylesheet appended
// after the legacy one. Nothing here overrides an attendance or admin style.
import './styles/erp.css';
// The Overview dashboard's own skin, scoped under `.rge-` so it can only affect
// the one screen that renders that root class. Loaded last so it wins the
// cascade on that screen without needing a single `!important`.
import './styles/rge-dashboard.css';
import { purgeStaleEmployeeStorage } from './config/employeeSeedRepair';

// Runs BEFORE React mounts, and before the sign-in gate can short-circuit
// anything.
//
// This is the piece that was missing. The data layer only loads once a user is
// signed in (`DataProvider` lives inside `ProtectedRoute`), so a repair placed
// inside it never ran for a signed-out browser — which is why the directory kept
// showing 0 on the very screen it was reported from. Doing it here means the
// stored payload is corrected on page load, whoever is or is not signed in, and
// the sign-in screen does not have to be involved at all.
purgeStaleEmployeeStorage();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
