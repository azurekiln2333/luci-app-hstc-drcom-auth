// End-to-end module test that reproduces LuCI's `require` contract:
//   - a module factory returns a constructor (subclass of baseclass)
//   - requiring a module yields an INSTANCE
//   - every method a view calls must exist on that instance
//
// It loads common.js and all four view modules with stubs and exercises the
// methods, so contract mismatches (like common.style) fail here, not on the
// router.
const fs = require('fs');
const path = require('path');

const RES = 'htdocs/luci-static/resources';
let failures = 0;
function check(cond, msg) { if (cond) console.log('  OK  ' + msg); else { console.log('  FAIL ' + msg); failures++; } }

// --- LuCI-ish runtime stubs -------------------------------------------------
function makeBaseclass() {
  function Class() {}
  Class.extend = function (props) {
    function Derived() {}
    Derived.prototype = Object.create(Class.prototype);
    Object.assign(Derived.prototype, props);
    Derived.__isSubclass = true;
    return Derived;
  };
  Class.isSubclass = (c) => typeof c === 'function' && c.__isSubclass === true;
  return Class;
}
const E = (tag, attrs, children) => ({ tag, attrs, children });
const stubs = {
  baseclass: makeBaseclass(),
  fs: { exec: () => Promise.resolve({ stdout: '' }), exec_direct: () => Promise.resolve('') },
  ui: { addNotification() {} },
  network: { getDevices: () => [] },
  form: { Map: function () {}, TypedSection: {}, Value: {}, ListValue: {}, Flag: {}, Button: {}, DummyValue: {} },
  view: { extend: (o) => o },
  dom: {}, poll: {}, uci: {}, rpc: {}
};

// Load a module file the way luci.js does: strip require/use directives, then
// call the factory with the dependency instances.
function loadModule(file) {
  let src = fs.readFileSync(file, 'utf8');
  const deps = [];
  const args = [];
  for (const line of src.split('\n')) {
    const t = line.trim();
    const m = t.match(/^'require[ \t]+(\S+?)(?:[ \t]+as[ \t]+([a-zA-Z_]\S*?))?';$/);
    if (m) {
      const dep = m[1];
      const as = m[2] || dep.replace(/[^a-zA-Z0-9_]/g, '_');
      deps.push(dep);
      args.push(as);
      continue;
    }
    if (/^'use[ \t]+strict';$/.test(t)) continue;
    if (t === '') continue;
    break; // first real statement ends the header
  }
  // Build the resolved dependency list.
  const resolved = deps.map((d) => {
    if (stubs[d]) return stubs[d];
    // resource module like hstc-drcom-auth.common -> resources/<path>.js
    const p = path.join(RES, d.replace(/\./g, '/') + '.js');
    if (fs.existsSync(p)) {
      const cls = loadModule(p);         // returns the class
      return typeof cls === 'function' ? new cls() : cls; // instance
    }
    return {};
  });
  // Stub the browser language so host Node/runner locale cannot change assertions.
  const factory = new Function('window', 'document', 'navigator', 'L', 'E', args.join(', '), src);
  const cls = factory({ localStorage: { getItem: () => null } }, {}, { language: 'zh-CN' }, {}, E, ...resolved);
  if (!stubs.baseclass.isSubclass(cls))
    throw new Error('module factory did not yield a baseclass subclass: ' + file);
  return cls;
}

function viewMethods(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/\bcommon\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)].map((m) => m[1]);
}

console.log('=== common.js ===');
const common = loadModule(path.join(RES, 'hstc-drcom-auth/common.js'));
const inst = new common();
for (const m of ['collectInterfaces', 'parseAccounts', 'makeTranslator', 'makeBaseHelpers', 'style'])
  check(typeof inst[m] === 'function', 'common.' + m + ' is a function');

console.log('=== methods used by each view exist on common ===');
const viewDir = path.join(RES, 'view/hstc-drcom-auth');
for (const f of fs.readdirSync(viewDir)) {
  const used = [...new Set(viewMethods(path.join(viewDir, f)))];
  for (const m of used) check(typeof inst[m] === 'function', f + ' -> common.' + m);
}

console.log('=== runtime behaviour ===');
const tr = inst.makeTranslator();
check(tr('title') === 'Dr.COM 认证', 'tr(title)');
const h = inst.makeBaseHelpers(tr);
check(h.htmlEscape('<a&b>') === '&lt;a&amp;b&gt;', 'htmlEscape');
check(typeof h.refreshDashboard === 'function', 'makeBaseHelpers.refreshDashboard');
check(inst.parseAccounts('acc1\tuser1\tactive').length === 1, 'parseAccounts');

console.log(failures ? `\nFAILURES: ${failures}` : '\nALL OK');
process.exit(failures ? 1 : 0);
