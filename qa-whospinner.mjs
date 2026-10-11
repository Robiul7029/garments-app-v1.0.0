// QA: identify what is rendering the spinner and whether React ever committed a tree.
export default async function run(page) {
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`.slice(0, 400)));

  await page.goto('http://localhost:5199/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const info = await page.evaluate(() => {
    const root = document.getElementById('root');
    const spinner = document.querySelector('.auth-spinner');
    const card = document.querySelector('.auth-card');
    return {
      rootHtml: (root?.innerHTML || '').slice(0, 500),
      spinnerClassName: spinner?.className || null,
      spinnerParentChain: (() => {
        const chain = [];
        let el = spinner;
        while (el && chain.length < 6) {
          chain.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ').join('.') : ''}`);
          el = el.parentElement;
        }
        return chain;
      })(),
      authCardPresent: Boolean(card),
      // Is the React root's __reactContainer key present (i.e. React mounted here)?
      reactKeys: Object.keys(root || {}).filter((k) => k.startsWith('__react')).slice(0, 5),
      // Any error boundary fallback text?
      bodyLen: document.body.innerHTML.length,
    };
  });

  return { info, logs, url: page.url() };
}
