#!/bin/sh
# Verify the single coherent session state in cas_status.
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
USERNAME="${USERNAME:?}"; PASSWORD="${PASSWORD:?}"
LOG_DIR="$TMP/logs"; LOG_FILE="$TMP/logs/a"; STATUS_LOG_FILE="$TMP/logs/s"
COOKIE_DIR="$TMP/app/info"; RESPONSE_DIR="$TMP/app/responses"
output_status() { mkdir -p "\$(dirname "\$1")"; echo "\$2" >> "\$1"; }
mkdir -p "\$LOG_DIR" "\$COOKIE_DIR" "\$RESPONSE_DIR"
EOF

st() { sh "$TMP/app/cas_auth.sh" status | grep -E '^(cookie|session)=' | tr '\n' ' '; echo; }

echo "=== 1) clean state (logout) -> expect cookie=absent session=inactive ==="
sh "$TMP/app/cas_auth.sh" logout >/dev/null 2>&1
st

echo
echo "=== 2) after login -> expect cookie=valid session=active ==="
sh "$TMP/app/cas_auth.sh" login >/dev/null 2>&1 || true
st

echo
echo "=== 3) delete local cookie, server session likely active ==="
rm -f "$TMP/app/info/cas_cookie.txt"
st
echo "    (session must NOT be reported together with an invalid-cookie claim)"

rm -rf "$TMP"
