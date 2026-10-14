// Verify the native tab layout: the menu registers a firstchild parent with
// four child views, and each tab view file exists and is syntactically sane
// (checked separately by node --check).
import fs from 'node:fs';
import assert from 'node:assert';

const menuPath = new URL('../root/usr/share/luci/menu.d/luci-app-drcom-auth.json', import.meta.url);
const menu = JSON.parse(fs.readFileSync(menuPath, 'utf8'));

const parent = menu['admin/services/hstc-drcom-auth'];
assert(parent, 'parent menu entry exists');
assert.equal(parent.action.type, 'firstchild', 'parent is firstchild');

const tabs = ['online', 'accounts', 'diag', 'settings'];
for (const t of tabs) {
  const key = `admin/services/hstc-drcom-auth/${t}`;
  assert(menu[key], `child ${t} exists`);
  assert.equal(menu[key].action.type, 'view', `child ${t} is a view`);
  assert.equal(menu[key].action.path, `hstc-drcom-auth/${t}`, `child ${t} path`);
  const view = new URL(`../htdocs/luci-static/resources/view/hstc-drcom-auth/${t}.js`, import.meta.url);
  assert(fs.existsSync(view), `view file ${t}.js exists`);
}

// No custom tab bar remains anywhere in the view modules.
const dir = new URL('../htdocs/luci-static/resources/view/hstc-drcom-auth/', import.meta.url);
for (const f of fs.readdirSync(dir)) {
  const src = fs.readFileSync(new URL(f, dir), 'utf8');
  assert(!src.includes('drcom-tab-btn'), `${f} has no custom tab button`);
  assert(!src.includes('drcom-tabs-nav'), `${f} has no custom tab nav`);
}

// The shared module lives next to view/ (require hstc-drcom-auth.common) and
// exposes what the tab views require.
const common = fs.readFileSync(new URL('../htdocs/luci-static/resources/hstc-drcom-auth/common.js', import.meta.url), 'utf8');
for (const sym of ['makeTranslator', 'makeBaseHelpers', 'collectInterfaces', 'parseAccounts', 'style'])
  assert(common.includes(sym), `common exports ${sym}`);

console.log('tabs order:', tabs.join(' -> '));
console.log('ALL OK');
