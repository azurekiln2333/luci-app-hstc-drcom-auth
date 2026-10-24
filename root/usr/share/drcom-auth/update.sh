#!/bin/sh
# Stable-release updater. Status is data, never shell input. Kernel flock
# locks survive the detached worker handoff and are released on process exit.
LC_ALL=C
export LC_ALL
umask 077
PACKAGE_NAME=luci-app-drcom-auth
REPOSITORY=azurekiln2333/luci-app-hstc-drcom-auth
RELEASE_API="https://api.github.com/repos/$REPOSITORY/releases/latest"
# Overrides isolate offline tests; service/cron callers use fixed defaults.
STATE_DIR="${DRCOM_UPDATE_STATE_DIR:-/tmp/drcom-auth-update}"
TMP_DIR="${DRCOM_UPDATE_TMP_DIR:-/tmp}"
CRON_INIT="${DRCOM_UPDATE_CRON_INIT:-/etc/init.d/cron}"
STATE_FILE="$STATE_DIR/status"
WORK_DIR=
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

cleanup() {
	[ -z "$WORK_DIR" ] || rm -rf "$WORK_DIR"
}
trap cleanup EXIT

prepare_runtime() {
	[ ! -L "$STATE_DIR" ] && mkdir -p "$STATE_DIR" && chmod 700 "$STATE_DIR"
}

load_state() {
	state=idle current_version= latest_version= message= checked_at= installed_at=
	[ -f "$STATE_FILE" ] || return 0
	while IFS='=' read -r key value; do
		case "$key" in
			state) state="$value" ;;
			current_version) current_version="$value" ;;
			latest_version) latest_version="$value" ;;
			message) message="$value" ;;
			checked_at) checked_at="$value" ;;
			installed_at) installed_at="$value" ;;
		esac
	done < "$STATE_FILE"
}

print_status() {
	printf 'state=%s\ncurrent_version=%s\nlatest_version=%s\nmessage=%s\nchecked_at=%s\ninstalled_at=%s\n' \
		"$state" "$current_version" "$latest_version" "$message" "$checked_at" "$installed_at"
}

save_state() {
	message=$(printf '%s' "$message" | tr '\r\n' '  ')
	print_status > "$STATE_FILE.tmp.$$" && mv "$STATE_FILE.tmp.$$" "$STATE_FILE"
}

fail_update() {
	state=error
	message="$1"
	save_state
	return 1
}

current_package_version() {
	local result
	result=$(opkg status "$PACKAGE_NAME" 2>/dev/null) || return 1
	printf '%s\n' "$result" | awk -v package="$PACKAGE_NAME" '
		$1 == "Package:" { name=$2 }
		$1 == "Version:" { version=$2 }
		$1 == "Status:" && $NF == "installed" { installed=1 }
		END { if (name == package && installed && version != "") print version; else exit 1 }
	'
}

require_package() {
	if ! command -v opkg >/dev/null 2>&1; then
		state=unsupported
		current_version=
		message='Automatic updates support opkg/IPK systems only; apk systems are not supported.'
		return 1
	fi
	current_version=$(current_package_version) || {
		state=error
		message='Cannot read the installed package version from opkg.'
		return 1
	}
}

require_dependencies() {
	local command
	for command in "$@"; do
		command -v "$command" >/dev/null 2>&1 || {
			state=error
			message="Required update dependency is missing: $command."
			return 1
		}
	done
}

new_work_dir() {
	WORK_DIR=$(mktemp -d "$TMP_DIR/drcom-auth-update.XXXXXX") || fail_update 'Cannot create a temporary update directory.'
}

fetch_https() {
	# Redirects must also remain HTTPS. No insecure-TLS fallback.
	curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
		--connect-timeout 10 --max-time "$3" --max-redirs 5 --max-filesize "$4" \
		-H 'Accept: application/vnd.github+json' -H 'User-Agent: luci-app-drcom-auth-updater' \
		--output "$2" "$1"
}

release_field() {
	jsonfilter -i "$WORK_DIR/release.json" -e "$1" 2>/dev/null
}

check_release() {
	local tag tag_version tag_pattern names name candidate base asset_url checksum_url count
	latest_version=
	checked_at=$(date '+%Y-%m-%d %H:%M:%S %Z')
	fetch_https "$RELEASE_API" "$WORK_DIR/release.json" 20 2097152 || {
		fail_update 'Cannot download the latest GitHub release; check network access, TLS, or API rate limits.'
		return 1
	}
	tag=$(release_field '@.tag_name')
	[ "$(release_field '@.draft')" = false ] && [ "$(release_field '@.prerelease')" = false ] &&
		printf '%s\n' "$tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || {
		fail_update 'The latest release has invalid metadata or is not a stable vX.Y.Z release.'
		return 1
	}
	tag_version=${tag#v}
	tag_pattern=$(printf '%s' "$tag_version" | sed 's/[.]/[.]/g')
	names=$(release_field '@.assets[*].name') || {
		fail_update 'Cannot read release assets.'
		return 1
	}
	# Permit packaging release bumps (-2, -3, ...); reject ambiguous assets.
	name=$(printf '%s\n' "$names" | grep -E "^${PACKAGE_NAME}_${tag_pattern}-[1-9][0-9]*_all[.]ipk$")
	count=$(printf '%s\n' "$name" | awk 'NF { n++ } END { print n+0 }')
	[ "$count" -eq 1 ] || {
		fail_update 'The release must contain exactly one matching universal IPK asset.'
		return 1
	}
	ASSET_NAME="$name"
	candidate=${name#${PACKAGE_NAME}_}
	latest_version=${candidate%_all.ipk}
	base="https://github.com/$REPOSITORY/releases/download/$tag"
	ASSET_URL="$base/$ASSET_NAME"
	CHECKSUM_URL="$ASSET_URL.sha256.txt"
	asset_url=$(release_field "@.assets[@.name=\"$ASSET_NAME\"].browser_download_url")
	checksum_url=$(release_field "@.assets[@.name=\"$ASSET_NAME.sha256.txt\"].browser_download_url")
	[ "$asset_url" = "$ASSET_URL" ] && [ "$checksum_url" = "$CHECKSUM_URL" ] || {
		fail_update 'The release is missing its matching IPK/checksum asset or has an unexpected download URL.'
		return 1
	}
	if opkg compare-versions "$latest_version" '>>' "$current_version"; then
		state=available
		message="Update available: $latest_version."
	else
		state=up_to_date
		message='The installed version is current or newer; no package will be installed.'
	fi
	# An install stays busy during its release check, including between writes.
	if [ "${1:-check}" != install ] || [ "$state" != available ]; then save_state; fi
}

verify_checksum() {
	local expected actual
	expected=$(awk -v name="$ASSET_NAME" '
		{ sub(/\r$/, "") }
		NF != 2 || length($1) != 64 || $1 !~ /^[0-9A-Fa-f]+$/ || ($2 != name && $2 != "*" name) { bad=1 }
		{ count++; hash=tolower($1) }
		END { if (bad || count != 1) exit 1; print hash }
	' "$WORK_DIR/checksum") || {
		fail_update 'The checksum file must contain one SHA-256 line for the exact IPK filename.'
		return 1
	}
	actual=$(sha256sum "$WORK_DIR/$ASSET_NAME") || {
		fail_update 'Cannot calculate the downloaded package checksum.'
		return 1
	}
	actual=${actual%% *}
	[ "$expected" = "$actual" ] || {
		fail_update 'SHA-256 mismatch; the downloaded package was not installed.'
		return 1
	}
}

verify_package() {
	local member binary control
	# Stream only exact members to stdout; never unpack archive paths to disk.
	tar -tzf "$WORK_DIR/$ASSET_NAME" > "$WORK_DIR/ipk.list" 2>/dev/null || return 1
	member=$(sed -n '/^\(\.\/\)\?control\.tar\.gz$/p' "$WORK_DIR/ipk.list")
	binary=$(sed -n '/^\(\.\/\)\?debian-binary$/p' "$WORK_DIR/ipk.list")
	[ "$(printf '%s\n' "$member" | awk 'NF { n++ } END { print n+0 }')" -eq 1 ] || return 1
	[ "$(printf '%s\n' "$binary" | awk 'NF { n++ } END { print n+0 }')" -eq 1 ] || return 1
	[ "$(tar -xzOf "$WORK_DIR/$ASSET_NAME" "$binary" 2>/dev/null)" = '2.0' ] || return 1
	tar -xzOf "$WORK_DIR/$ASSET_NAME" "$member" > "$WORK_DIR/control.tar.gz" 2>/dev/null || return 1
	tar -tzf "$WORK_DIR/control.tar.gz" > "$WORK_DIR/control.list" 2>/dev/null || return 1
	control=$(sed -n '/^\(\.\/\)\?control$/p' "$WORK_DIR/control.list")
	[ "$(printf '%s\n' "$control" | awk 'NF { n++ } END { print n+0 }')" -eq 1 ] || return 1
	tar -xzOf "$WORK_DIR/control.tar.gz" "$control" > "$WORK_DIR/control" 2>/dev/null || return 1
	awk -v package="$PACKAGE_NAME" -v version="$latest_version" '
		{ sub(/\r$/, "") }
		/^Package:/ { packages++; if ($0 != "Package: " package) bad=1 }
		/^Version:/ { versions++; if ($0 != "Version: " version) bad=1 }
		/^Architecture:/ { arches++; if ($0 != "Architecture: all") bad=1 }
		END { exit (bad || packages != 1 || versions != 1 || arches != 1) }
	' "$WORK_DIR/control"
}

perform_install() {
	check_release install || return 1
	[ "$state" = available ] || return 0
	state=installing
	message="Downloading and verifying $latest_version."
	save_state || return 1
	fetch_https "$CHECKSUM_URL" "$WORK_DIR/checksum" 30 16384 &&
		fetch_https "$ASSET_URL" "$WORK_DIR/$ASSET_NAME" 120 33554432 || {
		fail_update 'Cannot download the update package or its checksum.'
		return 1
	}
	verify_checksum || return 1
	verify_package || {
		fail_update 'Invalid IPK control metadata; package name, version, or architecture does not match the release.'
		return 1
	}
	# An external opkg invocation may upgrade the package during download.
	current_version=$(current_package_version) || {
		fail_update 'Cannot re-read the installed version before installation.'
		return 1
	}
	if ! opkg compare-versions "$latest_version" '>>' "$current_version"; then
		state=up_to_date
		message='The installed version changed; no reinstall or downgrade was performed.'
		save_state
		return 0
	fi
	message="Installing $latest_version."
	save_state || return 1
	if ! opkg install "$WORK_DIR/$ASSET_NAME"; then
		fail_update 'opkg installation failed; see /tmp/drcom-auth-update/install.log.'
		return 1
	fi
	current_version=$(current_package_version)
	[ "$current_version" = "$latest_version" ] || {
		fail_update 'opkg returned success but the installed version could not be verified.'
		return 1
	}
	state=installed
	installed_at=$(date '+%Y-%m-%d %H:%M:%S %Z')
	message="Installed $current_version. Refresh the LuCI page."
	save_state
}

status_command() {
	load_state
	if ! require_package; then print_status; return 0; fi
	case "$state" in
		checking|installing)
			# Recover interrupted worker state using its kernel lock.
			if command -v flock >/dev/null 2>&1; then
				exec 9> "$STATE_DIR/work.lock"
				if flock -n 9; then
					# The worker may have finished since the first read.
					load_state
					require_package
					case "$state" in
						checking|installing)
							state=error
							message='The previous update was interrupted; check again to retry.'
							save_state
							;;
					esac
				fi
			fi
			;;
	esac
	print_status
}

start_update() {
	local action="$1" result
	load_state
	if ! require_package || ! require_dependencies flock curl jsonfilter sha256sum tar; then
		print_status
		return 1
	fi
	exec 9> "$STATE_DIR/work.lock"
	if ! flock -n 9; then
		# Never overwrite the process that holds the lock.
		load_state
		message='Another update check or installation is already running.'
		print_status
		return 1
	fi
	load_state
	require_package || { print_status; return 1; }
	state=checking
	message='Checking the latest stable GitHub release.'
	[ "$action" != install ] || { state=installing; message='Starting the update worker.'; }
	save_state || return 1
	if [ "$action" = install ]; then
		# Inherited FD 9 keeps the lock after the RPC parent exits.
		(
			trap '' HUP
			exec /bin/sh "$SELF" _install_worker
		) < /dev/null > "$STATE_DIR/install.log" 2>&1 &
		print_status
		return 0
	fi
	new_work_dir || { print_status; return 1; }
	check_release
	result=$?
	print_status
	return "$result"
}

install_worker() {
	# Private entry point; requires the starter's inherited descriptor.
	flock -n 9 2>/dev/null || return 1
	load_state
	trap 'fail_update "The update worker was interrupted."; exit 1' INT TERM
	new_work_dir || return 1
	perform_install
}

read_schedule_config() {
	local exported values
	# Absolute-filename loading disables UCI deltas: pending LuCI edits must
	# never enable unattended installs before they have been committed.
	exported=$(uci -q export /etc/config/drcom_auth 2>/dev/null) || return 1
	values=$(printf '%s\n' "$exported" | awk '
		BEGIN { q=sprintf("%c", 39); enabled="0"; hour="4"; minute="0" }
		$1 == "config" { main=($2 == "drcom_auth" && $3 == q "main" q) }
		main && $1 == "option" {
			value=$3; if (substr(value,1,1) == q) value=substr(value,2,length(value)-2)
			if ($2 == "auto_update") enabled=value
			if ($2 == "update_hour") hour=value
			if ($2 == "update_minute") minute=value
		}
		END { printf "%s\n%s\n%s\n", enabled, hour, minute }
	')
	auto_update=$(printf '%s\n' "$values" | sed -n '1p')
	update_hour=$(printf '%s\n' "$values" | sed -n '2p')
	update_minute=$(printf '%s\n' "$values" | sed -n '3p')
}

schedule_command() {
	local marker=' # drcom-auth-auto-update'
	load_state
	if ! require_dependencies flock uci crontab; then print_status; return 1; fi
	exec 8> "$STATE_DIR/schedule.lock"
	if ! flock -n 8; then
		state=error message='Another update schedule change is already running.'
		print_status
		return 1
	fi
	read_schedule_config || {
		state=error message='Cannot read committed update settings.'
		print_status
		return 1
	}
	case "$auto_update" in
		0) ;;
		1)
			case "$update_hour" in ''|*[!0-9]*) update_hour=invalid ;; esac
			case "$update_minute" in ''|*[!0-9]*) update_minute=invalid ;; esac
			if ! [ "$update_hour" -le 23 ] 2>/dev/null || ! [ "$update_minute" -le 59 ] 2>/dev/null; then
				state=error message='Invalid automatic update time.'
				print_status
				return 1
			fi
			;;
		*) state=error message='Invalid automatic update switch.'; print_status; return 1 ;;
	esac
	new_work_dir || { print_status; return 1; }
	if ! crontab -u root -l > "$WORK_DIR/cron.old" 2> "$WORK_DIR/cron.error"; then
		if [ -s "$WORK_DIR/cron.old" ] || ! grep -Eiq 'no crontab|No such file|does not exist' "$WORK_DIR/cron.error"; then
			state=error message='Cannot read the root crontab; it was not changed.'
			print_status
			return 1
		fi
	fi
	awk -v marker="$marker" 'substr($0, length($0)-length(marker)+1) != marker { print }' \
		"$WORK_DIR/cron.old" > "$WORK_DIR/cron.new" || return 1
	if [ "$auto_update" = 1 ]; then
		printf '%s %s * * * [ ! -f /usr/share/drcom-auth/update.sh ] || /bin/sh /usr/share/drcom-auth/update.sh scheduled >/dev/null 2>&1%s\n' \
			"$update_minute" "$update_hour" "$marker" >> "$WORK_DIR/cron.new"
	fi
	if ! cmp -s "$WORK_DIR/cron.old" "$WORK_DIR/cron.new"; then
		if ! crontab -u root "$WORK_DIR/cron.new"; then
			state=error message='Cannot install the root update schedule.'
			print_status
			return 1
		fi
	fi
	if [ "$auto_update" = 1 ]; then
		# Start/enable cron without restarting a running daemon: this also
		# runs from an updater's own opkg postinst.
		if [ ! -x "$CRON_INIT" ] ||
			{ ! "$CRON_INIT" enabled && ! "$CRON_INIT" enable; } ||
			{ ! "$CRON_INIT" running && ! "$CRON_INIT" start; } ||
			! "$CRON_INIT" running; then
			state=error message='The update schedule was saved but the cron service could not be activated.'
			print_status
			return 1
		fi
	fi
	# postinst may call this during an install; keep worker state intact.
	state=idle
	message='Automatic update schedule disabled.'
	[ "$auto_update" != 1 ] || message="Automatic updates scheduled daily at $update_hour:$update_minute (router local time)."
	print_status
}

prepare_runtime || { printf 'state=error\nmessage=Cannot create the update runtime directory.\n'; exit 1; }
case "${1:-status}" in
	status) status_command ;;
	check) start_update check ;;
	install) start_update install ;;
	_install_worker) install_worker ;;
	schedule) schedule_command ;;
	scheduled)
		# An obsolete cron entry cannot bypass a disabled setting.
		read_schedule_config && [ "$auto_update" = 1 ] || exit 0
		start_update install
		;;
	*) printf 'Usage: %s {status|check|install|schedule|scheduled}\n' "$0" >&2; exit 1 ;;
esac
