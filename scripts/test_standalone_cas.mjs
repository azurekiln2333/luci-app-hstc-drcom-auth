// Standalone CAS test: authenticate against https://hscas.hstc.edu.cn/cas/login
// with NO Dr.COM service parameter, using only HSCAS_URL.
//
// Proves the "CAS-only" premise: scrape fm1 params, RSA-encrypt (PKCS#1 v1.5,
// identical to `openssl pkeyutl -pkeyopt rsa_padding_mode:pkcs1`), POST back.
//
// Usage: node scripts/test_standalone_cas.mjs <username> <password>

import crypto from 'node:crypto';
import https from 'node:https';

const USER = process.argv[2];
const PASS = process.argv[3];
if (!USER || !PASS) {
  console.error('usage: node scripts/test_standalone_cas.mjs <username> <password>');
  process.exit(2);
}

const CAS = 'https://hscas.hstc.edu.cn';
const LOGIN = `${CAS}/cas/login`;
const PK_URL = `${CAS}/cas/jwt/publicKey`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/85.0.4183.121 Safari/537.36';

const cookies = new Map();
function store(res) {
  for (const c of res.headers['set-cookie'] || []) {
    const [p] = c.split(';');
    const i = p.indexOf('=');
    if (i > 0) cookies.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
  }
}
function cookieHeader() {
  return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
}
function req(url, { method = 'GET', body, headers = {}, follow = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = https.request(
      {
        method,
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          'User-Agent': UA,
          ...(cookies.size ? { Cookie: cookieHeader() } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          store(res);
          const out = {
            status: res.statusCode,
            location: res.headers.location,
            body: Buffer.concat(chunks).toString('utf8'),
          };
          if (follow > 0 && res.statusCode >= 300 && res.statusCode < 400 && out.location) {
            req(new URL(out.location, url).href, { follow: follow - 1 }).then(resolve, reject);
          } else resolve(out);
        });
      },
    );
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function formField(page, id, name) {
  const lines = page.split(/\r?\n/);
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/<(el-)?form[^>]*id="fm\d+"/.test(lines[i])) {
      if (start < 0 && lines[i].includes(`id="${id}"`)) start = i;
      else if (start >= 0 && i > start) { end = i; break; }
    }
  }
  if (start < 0) return '';
  const m = lines.slice(start, end).join('\n').match(
    new RegExp(`name="${name}"[^>]*value="([^"]*)"`),
  );
  return m ? m[1] : '';
}

(async () => {
  console.log('=== GET', LOGIN, '(no service=) ===');
  const page = await req(LOGIN, { follow: 3 });
  console.log('HTTP', page.status, 'bytes', page.body.length);

  const EX = formField(page.body, 'fm1', 'execution');
  const CM = formField(page.body, 'fm1', 'currentMenu') || '1';
  const FN = formField(page.body, 'fm1', 'failN') || '0';
  const EV = formField(page.body, 'fm1', '_eventId') || 'submit';
  console.log('execution  :', EX.slice(0, 50) + '...');
  console.log('currentMenu:', CM, ' failN:', FN, ' _eventId:', EV);
  if (!EX) { console.error('no execution'); process.exit(1); }

  const pk = await req(PK_URL);
  const pw =
    '__RSA__' +
    crypto
      .publicEncrypt(
        { key: pk.body, padding: crypto.constants.RSA_PKCS1_PADDING },
        Buffer.from(PASS, 'utf8'),
      )
      .toString('base64');

  console.log('\n=== POST back to', LOGIN, '(no service=) ===');
  const body = new URLSearchParams({
    username: USER,
    password: pw,
    currentMenu: CM,
    failN: FN,
    execution: EX,
    _eventId: EV,
    geolocation: '',
    submit: '登录',
  });
  const post = await req(LOGIN, {
    method: 'POST',
    body: body.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: LOGIN },
  });
  console.log('POST HTTP', post.status);
  console.log('Location:', post.location || '(none)');
  const markers = post.body.match(
    /successRedirectUrl|登录成功|Log In Successful|用户名或密码错误|验证码|ticket=[^&"']+/g,
  );
  console.log('markers:', markers ? [...new Set(markers)] : '(none)');
  console.log('body bytes:', post.body.length);

  // Capture the resulting cookie state for the persistence check.
  console.log('\n=== cookies after login ===');
  for (const [k, v] of cookies) console.log(`  ${k} = ${v.slice(0, 30)}${v.length > 30 ? '...' : ''}`);

  process.exit(post.status === 302 ? 0 : 1);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
