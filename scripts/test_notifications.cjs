// Confirm no ui.addNotification call passes the raw diagnostic output, and that
// showDiag puts the raw dump behind a collapsed <details>.
const fs = require('fs');
const path = require('path');

const viewDir = 'htdocs/luci-static/resources/view/hstc-drcom-auth';
const commonPath = 'htdocs/luci-static/resources/hstc-drcom-auth/common.js';
let fail = 0;
function check(cond, msg) { console.log((cond ? '  OK  ' : '  FAIL ') + msg); if (!cond) fail++; }

console.log('=== addNotification must not carry raw output ===');
// Only the auth callers named in the task are in scope: cas_ensure, cas_login,
// ticket, cas_params, authorize. The public-key update notification lives in
// settings.js and is reported separately (not part of this requirement).
const inScope = (f) => f !== 'settings.js';
for (const f of fs.readdirSync(viewDir)) {
  if (!inScope(f)) continue;
  const src = fs.readFileSync(path.join(viewDir, f), 'utf8');
  src.split('\n').forEach((line, i) => {
    if (!/addNotification/.test(line)) return;
    // Raw-output smells: the exec message variable or a <pre> element.
    const looksRaw = /\bmessage\b/.test(line) || /'pre'|"pre"/.test(line);
    if (looksRaw) { console.log(`  RAW? ${f}:${i + 1}: ${line.trim()}`); fail++; }
  });
}
check(true, 'scan complete for in-scope callers (no RAW? lines above)');

console.log('\n=== showDiag collapses the raw dump ===');
const common = fs.readFileSync(commonPath, 'utf8');
check(/E\('details'/.test(common), 'showDiag uses <details>');
check(/E\('summary'/.test(common), 'showDiag has a <summary> label');
check(/diagSentence\(raw\)/.test(common), 'showDiag derives the short sentence');
check(!/ui\.addNotification\(null, E\('div'/.test(common), 'showDiag no longer notifies a raw block');

console.log('\n=== bad_credentials mapping present ===');
check(/'bad_credentials'/.test(common), 'diagSentence handles bad_credentials');
check(/'cas_message'|v\.cas_message/.test(common), 'uses cas_message');
check(/diagBadCredentials/.test(common), 'has the localized sentence key');

console.log(fail ? `\nFAILURES: ${fail}` : '\nALL OK');
process.exit(fail ? 1 : 0);
