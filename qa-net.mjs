// QA: capture every response and request failure on a cold load, unfiltered.
export default async function run(page) {
  const events = [];
  page.on('requestfailed', (r) => events.push(`FAILED ${r.url().slice(0, 140)} :: ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    if (r.status() >= 400) events.push(`HTTP ${r.status()} ${r.url().slice(0, 140)}`);
  });
  page.on('pageerror', (e) => events.push(`PAGEERROR ${e.message.slice(0, 300)}`));
  page.on('console', (m) => events.push(`CONSOLE ${m.type()} ${m.text().slice(0, 200)}`));

  await page.goto('http://localhost:5199/', { waitUntil: 'load' });
  await page.waitForTimeout(9000);

  const state = await page.evaluate(() => ({
    rootHtmlLen: document.getElementById('root')?.innerHTML.length ?? -1,
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 100),
  }));

  return { state, eventCount: events.length, events };
}
