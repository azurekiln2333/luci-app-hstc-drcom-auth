#!/bin/sh
# Offline integration: real init and authentication scripts, fake UCI/HTTP/crypto.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/app" "$TMP/bin"
cp "$ROOT/root/usr/share/drcom-auth/"*.sh "$ROOT/root/usr/share/drcom-auth/public_key.pem" "$TMP/app/"
export MOCK_ROOT="$TMP" UCI_STORE="$TMP/store" UCI_MUTATIONS="$TMP/uci-mutations"
cat > "$TMP/bin/uci" <<'EOF'
#!/bin/sh
[ "$1" != -q ] || shift
case "$1" in
 get) awk -v key="$2" 'index($0, key "=") == 1 { print substr($0, length(key)+2); found=1; exit } END { if (!found) exit 1 }' "$UCI_STORE" ;;
 *) printf '%s\n' "$*" >> "$UCI_MUTATIONS"; exit 1 ;;
esac
EOF
cat > "$TMP/bin/ifconfig" <<'EOF'
#!/bin/sh
printf 'inet addr:10.0.0.2\n'
EOF
cat > "$TMP/bin/logger" <<'EOF'
#!/bin/sh
exit 0
EOF
cat > "$TMP/bin/openssl" <<'EOF'
#!/bin/sh
cat
EOF
cat > "$TMP/bin/curl" <<'EOF'
#!/bin/sh
out= cookie= headers= body= method=GET url=
while [ "$#" -gt 0 ]; do
 case "$1" in
  -o) out="$2"; shift 2 ;;
  -c) cookie="$2"; shift 2 ;;
  -D) headers="$2"; shift 2 ;;
  -X) method="$2"; shift 2 ;;
  --data-raw|--data-urlencode) body="$body $2"; shift 2 ;;
  -b|-H|-w|--connect-timeout|--max-time) shift 2 ;;
  -*) shift ;;
  *) url="$1"; shift ;;
 esac
done
cfg="${DRCOM_CONFIG_FILE:-$MOCK_ROOT/app/config.sh}"
account=$(sed -n 's/^ACCOUNT_ID="\([^"]*\)"/\1/p' "$cfg")
username=$(sed -n 's/^USERNAME="\([^"]*\)"/\1/p' "$cfg")
stage=
case "$url" in
 *eportal/portal/cas/create) stage=authorize ;;
 https://cas.test.invalid/cas/login) [ "$method" != POST ] && stage=cas_params || stage=cas_login ;;
 https://cas.test.invalid/cas/login\?service=*) [ "$method" != POST ] && stage=drcom_params || stage=drcom_login ;;
 http://192.168.2.34/verify\?ticket=*) stage=ticket_verify ;;
 http://connect.rom.miui.com/generate_204) stage=portal_probe ;;
 http://192.168.2.34/) stage=portal_details ;;
 *) echo "Unexpected mock HTTP URL: $url" >&2; exit 91 ;;
esac
printf '%s\n' "$stage" >> "$MOCK_ROOT/stages"
printf '%s\t%s\t%s\n' "$stage" "$cfg" "$(sha256sum "$cfg" | cut -d' ' -f1)" >> "$MOCK_ROOT/configs"
if [ "$MOCK_MODE" = mutate ] && [ "$stage" = authorize ]; then
 printf 'Changed global config while request in flight\n' > "$MOCK_ROOT/app/config.sh"
 sed 's/drcom_auth.accB.password=passB/drcom_auth.accB.password=changed-after-start/' "$UCI_STORE" > "$MOCK_ROOT/store.next"
 mv "$MOCK_ROOT/store.next" "$UCI_STORE"
fi
form() {
 cat <<PAGE
<html><body>
<form id="fm1">
<input name="execution" value="$1"/>
<input name="currentMenu" value="1"/>
<input name="failN" value="0"/>
<input name="_eventId" value="submit"/>
</form>
</body></html>
PAGE
}
case "$stage" in
 authorize)
  [ "$MOCK_MODE" != fail_authorize ] || exit 7
  printf '{"result":1,"authorize_uri":"https://cas.test.invalid/cas/login?service=drcom"}' ;;
 cas_params)
  [ "$MOCK_MODE" != fail_params ] || exit 7
  if [ "$MOCK_MODE" = already_cas ] || [ "$MOCK_MODE" = already_online ] || [ "$MOCK_MODE" = other_online ] || [ "$MOCK_MODE" = formless_billing_future ]; then
   printf '<html>Log In Successful</html>' > "$out"
  else
   form "fresh-$account" > "$out"
  fi
  printf 200 ;;
 cas_login)
  case "$body" in *"execution=fresh-$account"*) ;; *) echo 'Stale execution submitted' >&2; exit 92 ;; esac
  case "$body" in *"username=$username&password="*) ;; *) exit 93 ;; esac
  if [ "$MOCK_MODE" = mutate ]; then
   case "$body" in *'password=__RSA__cGFzc0I%3D'*) ;; *) echo 'Credentials changed during attempt' >&2; exit 94 ;; esac
  fi
  if [ "$MOCK_MODE" = bad_credentials ]; then
   printf '<html>Invalid credentials.</html>' > "$out"; printf 401
  else
   printf '<html>Log In Successful</html>' > "$out"
   printf 'cas.test.invalid\tFALSE\t/\tFALSE\t0\tTGC\tTGC-%s\n' "$account" > "$cookie"
   printf 302
  fi ;;
 drcom_params)
  if [ "$MOCK_MODE" = already_online ] || [ "$MOCK_MODE" = other_online ] || [ "$MOCK_MODE" = formless_billing_future ]; then
   printf '<html>Already redirected to portal</html>' > "$out"
  else
   form "service-$account" > "$out"
  fi
  printf 200 ;;
 drcom_login)
  case "$body" in *"username=$username"*"execution=service-$account"*) ;; *) exit 95 ;; esac
  if [ "$MOCK_MODE" = fail_drcom ]; then
   printf '<html>Service login failed</html>' > "$out"; printf 500
  else
   printf '<html>Ticket issued</html>' > "$out"
   printf 'HTTP/1.1 302 Found\nLocation: http://192.168.2.34/verify?ticket=TEST\n' > "$headers"
   printf 302
  fi ;;
 ticket_verify)
  printf '<html>Ticket verified</html>' > "$out"
  [ "$MOCK_MODE" != fail_ticket ] && printf 302 || printf 200 ;;
 portal_probe)
  case "$MOCK_MODE" in
   offline|billing_future|formless_billing_future) printf 200 ;;
   *) printf 204 ;;
  esac ;;
 portal_details)
  if [ "$MOCK_MODE" = billing_future ] || [ "$MOCK_MODE" = formless_billing_future ]; then
   printf "<html>uid='%s';stime='2026-01-01 00:00:00';etime='2999-12-31 23:59:59';</html>" "$username" > "$out"
  elif [ "$MOCK_MODE" = already_online ]; then
   printf "<html>uid='%s';</html>" "$username" > "$out"
  elif [ "$MOCK_MODE" = other_online ]; then
   printf "<html>uid='userA';</html>" > "$out"
  else
   printf '<html>portal</html>' > "$out"
  fi
  printf 200 ;;
esac
EOF
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
 for section in $(awk -F= -v type="$type" '$2 == type && $1 ~ /^drcom_auth\.[^.]+$/ { sub(/^drcom_auth\./, "", $1); print $1 }' "$UCI_STORE"); do "$callback" "$section"; done
}
. "$ROOT/root/etc/init.d/drcom_auth"
APP_DIR="$TMP/app"
CONFIG_FILE="$APP_DIR/config.sh"
TEMPLATE_FILE="$ROOT/root/usr/share/drcom-auth/config.sh.template"
fail() { echo "FAIL: $*" >&2; exit 1; }
contains() { grep -Fq "$2" "$1" || fail "$1 missing $2"; }
reset() {
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
EOF
 : > "$UCI_MUTATIONS"; : > "$TMP/stages"; : > "$TMP/configs"
 write_config
 cp "$CONFIG_FILE" "$TMP/global.before"
 mkdir -p "$APP_DIR/info/accounts/accA" "$APP_DIR/info/accounts/accB"
 printf 'A cookie\n' > "$APP_DIR/info/accounts/accA/cas_cookie.txt"
 printf 'A lockout\n' > "$APP_DIR/info/accounts/accA/bad_credentials"
 printf 'B lockout\n' > "$APP_DIR/info/accounts/accB/bad_credentials"
 printf 'CAS_EXECUTION=stale-consumed-token\nCAS_CURRENT_MENU=1\nCAS_FAIL_N=0\nCAS_EVENT_ID=submit\n' > "$APP_DIR/info/accounts/accB/cas_params.env"
 printf 'cas.test.invalid\tFALSE\t/\tFALSE\t0\tTGC\told-valid-TGC\n' > "$APP_DIR/info/accounts/accB/cas_cookie.txt"
 MOCK_MODE=normal; export MOCK_MODE
}
cleaned() {
 for file in "$APP_DIR/info/accounts/accB"/auth_config.*; do [ ! -e "$file" ] || fail 'temporary credentials/output remained'; done
 [ ! -s "$UCI_MUTATIONS" ] || fail 'authentication changed global UCI'
 contains "$APP_DIR/info/accounts/accA/cas_cookie.txt" 'A cookie'
 contains "$APP_DIR/info/accounts/accA/bad_credentials" 'A lockout'
 if grep -Eq 'password=|execution=|__RSA__|TGC-' "$TMP/result"; then fail 'RPC output leaked authentication data'; fi
}
reset
authenticate accB > "$TMP/result"
contains "$TMP/result" 'authenticated=1'
contains "$TMP/result" 'portal=online'
expected='authorize cas_params cas_login drcom_params drcom_login ticket_verify portal_probe portal_details'
[ "$(tr '\n' ' ' < "$TMP/stages" | sed 's/ $//')" = "$expected" ] || fail 'authentication stages differ from diagnostics'
[ "$(cut -f2 "$TMP/configs" | sort -u | wc -l | tr -d ' ')" -eq 1 ] || fail 'stages used different config snapshots'
[ "$(cut -f3 "$TMP/configs" | sort -u | wc -l | tr -d ' ')" -eq 1 ] || fail 'config changed during stages'
cmp "$CONFIG_FILE" "$TMP/global.before" || fail 'global config changed'
[ ! -e "$APP_DIR/info/accounts/accB/bad_credentials" ] || fail 'manual connect kept its lockout'
cleaned
echo 'OK: one-click runs diagnostic stages in order, refreshes stale params, verifies Dr.COM, and preserves account A'

reset
MOCK_MODE=already_cas
authenticate accB > "$TMP/result"
contains "$TMP/result" 'authenticated=1'
! grep -qx cas_login "$TMP/stages" || fail 'already logged-in CAS reposted a stale execution'
contains "$TMP/stages" 'drcom_login'
contains "$TMP/stages" 'ticket_verify'
cleaned
echo 'OK: CAS already logged in still completes Dr.COM instead of returning after its cookie check'

reset
MOCK_MODE=already_online
authenticate accB > "$TMP/result"
contains "$TMP/result" 'authenticated=1'
contains "$TMP/result" 'portal_uid=userB'
contains "$TMP/stages" 'drcom_params'
! grep -qx drcom_login "$TMP/stages" || fail 'already authenticated account needlessly reposted credentials'
cleaned
reset
MOCK_MODE=other_online
if authenticate accB > "$TMP/result"; then fail 'account A online was accepted as account B'; fi
contains "$TMP/result" 'stage=drcom'
contains "$TMP/result" 'authenticated=0'
cleaned
echo 'OK: a form-less Dr.COM redirect succeeds only for the same authenticated portal account'

for mode in billing_future formless_billing_future; do
 reset
 MOCK_MODE="$mode"
 if authenticate accB > "$TMP/result"; then fail "$mode bypassed a failed connectivity probe"; fi
 contains "$TMP/result" 'authenticated=0'
 if [ "$mode" = billing_future ]; then
  contains "$TMP/result" 'stage=verify'
  contains "$TMP/stages" 'ticket_verify'
 else
  contains "$TMP/result" 'stage=drcom'
  ! grep -qx drcom_login "$TMP/stages" || fail 'form-less failed probe posted credentials'
 fi
 [ "$(tail -n 1 "$TMP/stages")" = portal_details ] || fail "$mode continued after failed verification"
 cleaned
done
echo 'OK: historical portal account details and a future billing end never override HTTP 200, including form-less redirects'

for mode in fail_authorize fail_params bad_credentials fail_drcom fail_ticket offline; do
 reset
 MOCK_MODE="$mode"
 if authenticate accB > "$TMP/result"; then fail "$mode returned success"; else rc=$?; fi
 contains "$TMP/result" 'authenticated=0'
 case "$mode" in
  fail_authorize) stage=authorize; last=authorize ;;
  fail_params) stage=cas_params; last=cas_params ;;
  bad_credentials) stage=cas_login; last=cas_login; contains "$TMP/result" 'diagnosis=bad_credentials'; [ "$rc" -eq 3 ] || fail 'CAS rejection exit status changed' ;;
  fail_drcom) stage=drcom; last=drcom_login ;;
  fail_ticket) stage=drcom; last=ticket_verify; [ "$rc" -eq 3 ] || fail 'ticket failure exit status changed' ;;
  offline) stage=verify; last=portal_details ;;
 esac
 contains "$TMP/result" "stage=$stage"
 [ "$(tail -n 1 "$TMP/stages")" = "$last" ] || fail "$mode continued after failure"
 cleaned
done
echo 'OK: every failing stage stops, preserves its status, and never reports a cookie or ticket as online'

reset
MOCK_MODE=mutate
authenticate accB > "$TMP/result"
contains "$TMP/result" 'authenticated=1'
[ "$(cut -f3 "$TMP/configs" | sort -u | wc -l | tr -d ' ')" -eq 1 ] || fail 'attempt observed changed credentials'
cleaned
echo 'OK: changing global config and B credentials mid-request cannot replace the captured account/config'

reset
ticket accB > "$TMP/result"
[ "$(tr '\n' ' ' < "$TMP/stages" | sed 's/ $//')" = 'authorize drcom_params drcom_login ticket_verify' ] || fail 'diagnostic ticket does not reuse the Dr.COM stage'
cmp "$CONFIG_FILE" "$TMP/global.before" || fail 'diagnostic ticket overwrote global config'
cleaned
reset
for id in '' missing '../accA' 'accB/../accA'; do
 if authenticate "$id" > "$TMP/result" 2>&1; then fail "accepted invalid account $id"; fi
done
[ ! -s "$TMP/stages" ] || fail 'invalid account performed network requests'
echo 'OK: diagnostic ticket accepts the selected account; invalid accounts never fall back to global credentials'
