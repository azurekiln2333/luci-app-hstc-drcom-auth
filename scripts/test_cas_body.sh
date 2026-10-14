#!/bin/sh
# Show cas_auth.sh `body` output against the live server and verify the login
# still succeeds with the assembled (url-encoded, --data-raw) body.
set -e
SCRIPT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$SCRIPT_ROOT/root/usr/share/drcom-auth"
TMP=$(mktemp -d)
mkdir -p "$TMP/app" "$TMP/bin"
cp "$SRC"/*.sh "$SRC/public_key.pem" "$TMP/app/"
if ! command -v openssl >/dev/null 2>&1; then
  cat > "$TMP/bin/openssl" <<EOF
#!/bin/sh
exec node "$SCRIPT_ROOT/scripts/openssl-shim.mjs" "\$@"
EOF
  chmod +x "$TMP/bin/openssl"; PATH="$TMP/bin:$PATH"; export PATH
fi

cat > "$TMP/app/config.sh" <<EOF
SCRIPT_DIR="$TMP/app"
USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
HSCAS_URL="https://hscas.hstc.edu.cn"
HSCAS_LOGIN_URL="https://hscas.hstc.edu.cn/cas/login"
HSCAS_PUBLIC_KEY_URL="https://hscas.hstc.edu.cn/cas/jwt/publicKey"
USERNAME="${USERNAME:?}"; PASSWORD="${PASSWORD:?}"
LOG_DIR="$TMP/logs"; LOG_FILE="$TMP/logs/a.txt"; STATUS_LOG_FILE="$TMP/logs/s.txt"
COOKIE_DIR="$TMP/app/info"; CAS_COOKIE_FILE="$COOKIE_DIR/cas_cookie.txt"
CAS_PARAMS_FILE="$COOKIE_DIR/cas_params.env"; CAS_PUBLIC_KEY_FILE="$TMP/app/info/public_key.pem"
DEFAULT_PUBLIC_KEY_FILE="$TMP/app/public_key.pem"; RESPONSE_DIR="$TMP/app/responses"
CAS_HEADERS="$COOKIE_DIR/cas_headers.txt"; CAS_POST_BODY="$RESPONSE_DIR/cas_post_response.html"
output_status() { mkdir -p "\$(dirname "\$1")"; echo "\$(date): \$2" >> "\$1"; }
mkdir -p "\$LOG_DIR" "\$COOKIE_DIR" "\$RESPONSE_DIR"
EOF

echo "########## cas_auth.sh params ##########"
sh "$TMP/app/cas_auth.sh" params | sed 's/\(execution=......................\).*/\1.../'

echo
echo "########## cas_auth.sh body ##########"
sh "$TMP/app/cas_auth.sh" body | sed -e 's/\(body=.\{80\}\).*/\1.../' -e 's/\(execution=[^&]\{24\}\).*/\1.../'

echo
echo "########## verify the shown body is exactly what is sent, then log in ##########"
sh "$TMP/app/cas_auth.sh" login
sh "$TMP/app/cas_auth.sh" status | grep -E 'cookie=|last_result|TGC='

rm -rf "$TMP"
