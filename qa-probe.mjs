// QA: probe the running app's actual module state and whether AuthProvider mounts.
export default async function run(page) {
  const out = {};
  await page.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  // 1. Does the module even load? Ask the dev server for the transformed source.
  out.moduleFetch = await page.evaluate(async () => {
    try {
      const res = await fetch('/src/context/AuthContext.jsx');
      const src = await res.text();
      return {
        status: res.status,
        bytes: src.length,
        hasBootstrapTimer: src.includes('bootstrapTimer'),
        hasSetTimeout: src.includes('setTimeout'),
        // Vite may have failed to transform; look for an error marker.
        looksLikeError: src.includes('Internal server error') || src.includes('Transform failed'),
        head: src.slice(0, 200),
      };
    } catch (e) {
      return { error: String(e) };
    }
  });

  // 2. Is React mounted at all?
  out.reactMounted = await page.evaluate(() => ({
    rootHtmlLen: document.getElementById('root')?.innerHTML.length ?? -1,
    spinnerPresent: Boolean(document.querySelector('.auth-spinner')),
    scriptTags: [...document.querySelectorAll('script[type=module]')].map((s) => s.src),
  }));

  // 3. Watch for our own warning over a longer window.
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`.slice(0, 200)));
  await page.waitForTimeout(8000);
  out.timeoutWarning = logs.some((l) => /did not answer in time/.test(l));
  out.logs = logs;

  return out;
}
