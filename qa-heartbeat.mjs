// QA: prove whether the AuthProvider bootstrap effect runs at all, by timestamping
// the app's own console output over time on a cold protected-URL load.
export default async function run(page) {
  const logs = [];
  const t0 = Date.now();
  page.on('console', (msg) => logs.push(`+${Date.now() - t0}ms ${msg.type()}: ${msg.text()}`.slice(0, 240)));
  page.on('pageerror', (err) => logs.push(`+${Date.now() - t0}ms pageerror: ${err.message}`.slice(0, 300)));

  await page.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' });

  // Poll for 15s, sampling the gate.
  const samples = [];
  for (let i = 0; i < 15; i += 1) {
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => ({
      spinner: Boolean(document.querySelector('.auth-spinner')),
      tabs: Boolean(document.querySelector('.auth-tab')),
    }));
    samples.push(`${i + 1}s spinner=${s.spinner} tabs=${s.tabs}`);
    if (s.tabs) break;
  }

  return {
    opened: samples.some((s) => s.includes('tabs=true')),
    samples,
    logs,
    note: 'If the 8s safety-net warning is absent, the effect body never ran.',
  };
}
