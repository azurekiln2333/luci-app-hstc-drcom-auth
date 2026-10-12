#!/bin/sh
# Prove that setting hscas_url to the FULL login URL no longer produces a
# doubled /cas/login/cas/login path.
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
chmod +x "$TMP/bin/openssl"; PATH="$TMP/bin:$PATH"; export PATH

for input in \
  "https://hscas.hstc.edu.cn" \
  "https://hscas.hstc.edu.cn/cas/login" \
  "https://hscas.hstc.edu.cn/cas/login/"
do
  cat > "$TMP/app/config.sh" <<EOF
SCRIPT_DIR="$TMP/app"
USER_AGENT="Mozilla/5.0"
HSCAS_URL="$input"
USERNAME=x; PASSWORD=y
LOG_DIR="$TMP/logs"; LOG_FILE="$TMP/logs/a"; STATUS_LOG_FILE="$TMP/logs/s"
COOKIE_DIR="$TMP/app/info"; RESPONSE_DIR="$TMP/app/responses"
output_status() { mkdir -p "\$(dirname "\$1")"; echo "\$2" >> "\$1"; }
mkdir -p "\$LOG_DIR" "\$COOKIE_DIR" "\$RESPONSE_DIR"
EOF
  printf 'input : %s\n' "$input"
  printf '  login_url : %s\n' "$(sh "$TMP/app/cas_auth.sh" status | sed -n 's/^login_url=//p')"
  printf '  params    : %s\n\n' "$(sh "$TMP/app/cas_auth.sh" params 2>&1 | grep -c '^form=fm1')"
done

rm -rf "$TMP"
