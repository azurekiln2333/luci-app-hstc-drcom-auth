#!/bin/sh
# Full cas_auth.sh login test against the live server, using the openssl shim
# so it runs on a machine without OpenSSL. On a router the real openssl is used.
set -e
SCRIPT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$SCRIPT_ROOT/root/usr/share/drcom-auth"
TMP=$(mktemp -d)

mkdir -p "$TMP/app" "$TMP/bin"
cp "$SRC"/*.sh "$SRC/public_key.pem" "$TMP/app/"
# Shim named `openssl`, delegating to node.
cat > "$TMP/bin/openssl" <<EOF
#!/bin/sh
exec node "$SCRIPT_ROOT/scripts/openssl-shim.mjs" "\$@"
EOF
chmod +x "$TMP/bin/openssl"
PATH="$TMP/bin:$PATH"
export PATH

cat > "$TMP/app/config.sh" <<EOF
SCRIPT_DIR="$TMP/app"
USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.121 Safari/537.36"
HSCAS_URL="https://hscas.hstc.edu.cn"
HSCAS_LOGIN_URL="https://hscas.hstc.edu.cn/cas/login"
HSCAS_PUBLIC_KEY_URL="https://hscas.hstc.edu.cn/cas/jwt/publicKey"
USERNAME="${USERNAME:?set USERNAME}"
PASSWORD="${PASSWORD:?set PASSWORD}"
LOG_DIR="$TMP/logs"
LOG_FILE="$LOG_DIR/drcom_log.txt"
STATUS_LOG_FILE="$LOG_DIR/drcom_status_log.txt"
COOKIE_DIR="$TMP/app/info"
CAS_COOKIE_FILE="$COOKIE_DIR/cas_cookie.txt"
CAS_PARAMS_FILE="$COOKIE_DIR/cas_params.env"
CAS_PUBLIC_KEY_FILE="$COOKIE_DIR/public_key.pem"
DEFAULT_PUBLIC_KEY_FILE="$TMP/app/public_key.pem"
RESPONSE_DIR="$TMP/app/responses"
output_status() { mkdir -p "\$(dirname "\$1")"; echo "\$(date): \$2" >> "\$1"; }
mkdir -p "\$LOG_DIR" "\$COOKIE_DIR" "\$RESPONSE_DIR"
EOF

echo "########## cas_auth.sh login ##########"
# Start from a clean session: the CAS server may still report the previous
# login as active (server-side session), which would hide the fm1 form.
sh "$TMP/app/cas_auth.sh" logout >/dev/null 2>&1 || true
sh "$TMP/app/cas_auth.sh" login
echo
echo "########## cas_auth.sh status ##########"
sh "$TMP/app/cas_auth.sh" status | sed 's/\(params_execution=................................\).*/\1.../'
echo
echo "########## cookie jar ##########"
if [ -s "$TMP/app/info/cas_cookie.txt" ]; then
	cat "$TMP/app/info/cas_cookie.txt"
else
	echo "(no cookie file: server reported an already-active session)"
fi
echo
echo "########## cas_auth.sh ensure (should say valid, no re-login) ##########"
sh "$TMP/app/cas_auth.sh" ensure

echo
echo "rc=$?"
rm -rf "$TMP"
