#!/bin/sh
# Step 2 of the Dr.COM HSTC auth flow (CAS login as part of the Dr.COM chain).
#
# Usage: hscas_login.sh <AUTHORIZE_URI>
#
# When AUTHORIZE_URI is omitted, get_authorize_url.sh is called first so the
# script can be run standalone.
#
# This is the Dr.COM-coupled path: the authorize URI carries a service= that
# points back at the Dr.COM portal, so a successful login yields a ticket that
# Dr.COM can verify. For authentication against CAS alone (no Dr.COM), use
# cas_auth.sh instead.
#
# Flow:
#   A) load the CAS login page and scrape flow state from the PASSWORD form
#   B) POST the RSA-encrypted password and follow the redirect to get a ticket
#   C) verify the ticket; a 302 on verification counts as success
#
# CAS flow state (execution / currentMenu / failN) is session-bound and cannot
# be reused: it is tied to the cookie jar and regenerated on every login page
# load. We therefore always refetch it before every POST.
#
# Exit codes:
#   0  ticket verification succeeded
#   1  generic failure (bad page, missing openssl, POST rejected)
#   2  ticket could not be obtained
#   3  ticket verification failed

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

CONFIG_FILE="$SCRIPT_DIR/config.sh"
if [ -f "$CONFIG_FILE" ]; then
	. "$CONFIG_FILE"
else
	echo "The config file $CONFIG_FILE is not found." >&2
	exit 1
fi

# The password form in the HSTC CAS page is <el-form id="fm1">. The page also
# carries fm2 (SMS/dynamic code) and fm3 (QR), each with their own
# currentMenu/_eventId, so parameters MUST be read from fm1 only.
CAS_LOGIN_FORM_ID="fm1"

# Extract a hidden input value from the body of a form.
cas_form_field() {
	local form_id="$1" field="$2" forms start end slice value

	forms=$(grep -n -E '<(el-)?form[^>]*id="fm[0-9]+"' "$LOGIN_PAGE_CONTENT")
	[ -n "$forms" ] || return 1

	start=$(printf '%s\n' "$forms" | awk -F: -v id="$form_id" '$0 ~ ("id=\"" id "\"") { print $1; exit }')
	[ -n "$start" ] || return 1

	end=$(printf '%s\n' "$forms" | awk -F: -v s="$start" '$1 > s { print $1; exit }')
	[ -n "$end" ] || end=$(( $(wc -l < "$LOGIN_PAGE_CONTENT") + 1 ))

	slice=$(mktemp)
	sed -n "${start},$((end - 1))p" "$LOGIN_PAGE_CONTENT" > "$slice"
	value=$(sed -n "s/.*name=\"$field\"[^>]*value=\"\([^\"]*\)\".*/\1/p" "$slice" | head -n 1)
	rm -f "$slice"

	printf '%s\n' "$value"
}

AUTHORIZE_URI="$1"
if [ -z "$AUTHORIZE_URI" ]; then
	# stdout only carries the URL; diagnostics stay on stderr.
	AUTHORIZE_URI=$(/bin/sh "$SCRIPT_DIR/get_authorize_url.sh")
	if [ -z "$AUTHORIZE_URI" ]; then
		output_status "$STATUS_LOG_FILE" "Get authorize url failed"
		exit 1
	fi
fi

output_status "$LOG_FILE" "Received AUTHORIZE URI: $AUTHORIZE_URI"
output_status "$LOG_FILE" "Loading HSCAS login page to fetch execution token"
LOGIN_PAGE_RESPONSE=$(curl -L -c "$COOKIE_FILE" -b "$COOKIE_FILE" -H "User-Agent: $USER_AGENT" -s -o "$LOGIN_PAGE_CONTENT" -w "%{http_code}" "$AUTHORIZE_URI")

EXECUTION=$(cas_form_field "$CAS_LOGIN_FORM_ID" execution)
if [ -z "$EXECUTION" ]; then
	output_status "$STATUS_LOG_FILE" "HSCAS login failed: execution token not found in form $CAS_LOGIN_FORM_ID, HTTP $LOGIN_PAGE_RESPONSE"
	exit 1
fi
CURRENT_MENU=$(cas_form_field "$CAS_LOGIN_FORM_ID" currentMenu)
FAIL_N=$(cas_form_field "$CAS_LOGIN_FORM_ID" failN)
EVENT_ID=$(cas_form_field "$CAS_LOGIN_FORM_ID" _eventId)
GEOLOCATION=$(cas_form_field "$CAS_LOGIN_FORM_ID" geolocation)
CURRENT_MENU=${CURRENT_MENU:-1}
FAIL_N=${FAIL_N:-0}
EVENT_ID=${EVENT_ID:-submit}

# Ensure the global public key exists, migrating a legacy per-account copy on
# first use. The old file is left in place so nothing is lost.
if [ ! -s "$PUBLIC_KEY_FILE" ]; then
	mkdir -p "$(dirname "$PUBLIC_KEY_FILE")"
	LEGACY_KEY="${COOKIE_DIR:-}/public_key.pem"
	if [ -n "${COOKIE_DIR:-}" ] && [ -s "$LEGACY_KEY" ] && [ "$LEGACY_KEY" != "$PUBLIC_KEY_FILE" ]; then
		cp "$LEGACY_KEY" "$PUBLIC_KEY_FILE"
		chmod 600 "$PUBLIC_KEY_FILE"
	elif [ -s "$DEFAULT_PUBLIC_KEY_FILE" ]; then
		cp "$DEFAULT_PUBLIC_KEY_FILE" "$PUBLIC_KEY_FILE"
		chmod 600 "$PUBLIC_KEY_FILE"
	fi
fi

if [ ! -s "$PUBLIC_KEY_FILE" ]; then
	output_status "$LOG_FILE" "Fetching HSCAS RSA public key"
	if ! curl -L -b "$COOKIE_FILE" -H "User-Agent: $USER_AGENT" -s -o "$PUBLIC_KEY_FILE" "$HSCAS_PUBLIC_KEY_URL"; then
		output_status "$STATUS_LOG_FILE" "HSCAS login failed: public key request failed"
		exit 1
	fi
fi

if ! grep -q "BEGIN PUBLIC KEY" "$PUBLIC_KEY_FILE"; then
	output_status "$STATUS_LOG_FILE" "HSCAS login failed: invalid public key"
	exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
	output_status "$STATUS_LOG_FILE" "HSCAS login failed: openssl command is required for RSA password encryption"
	exit 1
fi

# The CAS server expects the password RSA-encrypted with PKCS#1 v1.5 padding and
# base64-encoded, prefixed with __RSA__.
#
# Base64-encode stdin. Prefer a `base64` command, fall back to `openssl base64`;
# some stripped-down images ship neither coreutils-base64 nor busybox base64.
cas_base64() {
	if command -v base64 >/dev/null 2>&1; then
		base64 | tr -d '\r\n'
	else
		openssl base64 -A 2>/dev/null | tr -d '\r\n'
	fi
}

encrypt_password() {
	local encrypted
	if encrypted=$(printf "%s" "$PASSWORD" | openssl pkeyutl -encrypt -pubin -inkey "$PUBLIC_KEY_FILE" -pkeyopt rsa_padding_mode:pkcs1 2>/dev/null | cas_base64); then
		printf "%s\n" "__RSA__$encrypted"
		return 0
	fi

	if encrypted=$(printf "%s" "$PASSWORD" | openssl rsautl -encrypt -pubin -inkey "$PUBLIC_KEY_FILE" -pkcs 2>/dev/null | cas_base64); then
		printf "%s\n" "__RSA__$encrypted"
		return 0
	fi

	return 1
}

ENCRYPTED_PASSWORD=$(encrypt_password)
if [ -z "$ENCRYPTED_PASSWORD" ]; then
	output_status "$STATUS_LOG_FILE" "HSCAS login failed: password encryption failed, openssl is required"
	exit 1
fi

output_status "$LOG_FILE" "Executing POST request to $AUTHORIZE_URI"
POST_RESPONSE=$(curl -c "$COOKIE_FILE" -b "$COOKIE_FILE" -H "User-Agent: $USER_AGENT" -X POST -s -D "$HEADERS_FILE" -o "$POST_RESPONSE_CONTENT" -w "%{http_code}" \
	--data-urlencode "username=$USERNAME" \
	--data-urlencode "password=$ENCRYPTED_PASSWORD" \
	--data-urlencode "currentMenu=$CURRENT_MENU" \
	--data-urlencode "failN=$FAIL_N" \
	--data-urlencode "execution=$EXECUTION" \
	--data-urlencode "_eventId=$EVENT_ID" \
	--data-urlencode "geolocation=$GEOLOCATION" \
	--data-urlencode "submit=登录" \
	"$AUTHORIZE_URI")

POST_SUCCESS=false
if grep -q "successRedirectUrl" "$POST_RESPONSE_CONTENT" || grep -q "登录成功" "$POST_RESPONSE_CONTENT" || grep -q "Log In Successful" "$POST_RESPONSE_CONTENT"; then
	POST_SUCCESS=true
fi

# A 401 means CAS rejected the credentials. Record the same lockout marker that
# cas_auth.sh writes, so the periodic auto-reconnect loop (which goes through
# this script) stops retrying a password that cannot work.
if [ "$POST_RESPONSE" -eq 401 ]; then
	BAD_CREDS_FILE="${BAD_CREDS_FILE:-${COOKIE_DIR:-$SCRIPT_DIR}/bad_credentials}"
	mkdir -p "$(dirname "$BAD_CREDS_FILE")" 2>/dev/null
	printf '%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" > "$BAD_CREDS_FILE" 2>/dev/null
	chmod 600 "$BAD_CREDS_FILE" 2>/dev/null
	output_status "$STATUS_LOG_FILE" "HSCAS login rejected: bad credentials (HTTP 401); auto-retry paused."
fi

if [ "$POST_RESPONSE" -eq 302 ]; then
	output_status "$STATUS_LOG_FILE" "Log In hstc Successful."
	LOCATION=$(grep -i "^Location:" "$HEADERS_FILE" | awk '{print $2}' | tr -d '\r')
	if [ -n "$LOCATION" ]; then
		output_status "$STATUS_LOG_FILE" "Ticket obtained successfully: $LOCATION"
		output_status "$STATUS_LOG_FILE" "Verifying ticket..."
		THIRD_GET_RESPONSE=$(curl -b "$COOKIE_FILE" -H "User-Agent: $USER_AGENT" -s -o "$THIRD_GET_RESPONSE_CONTENT" -w "%{http_code}" "$LOCATION")
		if [ "$THIRD_GET_RESPONSE" -eq 302 ]; then
			output_status "$STATUS_LOG_FILE" "Ticket verification successful."
			exit 0
		fi
	fi

	output_status "$STATUS_LOG_FILE" "Ticket verification failed."
	exit 3
elif [ "$POST_SUCCESS" = true ] && [ "$POST_RESPONSE" -eq 200 ]; then
	output_status "$STATUS_LOG_FILE" "Log In hstc Successful."
	output_status "$STATUS_LOG_FILE" "Executing GET request to $AUTHORIZE_URI to get ticket."

	curl -b "$COOKIE_FILE" -H "User-Agent: $USER_AGENT" -s -D "$HEADERS_FILE" -o "$GET_RESPONSE_CONTENT" "$AUTHORIZE_URI"
	GET_RESPONSE=$(awk 'NR == 1 { print $2 }' "$HEADERS_FILE")
	if [ "$GET_RESPONSE" -eq 302 ]; then
		LOCATION=$(grep -i "^Location:" "$HEADERS_FILE" | awk '{print $2}' | tr -d '\r')
		output_status "$STATUS_LOG_FILE" "Ticket obtained successfully: $LOCATION"
		output_status "$STATUS_LOG_FILE" "Verifying ticket..."
		THIRD_GET_RESPONSE=$(curl -b "$COOKIE_FILE" -H "User-Agent: $USER_AGENT" -s -o "$THIRD_GET_RESPONSE_CONTENT" -w "%{http_code}" "$LOCATION")
		if [ "$THIRD_GET_RESPONSE" -eq 302 ]; then
			output_status "$STATUS_LOG_FILE" "Ticket verification successful."
			exit 0
		else
			output_status "$STATUS_LOG_FILE" "Ticket verification failed."
			exit 3
		fi
	else
		output_status "$STATUS_LOG_FILE" "Failed to obtain ticket."
		exit 2
	fi
else
	output_status "$STATUS_LOG_FILE" "HSCAS login failed."
	exit 1
fi
