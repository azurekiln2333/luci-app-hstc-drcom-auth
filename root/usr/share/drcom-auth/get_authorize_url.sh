#!/bin/sh
# Step 1 of the Dr.COM HSTC auth flow.
#
# Asks the Dr.COM eportal API for the CAS authorize URL that the client must
# visit next. Only the final URL is written to stdout so callers can pipe it:
#
#   AUTHORIZE_URI=$(/bin/sh get_authorize_url.sh)
#
# All diagnostics go to stderr and the status log.

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

CONFIG_FILE="${DRCOM_CONFIG_FILE:-$SCRIPT_DIR/config.sh}"
if [ -f "$CONFIG_FILE" ]; then
	. "$CONFIG_FILE"
else
	printf "%s\n" "The config.sh is not found" >&2
	exit 1
fi

log_status() {
	local message="$1"
	mkdir -p "$(dirname "$STATUS_LOG_FILE")"
	printf "%s: %s\n" "$(date)" "$message" >> "$STATUS_LOG_FILE"
	logger "drcom-auth: $message"
}

log_status "Sending identity_login request: $AUTHORIZATION_API"
RESPONSE=$(curl --connect-timeout "${CAS_CONNECT_TIMEOUT:-10}" --max-time "${CAS_MAX_TIME:-30}" -s -G "$AUTHORIZATION_API" \
	--data-urlencode "login_method=$LOGIN_METHOD" \
	--data-urlencode "wlan_user_ip=$TERM_IP" \
	--data-urlencode "wlan_user_ipv6=$TERM_IPV6" \
	--data-urlencode "wlan_user_mac=$TERM_MAC" \
	--data-urlencode "wlan_ac_ip=$WLAN_AC_IP" \
	--data-urlencode "wlan_ac_name=$WLAN_AC_NAME" \
	--data-urlencode "authex_enable=$AUTHEX_ENABLE" \
	--data-urlencode "mac_type=$MAC_TYPE" \
	--data-urlencode "jsVersion=$JS_VERSION") || {
	log_status 'Get authorize url failed: network request failed'
	exit 1
}

log_status "[response] $RESPONSE"
JSON=$(echo "$RESPONSE" | sed -e 's/^jsonpReturn(//' -e 's/);$//')
log_status "[JSON] $JSON"

RESULT=$(echo "$JSON" | grep -o '"result"[ ]*:[ ]*[^,}]*' | cut -d ':' -f 2 | tr -d ' "')
log_status "[RESULT] $RESULT"

if [ "$RESULT" = "1" ] || [ "$RESULT" = "ok" ]; then
	AUTHORIZE_URI=$(echo "$JSON" | sed -n 's/.*"authorize_uri"[ ]*:[ ]*"\([^"]*\)".*/\1/p')
	AUTHORIZE_URI=$(echo "$AUTHORIZE_URI" | sed 's#\\/#/#g')
	[ -n "$AUTHORIZE_URI" ] || { log_status 'Get authorize url failed: empty URL'; exit 1; }
	log_status "Successfully obtained authorize URL: $AUTHORIZE_URI"
	printf "%s\n" "$AUTHORIZE_URI"
else
	MSG=$(echo "$RESPONSE" | grep -o '"msg"[ ]*:[ ]*"[^"]*"' | cut -d '"' -f 4)
	log_status "Get authorize url failed: $MSG"
	printf "%s\n" "${MSG:-Get authorize url failed}" >&2
	exit 1
fi
