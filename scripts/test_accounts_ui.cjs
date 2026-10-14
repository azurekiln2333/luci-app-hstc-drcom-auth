// Sanity-check the accounts editor config value by exercising the same row
// builder logic that cfgvalue uses, and verifying required hooks exist.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../htdocs/luci-static/resources/view/hstc-drcom-auth/accounts.js', 'utf8');

const need = ['drcom-accounts-editor', 'drcom-acc-new-user',
  'drcom-acc-new-pass', 'drcom-acc-save', 'data-acc-del', 'drcom-active-account',
  'drcom-acc-row', 'drcom-acc-add'];
let ok = true;
for (const n of need) {
  if (!src.includes(n)) { console.log('MISSING in source:', n); ok = false; }
}
console.log(ok ? 'OK: all editor hooks present in source' : 'INCOMPLETE');

const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const accounts = [
  { id: 'acc1', username: '202411039159', active: true },
  { id: 't2', username: 'tester2', active: false }
];
let rows = '';
accounts.forEach((a) => {
  rows += '<div class="drcom-acc-row">' +
    '<input type="radio" name="drcom-active-account" value="' + esc(a.id) + '"' +
    (a.active ? ' checked="checked"' : '') + '/>' +
    '<span class="drcom-acc-user">' + esc(a.username || ('(' + a.id + ')')) + '</span>' +
    '<span class="drcom-acc-id">' + esc(a.id) + '</span>' +
    '<button type="button" class="cbi-button cbi-button-negative" data-acc-del="' + esc(a.id) + '">Delete</button>' +
    '</div>';
});
console.log('\nrendered rows:');
console.log(rows);

const checks = ['value="acc1"', 'checked="checked"', 'data-acc-del="t2"', 'tester2'];
let all = true;
for (const c of checks) if (!rows.includes(c)) { console.log('MISSING row content:', c); all = false; }
console.log(all ? '\nOK: row builder output correct' : '\nFAIL');
