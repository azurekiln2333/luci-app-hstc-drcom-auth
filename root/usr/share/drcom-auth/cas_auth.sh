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
# Derive from SCRIPT_DIR so the script keeps working even if config.sh is from
# an older package version and does not define the CAS_* variables yet.
COOKIE_DIR="${COOKIE_DIR:-${SCRIPT_DIR:-/usr/share/drcom-auth}/info}"
RESPONSE_DIR="${RESPONSE_DIR:-${SCRIPT_DIR:-/usr/share/drcom-auth}/responses}"
CAS_COOKIE_FILE="${CAS_COOKIE_FILE:-$COOKIE_DIR/cas_cookie.txt}"
CAS_PARAMS_FILE="${CAS_PARAMS_FILE:-$COOKIE_DIR/cas_params.env}"
CAS_PUBLIC_KEY_FILE="${CAS_PUBLIC_KEY_FILE:-$COOKIE_DIR/public_key.pem}"
DEFAULT_PUBLIC_KEY_FILE="${DEFAULT_PUBLIC_KEY_FILE:-${SCRIPT_DIR:-/usr/share/drcom-auth}/public_key.pem}"
CAS_LOGIN_PAGE="${CAS_LOGIN_PAGE:-$RESPONSE_DIR/cas_login_page.html}"
CAS_POST_BODY="${CAS_POST_BODY:-$RESPONSE_DIR/cas_post_response.html}"
CAS_HEADERS="${CAS_HEADERS:-$COOKIE_DIR/cas_headers.txt}"
STATUS_LOG_FILE="${STATUS_LOG_FILE:-${SCRIPT_DIR:-/usr/share/drcom-auth}/logs/drcom_status_log.txt}"
USER_AGENT="${USER_AGENT:-Mozilla/5.0}"

# Hard timeouts so a stuck network never hangs the panel indefinitely.
# Overridable from config.sh for slow links.
CAS_CONNECT_TIMEOUT="${CAS_CONNECT_TIMEOUT:-10}"
CAS_MAX_TIME="${CAS_MAX_TIME:-30}"
# Reuse freshly captured params for this many seconds before refetching.
CAS_PARAMS_MAX_AGE="${CAS_PARAMS_MAX_AGE:-120}"

HSCAS_URL="${HSCAS_URL:-https://hscas.hstc.edu.cn}"

# Normalize HSCAS_URL so both spellings work and the user never ends up with a
# doubled path like /cas/login/cas/login. Accepted inputs:
#   https://hscas.hstc.edu.cn
#   https://hscas.hstc.edu.cn/
#   https://hscas.hstc.edu.cn/cas
#   https://hscas.hstc.edu.cn/cas/login
#   https://hscas.hstc.edu.cn/cas/login?service=...
cas_normalize_base() {
	printf '%s' "$1" \
		| sed -e 's#/*$##' \
		      -e 's#[?#].*$##' \
		      -e 's#/*$##' \
		      -e 's#/cas/login$##' \
		      -e 's#/cas$##' \
		      -e 's#/*$##'
}

HSCAS_BASE_URL=$(cas_normalize_base "$HSCAS_URL")
HSCAS_LOGIN_URL="$HSCAS_BASE_URL/cas/login"
HSCAS_PUBLIC_KEY_URL="${HSCAS_PUBLIC_KEY_URL:-$HSCAS_BASE_URL/cas/jwt/publicKey}"

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
	local http_code curl_rc page_size

	mkdir -p "$COOKIE_DIR" "$RESPONSE_DIR"
	cas_log "GET $HSCAS_LOGIN_URL (no service parameter)"

	# Capture curl's exit status and stderr separately so failures are visible.
	curl_rc=0
	http_code=$(curl --connect-timeout "$CAS_CONNECT_TIMEOUT" --max-time "$CAS_MAX_TIME" \
		-L -c "$CAS_COOKIE_FILE" -b "$CAS_COOKIE_FILE" \
		-H "User-Agent: $USER_AGENT" -s -S -o "$CAS_LOGIN_PAGE" \
		-w "%{http_code}" "$HSCAS_LOGIN_URL" 2>"$COOKIE_DIR/cas_curl_error.txt") || curl_rc=$?

	# Ensure the output file exists before wc; curl may not create it on failure.
	[ -f "$CAS_LOGIN_PAGE" ] || : > "$CAS_LOGIN_PAGE"
	page_size=$(wc -c < "$CAS_LOGIN_PAGE" 2>/dev/null || echo 0)

	if [ "$curl_rc" -ne 0 ]; then
		cas_log "failed: curl exit $curl_rc; $(cat "$COOKIE_DIR/cas_curl_error.txt" 2>/dev/null)"
		printf 'diagnosis=curl failed (exit %s)\n' "$curl_rc"
		printf 'curl_error=%s\n' "$(cat "$COOKIE_DIR/cas_curl_error.txt" 2>/dev/null)"
		printf 'url=%s\n' "$HSCAS_LOGIN_URL"
		return 1
	fi

	if [ "$http_code" != "200" ]; then
		cas_log "failed: unexpected HTTP $http_code from $HSCAS_LOGIN_URL (page ${page_size}B)"
		printf 'diagnosis=unexpected HTTP status\n'
		printf 'http_code=%s\n' "$http_code"
		printf 'url=%s\n' "$HSCAS_LOGIN_URL"
		printf 'page_saved=%s\n' "$CAS_LOGIN_PAGE"
		return 1
	fi

	CAS_EXECUTION=$(cas_form_field "$CAS_LOGIN_FORM_ID" execution)
	if [ -z "$CAS_EXECUTION" ]; then
		cas_log "failed: execution token not found in form $CAS_LOGIN_FORM_ID (HTTP $http_code, page ${page_size}B)"
		printf 'diagnosis=login form %s not found in page\n' "$CAS_LOGIN_FORM_ID"
		printf 'http_code=%s\n' "$http_code"
		printf 'page_size=%s\n' "$page_size"
		printf 'page_saved=%s\n' "$CAS_LOGIN_PAGE"
		# First line of the page often explains why (redirect page, error, WAF).
		printf 'page_head=%s\n' "$(head -c 300 "$CAS_LOGIN_PAGE" 2>/dev/null | tr '\n' ' ')"
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
	CAS_CAPTURED_EPOCH=$(date '+%s' 2>/dev/null || echo 0)
	cas_log "params captured: form=$CAS_LOGIN_FORM_ID currentMenu=$CAS_CURRENT_MENU failN=$CAS_FAIL_N _eventId=$CAS_EVENT_ID execution=${#CAS_EXECUTION} chars"
	# Persist immediately so a later login can reuse exactly what was fetched.
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
CAS_CAPTURED_EPOCH=$CAS_CAPTURED_EPOCH
EOF
	chmod 600 "$CAS_PARAMS_FILE"
}

load_persisted_params() {
	[ -f "$CAS_PARAMS_FILE" ] || return 1
	. "$CAS_PARAMS_FILE"
	[ -n "$CAS_EXECUTION" ] || return 1
	return 0
}

# Seconds since the persisted params were captured, or a large number if
# unknown. Used to decide whether they are still worth reusing.
params_age() {
	local now
	[ -n "$CAS_CAPTURED_EPOCH" ] || { printf '999999\n'; return 0; }
	now=$(date '+%s' 2>/dev/null || echo 0)
	printf '%s\n' "$((now - CAS_CAPTURED_EPOCH))"
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
		if ! curl --connect-timeout "$CAS_CONNECT_TIMEOUT" --max-time "$CAS_MAX_TIME" \
			-L -b "$CAS_COOKIE_FILE" -H "User-Agent: $USER_AGENT" -s \
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
#
# Implemented with POSIX parameter expansion only: no od, awk, sed or locale
# dependency. This matters on stripped-down OpenWrt images where od/awk may be
# missing, which previously made this function return an empty string and sent
# an empty `execution` field to CAS (HTTP 500 BadlyFormattedFlowExecutionKey).
#
# Input is treated byte-wise: each character is mapped to its byte value with
# printf '%d' "'$c" which BusyBox ash supports. Bytes >= 0x80 are handled as
# UTF-8 lead/continuation bytes naturally because each char in a multibyte
# sequence is iterated separately by ${var#?} in a C locale.
cas_urlencode() {
	_cas_urlencode_str "$1"
}

# Internal worker; broken out so the loop variable stays local.
_cas_urlencode_str() {
	_cue_in="$1"
	_cue_out=""
	while [ -n "$_cue_in" ]; do
		_cue_c=${_cue_in%"${_cue_in#?}"}      # first character
		_cue_in=${_cue_in#?}                    # rest
		case "$_cue_c" in
			[A-Za-z0-9.\-_~])
				_cue_out="$_cue_out$_cue_c"
				;;
			" ")
				_cue_out="$_cue_out+"
				;;
			*)
				# Byte value of the character. printf %d "'<char>" yields the
				# value of the first byte, which is exactly what we need for
				# percent-encoding UTF-8 byte by byte.
				_cue_n=$(printf '%d' "'$_cue_c" 2>/dev/null)
				case "$_cue_n" in
					''|*[!0-9]*) _cue_n=63 ;;   # fall back to '?' on failure
				esac
				[ "$_cue_n" -gt 255 ] 2>/dev/null && _cue_n=$((_cue_n % 256))
				_cue_out="$_cue_out$(printf '%%%02X' "$_cue_n")"
				;;
		esac
	done
	printf '%s' "$_cue_out"
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

# Emit the request headers that will be sent on the POST, one per line as
# `name: value`, so they can be shown/copied.
cas_request_headers() {
	printf 'User-Agent: %s\n' "$USER_AGENT"
	printf 'Content-Type: application/x-www-form-urlencoded\n'
	printf 'Accept: */*\n'
	printf 'Cookie: %s\n' "$(cas_cookie_header_value)"
}

# Collapse the cookie jar into a single Cookie header value (or empty).
cas_cookie_header_value() {
	[ -s "$CAS_COOKIE_FILE" ] || return 0
	awk '!/^#/ && NF >= 7 { printf "%s%s=%s", (n++ ? "; " : ""), $6, $7 }' "$CAS_COOKIE_FILE"
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
	printf 'headers=%s\n' "$(cas_request_headers | tr '\n' '|' | sed 's/|$//')"
	printf 'body=%s\n' "$CAS_POST_BODY_STRING"
}

# Print the fully assembled request exactly as it goes on the wire:
#   request line, headers, blank line, then the url-encoded body.
# Everything here is literal text (no truncation) so it can be copied as-is.
cmd_request_inner() {
	cas_build_body || return 1

	printf 'POST %s HTTP/1.1\n' "${HSCAS_LOGIN_URL#*://}"
	printf 'Host: %s\n' "$(printf '%s' "$HSCAS_BASE_URL" | sed -e 's#^[a-z]*://##' -e 's#/.*$##')"
	cas_request_headers
	printf 'Content-Length: %s\n' "${#CAS_POST_BODY_STRING}"
	printf '\n'
	printf '%s\n' "$CAS_POST_BODY_STRING"
}

perform_cas_login() {
	local http_code success_marker curl_rc

	# Build the body once so the value shown by `cas_auth.sh body` is exactly
	# what gets submitted.
	cas_build_body || return 1

	cas_log "POST $HSCAS_LOGIN_URL (no service parameter)"
	curl_rc=0
	http_code=$(curl --connect-timeout "$CAS_CONNECT_TIMEOUT" --max-time "$CAS_MAX_TIME" \
		-c "$CAS_COOKIE_FILE" -b "$CAS_COOKIE_FILE" \
		-H "User-Agent: $USER_AGENT" -X POST -s -S -D "$CAS_HEADERS" -o "$CAS_POST_BODY" \
		-H "Content-Type: application/x-www-form-urlencoded" \
		--data-raw "$CAS_POST_BODY_STRING" \
		-w "%{http_code}" \
		"$HSCAS_LOGIN_URL" 2>"$COOKIE_DIR/cas_curl_error.txt") || curl_rc=$?

	if [ "$curl_rc" -ne 0 ]; then
		cas_log "CAS login failed: curl exit $curl_rc; $(cat "$COOKIE_DIR/cas_curl_error.txt" 2>/dev/null)"
		persist_cas_state "$(date '+%Y-%m-%d %H:%M:%S')" "curl-error" "$curl_rc"
		printf 'diagnosis=curl failed on POST (exit %s)\n' "$curl_rc"
		printf 'curl_error=%s\n' "$(cat "$COOKIE_DIR/cas_curl_error.txt" 2>/dev/null)"
		printf 'login_url=%s\n' "$HSCAS_LOGIN_URL"
		printf 'timeouts=%s/%s\n' "$CAS_CONNECT_TIMEOUT" "$CAS_MAX_TIME"
		return 1
	fi

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
	printf 'diagnosis=login rejected by CAS\n'
	printf 'http_code=%s\n' "$http_code"
	printf 'login_url=%s\n' "$HSCAS_LOGIN_URL"
	printf 'headers=%s\n' "$(cas_request_headers | tr '\n' '|' | sed 's/|$//')"
	printf 'execution_length=%s\n' "${#CAS_EXECUTION}"
	printf 'body=%s\n' "$CAS_POST_BODY_STRING"
	printf 'page_saved=%s\n' "$CAS_POST_BODY"
	printf 'page_head=%s\n' "$(head -c 400 "$CAS_POST_BODY" 2>/dev/null | tr '\n' ' ')"
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
	# On failure the diagnosis lines were already printed to stdout so the
	# caller (LuCI) can show the real reason.
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
	local age
	# Reuse the params captured by `params` when they are still fresh, so the
	# panel flow (fetch -> login) uses exactly the values that were displayed
	# and persisted. Refetch only when none exist or they look stale.
	if [ -z "$CAS_EXECUTION" ]; then
		if load_persisted_params; then
			age=$(params_age)
			if [ "${age:-999999}" -le "$CAS_PARAMS_MAX_AGE" ] 2>/dev/null; then
				cas_log "reusing persisted params (age ${age}s)"
			else
				cas_log "persisted params are ${age}s old; refetching"
				fetch_cas_params || return 1
			fi
		else
			fetch_cas_params || return 1
		fi
	fi
	perform_cas_login
}

# Load persisted params if needed, then assemble and print the request body.
# Usage: cmd_body [request]
#   default   key=value dump (machine readable)
#   request   full HTTP request preview (request line + headers + body)
cmd_body() {
	if [ -z "$CAS_EXECUTION" ]; then
		# Prefer the params captured earlier; only refetch when none are saved.
		load_persisted_params || fetch_cas_params || return 1
	fi
	case "${1:-}" in
		request) cmd_request_inner ;;
		*) cmd_body_inner ;;
	esac
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
	body) cmd_body "${2:-}" ;;
	request) cmd_body request ;;
	login) cmd_login ;;
	status) cmd_status ;;
	ensure) cmd_ensure ;;
	*)
		echo "usage: $0 {params|body|request|login|status|ensure}" >&2
		exit 2
		;;
esac
