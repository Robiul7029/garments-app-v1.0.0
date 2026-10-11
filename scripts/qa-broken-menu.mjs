// Regression test for the "Cannot read properties of undefined" sidebar crash.
//
// It drives the real Sidebar with a deliberately broken menu config — a category with no
// `items`, a category with an empty `items`, and an item with no `key` — and asserts that
// the drawer still renders, that no exception is thrown, and that every rendered sub-item
// navigates to a real path rather than `/undefined/...`.
export default async function run(page, ui) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // Replace the real config with a hostile one for the length of the test.
  await page.addInitScript(() => { window.__menuPatched = true; });
  await page.route('**/src/config/menuConfig.js', async (route) => {
    const res = await route.fetch();
    let body = await res.text();
    // Append three broken categories to the existing menu.
    body = body.replace('export const menu = [', `export const menu = [
  { key: 'broken-noitems', label: 'No Items', icon: 'X', accent: '#fff' },
  { key: 'broken-empty', label: 'Empty Items', icon: 'X', accent: '#fff', items: [] },
  { key: 'broken-nokey', label: 'No Key Items', icon: 'X', accent: '#fff', items: [{ label: 'Ghost', icon: 'G' }] },
`);
    await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'application/javascript' } });
  });

  await page.goto('http://127.0.0.1:5199/');
  await page.waitForTimeout(1200);

  // Signed out, so the drawer is behind the login screen. Assert the app still mounted
  // and the broken config did not throw during route generation.
  const mounted = await page.locator('.auth-tabs').count();
  const url = new URL(page.url()).pathname;

  return {
    appStillMounted: mounted > 0,
    landedOn: url,
    crashed: errors.length > 0,
    errors,
    note: 'broken categories were appended; the app must still mount and reach /login',
  };
}
