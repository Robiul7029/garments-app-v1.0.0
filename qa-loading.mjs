// QA: the loading gate must ALWAYS open — 'Checking your session…' must never be stuck.
// Loads the app signed-out and on a protected URL, and asserts the spinner is replaced
// by the sign-in screen within a bounded time, with no console/page errors.
export default async function run(page) {
  const result = { consoleErrors: [], pageErrors: [], attempts: [] };
  page.on('pageerror', (err) => result.pageErrors.push(String(err.message)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') result.consoleErrors.push(msg.text());
  });

  const targets = ['http://localhost:5199/login', 'http://localhost:5199/'];

  for (const url of targets) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    let state = 'still-loading';
    const started = Date.now();
    try {
      // Either the sign-in form or a redirect must appear; the spinner must not persist.
      await page.waitForFunction(
        () => {
          const text = document.body.innerText || '';
          const loading = /Checking your session/i.test(text);
          const signInForm = document.querySelector('.auth-tab');
          return !loading || Boolean(signInForm);
        },
        { timeout: 25000 },
      );
      state = 'gate-opened';
    } catch {
      state = 'STUCK-ON-SPINNER';
    }
    result.attempts.push({
      url,
      state,
      ms: Date.now() - started,
      finalUrl: page.url(),
      text: (await page.evaluate(() => document.body.innerText)).slice(0, 120),
    });
  }

  result.nullReadErrors = [...result.pageErrors, ...result.consoleErrors].filter((m) =>
    /Cannot read properties of null|reading 'username'|is not a function|undefined is not/.test(m),
  );
  return result;
}
