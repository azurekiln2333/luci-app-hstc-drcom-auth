// Verify the credential-failure mapping: a 401 diagnostic dump must become the
// short bad_credentials sentence, and the notification text must never contain
// the raw password= or execution= fields.
//
// Mirrors the logic in common.js diagSentence() so it can run without a browser.
const assert = require('node:assert');

// --- copy of the mapping under test (kept in sync with common.js) -----------
const DICT_ZH = {
  diagBadCredentials: 'CAS 认证失败：账号或密码错误',
  diagBadCredentialsMsg: 'CAS 认证失败：账号或密码错误（%s）',
  diagAlreadyLoggedIn: 'CAS 会话已处于登录状态。',
  diagBadLoginForm: 'CAS 登录页解析失败，请重试。',
  diagCurlFailed: '网络请求失败，请检查网络后重试。',
  diagUnexpectedHttp: 'CAS 返回了异常状态码，请重试。',
  diagRejected: 'CAS 拒绝了本次登录。',
  diagGeneric: '认证失败，请查看诊断详情。'
};

function format(text, ...args) {
  let i = 0;
  return text.replace(/%s/g, () => args[i++] || '');
}
function tr(k) { return DICT_ZH[k] || k; }
function parseDiag(raw) {
  const v = {};
  String(raw || '').split('\n').forEach((line) => {
    const eq = line.indexOf('=');
    if (eq > 0) v[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  });
  return v;
}
function diagSentence(raw) {
  const v = parseDiag(raw);
  switch (v.diagnosis) {
    case 'bad_credentials':
      return v.cas_message ? format(tr('diagBadCredentialsMsg'), v.cas_message) : tr('diagBadCredentials');
    case 'already logged in': return tr('diagAlreadyLoggedIn');
    case 'login form fm1 not found in page': return tr('diagBadLoginForm');
    case 'curl failed': return tr('diagCurlFailed');
    case 'unexpected HTTP status': return tr('diagUnexpectedHttp');
    case 'login rejected by CAS': return tr('diagRejected');
    default: return tr('diagGeneric');
  }
}

let fail = 0;
function check(cond, msg) { console.log((cond ? '  OK  ' : '  FAIL ') + msg); if (!cond) fail++; }

// --- a realistic 401 dump (contains secrets that must NOT leak) -------------
const dump401 = [
  'diagnosis=bad_credentials',
  'cas_message=Invalid credentials.',
  'http_code=401',
  'login_url=https://hscas.hstc.edu.cn/cas/login',
  'page_saved=/usr/share/drcom-auth/responses/cas_post_response.html',
  'execution=SECRET_EXECUTION_TOKEN_SHOULD_NOT_LEAK',
  'body=username=202411039159&password=__RSA__SECRETCIPHER&execution=SECRET',
  'page_head=<!DOCTYPE html>...password=__RSA__SECRETCIPHER'
].join('\n');

const sentence = diagSentence(dump401);
console.log('sentence:', sentence);
check(/账号或密码错误/.test(sentence), 'maps to "wrong username or password"');
check(/Invalid credentials\./.test(sentence), 'includes the server message');
check(!/password=/.test(sentence), 'sentence has no password= field');
check(!/execution=/.test(sentence), 'sentence has no execution= field');
check(!/__RSA__/.test(sentence), 'sentence has no RSA ciphertext');

// --- bad_credentials without a server message ------------------------------
const noMsg = diagSentence('diagnosis=bad_credentials\ncas_message=\nhttp_code=401');
console.log('no-message sentence:', noMsg);
check(noMsg === 'CAS 认证失败：账号或密码错误', 'falls back when cas_message empty');
check(!/password=|execution=/.test(noMsg), 'no-message sentence leaks nothing');

// --- other diagnoses keep a short sentence, never the raw dump -------------
const cases = {
  'already logged in': 'already',
  'login form fm1 not found in page': 'form',
  'curl failed': 'curl',
  'unexpected HTTP status': 'http',
  'login rejected by CAS': 'rejected',
  'something-else': 'generic'
};
for (const [d, label] of Object.entries(cases)) {
  const s = diagSentence('diagnosis=' + d + '\npassword=__RSA__X\nexecution=Y');
  check(s && s.length < 60, `${label}: short sentence`);
  check(!/password=|execution=|__RSA__/.test(s), `${label}: no secrets`);
}

// --- backend rule: only a 401 is treated as bad credentials -----------------
// A re-served login page can also mean a captcha or an expired execution, so it
// must NOT produce bad_credentials (that would stop the retry loop forever).
console.log('\n=== backend bad_credentials rule (source inspection) ===');
const fs = require('node:fs');
const casAuth = fs.readFileSync('root/usr/share/drcom-auth/cas_auth.sh', 'utf8');
check(/if \[ "\$http_code" = "401" \]; then/.test(casAuth), 'cas_auth: bad_credentials only on 401');
check(!/page_is_login_form/.test(casAuth), 'cas_auth: page_is_login_form removed');
check(!/\|\| \[ -n "\$cas_message" \]/.test(casAuth), 'cas_auth: cas_message not a trigger');
check(!/save_cas_response\(\) \{\t/.test(casAuth), 'cas_auth: save_cas_response not merged');

const hscas = fs.readFileSync('root/usr/share/drcom-auth/hscas_login.sh', 'utf8');
check(/if \[ "\$POST_RESPONSE" -eq 401 \]; then/.test(hscas), 'hscas_login: writes marker on 401');
check(/bad_credentials/.test(hscas), 'hscas_login: marker filename');
check(/date '\+%Y-%m-%d %H:%M:%S'/.test(hscas), 'hscas_login: same timestamp format');

console.log(fail ? `\nFAILURES: ${fail}` : '\nALL OK');
process.exit(fail ? 1 : 0);
