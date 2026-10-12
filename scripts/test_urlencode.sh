#!/bin/sh
# Unit test for cas_urlencode (pure-shell implementation, no od/awk/sed).
SRC="$(cd "$(dirname "$0")/.." && pwd)/root/usr/share/drcom-auth/cas_auth.sh"
eval "$(sed -n '/^_cas_urlencode_str() {/,/^}/p' "$SRC")"
cas_urlencode() { _cas_urlencode_str "$1"; }

check() {
	got=$(cas_urlencode "$1")
	if [ "$got" = "$2" ]; then
		printf 'OK   %-16s -> %s\n' "$1" "$got"
	else
		printf 'FAIL %-16s -> got [%s] want [%s]\n' "$1" "$got" "$2"
		return 1
	fi
}

fail=0
check "登录" "%E7%99%BB%E5%BD%95" || fail=1
check "a-b_c.d~" "a-b_c.d~" || fail=1
check "a b/c" "a+b%2Fc" || fail=1
check "AAA==" "AAA%3D%3D" || fail=1
check "+/\\" "%2B%2F%5C" || fail=1
check "202411039159" "202411039159" || fail=1
# A realistic execution token fragment.
check "ab12-CD_" "ab12-CD_" || fail=1

[ "$fail" -eq 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
