// QA: does the bootstrap timeout actually fire on a protected URL?
export default async function run(page) {
  const logs = [];
  page.on('console', (msg) => logs.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', (err) => logs.push(`pageerror: ${err.message}`));

  await page.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' });
  // Wait past the 8s safety net.
  await page.waitForTimeout(12000);

  const text = await page.evaluate(() => document.body.innerText);
  return {
    url: page.url(),
    sawTimeoutWarning: logs.some((l) => /did not answer in time/.test(l)),
    relevantLogs: logs.filter((l) => /Auth|session|listener|error/i.test(l)).slice(0, 15),
    stillSpinner: /Checking your session/i.test(text),
    text: text.slice(0, 150),
  };
}
