/** Why is the exposed state undefined? Test defineProperty in the real page. */
export default async function run(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  await page.goto('http://localhost:5299/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const probe = await page.evaluate(() => {
    const desc = Object.getOwnPropertyDescriptor(window, '__DIRECTORY_STATE__');
    let readValue = null;
    let readError = null;
    try { readValue = window.__DIRECTORY_STATE__; } catch (e) { readError = String(e); }
    let canDefine = null;
    try {
      let probeVal = 42;
      Object.defineProperty(window, '__PROBE_GETTER__', { configurable: true, get: () => probeVal });
      canDefine = window.__PROBE_GETTER__ === 42;
      delete window.__PROBE_GETTER__;
    } catch (e) { canDefine = `threw: ${e.message}`; }
    return {
      hasProperty: '__DIRECTORY_STATE__' in window,
      descriptor: desc ? { hasGet: typeof desc.get === 'function', configurable: desc.configurable } : null,
      readValueType: typeof readValue,
      readValueKeys: readValue ? Object.keys(readValue) : null,
      readError,
      canDefine,
    };
  });

  return { probe, errors };
}
