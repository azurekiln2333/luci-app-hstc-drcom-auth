// Unit test for the interface-collection logic used by collectInterfaces().
// Feed it sample `uci show network` + `ls /sys/class/net` output and check the
// resulting dropdown list.
import assert from 'node:assert';

function buildInterfaces(uci, ls, current) {
  const out = {};
  const logical = {};
  const ifaces = {};
  const isVirtual = (n) => !n || n === 'lo' || n === 'docker0' || n === 'ip6tnl0' || n === 'dummy0' || n.charAt(0) === '@';
  uci.split('\n').forEach((l) => {
    const m = l.match(/^network\.([^.[]+)\.device='([^']+)'/);
    if (m) ifaces[m[1]] = m[2];
  });
  ls.split('\n').forEach((raw) => {
    const n = raw.trim();
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
  const bestLabel = {};
  Object.keys(ifaces).forEach((lname) => {
    const dev = ifaces[lname];
    if (isVirtual(dev)) return;
    if (out[dev] === undefined) out[dev] = dev;
    if (bestLabel[dev] === undefined || labelScore(lname) > labelScore(bestLabel[dev]))
      bestLabel[dev] = lname;
  });
  Object.keys(bestLabel).forEach((dev) => { logical[dev] = bestLabel[dev]; });
  const devices = Object.keys(out).sort();
  if (current && devices.indexOf(current) < 0) devices.push(current);
  return { devices, logical };
}

const uci = `network.loopback=interface
network.loopback.device='lo'
network.lan=interface
network.lan.device='br-lan'
network.wan=interface
network.wan.device='eth0'
network.wan6=interface
network.wan6.device='eth0'
network.@device[0]=device
network.@device[0].name='br-lan'`;

const ls = `br-lan
docker0
dummy0
eth0
eth1
ip6tnl0
lo
wwand0`;
const r = buildInterfaces(uci, ls, 'eth1');
console.log('devices:', r.devices.join(', '));
console.log('labels:');
for (const d of r.devices) {
  const l = r.logical[d];
  console.log('  ' + d + ' -> ' + ((l && l !== d) ? (l + ' (' + d + ')') : d));
}

assert(r.devices.includes('eth0'), 'eth0 present');
assert(r.devices.includes('eth1'), 'eth1 present');
assert(r.devices.includes('wwand0'), 'wwand0 present');
assert(r.devices.includes('br-lan'), 'br-lan present');
assert(!r.devices.includes('lo'), 'lo excluded');
assert(!r.devices.includes('docker0'), 'docker0 excluded');
assert(!r.devices.includes('dummy0'), 'dummy0 excluded');
assert.equal(r.logical.eth0, 'wan', 'eth0 labelled as wan, not wan6');
assert.equal(r.logical['br-lan'], 'lan', 'br-lan labelled as lan');

// Offline saved value must be kept.
const r2 = buildInterfaces(uci, 'eth0\n', 'eth9');
assert(r2.devices.includes('eth9'), 'offline saved value kept');
console.log('\nALL OK');
