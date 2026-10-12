#!/bin/sh
# Verify: params persists immediately, and a later login REUSES the persisted
# params instead of refetching (execution stays identical), then still logs in.
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

echo "=== 1) fetch params ==="
EX1=$(sh "$TMP/app/cas_auth.sh" params | sed -n 's/^execution=//p')
echo "execution: $(printf '%s' "$EX1" | cut -c1-40)..."
echo "persisted file exists: $([ -s "$TMP/app/info/cas_params.env" ] && echo yes || echo no)"
grep -c '^CAS_CAPTURED_EPOCH=' "$TMP/app/info/cas_params.env" >/dev/null && echo "has epoch: yes"

echo
echo "=== 2) login (should REUSE, execution unchanged) ==="
sh "$TMP/app/cas_auth.sh" login
EX2=$(sh "$TMP/app/cas_auth.sh" status | sed -n 's/^params_execution=//p')
if [ "$EX1" = "$EX2" ]; then echo "REUSED: execution identical"; else echo "REFETCHED: execution changed"; fi
sh "$TMP/app/cas_auth.sh" status | grep -E 'last_result|cookie='
echo
echo "=== 3) log tail ==="
tail -n 4 "$TMP/logs/s"

rm -rf "$TMP"
