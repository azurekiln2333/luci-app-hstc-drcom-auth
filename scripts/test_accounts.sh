#!/bin/sh
# Test account resolution + rendering: legacy migration, active account
# selection, per-account COOKIE_DIR, and multi-account listing.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INITD="$ROOT/root/etc/init.d/drcom_auth"
TEMPLATE="$ROOT/root/usr/share/drcom-auth/config.sh.template"
TMP=$(mktemp -d)

# --- fake uci + OpenWrt helpers backed by a flat store ----------------------
cat > "$TMP/uci" <<'EOF'
#!/bin/sh
S="$UCI_STORE"
case "$1" in -q) shift ;; esac
cmd="$1"; shift
key="$1"
case "$cmd" in
  get) grep "^${key}=" "$S" 2>/dev/null | head -n1 | cut -d= -f2- ;;
  set)
    kv="$1"; k="${kv%%=*}"; v="${kv#*=}"
    if grep -q "^${k}=" "$S"; then sed -i "s|^${k}=.*|${k}=${v}|" "$S"; else echo "${k}=${v}" >> "$S"; fi ;;
  delete) sed -i "/^$1=/d" "$S" 2>/dev/null || true ;;
  commit) : ;;
esac
exit 0
EOF
chmod +x "$TMP/uci"

# Minimal config_load/config_get/config_foreach shims reading the flat store.
cat > "$TMP/helpers.sh" <<'EOF'
config_load() { :; }
config_get() {
  # config_get <var> <section> <option> <default>
  local var="$1" sec="$2" opt="$3" def="$4"
  local v
  v=$(grep "^drcom_auth.${sec}.${opt}=" "$UCI_STORE" 2>/dev/null | head -n1 | cut -d= -f2-)
  eval "$var=\${v:-\$def}"
}
config_foreach() {
  # config_foreach <func> <type>
  local func="$1" type="$2"
  for line in $(grep "^drcom_auth\.[A-Za-z0-9_.-]*=account$" "$UCI_STORE" 2>/dev/null | cut -d= -f1); do
    local sec="${line#drcom_auth.}"
    "$func" "$sec"
  done
}
EOF

# Extract resolve_account/write_config from the init script (they only need
# uci, config_* and sed helpers we provide).
cat > "$TMP/render.sh" <<EOF
#!/bin/sh
APP_DIR="$TMP/app"
CONFIG_FILE="\$APP_DIR/config.sh"
TEMPLATE_FILE="$TEMPLATE"
uci_get() { config_get "\$1" main "\$2" "\$3"; }
sed_escape() { printf '%s' "\$1" | sed -e 's/[\\\\&|]/\\\\&/g'; }
. "$TMP/helpers.sh"
export PATH="$TMP:\$PATH"
export UCI_STORE="\$UCI_STORE"
EOF
sed -n '/^_collect_account()/,/^}/p' "$INITD" >> "$TMP/render.sh"
sed -n '/^resolve_account()/,/^}/p' "$INITD" >> "$TMP/render.sh"
sed -n '/^write_config()/,/^}/p' "$INITD" >> "$TMP/render.sh"
echo 'write_config' >> "$TMP/render.sh"
chmod +x "$TMP/render.sh"

run() {
  export UCI_STORE="$TMP/store"
  mkdir -p "$TMP/app"
  sh "$TMP/render.sh"
  echo "account: $(sed -n 's/^ACCOUNT_ID=//p' "$TMP/app/config.sh" | tr -d '\"')"
  echo "accounts: $(sed -n 's/^ACCOUNTS=//p' "$TMP/app/config.sh" | tr -d '\"')"
  echo "username: $(sed -n 's/^USERNAME=//p' "$TMP/app/config.sh" | tr -d '\"')"
  echo "cookie_dir: $(sed -n 's/^COOKIE_DIR=//p' "$TMP/app/config.sh" | tr -d '\"')"
}

echo "=== case 1: legacy single account -> migrated ==="
cat > "$TMP/store" <<'EOF'
drcom_auth.main=enabled
drcom_auth.main.username=202411039159
drcom_auth.main.password=secret
EOF
run

echo
echo "=== case 2: two accounts, acc2 active ==="
cat > "$TMP/store" <<'EOF'
drcom_auth.main=enabled
drcom_auth.main.active_account=acc2
drcom_auth.acc1=account
drcom_auth.acc1.username=user1
drcom_auth.acc1.password=pass1
drcom_auth.acc2=account
drcom_auth.acc2.username=user2
drcom_auth.acc2.password=pass2
EOF
run

echo
echo "=== case 3: accounts exist, no active set -> first used ==="
cat > "$TMP/store" <<'EOF'
drcom_auth.main=enabled
drcom_auth.acc1=account
drcom_auth.acc1.username=user1
drcom_auth.acc1.password=pass1
drcom_auth.acc2=account
drcom_auth.acc2.username=user2
drcom_auth.acc2.password=pass2
EOF
run

rm -rf "$TMP"
