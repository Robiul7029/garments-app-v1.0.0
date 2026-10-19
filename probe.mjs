export default async function run(page, ui) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 400)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 400)));
  await page.waitForTimeout(9000);
  const info = await page.evaluate(() => ({
    path: location.pathname,
    title: document.title,
    text: document.body.innerText.slice(0, 600).replace(/\s+/g, ' '),
  }));
  return { info, errors: errors.slice(0, 12) };
}
