#!/bin/sh
# Standalone HSTC CAS authentication.
#
# This script talks ONLY to the CAS server (HSCAS_URL). It does not involve the
# Dr.COM portal or any Dr.COM parameter: the presence of a `service=` query
# parameter is what ties a CAS flow to Dr.COM, and we deliberately omit it.
#
# What it does:
#   1. GET  $HSCAS_LOGIN_URL                 -> scrape the fm1 password form
#   2. GET  $HSCAS_PUBLIC_KEY_URL            -> RSA public key
#   3. POST $HSCAS_LOGIN_URL                 -> __RSA__ password + fm1 fields
#   4. persist the resulting cookies (TGC + SESSION) under COOKIE_DIR
#
# The CAS flow parameters (execution/currentMenu/failN/_eventId/geolocation) are
# issued by the server and change per session, so they are always refetched and
# then persisted for inspection/refresh. Cookies are what carry the login
# state; when they expire, re-running this script logs in again using the
# persisted parameters fetched from the login URL.
#
# Sub-commands:
#   cas_auth.sh params    Fetch + persist fm1 params, print them, do not log in
#   cas_auth.sh login     Fetch params (if needed) and perform the CAS login
#   cas_auth.sh status    Print persisted params + cookie status
#   cas_auth.sh ensure    Login only if the stored cookies are missing/expired
#
# Exit codes:
#   0 success
#   1 generic failure (bad page, missing openssl, rejected login)
#   3 login rejected by the server

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

CONFIG_FILE="$SCRIPT_DIR/config.sh"
if [ -f "$CONFIG_FILE" ]; then
	. "$CONFIG_FILE"
else
	echo "The config file $CONFIG_FILE is not found." >&2
	exit 1
fi

# --- paths (standalone CAS; independent of Dr.COM flows) --------------------
CAS_COOKIE_FILE="$COOKIE_DIR/cas_cookie.txt"
CAS_PARAMS_FILE="$COOKIE_DIR/cas_params.env"
CAS_LOGIN_PAGE="$RESPONSE_DIR/cas_login_page.html"
CAS_POST_BODY="$RESPONSE_DIR/cas_post_response.html"
CAS_HEADERS="$COOKIE_DIR/cas_headers.txt"

HSCAS_URL="${HSCAS_URL:-https://hscas.hstc.edu.cn}"
HSCAS_LOGIN_URL="$HSCAS_URL/cas/login"
HSCAS_PUBLIC_KEY_URL="${HSCAS_PUBLIC_KEY_URL:-$HSCAS_URL/cas/jwt/publicKey}"

# The CAS login page carries three forms: fm1 (password), fm2 (SMS/dynamic
# code), fm3 (QR). Each has its own currentMenu/_eventId, so parameters must be
# read from the password form only.
CAS_LOGIN_FORM_ID="fm1"

cas_log() {
	output_status "$STATUS_LOG_FILE" "[cas] $1"
}

# Extract a hidden input value from the body of a given form.
# Usage: cas_form_field <form_id> <field_name>
cas_form_field() {
	local form_id="$1" field="$2" forms start end slice value

	forms=$(grep -n -E '<(el-)?form[^>]*id="fm[0-9]+"' "$CAS_LOGIN_PAGE")
	[ -n "$forms" ] || return 1

	start=$(printf '%s\n' "$forms" | awk -F: -v id="$form_id" '$0 ~ ("id=\"" id "\"") { print $1; exit }')
	[ -n "$start" ] || return 1

	end=$(printf '%s\n' "$forms" | awk -F: -v s="$start" '$1 > s { print $1; exit }')
	[ -n "$end" ] || end=$(( $(wc -l < "$CAS_LOGIN_PAGE") + 1 ))

	slice=$(mktemp)
	sed -n "${start},$((end - 1))p" "$CAS_LOGIN_PAGE" > "$slice"
	value=$(sed -n "s/.*name=\"$field\"[^>]*value=\"\([^\"]*\)\".*/\1/p" "$slice" | head -n 1)
	rm -f "$slice"

	printf '%s\n' "$value"
}

# --- step 1+2: fetch the login page and the fm1 params ----------------------
fetch_cas_params() {
	local http_code

	mkdir -p "$COOKIE_DIR" "$RESPONSE_DIR"
	cas_log "GET $HSCAS_LOGIN_URL (no service parameter)"
	http_code=$(curl -L -c "$CAS_COOKIE_FILE" -b "$CAS_COOKIE_FILE" \
		-H "User-Agent: $USER_AGENT" -s -o "$CAS_LOGIN_PAGE" -w "%{http_code}" \
		"$HSCAS_LOGIN_URL")

	CAS_EXECUTION=$(cas_form_field "$CAS_LOGIN_FORM_ID" execution)
	if [ -z "$CAS_EXECUTION" ]; then
		cas_log "failed: execution token not found in form $CAS_LOGIN_FORM_ID (HTTP $http_code)"
		return 1
	fi
	CAS_CURRENT_MENU=$(cas_form_field "$CAS_LOGIN_FORM_ID" currentMenu)
	CAS_FAIL_N=$(cas_form_field "$CAS_LOGIN_FORM_ID" failN)
	CAS_MFA_STATE=$(cas_form_field "$CAS_LOGIN_FORM_ID" mfaState)
	CAS_EVENT_ID=$(cas_form_field "$CAS_LOGIN_FORM_ID" _eventId)
	CAS_GEOLOCATION=$(cas_form_field "$CAS_LOGIN_FORM_ID" geolocation)

	CAS_CURRENT_MENU=${CAS_CURRENT_MENU:-1}
	CAS_FAIL_N=${CAS_FAIL_N:-0}
	CAS_EVENT_ID=${CAS_EVENT_ID:-submit}

	CAS_PARAMS_TIME=$(date '+%Y-%m-%d %H:%M:%S')
	cas_log "params captured: form=$CAS_LOGIN_FORM_ID currentMenu=$CAS_CURRENT_MENU failN=$CAS_FAIL_N _eventId=$CAS_EVENT_ID execution=${#CAS_EXECUTION} chars"
	persist_cas_params
	return 0
}

# Persist the captured flow state. This is per-session data: it is reused only
# to re-establish a login when cookies expire, never as a long-lived secret.
persist_cas_params() {
	mkdir -p "$COOKIE_DIR"
	cat > "$CAS_PARAMS_FILE" <<EOF
# Captured: $CAS_PARAMS_TIME
# CAS login form state issued by $HSCAS_URL. Session-bound; refetched on each login.
CAS_PARAMS_TIME="$CAS_PARAMS_TIME"
CAS_LOGIN_URL=$HSCAS_LOGIN_URL
CAS_FORM_ID=$CAS_LOGIN_FORM_ID
CAS_EXECUTION=$CAS_EXECUTION
CAS_CURRENT_MENU=$CAS_CURRENT_MENU
CAS_FAIL_N=$CAS_FAIL_N
CAS_MFA_STATE=$CAS_MFA_STATE
CAS_EVENT_ID=$CAS_EVENT_ID
CAS_GEOLOCATION=$CAS_GEOLOCATION
EOF
	chmod 600 "$CAS_PARAMS_FILE"
}

load_persisted_params() {
	[ -f "$CAS_PARAMS_FILE" ] || return 1
	. "$CAS_PARAMS_FILE"
	[ -n "$CAS_EXECUTION" ] || return 1
	return 0
}

# --- step 3+4: RSA-encrypt the password and POST ----------------------------
rsa_encrypt_password() {
	local encrypted

	if ! command -v openssl >/dev/null 2>&1; then
		cas_log "failed: openssl command is required for RSA password encryption"
		return 1
	fi

	if [ ! -s "$CAS_PUBLIC_KEY_FILE" ] && [ -s "$DEFAULT_PUBLIC_KEY_FILE" ]; then
		cp "$DEFAULT_PUBLIC_KEY_FILE" "$CAS_PUBLIC_KEY_FILE"
		chmod 600 "$CAS_PUBLIC_KEY_FILE"
	fi

	if [ ! -s "$CAS_PUBLIC_KEY_FILE" ]; then
		cas_log "fetching RSA public key from $HSCAS_PUBLIC_KEY_URL"
		if ! curl -L -b "$CAS_COOKIE_FILE" -H "User-Agent: $USER_AGENT" -s \
			-o "$CAS_PUBLIC_KEY_FILE" "$HSCAS_PUBLIC_KEY_URL"; then
			cas_log "failed: public key request failed"
			return 1
		fi
	fi

	if ! grep -q "BEGIN PUBLIC KEY" "$CAS_PUBLIC_KEY_FILE"; then
		cas_log "failed: invalid public key at $CAS_PUBLIC_KEY_FILE"
		return 1
	fi

	# CAS expects the password RSA-encrypted with PKCS#1 v1.5 padding, base64
	# encoded, prefixed with __RSA__ (mirrors JSEncrypt in the login page).
	if encrypted=$(printf "%s" "$PASSWORD" | openssl pkeyutl -encrypt -pubin -inkey "$CAS_PUBLIC_KEY_FILE" -pkeyopt rsa_padding_mode:pkcs1 2>/dev/null | base64 | tr -d '\r\n'); then
		printf "%s\n" "__RSA__$encrypted"
		return 0
	fi

	if encrypted=$(printf "%s" "$PASSWORD" | openssl rsautl -encrypt -pubin -inkey "$CAS_PUBLIC_KEY_FILE" -pkcs 2>/dev/null | base64 | tr -d '\r\n'); then
		printf "%s\n" "__RSA__$encrypted"
		return 0
	fi

	cas_log "failed: password encryption failed"
	return 1
}

# Percent-encode a value for application/x-www-form-urlencoded bodies, matching
# curl --data-urlencode semantics (space -> +, unreserved bytes kept as-is).
# Byte-oriented so UTF-8 input is encoded per byte. Avoids gawk-only helpers
# (strtonum) so it also runs under BusyBox awk on OpenWrt.
cas_urlencode() {
	printf '%s' "$1" | od -An -v -tx1 | awk -v HEX="0123456789ABCDEF" '
		{
			for (i = 1; i <= NF; i++) {
				h = toupper($i)
				# Unreserved: 0-9 A-Z a-z - . _ ~  (space becomes +)
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

# Build the exact POST body that perform_cas_login() sends. Stored in
# CAS_POST_BODY_STRING and also printed. Field order mirrors the historical
# LOGIN_POSTBODY:
#   username password currentMenu failN execution _eventId geolocation submit
cas_build_body() {
	local encrypted u pw

	[ -n "$CAS_EXECUTION" ] || { cas_log "no params loaded; fetch params first"; return 1; }

	encrypted=$(rsa_encrypt_password) || return 1

	pw=$(cas_urlencode "$encrypted")
	u=$(cas_urlencode "$USERNAME")
	CAS_ENCRYPTED_PASSWORD="$encrypted"
	CAS_POST_BODY_STRING="username=${u}&password=${pw}&currentMenu=$(cas_urlencode "$CAS_CURRENT_MENU")&failN=$(cas_urlencode "$CAS_FAIL_N")&execution=$(cas_urlencode "$CAS_EXECUTION")&_eventId=$(cas_urlencode "$CAS_EVENT_ID")&geolocation=$(cas_urlencode "$CAS_GEOLOCATION")&submit=$(cas_urlencode "登录")"
	return 0
}

# Report the assembled request in a copy-pasteable, machine-readable form.
cmd_body_inner() {
	cas_build_body || return 1

	printf 'login_url=%s\n' "$HSCAS_LOGIN_URL"
	printf 'method=POST\n'
	printf 'content_type=application/x-www-form-urlencoded\n'
	printf 'urlencoded=yes\n'
	printf 'field_order=username password currentMenu failN execution _eventId geolocation submit\n'
	printf 'encrypted_password=%s\n' "$CAS_ENCRYPTED_PASSWORD"
	printf 'password_prefix=%s\n' "$(printf '%s' "$CAS_ENCRYPTED_PASSWORD" | cut -c1-7)"
	printf 'password_length=%s\n' "${#CAS_ENCRYPTED_PASSWORD}"
	printf 'body=%s\n' "$CAS_POST_BODY_STRING"
}

perform_cas_login() {
	local http_code success_marker

	# Build the body once so the value shown by `cas_auth.sh body` is exactly
	# what gets submitted.
	cas_build_body || return 1

	cas_log "POST $HSCAS_LOGIN_URL (no service parameter)"
	http_code=$(curl -c "$CAS_COOKIE_FILE" -b "$CAS_COOKIE_FILE" \
		-H "User-Agent: $USER_AGENT" -X POST -s -D "$CAS_HEADERS" -o "$CAS_POST_BODY" \
		-H "Content-Type: application/x-www-form-urlencoded" \
		--data-raw "$CAS_POST_BODY_STRING" \
		-w "%{http_code}" \
		"$HSCAS_LOGIN_URL")

	success_marker=false
	if grep -q "successRedirectUrl" "$CAS_POST_BODY" 2>/dev/null \
		|| grep -q "登录成功" "$CAS_POST_BODY" 2>/dev/null \
		|| grep -q "Log In Successful" "$CAS_POST_BODY" 2>/dev/null; then
		success_marker=true
	fi

	if [ "$http_code" = "302" ] || [ "$success_marker" = "true" ]; then
		cas_log "CAS login OK (HTTP $http_code)"
		CAS_LOGIN_TIME=$(date '+%Y-%m-%d %H:%M:%S')
		persist_cas_state "$CAS_LOGIN_TIME" "ok" "$http_code"
		return 0
	fi

	cas_log "CAS login rejected (HTTP $http_code)"
	persist_cas_state "$(date '+%Y-%m-%d %H:%M:%S')" "rejected" "$http_code"
	return 3
}

# Record the last login outcome alongside the cookie jar.
persist_cas_state() {
	local when="$1" result="$2" code="$3"
	mkdir -p "$COOKIE_DIR"
	{
		echo "CAS_LOGIN_TIME=\"$when\""
		echo "CAS_LOGIN_RESULT=$result"
		echo "CAS_LOGIN_HTTP=$code"
	} > "$COOKIE_DIR/cas_state.env"
	chmod 600 "$COOKIE_DIR/cas_state.env"
}

# --- cookie helpers ---------------------------------------------------------
# The TGC cookie is the CAS ticket-granting cookie; it is what makes the
# session authenticated. Its presence + non-expiry is the login indicator.
cas_cookie_tgc() {
	[ -s "$CAS_COOKIE_FILE" ] || return 1
	awk '$6 == "TGC" { print $7; exit }' "$CAS_COOKIE_FILE"
}

cas_cookie_summary() {
	local tgc session

	[ -s "$CAS_COOKIE_FILE" ] || { printf 'none\n'; return 0; }
	tgc=$(awk '$6 == "TGC" { print $7; exit }' "$CAS_COOKIE_FILE")
	session=$(awk '$6 == "SESSION" { print $7; exit }' "$CAS_COOKIE_FILE")

	printf 'TGC=%s SESSION=%s\n' \
		"${tgc:+present}" "${session:+present}"
	[ -n "$tgc" ] && printf 'TGC_VALUE=%s\n' "$tgc"
	[ -n "$session" ] && printf 'SESSION_VALUE=%s\n' "$session"
	printf 'COOKIE_FILE=%s\n' "$CAS_COOKIE_FILE"
	printf 'COOKIE_MTIME=%s\n' "$(date -r "$CAS_COOKIE_FILE" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || stat -c '%y' "$CAS_COOKIE_FILE" 2>/dev/null | cut -d. -f1)"
}

# Cookies are considered usable if a TGC is present and the file is fresh.
cas_cookie_valid() {
	local tgc
	tgc=$(cas_cookie_tgc) || return 1
	[ -n "$tgc" ] || return 1
	return 0
}

# --- sub-commands -----------------------------------------------------------
cmd_params() {
	fetch_cas_params || return 1
	printf 'form=%s\n' "$CAS_LOGIN_FORM_ID"
	printf 'execution=%s\n' "$CAS_EXECUTION"
	printf 'currentMenu=%s\n' "$CAS_CURRENT_MENU"
	printf 'failN=%s\n' "$CAS_FAIL_N"
	printf 'mfaState=%s\n' "$CAS_MFA_STATE"
	printf '_eventId=%s\n' "$CAS_EVENT_ID"
	printf 'geolocation=%s\n' "$CAS_GEOLOCATION"
	printf 'captured=%s\n' "$CAS_PARAMS_TIME"
	printf 'saved=%s\n' "$CAS_PARAMS_FILE"
}

cmd_login() {
	if [ -z "$CAS_EXECUTION" ]; then
		fetch_cas_params || return 1
	fi
	perform_cas_login
}

# Load persisted params if needed, then assemble and print the request body.
cmd_body() {
	if [ -z "$CAS_EXECUTION" ]; then
		load_persisted_params || fetch_cas_params || return 1
	fi
	cmd_body_inner
}

cmd_status() {
	local state_file="$COOKIE_DIR/cas_state.env"

	printf 'login_url=%s\n' "$HSCAS_LOGIN_URL"

	if load_persisted_params; then
		printf 'params_captured=%s\n' "${CAS_PARAMS_TIME:-unknown}"
		printf 'params_currentMenu=%s\n' "${CAS_CURRENT_MENU:-}"
		printf 'params_failN=%s\n' "${CAS_FAIL_N:-}"
		printf 'params_eventId=%s\n' "${CAS_EVENT_ID:-}"
		printf 'params_execution=%s\n' "${CAS_EXECUTION:-}"
		printf 'params_saved=%s\n' "$CAS_PARAMS_FILE"
	else
		printf 'params=none\n'
	fi

	if cas_cookie_valid; then
		printf 'cookie=valid\n'
	else
		printf 'cookie=invalid\n'
	fi
	cas_cookie_summary

	if [ -f "$state_file" ]; then
		. "$state_file"
		printf 'last_login=%s\n' "${CAS_LOGIN_TIME:-unknown}"
		printf 'last_result=%s\n' "${CAS_LOGIN_RESULT:-unknown}"
	fi
}

cmd_ensure() {
	if cas_cookie_valid; then
		printf 'cookie=valid\n'
		return 0
	fi

	cas_log "cookie missing or expired; re-authenticating"
	# Refresh the server-issued params, then log in with them.
	fetch_cas_params || return 1
	perform_cas_login
}

CMD="${1:-status}"
case "$CMD" in
	params) cmd_params ;;
	body) cmd_body ;;
	login) cmd_login ;;
	status) cmd_status ;;
	ensure) cmd_ensure ;;
	*)
		echo "usage: $0 {params|body|login|status|ensure}" >&2
		exit 2
		;;
esac
