/**
 * QA-only Vite config: same app, but `utils/attendance` and `context/RoleContext`
 * are aliased to no-backend stubs, so the Smart Attendance form can be loaded in
 * a headless browser without Firestore or an auth session.
 *
 * Not used by the app or the test suite — `npm run dev` / `npm run build` use
 * the normal `vite.config.js`.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^(.*)\/utils\/attendance$/, replacement: fileURLToPath(new URL('./qa-stubs/attendance.js', import.meta.url)) },
      { find: /^(.*)\/context\/RoleContext$/, replacement: fileURLToPath(new URL('./qa-stubs/RoleContext.jsx', import.meta.url)) },
    ],
  },
  server: { port: 5199 },
});
