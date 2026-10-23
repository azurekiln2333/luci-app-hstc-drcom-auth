#!/bin/sh
# Entirely offline: real init functions and cas_auth.sh, fake UCI/network/crypto.
# Run with Git's sh.exe on Windows, or sh on Linux. All state is under mktemp.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/app"
cp "$ROOT/root/usr/share/drcom-auth/cas_auth.sh" "$ROOT/root/usr/share/drcom-auth/public_key.pem" "$TMP/app/"
export UCI_STORE="$TMP/store" UCI_MUTATIONS="$TMP/uci-mutations" MOCK_HTTP="$TMP/http"
: > "$UCI_MUTATIONS"
: > "$MOCK_HTTP"

cat > "$TMP/bin/uci" <<'EOF'
#!/bin/sh
[ "$1" != '-q' ] || shift
case "$1" in
	get) awk -v key="$2" 'index($0, key "=") == 1 { print substr($0, length(key) + 2); found=1; exit } END { if (!found) exit 1 }' "$UCI_STORE" ;;
	*) printf '%s\n' "$*" >> "$UCI_MUTATIONS"; exit 1 ;;
esac
EOF
cat > "$TMP/bin/curl" <<'EOF'
#!/bin/sh
out= cookie= headers= body= method=GET url=
while [ $# -gt 0 ]; do
	case "$1" in
		-o) out="$2"; shift 2 ;;
		-c) cookie="$2"; shift 2 ;;
		-D) headers="$2"; shift 2 ;;
		-X) method="$2"; shift 2 ;;
		--data-raw) body="$2"; shift 2 ;;
		-b|-H|-w|--connect-timeout|--max-time) shift 2 ;;
		-*) shift ;;
		*) url="$1"; shift ;;
	esac
done
printf '%s\t%s\t%s\t%s\n' "$method" "$url" "$cookie" "$body" >> "$MOCK_HTTP"
case "$url" in
	https://cas.test.invalid/cas/logout) exit 0 ;;
	https://cas.test.invalid/cas/login) ;;
	*) echo "Unexpected mock URL: $url" >&2; exit 90 ;;
esac
[ -z "$headers" ] || printf 'HTTP/1.1 302 Found\n' > "$headers"
if [ "$method" = POST ]; then
	printf '<html>mock login success for %s</html>\n' "$body" > "$out"
	printf 'cas.test.invalid\tFALSE\t/\tFALSE\t0\tTGC\tTGC-B\n' > "$cookie"
	printf 302
else
	cat > "$out" <<'PAGE'
<html><body>
<form id="fm1">
<input name="execution" value="fetched-B"/>
<input name="currentMenu" value="1"/>
<input name="failN" value="0"/>
<input name="_eventId" value="submit"/>
</form>
</body></html>
PAGE
	[ -z "$cookie" ] || : > "$cookie"
	printf 200
fi
EOF
cat > "$TMP/bin/openssl" <<'EOF'
#!/bin/sh
# Return stdin unchanged so assertions can identify the supplied mock password.
cat
EOF
for command in ifconfig logger; do
	printf '#!/bin/sh\nexit 0\n' > "$TMP/bin/$command"
done
chmod +x "$TMP/bin/"*
PATH="$TMP/bin:$PATH"
export PATH

config_load() { :; }
config_get() {
	local var="$1" section="$2" option="$3" fallback="$4" value
	value=$(uci -q get "drcom_auth.$section.$option") || value="$fallback"
	eval "$var=\$value"
}
config_foreach() {
	local callback="$1" type="$2" section
	for section in $(awk -F= -v type="$type" '$2 == type && $1 ~ /^drcom_auth\.[^.]+$/ { sub(/^drcom_auth\./, "", $1); print $1 }' "$UCI_STORE"); do
		"$callback" "$section"
	done
}
. "$ROOT/root/etc/init.d/drcom_auth"
APP_DIR="$TMP/app"
CONFIG_FILE="$APP_DIR/config.sh"
TEMPLATE_FILE="$ROOT/root/usr/share/drcom-auth/config.sh.template"
cat > "$UCI_STORE" <<'EOF'
drcom_auth.main=enabled
drcom_auth.main.active_account=accA
drcom_auth.main.hscas_url=https://cas.test.invalid
drcom_auth.accA=account
drcom_auth.accA.username=userA
drcom_auth.accA.password=passA
drcom_auth.accB=account
drcom_auth.accB.username=userB
drcom_auth.accB.password=passB
drcom_auth.settings=settings
drcom_auth.settings.username=wrong-type-user
EOF
fail() { echo "FAIL: $*" >&2; exit 1; }
contains() { grep -Fq "$2" "$1" || fail "$1 missing $2"; }
unchanged() {
	cmp "$UCI_STORE" "$TMP/store.before" || fail 'global UCI changed'
	cmp "$CONFIG_FILE" "$TMP/config.before" || fail 'global runtime config changed'
	contains "$APP_DIR/info/accounts/accA/bad_credentials" 'A lockout'
	contains "$APP_DIR/info/accounts/accA/cas_cookie.txt" 'TGC-A'
	[ ! -s "$UCI_MUTATIONS" ] || fail 'diagnostics issued a UCI write'
}

write_config
for account in accA accB; do
	dir="$APP_DIR/info/accounts/$account"
	mkdir -p "$dir"
	printf 'CAS_EXECUTION=token-%s\nCAS_CURRENT_MENU=1\nCAS_FAIL_N=0\nCAS_EVENT_ID=submit\nCAS_PARAMS_TIME=mock\n' "$account" > "$dir/cas_params.env"
	printf 'cas.test.invalid\tFALSE\t/\tFALSE\t0\tTGC\tTGC-%s\n' "${account#acc}" > "$dir/cas_cookie.txt"
	printf '<html>response-%s</html>\n' "$account" > "$dir/cas_last_response.txt"
done
printf 'A lockout\n' > "$APP_DIR/info/accounts/accA/bad_credentials"
printf 'B lockout\n' > "$APP_DIR/info/accounts/accB/bad_credentials"
cp "$UCI_STORE" "$TMP/store.before"
cp "$CONFIG_FILE" "$TMP/config.before"

cas_status accB > "$TMP/status-B"
contains "$TMP/status-B" 'params_execution=token-accB'
contains "$TMP/status-B" 'username=userB&password=__RSA__cGFzc0I%3D'
contains "$TMP/status-B" 'TGC_VALUE=TGC-B'
contains "$TMP/status-B" 'response-accB'
contains "$APP_DIR/info/accounts/accB/bad_credentials" 'B lockout'
unchanged
cas_status > "$TMP/status-A"
contains "$TMP/status-A" 'params_execution=token-accA'
contains "$TMP/status-A" 'username=userA&password=__RSA__cGFzc0E%3D'
contains "$TMP/status-A" 'TGC_VALUE=TGC-A'
contains "$TMP/status-A" 'response-accA'
unchanged
echo 'OK: explicit B status/request/response/session with global A config and lockout preserved; no-argument calls retain A'

cas_params accB > "$TMP/params-B"
contains "$TMP/params-B" 'execution=fetched-B'
contains "$TMP/params-B" 'username=userB&password=__RSA__cGFzc0I%3D'
cas_body accB > "$TMP/body-B"
contains "$TMP/body-B" 'body=username=userB&password=__RSA__cGFzc0I%3D'
cas_login accB > "$TMP/login-B"
contains "$MOCK_HTTP" 'username=userB&password=__RSA__cGFzc0I%3D'
[ ! -f "$APP_DIR/info/accounts/accB/bad_credentials" ] || fail 'B manual login did not clear its own lockout'
cas_ensure accB > "$TMP/ensure-B"
contains "$TMP/ensure-B" 'cookie=valid'
printf 'B lockout\n' > "$APP_DIR/info/accounts/accB/bad_credentials"
cas_clear_bad_credentials accB > "$TMP/clear-B"
[ ! -f "$APP_DIR/info/accounts/accB/bad_credentials" ] || fail 'B clear did not clear its own lockout'
cas_logout accB > "$TMP/logout-B"
[ ! -s "$APP_DIR/info/accounts/accB/cas_cookie.txt" ] || fail 'B logout kept its cookie'
[ ! -f "$APP_DIR/info/accounts/accB/cas_params.env" ] || fail 'B logout kept its params'
unchanged
echo 'OK: B params/body/login/ensure/logout/lockout operations stay isolated from A'

# A leftover session directory must not make a deleted UCI account valid.
mkdir -p "$APP_DIR/info/accounts/deleted"
printf stale > "$APP_DIR/info/accounts/deleted/cas_cookie.txt"
cp "$MOCK_HTTP" "$TMP/http.before"
for id in '' deleted settings main '../accA' '.' '..' 'accB/../../accA' 'accB bad' '@account[0]'; do
	for command in cas_params cas_body cas_login cas_status cas_ensure cas_logout cas_clear_bad_credentials; do
		if "$command" "$id" > "$TMP/invalid" 2>&1; then fail "$command accepted invalid account [$id]"; fi
	done
done
unchanged
cmp "$MOCK_HTTP" "$TMP/http.before" || fail 'invalid account reached CAS execution'
echo 'OK: empty/deleted/non-account/traversal IDs fail before execution without global fallback'

# Pause two real CAS invocations at the executable boundary while global A is
# re-rendered. Each invocation must keep its own B config until it exits.
printf 'CAS_EXECUTION=concurrent-B\nCAS_CURRENT_MENU=1\nCAS_FAIL_N=0\nCAS_EVENT_ID=submit\n' > "$APP_DIR/info/accounts/accB/cas_params.env"
printf 'cas.test.invalid\tFALSE\t/\tFALSE\t0\tTGC\tTGC-B\n' > "$APP_DIR/info/accounts/accB/cas_cookie.txt"
cp "$APP_DIR/cas_auth.sh" "$APP_DIR/cas_auth.real.sh"
cat > "$APP_DIR/cas_auth.sh" <<'EOF'
#!/bin/sh
printf '%s\n' "$DRCOM_CAS_CONFIG_FILE" > "$MOCK_READY"
tries=0
while [ ! -f "$MOCK_RELEASE" ]; do
	tries=$((tries + 1))
	[ "$tries" -lt 500 ] || exit 91
	sleep 0.02
done
exec sh "$(dirname "$0")/cas_auth.real.sh" "$@"
EOF
(
	trap - EXIT
	export MOCK_READY="$TMP/ready-1" MOCK_RELEASE="$TMP/release-1"
	cas_status accB > "$TMP/concurrent-1"
) &
first_pid=$!
(
	trap - EXIT
	export MOCK_READY="$TMP/ready-2" MOCK_RELEASE="$TMP/release-2"
	cas_status accB > "$TMP/concurrent-2"
) &
second_pid=$!
tries=0
while [ ! -s "$TMP/ready-1" ] || [ ! -s "$TMP/ready-2" ]; do
	tries=$((tries + 1))
	[ "$tries" -lt 500 ] || fail 'concurrent CAS processes did not become ready'
	sleep 0.02
done
first_config=$(cat "$TMP/ready-1")
second_config=$(cat "$TMP/ready-2")
[ "$first_config" != "$second_config" ] || fail 'concurrent diagnostics shared one config file'
[ "$first_config" != "$CONFIG_FILE" ] && [ "$second_config" != "$CONFIG_FILE" ] || fail 'diagnostics used the global config file'
contains "$first_config" 'USERNAME="userB"'
contains "$second_config" 'USERNAME="userB"'
(
	trap - EXIT
	. "$first_config"
	[ "$RESPONSE_DIR" = "$APP_DIR/info/accounts/accB/responses" ] || exit 1
	[ "$CAS_PUBLIC_KEY_FILE" = "$APP_DIR/info/public_key.pem" ] || exit 1
) || fail 'B response directory or shared public key path changed'
write_config
contains "$first_config" 'USERNAME="userB"'
contains "$second_config" 'USERNAME="userB"'
touch "$TMP/release-1" "$TMP/release-2"
wait "$first_pid"
wait "$second_pid"
[ ! -f "$first_config" ] && [ ! -f "$second_config" ] || fail 'temporary credential configs survived command exit'
contains "$TMP/concurrent-1" 'username=userB&password=__RSA__cGFzc0I%3D'
contains "$TMP/concurrent-2" 'username=userB&password=__RSA__cGFzc0I%3D'
unchanged
echo 'OK: concurrent B diagnostics keep distinct configs during global A render and remove them after exit'

cat > "$APP_DIR/cas_auth.sh" <<'EOF'
#!/bin/sh
printf '%s\n' "$DRCOM_CAS_CONFIG_FILE" > "$MOCK_FAILURE_CONFIG"
exit 23
EOF
export MOCK_FAILURE_CONFIG="$TMP/failed-config"
if cas_status accB > "$TMP/failure" 2>&1; then
	fail 'failed CAS command returned success'
else
	rc=$?
	[ "$rc" -eq 23 ] || fail "CAS exit code 23 became $rc"
fi
failed_config=$(cat "$MOCK_FAILURE_CONFIG")
[ ! -e "$failed_config" ] || fail 'failed CAS command retained temporary credentials'
TEMPLATE_FILE="$TMP/no-such-template"
if cas_status accB > "$TMP/render-failure" 2>&1; then fail 'renderer failure returned success'; fi
for config in "$APP_DIR/info/accounts/accB"/cas_config.*; do
	[ ! -e "$config" ] || fail 'renderer failure retained a temporary config'
done
unchanged
echo 'OK: CAS/renderer failures preserve error status and clean up temporary credential configs'
