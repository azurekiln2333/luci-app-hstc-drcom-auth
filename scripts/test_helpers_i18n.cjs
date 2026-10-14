// Verify every h.<method> used by a view is exported by makeBaseHelpers, and
// that every tr('key') a view uses exists in all three language dicts.
const fs = require('fs');
const path = require('path');

const RES = 'htdocs/luci-static/resources';
const common = fs.readFileSync(path.join(RES, 'hstc-drcom-auth/common.js'), 'utf8');

// h.X used by views
const viewDir = path.join(RES, 'view/hstc-drcom-auth');
let fail = 0;
const used = new Set();
for (const f of fs.readdirSync(viewDir)) {
  const src = fs.readFileSync(path.join(viewDir, f), 'utf8');
  for (const m of src.matchAll(/\bh\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) used.add(m[1]);
}
console.log('h.* used by views:', [...used].sort().join(', '));
for (const m of [...used].sort()) {
  // exported as `name: name` inside the makeBaseHelpers return, or the function exists
  const ok = new RegExp('\\b' + m + ':\\s*' + m + '\\b').test(common) ||
             new RegExp('\\bfunction\\s+' + m + '\\s*\\(').test(common);
  console.log((ok ? '  OK  ' : '  FAIL ') + 'h.' + m);
  if (!ok) fail++;
}

// tr('key') coverage across the three dicts: count occurrences of `key:` .
const usedKeys = new Set();
for (const dir of [viewDir]) {
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/tr\('([a-zA-Z0-9_]+)'\)/g)) usedKeys.add(m[1]);
  }
}
const missing = [];
for (const k of [...usedKeys].sort()) {
  const n = (common.match(new RegExp('(^|\\n)\\s*' + k + ':\\s*\'', 'g')) || []).length;
  if (n < 3) missing.push(k + ' (' + n + '/3)');
}
console.log('\ni18n keys used by views with <3 definitions:');
console.log(missing.length ? '  ' + missing.join('\n  ') : '  none');
if (missing.length) fail++;

console.log(fail ? `\nFAILURES: ${fail}` : '\nALL OK');
process.exit(fail ? 1 : 0);
