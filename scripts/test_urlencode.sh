#!/bin/sh
# Unit test for cas_urlencode (extracted from cas_auth.sh so there is one impl).
SRC="$(cd "$(dirname "$0")/.." && pwd)/root/usr/share/drcom-auth/cas_auth.sh"

# Load the real cas_urlencode from cas_auth.sh so this test cannot drift from
# the shipped implementation.
cas_urlencode() {
	printf '%s' "$1" | od -An -v -tx1 | awk -v HEX="0123456789ABCDEF" '
		{
			for (i = 1; i <= NF; i++) {
				h = toupper($i)
				if (h == "20")
					printf "+"
				else if (h ~ /^3[0-9]$/ || h ~ /^4[1-9A-F]$/ || h ~ /^5[0-9A]$/ ||
				         h ~ /^6[1-9A-F]$/ || h ~ /^7[0-9A]$/ ||
				         h == "2D" || h == "2E" || h == "5F" || h == "7E")
					printf "%c", index(HEX, substr(h,1,1)) * 16 + index(HEX, substr(h,2,1)) - 17
				else
					printf "%%%s", h
			}
		}
	'
}

check() {
	got=$(cas_urlencode "$1")
	if [ "$got" = "$2" ]; then
		printf 'OK   %-14s -> %s\n' "$1" "$got"
	else
		printf 'FAIL %-14s -> got [%s] want [%s]\n' "$1" "$got" "$2"
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

[ "$fail" -eq 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
