#!/bin/sh
# Offline test for the hscas_login.sh 401 branch: a rejected password must write
# the bad_credentials marker so the periodic auto-reconnect loop stops retrying.
#
# No real CAS is contacted. `curl` is stubbed in a temp PATH:
#   - fetching the login page returns a minimal fm1 form
#   - fetching the public key returns a bundled key
#   - the password POST returns HTTP 401
# `openssl` is either the real one or the node shim (scripts/openssl-shim.mjs).
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/root/usr/share/drcom-auth"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/app" "$TMP/bin"
cp "$SRC"/*.sh "$SRC/public_key.pem" "$TMP/app/"

# --- stub curl --------------------------------------------------------------
# Dispatch on the URL/method:
#   .../cas/login WITHOUT -X POST  -> the login page (fm1 form)
#   .../cas/jwt/publicKey          -> the public key file
#   -X POST (login submit)         -> HTTP 401
cat > "$TMP/bin/curl" <<'EOF'
#!/bin/sh
out=""
url=""
is_post=0
while [ $# -gt 0 ]; do
	case "$1" in
		-X) [ "$2" = "POST" ] && is_post=1; shift 2 ;;
		-o) out="$2"; shift 2 ;;
		-*) shift ;;
		*) url="$1"; shift ;;
	esac
done

case "$url" in
	*pubic*|*publicKey*)
		cat "$FAKE_PUBKEY" > "$out"
		printf '200'
		;;
	*)
		if [ "$is_post" = "1" ]; then
			printf '<html><body><div id="loginError1"><el-alert title="Invalid credentials." type="error"></el-alert></div></body></html>' > "$out"
			printf '401'
		else
			cat > "$out" <<'PAGE'
<html><body>
<form id="fm1">
<input type="hidden" name="execution" value="test-execution-abc"/>
<input type="hidden" name="currentMenu" value="1"/>
<input type="hidden" name="failN" value="0"/>
<input type="hidden" name="_eventId" value="submit"/>
</form>
</body></html>
PAGE
			printf '200'
		fi
		;;
esac
EOF
chmod +x "$TMP/bin/curl"

# openssl: real one if present, else the node shim (used only to encrypt).
if command -v openssl >/dev/null 2>&1; then
	:
else
	command -v node >/dev/null 2>&1 || { echo "SKIP: need openssl or node"; exit 0; }
	cat > "$TMP/bin/openssl" <<EOF
#!/bin/sh
exec node "$ROOT/scripts/openssl-shim.mjs" "\$@"
EOF
	chmod +x "$TMP/bin/openssl"
fi

# --- config -----------------------------------------------------------------
cat > "$TMP/app/config.sh" <<EOF
SCRIPT_DIR="$TMP/app"
USER_AGENT="Mozilla/5.0 (test)"
HSCAS_URL="https://hscas.test.invalid"
HSCAS_LOGIN_URL="\$HSCAS_URL/cas/login"
HSCAS_PUBLIC_KEY_URL="\$HSCAS_URL/cas/jwt/publicKey"
USERNAME="202400000000"
PASSWORD="wrong-password"
LOG_DIR="$TMP/logs"
LOG_FILE="$TMP/logs/drcom_log.txt"
STATUS_LOG_FILE="$TMP/logs/drcom_status_log.txt"
COOKIE_DIR="$TMP/app/info"
COOKIE_FILE="\$COOKIE_DIR/cookie.txt"
HEADERS_FILE="\$COOKIE_DIR/headers.txt"
PUBLIC_KEY_FILE="\$COOKIE_DIR/public_key.pem"
DEFAULT_PUBLIC_KEY_FILE="$TMP/app/public_key.pem"
BAD_CREDS_FILE="\$COOKIE_DIR/bad_credentials"
RESPONSE_DIR="$TMP/app/responses"
POST_RESPONSE_CONTENT="\$RESPONSE_DIR/post_response.html"
GET_RESPONSE_CONTENT="\$RESPONSE_DIR/get_response.html"
THIRD_GET_RESPONSE_CONTENT="\$RESPONSE_DIR/third_get_response.html"
CHECK_LOGIN_CONTENT="\$RESPONSE_DIR/check_hotspot_content.html"
LOGIN_PAGE_CONTENT="\$RESPONSE_DIR/login_page.html"
output_status() { mkdir -p "\$(dirname "\$1")"; echo "\$2" >> "\$1"; }
mkdir -p "\$LOG_DIR" "\$COOKIE_DIR" "\$RESPONSE_DIR"
EOF

FAKE_PUBKEY="$TMP/app/public_key.pem"
export FAKE_PUBKEY
PATH="$TMP/bin:$PATH"
export PATH

echo "=== run hscas_login.sh with a stubbed 401 POST ==="
sh "$TMP/app/hscas_login.sh" "https://hscas.test.invalid/cas/login" >/dev/null 2>&1 || true

MARKER="$TMP/app/info/bad_credentials"
fail=0
if [ -s "$MARKER" ]; then
	echo "  PASS: bad_credentials marker written"
	echo "  marker content: $(cat "$MARKER")"
else
	echo "  FAIL: marker NOT written"
	fail=1
fi

# Format must match cas_auth.sh: a single "YYYY-MM-DD HH:MM:SS" line.
if [ -s "$MARKER" ]; then
	LINES=$(wc -l < "$MARKER")
	CONTENT=$(cat "$MARKER")
	case "$CONTENT" in
		[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]\ [0-9][0-9]:[0-9][0-9]:[0-9][0-9])
			echo "  PASS: marker format matches (timestamp line)"
			;;
		*) echo "  FAIL: unexpected marker format: [$CONTENT]"; fail=1 ;;
	esac
fi

# The log must mention the rejection.
if grep -q "bad credentials" "$TMP/logs/drcom_status_log.txt" 2>/dev/null; then
	echo "  PASS: status log records the rejection"
else
	echo "  FAIL: status log missing the rejection line"
	fail=1
fi

[ "$fail" -eq 0 ] && echo "ALL OK" || echo "FAILURES"
exit "$fail"
