// Verifies that every path the Sidebar can navigate to is actually served by a route in
// App.jsx, and that every literal path in the sidebar matches a declared route.
//
// Run: node scripts/check-routes.mjs
//
// The menu routes are generated from `menu` in src/config/menuConfig.js, so the check
// re-derives those same paths and compares them against the routes App.jsx declares.
import { readFileSync } from 'fs';

const cfg = readFileSync('src/config/menuConfig.js', 'utf8');
const app = readFileSync('src/App.jsx', 'utf8');
const side = readFileSync('src/components/Sidebar.jsx', 'utf8');

/**
 * Walks the `menu` array by indentation: a category key sits at 4 spaces, an item key at
 * 8, and every deeper `key:` belongs to a field inside an item. That is enough to
 * rebuild the list of `/${cat.key}/${item.key}` paths the sidebar navigates to.
 */
function parseMenuPaths(source) {
  const start = source.indexOf('export const menu = [');
  if (start === -1) throw new Error('menu array not found in menuConfig.js');
  const lines = source.slice(start).split('\n');

  const paths = [];
  let category = null;
  for (const line of lines) {
    const cat = line.match(/^\s{4}key: '([a-z0-9-]+)',?\s*$/);
    if (cat) {
      category = cat[1];
      continue;
    }
    const item = line.match(/^\s{8}key: '([a-z0-9-]+)'/);
    if (item && category) paths.push({ path: `/${category}/${item[1]}`, category, item: item[1] });
    // A closing "  ]," ends the category's item list.
    if (/^ {2}\],?\s*$/.test(line)) category = null;
    // The menu array itself ends with "];".
    if (/^\];\s*$/.test(line)) break;
  }
  return paths;
}

/** Every route path App.jsx declares, with nested children resolved against their parent. */
function parseRoutes(source) {
  const declared = new Set([...source.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]));

  // Layout routes that nest children, and the children hanging off them.
  const parents = [...source.matchAll(/<Route\s+path="([^"]+)"[^>]*element=\{<(\w+)\s*\/>\}>/g)]
    .map((m) => ({ path: m[1], layout: m[2] }));
  const children = [...source.matchAll(/<Route\s+path="([^"/][^"]*)"[^>]*element=/g)].map((m) => m[1]);

  for (const parent of parents) {
    for (const child of children) declared.add(`${parent.path}/${child}`);
  }
  return { declared, parents, children };
}

/**
 * The dynamic family App.jsx generates from the menu config, if it is still there. A
 * menu path like /cutting/cutting-plan is served by <Route path={`/${cat.key}/${item.key}`}>,
 * which spans two lines in the JSX, so the pattern is matched across newlines.
 */
function hasGeneratedMenuRoutes(source) {
  return /<Route[\s\S]{0,200}?path=\{`\/\$\{cat\.key\}\/\$\{item\.key\}`\}[\s\S]{0,200}?\/>/.test(source);
}

const menuPaths = parseMenuPaths(cfg);
const { declared, parents, children } = parseRoutes(app);
const menuRoutesGenerated = hasGeneratedMenuRoutes(app);

const problems = [];

// Every menu path is served by the generated family — but only if that family still
// exists. If it is gone, the sidebar links would 404, so check it explicitly.
if (!menuRoutesGenerated) problems.push('App.jsx no longer generates routes from the menu config');
if (!menuRoutesGenerated) {
  for (const { path } of menuPaths) {
    if (!declared.has(path)) problems.push(`menu route not served: ${path}`);
  }
}

// Literal go('...') targets in the sidebar must match a declared route exactly.
const literalTargets = [...side.matchAll(/go\('([^']+)'\)/g)].map((m) => m[1]);
for (const path of literalTargets) {
  if (path === '/') continue;
  if (!declared.has(path)) problems.push(`sidebar link has no route: ${path}`);
}

console.log(`menu categories: ${new Set(menuPaths.map((p) => p.category)).size} (${[...new Set(menuPaths.map((p) => p.category))].join(', ')})`);
console.log(`menu routes checked: ${menuPaths.length} (served by the generated ${menuRoutesGenerated ? '/:cat/:item family' : 'MISSING family'})`);
console.log(`literal sidebar links checked: ${literalTargets.length}`);
console.log(`layout routes: ${parents.map((p) => `${p.path} -> ${p.layout}`).join(', ') || 'none'}`);
console.log(`nested children: ${children.join(', ') || 'none'}`);
console.log(problems.length ? `\nPROBLEMS:\n  ${problems.join('\n  ')}` : '\nOK: every sidebar target maps to a served route.');
process.exit(problems.length ? 1 : 0);
