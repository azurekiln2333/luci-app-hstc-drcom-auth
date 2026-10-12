#!/bin/sh
# Verify: params are captured once and reused; status/login never refetch.
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

ex() { sh "$TMP/app/cas_auth.sh" status 2>/dev/null | sed -n 's/^params_execution=//p' | cut -c1-36; }

echo "=== 1) fetch params (explicit) ==="
sh "$TMP/app/cas_auth.sh" params >/dev/null 2>&1 || true
E1=$(ex); echo "execution: $E1"
sleep 2

echo
echo "=== 2) status x3 (must NOT change execution, no refetch) ==="
for i in 1 2 3; do
  E=$(ex)
  [ "$E" = "$E1" ] && echo "  status $i: unchanged (OK)" || echo "  status $i: CHANGED -> $E (FAIL)"
done

echo
echo "=== 3) login (must reuse saved params) ==="
sh "$TMP/app/cas_auth.sh" login >/dev/null 2>&1 || true
E2=$(sh "$TMP/app/cas_auth.sh" status | sed -n 's/^params_execution=//p' | cut -c1-36)
[ "$E2" = "$E1" ] && echo "  login reused saved params (OK)" || echo "  login changed execution (FAIL): $E2"

echo
echo "=== 4) status after login (still no refetch) ==="
E3=$(ex)
[ "$E3" = "$E1" ] && echo "  unchanged (OK)" || echo "  CHANGED (FAIL): $E3"

echo
echo "=== 5) explicit params again SHOULD refresh (logout first) ==="
# While logged in the CAS page shows the success page, so params cannot be
# re-captured. Log out first, as the user would before refreshing.
sh "$TMP/app/cas_auth.sh" logout >/dev/null 2>&1
sh "$TMP/app/cas_auth.sh" params >/dev/null 2>&1 || true
E4=$(ex)
[ -n "$E4" ] && [ "$E4" != "$E1" ] && echo "  refreshed on explicit request (OK)" || echo "  did not refresh (FAIL): $E4"

rm -rf "$TMP"
