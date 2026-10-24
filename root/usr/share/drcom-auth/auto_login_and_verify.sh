#!/bin/sh
# Step 1 wrapper: obtain the CAS authorize URL, then perform the full login.
#
# Runs get_authorize_url.sh and hands the URL to hscas_login.sh. Safe to call
# directly from cron or from check_connection.sh.

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

CONFIG_FILE="${DRCOM_CONFIG_FILE:-$SCRIPT_DIR/config.sh}"
if [ ! -f "$CONFIG_FILE" ]; then
	echo "The config.sh is not found" >&2
	exit 1
fi
. "$CONFIG_FILE"

AUTHORIZE_URI="${1:-}"
if [ -z "$AUTHORIZE_URI" ]; then
	AUTHORIZE_URI=$(/bin/sh "$SCRIPT_DIR/get_authorize_url.sh") || exit 1
fi
if [ -n "$AUTHORIZE_URI" ]; then
	output_status "$STATUS_LOG_FILE" "Attempting to login to HSCAS..."
	/bin/sh "$SCRIPT_DIR/hscas_login.sh" "$AUTHORIZE_URI"
else
	output_status "$STATUS_LOG_FILE" "Get authorize url failed"
	exit 1
fi
