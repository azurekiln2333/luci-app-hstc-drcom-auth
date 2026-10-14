#!/bin/sh
# Verify cas_auth.sh emits a diagnosis= block on failure so LuCI can show it.
set -e
SCRIPT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$SCRIPT_ROOT/root/usr/share/drcom-auth"
TMP=$(mktemp -d)
mkdir -p "$TMP/app"
cp "$SRC"/*.sh "$SRC/public_key.pem" "$TMP/app/"

run_case() {
	label="$1"; url="$2"
	echo "########## $label ##########"
	sed "s|^HSCAS_URL=.*|HSCAS_URL=\"$url\"|" "$TMP/app/config.sh" > "$TMP/app/config.new"
	mv "$TMP/app/config.new" "$TMP/app/config.sh"
	sh "$TMP/app/cas_auth.sh" params 2>&1 | sed 's/\(page_head=.\{80\}\).*/\1.../'
	echo "exit=$?"
	echo
}

cat > "$TMP/app/config.sh" <<EOF
SCRIPT_DIR="$TMP/app"
USER_AGENT="Mozilla/5.0"
HSCAS_URL="https://hscas.hstc.edu.cn"
HSCAS_LOGIN_URL="\$HSCAS_URL/cas/login"
HSCAS_PUBLIC_KEY_URL="\$HSCAS_URL/cas/jwt/publicKey"
USERNAME=u; PASSWORD=p
LOG_DIR="$TMP/logs"; LOG_FILE="$TMP/logs/a.txt"; STATUS_LOG_FILE="$TMP/logs/s.txt"
COOKIE_DIR="$TMP/app/info"; CAS_COOKIE_FILE="$COOKIE_DIR/cas_cookie.txt"
CAS_PARAMS_FILE="$COOKIE_DIR/cas_params.env"; CAS_PUBLIC_KEY_FILE="$TMP/app/info/public_key.pem"
DEFAULT_PUBLIC_KEY_FILE="$TMP/app/public_key.pem"; RESPONSE_DIR="$TMP/app/responses"
CAS_HEADERS="$COOKIE_DIR/cas_headers.txt"; CAS_POST_BODY="$RESPONSE_DIR/p.html"
CAS_LOGIN_PAGE="$RESPONSE_DIR/cas_login_page.html"
output_status() { mkdir -p "\$(dirname "\$1")"; echo "\$2" >> "\$1"; }
mkdir -p "\$LOG_DIR" "\$COOKIE_DIR" "\$RESPONSE_DIR"
EOF

run_case "DNS failure (bad host)" "https://no-such-host.invalid"
run_case "connection refused (bad port)" "https://127.0.0.1:9"
run_case "404 page (wrong url)" "https://hscas.hstc.edu.cn/nope"

rm -rf "$TMP"
