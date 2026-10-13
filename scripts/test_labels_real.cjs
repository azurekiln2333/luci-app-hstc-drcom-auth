// Run the exact label logic from collectInterfaces() against this router's
// real state (captured via ssh into devnet.txt) and print the dropdown.
const fs = require('fs');
const raw = fs.readFileSync(process.argv[2], 'utf8');
const parts = raw.split('===NETDEV===');
const uci = parts[0] || '';
const ls = parts[1] || '';

const out = {}, logical = {}, ifaces = {};
const isVirtual = (n) => !n || n === 'lo' || n === 'docker0' || n === 'ip6tnl0' || n === 'dummy0' || n.charAt(0) === '@';
uci.split('\n').forEach((l) => {
  const m = l.match(/^network\.([^.[]+)\.device='([^']+)'/);
  if (m) ifaces[m[1]] = m[2];
});
ls.split('\n').forEach((r) => {
  const n = r.trim();
  if (isVirtual(n)) return;
  out[n] = n;
  logical[n] = ifaces[n] || null;
});
const labelScore = (name) => {
  let s = 0;
  if (/(?:^|[^0-9])6$/.test(name)) s -= 10;
  if (name === 'wan') s += 5;
  if (name.indexOf('wwan') === 0) s += 2;
  s -= name.length * 0.01;
  return s;
};
const best = {};
Object.keys(ifaces).forEach((lname) => {
  const dev = ifaces[lname];
  if (isVirtual(dev)) return;
  if (out[dev] === undefined) out[dev] = dev;
  if (best[dev] === undefined || labelScore(lname) > labelScore(best[dev])) best[dev] = lname;
});
Object.keys(best).forEach((d) => { logical[d] = best[d]; });

console.log('ifaces:', JSON.stringify(ifaces));
console.log('dropdown:');
Object.keys(out).sort().forEach((d) => {
  const l = logical[d];
  console.log('  ' + ((l && l !== d) ? (l + ' (' + d + ')') : d));
});
console.log('eth0 label =', logical.eth0);
if (logical.eth0 === 'wan') console.log('PASS: wan wins over wan6');
else console.log('FAIL: eth0 label is ' + logical.eth0);
