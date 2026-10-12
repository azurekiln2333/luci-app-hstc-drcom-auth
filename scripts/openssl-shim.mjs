#!/usr/bin/env node
// Minimal `openssl` shim for local testing of cas_auth.sh on machines without
// OpenSSL. Supports only the two invocations the script uses:
//   openssl pkeyutl -encrypt -pubin -inkey KEY -pkeyopt rsa_padding_mode:pkcs1
//   openssl rsautl  -encrypt -pubin -inkey KEY -pkcs
// Reads plaintext from stdin, writes raw ciphertext bytes to stdout.
import fs from 'node:fs';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const keyIdx = args.indexOf('-inkey');
if (keyIdx < 0) {
  console.error('openssl-shim: only -inkey forms are supported');
  process.exit(1);
}
const key = fs.readFileSync(args[keyIdx + 1]);
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const plain = Buffer.concat(chunks);
try {
  const out = crypto.publicEncrypt(
    { key, padding: crypto.constants.RSA_PKCS1_PADDING },
    plain,
  );
  process.stdout.write(out);
} catch (e) {
  console.error('openssl-shim error:', e.message);
  process.exit(1);
}
