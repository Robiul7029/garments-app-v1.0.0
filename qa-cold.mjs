// QA: cold-load the protected URL as the FIRST navigation, and watch for the safety-net
// warning. Logs a timeline so we can see whether the AuthProvider effect runs at all.
export default async function run(page) {
  const logs = [];
  page.on('console', (msg) => logs.push(`${Date.now()} ${msg.type()}: ${msg.text()}`.slice(0, 220)));
  page.on('pageerror', (err) => logs.push(`${Date.now()} pageerror: ${err.message}`.slice(0, 300)));

  const t0 = Date.now();
  await page.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' });
  const tNavigated = Date.now();

  // Sample the DOM every second for 20s to see if the gate ever opens.
  const timeline = [];
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(1000);
    const snap = await page.evaluate(() => ({
      spinner: Boolean(document.querySelector('.auth-spinner')),
      tabs: Boolean(document.querySelector('.auth-tab')),
      text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 60),
    }));
    timeline.push({ s: i + 1, ...snap });
    if (snap.tabs || (!snap.spinner && i > 2)) break;
  }

  return {
    navigateMs: tNavigated - t0,
    timeoutWarningSeen: logs.some((l) => /did not answer in time/.test(l)),
    timeline,
    logs,
  };
}
