// Verify the tab grouping: which section title lands in which tab, for every
// language. Parses the tabs config and the dict titles out of the view file.
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../htdocs/luci-static/resources/view/drcom-auth.js', import.meta.url), 'utf8');

// Section definition order and their tr() key.
const sectionKeys = [...src.matchAll(/m\.section\(form\.TypedSection, 'drcom_auth', tr\('([a-zA-Z]+)'\)\)/g)]
  .map((m) => m[1]);
console.log('sections in order:', sectionKeys.join(', '));
console.log();

// Extract each language dict's relevant titles.
function dict(lang) {
  // crude: pull the block for the language and read basic/account/network/authorize/cas/auth/settings/server
  const keys = ['basic', 'account', 'network', 'authorize', 'cas', 'auth', 'settings', 'server',
    'status', 'accountsTab', 'tabOnline', 'tabAccounts', 'tabDiag', 'tabSettings'];
  const out = {};
  // find the lang object start
  let start;
  if (lang === 'zh') start = src.indexOf('\t\t\tzh: {');
  else if (lang === 'zh-tw') start = src.indexOf("\t\t\t'zh-tw': {");
  else start = src.indexOf('\t\t\ten: {');
  const block = src.slice(start, start + 6000);
  for (const k of keys) {
    const m = block.match(new RegExp(`\\b${k}:\\s*'([^']*)'`));
    out[k] = m ? m[1] : '(missing)';
  }
  return out;
}

const tabs = {
  online: ['status', 'account', 'basic', 'network'],
  accounts: ['accountsTab'],
  diag: ['authorize', 'cas', 'auth'],
  settings: ['settings', 'server']
};

let fail = 0;
for (const lang of ['zh', 'zh-tw', 'en']) {
  const d = dict(lang);
  console.log(`--- ${lang} ---`);
  console.log(`  tabs: ${d.tabOnline} / ${d.tabDiag} / ${d.tabSettings}`);
  const assigned = [];
  for (const [tab, keys] of Object.entries(tabs)) {
    for (const k of keys) {
      assigned.push(k);
      console.log(`  ${tab.padEnd(8)} <- ${d[k]}`);
    }
  }
  // every section must be assigned exactly once
  const missing = sectionKeys.filter((k) => !assigned.includes(k));
  const dup = assigned.filter((k, i) => assigned.indexOf(k) !== i);
  if (missing.length) { console.log(`  FAIL unassigned: ${missing.join(', ')}`); fail++; }
  if (dup.length) { console.log(`  FAIL duplicated: ${dup.join(', ')}`); fail++; }
  if (!missing.length && !dup.length) console.log('  OK all sections assigned once');
  console.log();
}
console.log(fail ? `FAILURES: ${fail}` : 'ALL OK');
process.exit(fail ? 1 : 0);
