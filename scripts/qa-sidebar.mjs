// Visits every path the sidebar can navigate to and records where the router lands, plus
// any console error. Unauthenticated, the ProtectedRoute guard should send each one to
// /login — what we are checking is that the route MATCHES (so the guard runs) rather than
// falling through to the "*" catch-all, and that nothing throws on the way.
export default async function run(page, ui) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${e.message || e}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const menu = await page.evaluate(async () => {
    const mod = await import('/src/config/menuConfig.js');
    return mod.menu.flatMap((c) => c.items.map((i) => ({
      path: `/${c.key}/${i.key}`,
      label: `${c.label} > ${i.label}`,
    })));
  });

  const extra = ['/', '/salary', '/payroll', '/attendance-sheet', '/attendance/export',
    '/settings', '/privacy', '/settings/security', '/history', '/employee-management',
    '/admin', '/admin/workers', '/admin/approvals'];

  const checks = [];
  for (const target of [...menu.map((m) => m.path), ...extra]) {
    errors.length = 0;
    await page.goto(`http://127.0.0.1:5199${target}`);
    await page.waitForTimeout(350);
    const landed = new URL(page.url()).pathname;
    checks.push({
      target,
      landed,
      onLoginScreen: await page.locator('.auth-tabs').count().then((n) => n > 0),
      errors: [...errors],
    });
  }

  const bad = checks.filter((c) => !c.onLoginScreen || c.errors.length);
  return {
    total: checks.length,
    allRedirectedToLogin: checks.every((c) => c.landed === '/login'),
    failures: bad,
    sample: checks.slice(0, 4),
  };
}
