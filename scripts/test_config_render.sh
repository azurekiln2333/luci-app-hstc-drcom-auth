#!/bin/sh
# Test: render config.sh.template with sed_escape and verify special chars.
set -e
cd "$(dirname "$0")/../root/usr/share/drcom-auth"

sed_escape() { printf "%s" "$1" | sed -e 's/[\\&|]/\\&/g'; }

APP_DIR=/usr/share/drcom-auth
UA='Mozilla/5.0 (test) a&b \x y|z'
PW='p@ss&word\test|pipe'

sed \
  -e "s|__SCRIPT_DIR__|$(sed_escape "$APP_DIR")|g" \
  -e "s|__ACCOUNT_ID__|$(sed_escape acc1)|g" \
  -e "s|__ACCOUNT_IDS__|$(sed_escape "acc1 acc2")|g" \
  -e "s|__USER_AGENT__|$(sed_escape "$UA")|g" \
  -e "s|__WAN_PORT__|$(sed_escape eth1)|g" \
  -e "s|__DRCOM_SERVER_IP__|$(sed_escape 192.168.2.34)|g" \
  -e "s|__HSCAS_URL__|$(sed_escape https://hscas.hstc.edu.cn)|g" \
  -e "s|__HSCAS_PUBLIC_KEY_URL__|$(sed_escape https://hscas.hstc.edu.cn/cas/jwt/publicKey)|g" \
  -e "s|__MAC_TYPE__|$(sed_escape 2)|g" \
  -e "s|__USERNAME__|$(sed_escape 202400000000)|g" \
  -e "s|__PASSWORD__|$(sed_escape "$PW")|g" \
  -e "s|__PING_HOST__|$(sed_escape baidu.com)|g" \
  config.sh.template > /tmp/rendered.sh

sh -n /tmp/rendered.sh
grep -q '__' /tmp/rendered.sh && { echo "FAIL: unrendered placeholder"; grep -n '__' /tmp/rendered.sh; exit 1; }

# Source it in a sandbox and check exact values round-trip.
# Stub `logger` (unavailable off-router) so sourcing the template is safe.
logger() { :; }
. /tmp/rendered.sh
[ "$USER_AGENT" = "$UA" ] || { echo "FAIL UA: [$USER_AGENT] != [$UA]"; exit 1; }
[ "$PASSWORD" = "$PW" ] || { echo "FAIL PW: [$PASSWORD] != [$PW]"; exit 1; }
[ "$WAN_PORT" = "eth1" ] || { echo "FAIL WAN_PORT"; exit 1; }
[ "$ACCOUNT_ID" = "acc1" ] || { echo "FAIL ACCOUNT_ID"; exit 1; }
[ "$ACCOUNTS" = "acc1 acc2" ] || { echo "FAIL ACCOUNTS"; exit 1; }
case "$COOKIE_DIR" in *"/accounts/acc1") ;; *) echo "FAIL COOKIE_DIR per-account: $COOKIE_DIR"; exit 1 ;; esac
# The CAS public key must be global, not inside the per-account directory.
[ "$CAS_PUBLIC_KEY_FILE" = "$APP_DIR/info/public_key.pem" ] || { echo "FAIL CAS_PUBLIC_KEY_FILE not global: $CAS_PUBLIC_KEY_FILE"; exit 1; }
[ "$PUBLIC_KEY_FILE" = "$APP_DIR/info/public_key.pem" ] || { echo "FAIL PUBLIC_KEY_FILE not global: $PUBLIC_KEY_FILE"; exit 1; }
case "$CAS_PUBLIC_KEY_FILE" in *"/accounts/") echo "FAIL key under accounts dir"; exit 1 ;; esac
case "$PUBLIC_KEY_FILE" in *"/accounts/") echo "FAIL key under accounts dir"; exit 1 ;; esac

echo "OK: render + roundtrip of special characters succeeded"
