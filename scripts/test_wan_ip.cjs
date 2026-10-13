// Verify the ip -4 -o addr parsing matches collectInterfaces() expectations.
const sample = `1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever preferred_lft forever
2: eth0    inet 192.168.101.190/19 brd 192.168.127.255 scope global eth0\\       valid_lft forever preferred_lft forever
6: wwand0    inet 10.3.15.63/32 brd 255.255.255.255 scope global wwand0\\       valid_lft forever preferred_lft forever
7: br-lan    inet 10.0.0.1/24 brd 10.0.0.255 scope global br-lan\\       valid_lft forever preferred_lft forever
8: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0\\       valid_lft forever preferred_lft forever`;

const ips = {};
sample.split('\n').forEach((l) => {
  const m = l.match(/^\s*\d+:\s+(\S+)\s+inet\s+([0-9.]+)\//);
  if (m) ips[m[1]] = m[2];
});
console.log('parsed ips:', JSON.stringify(ips, null, 2));
const expect = { lo: '127.0.0.1', eth0: '192.168.101.190', wwand0: '10.3.15.63', 'br-lan': '10.0.0.1', docker0: '172.17.0.1' };
let ok = true;
for (const [k, v] of Object.entries(expect)) {
  if (ips[k] !== v) { console.log('MISMATCH', k, ips[k], '!=', v); ok = false; }
}
console.log(ok ? 'PASS: all IPs parsed' : 'FAIL');
process.exit(ok ? 0 : 1);
