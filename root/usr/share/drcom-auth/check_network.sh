#!/bin/sh
# Periodic connectivity probe driven by the procd service.
#
# When PING_HOST is unreachable the host is considered offline and one login
# attempt is made (guarded by a lock file).

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

CONFIG_FILE="$SCRIPT_DIR/config.sh"
if [ ! -f "$CONFIG_FILE" ]; then
	echo "The config.sh is not found" >&2
	exit 1
fi
. "$CONFIG_FILE"

# Skip automatic re-login while the account is flagged with bad credentials, so
# a rejected password is not retried every interval (which can lock the
# account). The marker is cleared on account switch/edit or a manual connect.
BAD_CREDS_FILE="${BAD_CREDS_FILE:-${COOKIE_DIR:-$SCRIPT_DIR/info}/bad_credentials}"
if [ -s "$BAD_CREDS_FILE" ]; then
	output_status "$PING_LOG_FILE" "Skipping auto login: CAS credentials were rejected; fix the account or reconnect manually."
	output_status "$STATUS_LOG_FILE" "Skipping auto login: bad-credentials marker present ($BAD_CREDS_FILE)."
	exit 0
fi

if ! ping -c 1 "$PING_HOST" >/dev/null 2>&1; then
	output_status "$PING_LOG_FILE" "Network is down."
	if mkdir "$SCRIPT_DIR/check_connection.lock" 2>/dev/null; then
		trap 'rmdir "$SCRIPT_DIR/check_connection.lock"' EXIT INT TERM
		/bin/sh "$SCRIPT_DIR/check_connection.sh"
	else
		output_status "$PING_LOG_FILE" "check_connection.sh is already running."
	fi
else
	output_status "$PING_LOG_FILE" "Network is up."
fi
