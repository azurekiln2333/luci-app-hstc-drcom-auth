#!/bin/sh
# Test packaging/postinst ensure_default logic with a fake `uci`, proving that
# (a) existing user values are kept and (b) missing options are filled in.
set -e
POSTINST="$(cd "$(dirname "$0")/.." && pwd)/packaging/postinst"
TMP=$(mktemp -d)
mkdir -p "$TMP/bin"

# Fake uci backed by a file: drcom_auth.main.<option>=<value>
cat > "$TMP/bin/uci" <<'EOF'
#!/bin/sh
STORE="$UCI_STORE"
case "$1" in
  -q) shift ;;
esac
cmd="$1"; shift
case "$cmd" in
  get)
    key="$1"
    opt=$(printf '%s' "$key" | sed 's/^drcom_auth\.main\.//')
    grep "^$opt=" "$STORE" 2>/dev/null | head -n1 | cut -d= -f2-
    ;;
  set)
    kv="$1"
    opt=$(printf '%s' "$kv" | sed 's/^drcom_auth\.main\.//' | cut -d= -f1)
    val=$(printf '%s' "$kv" | cut -d= -f2-)
    if grep -q "^$opt=" "$STORE" 2>/dev/null; then
      sed -i "s|^$opt=.*|$opt=$val|" "$STORE"
    else
      echo "$opt=$val" >> "$STORE"
    fi
    ;;
  delete)
    opt=$(printf '%s' "$1" | sed 's/^drcom_auth\.main\.//')
    sed -i "/^$opt=/d" "$STORE" 2>/dev/null || true
    ;;
  commit) : ;;
esac
exit 0
EOF
chmod +x "$TMP/bin/uci"
PATH="$TMP/bin:$PATH"; export PATH

echo "=== case 1: old config, user values + legacy field ==="
export UCI_STORE="$TMP/store1"
cat > "$UCI_STORE" <<'EOF'
enabled=1
wan_port=eth0
username=myuser
password=mypass
term_mac=AA:BB:CC
EOF
sh "$POSTINST"
echo "--- resulting config ---"
sort "$UCI_STORE"
echo "--- assertions ---"
grep -q '^username=myuser$' "$UCI_STORE" && echo "OK kept username" || echo "FAIL username"
grep -q '^password=mypass$' "$UCI_STORE" && echo "OK kept password" || echo "FAIL password"
grep -q '^wan_port=eth0$' "$UCI_STORE" && echo "OK kept wan_port" || echo "FAIL wan_port"
grep -q '^hscas_url=https://hscas.hstc.edu.cn$' "$UCI_STORE" && echo "OK filled hscas_url" || echo "FAIL hscas_url"
grep -q '^ping_host=baidu.com$' "$UCI_STORE" && echo "OK filled ping_host" || echo "FAIL ping_host"
grep -q '^term_mac=' "$UCI_STORE" && echo "FAIL legacy term_mac still present" || echo "OK removed term_mac"

echo
echo "=== case 2: fresh install, empty config ==="
export UCI_STORE="$TMP/store2"
: > "$UCI_STORE"
sh "$POSTINST"
sort "$UCI_STORE"

rm -rf "$TMP"
