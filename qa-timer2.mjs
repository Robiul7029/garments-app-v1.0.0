// QA: capture ALL console output on a protected URL, unfiltered.
export default async function run(page) {
  const logs = [];
  page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text()}`.slice(0, 200)));
  page.on('pageerror', (err) => logs.push(`pageerror: ${err.message}`.slice(0, 300)));
  page.on('requestfailed', (req) =>
    logs.push(`reqfail: ${req.url().slice(0, 120)} ${req.failure()?.errorText || ''}`));

  await page.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(11000);

  const state = await page.evaluate(() => ({
    text: (document.body.innerText || '').slice(0, 120),
    hasSpinner: Boolean(document.querySelector('.auth-spinner')),
    rootChildren: document.getElementById('root')?.children.length ?? -1,
  }));

  return { state, allLogs: logs };
}
