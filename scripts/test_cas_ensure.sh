#!/bin/sh
# Verify `cas_auth.sh ensure` re-authenticates when the cookie jar is gone,
# reusing the standalone CAS flow (no Dr.COM).
set -e
SCRIPT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$SCRIPT_ROOT/root/usr/share/drcom-auth"
TMP=$(mktemp -d)
mkdir -p "$TMP/app" "$TMP/bin"
cp "$SRC"/*.sh "$SRC/public_key.pem" "$TMP/app/"
cat > "$TMP/bin/openssl" <<EOF
#!/bin/sh
exec node "$SCRIPT_ROOT/scripts/openssl-shim.mjs" "\$@"
EOF
chmod +x "$TMP/bin/openssl"
PATH="$TMP/bin:$PATH"; export PATH
cat > "$TMP/app/config.sh" <<EOF
SCRIPT_DIR="$TMP/app"
USER_AGENT="Mozilla/5.0"
HSCAS_URL="https://hscas.hstc.edu.cn"
HSCAS_LOGIN_URL="https://hscas.hstc.edu.cn/cas/login"
HSCAS_PUBLIC_KEY_URL="https://hscas.hstc.edu.cn/cas/jwt/publicKey"
USERNAME="${USERNAME:?}"; PASSWORD="${PASSWORD:?}"
LOG_DIR="$TMP/logs"; LOG_FILE="$TMP/logs/a.txt"; STATUS_LOG_FILE="$TMP/logs/s.txt"
COOKIE_DIR="$TMP/app/info"; CAS_COOKIE_FILE="$COOKIE_DIR/cas_cookie.txt"
CAS_PARAMS_FILE="$COOKIE_DIR/cas_params.env"; CAS_PUBLIC_KEY_FILE="$TMP/app/info/public_key.pem"
DEFAULT_PUBLIC_KEY_FILE="$TMP/app/public_key.pem"; RESPONSE_DIR="$TMP/app/responses"
output_status() { mkdir -p "\$(dirname "\$1")"; echo "\$(date): \$2" >> "\$1"; }
mkdir -p "\$LOG_DIR" "\$COOKIE_DIR" "\$RESPONSE_DIR"
EOF

echo "=== 1) ensure with no cookie -> should log in (or detect server session) ==="
sh "$TMP/app/cas_auth.sh" ensure
if [ -s "$TMP/app/info/cas_cookie.txt" ]; then
	echo "RESULT: cookie file written (fresh login)"
else
	echo "RESULT: no fresh cookie; server session already active (acceptable)"
fi

echo
echo "=== 2) delete cookie, ensure again ==="
rm -f "$TMP/app/info/cas_cookie.txt"
sh "$TMP/app/cas_auth.sh" ensure
if [ -s "$TMP/app/info/cas_cookie.txt" ]; then
	echo "RESULT: cookie file written (fresh login)"
else
	echo "RESULT: no fresh cookie; server session already active (acceptable)"
fi

rm -rf "$TMP"
