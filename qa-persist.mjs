// QA: is Firebase's setPersistence() promise settling in this environment?
// If it never settles, onAuthStateChanged is never attached → the gate never opens.
export default async function run(page) {
  const out = {};
  await page.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  out.probe = await page.evaluate(async () => {
    const result = {};
    try {
      const mod = await import('/src/firebase.js');
      result.imported = true;
      result.hasAuth = Boolean(mod.auth);
      result.hasPersistenceReady = Boolean(mod.authPersistenceReady);

      // Race the persistence promise against a short clock — the crux of the bug.
      result.persistenceSettled = await Promise.race([
        mod.authPersistenceReady.then(() => 'settled').catch(() => 'rejected'),
        new Promise((r) => setTimeout(() => r('PENDING'), 2500)),
      ]);
      result.currentUser = mod.auth.currentUser ? 'signed-in' : 'signed-out';
    } catch (e) {
      result.importError = String(e).slice(0, 300);
    }
    return result;
  });

  return out;
}
