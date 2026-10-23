#!/bin/sh
# Fully offline updater tests. All package/network/UCI/cron operations are
# fixtures. Git for Windows lacks flock, so its bundled Perl provides the
# same real kernel FD lock for concurrency and detached-worker tests.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UPDATER="$ROOT/root/usr/share/drcom-auth/update.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/work" "$TMP/fixtures"
export MOCK_ROOT="$TMP"
command -v cygpath >/dev/null 2>&1 && MOCK_ROOT=$(cygpath -m "$TMP")
export DRCOM_UPDATE_STATE_DIR="$TMP/state" DRCOM_UPDATE_TMP_DIR="$TMP/work"
export DRCOM_UPDATE_CRON_INIT="$TMP/bin/cron-init"

cat > "$TMP/mock.py" <<'PY'
import json, os, re, shutil, sys, time
from pathlib import Path
# These mocks represent Unix commands, including their LF output on Windows.
sys.stdout.reconfigure(newline="\n")
sys.stderr.reconfigure(newline="\n")
root = Path(os.environ["MOCK_ROOT"])
command, *args = sys.argv[1:]
def has(name): return (root / name).exists()
def write(name, value): (root / name).write_text(value, encoding="utf-8")
def read(name): return (root / name).read_text(encoding="utf-8")
def log(name, value):
    with (root / name).open("a", encoding="utf-8") as out: out.write(value + "\n")
def hold(kind):
    if has("hold_" + kind):
        write("ready_" + kind, "ready")
        for _ in range(1500):
            if has("release_" + kind): return
            time.sleep(.02)
        raise RuntimeError("Fixture hold timed out: " + kind)
if command == "opkg":
    log("opkg.log", json.dumps(args))
    if args == ["status", "luci-app-drcom-auth"]:
        if has("fail_status"): sys.exit(1)
        print("Package: luci-app-drcom-auth\nVersion: " + read("version").strip() + "\nStatus: install user installed")
    elif len(args) == 4 and args[0] == "compare-versions" and args[2] == "gt":
        def version(v): return tuple(map(int, re.split(r"[.-]", v)))
        sys.exit(0 if version(args[1]) > version(args[3]) else 1)
    elif len(args) == 2 and args[0] == "install" and Path(args[1]).is_file():
        hold("install")
        log("install.log", args[1])
        if has("fail_install"): sys.exit(1)
        if not has("wrong_installed_version"):
            version = Path(args[1]).name.split("_")[1]
            write("version", version)
    else: raise RuntimeError("Unsafe/unexpected opkg invocation: " + repr(args))
elif command == "curl":
    log("http.log", json.dumps(args))
    assert "--insecure" not in args and "-k" not in args
    for flag, value in [("--proto", "=https"), ("--proto-redir", "=https")]:
        assert args[args.index(flag) + 1] == value
    for flag in ["--connect-timeout", "--max-time", "--max-redirs", "--max-filesize"]:
        assert int(args[args.index(flag) + 1]) > 0
    out, url = args[args.index("--output") + 1], args[-1]
    api = "https://api.github.com/repos/azurekiln2333/luci-app-hstc-drcom-auth/releases/latest"
    if url == api:
        hold("api")
        if has("fail_api"): sys.exit(22)
        source = root / "fixtures" / "release.json"
    else:
        assert url.startswith("https://github.com/azurekiln2333/luci-app-hstc-drcom-auth/releases/download/v2.4.0/")
        kind = "checksum" if url.endswith(".sha256.txt") else "package"
        if has("fail_" + kind): sys.exit(22)
        source = root / "fixtures" / ("checksum" if kind == "checksum" else "package.ipk")
    shutil.copyfile(source, out)
elif command == "jsonfilter":
    assert args[0] == "-i" and args[2] == "-e"
    payload = json.loads(Path(args[1]).read_text(encoding="utf-8"))
    expression = args[3]
    if expression in ["@.tag_name", "@.draft", "@.prerelease"]:
        values = [payload[expression[2:]]]
    elif expression == "@.assets[*].name":
        values = [a["name"] for a in payload["assets"]]
    else:
        match = re.fullmatch(r'@\.assets\[@\.name="([^"]+)"\]\.browser_download_url', expression)
        assert match, expression
        values = [a["browser_download_url"] for a in payload["assets"] if a["name"] == match[1]]
    for value in values: print(json.dumps(value) if isinstance(value, bool) else value)
elif command == "uci":
    log("uci.log", json.dumps(args))
    assert args == ["-q", "export", "/etc/config/drcom_auth"], args
    if has("fail_uci"): sys.exit(1)
    print(read("config"), end="")
elif command == "crontab":
    log("crontab.log", json.dumps(args))
    assert args[:2] == ["-u", "root"], args
    if args[2:] == ["-l"]:
        if has("fail_crontab_read"):
            print("permission denied", file=sys.stderr); sys.exit(1)
        if not has("crontab"):
            print("no crontab for root", file=sys.stderr); sys.exit(1)
        print(read("crontab"), end="")
    else:
        assert len(args) == 3
        if has("fail_crontab_write"): sys.exit(1)
        shutil.copyfile(args[2], root / "crontab")
        log("crontab.write", "write")
elif command == "cron-init":
    log("cron.log", " ".join(args))
    if args == ["enabled"]: sys.exit(0 if has("cron_enabled") else 1)
    if args == ["running"]: sys.exit(0 if has("cron_running") else 1)
    if has("fail_cron"): sys.exit(1)
    if args == ["enable"]: write("cron_enabled", "1")
    elif args == ["start"]: write("cron_running", "1")
    else: raise RuntimeError("Cron must never restart: " + repr(args))
else: raise RuntimeError(command)
PY
for command in opkg curl jsonfilter uci crontab cron-init; do
	# Keep this UCI config identifier literal when Git Bash calls native
	# Windows Python; temporary file paths should still be converted.
	printf '#!/bin/sh\nMSYS2_ARG_CONV_EXCL=/etc/config/drcom_auth exec python "$MOCK_ROOT/mock.py" %s "$@"\n' "$command" > "$TMP/bin/$command"
done
if ! command -v flock >/dev/null 2>&1; then
	command -v perl >/dev/null 2>&1 || { echo 'Need flock or Git-bundled Perl for kernel lock tests.' >&2; exit 1; }
	cat > "$TMP/bin/flock" <<'SH'
#!/bin/sh
[ "$#" -eq 2 ] && [ "$1" = -n ] || exit 90
exec perl -MFcntl=:flock -e 'open(my $f, ">&=", $ARGV[0]) or die $!; flock($f, LOCK_EX | LOCK_NB) or exit 1' "$2"
SH
fi
chmod +x "$TMP/bin/"*
PATH="$TMP/bin:$PATH"
export PATH
fail() { echo "FAIL: $*" >&2; [ ! -f "$TMP/result" ] || cat "$TMP/result" >&2; [ ! -f "$TMP/state/install.log" ] || cat "$TMP/state/install.log" >&2; exit 1; }
contains() { grep -Fq "$2" "$1" || fail "$1 missing [$2]"; }
absent() { [ ! -e "$1" ] || fail "$1 should not exist"; }
run() { sh "$UPDATER" "$@"; }
reject() { if run "$@" > "$TMP/result"; then fail "$* unexpectedly succeeded"; fi; contains "$TMP/result" 'state=error'; }
await_file() {
	attempt=0
	while [ ! -f "$1" ]; do
		attempt=$((attempt + 1))
		[ "$attempt" -lt 500 ] || fail "timed out waiting for $1"
		sleep .02
	done
}
await_terminal() {
	attempt=0
	while :; do
		run status > "$TMP/result"
		case "$(sed -n 's/^state=//p' "$TMP/result")" in
			checking|installing) ;;
			*) break ;;
		esac
		attempt=$((attempt + 1))
		[ "$attempt" -lt 500 ] || fail 'worker did not finish'
		sleep .02
	done
	contains "$TMP/result" "state=$1"
	# Terminal status is written just before worker cleanup/FD release.
	attempt=0
	while ! (exec 9> "$TMP/state/work.lock"; flock -n 9); do
		attempt=$((attempt + 1))
		[ "$attempt" -lt 200 ] || fail 'worker retained the kernel lock'
		sleep .02
	done
	for leftover in "$TMP/work"/drcom-auth-update.*; do
		[ ! -e "$leftover" ] || fail 'worker left a download directory'
	done
}
fixture() {
	python - "$TMP" "$@" <<'PY'
import hashlib, io, json, sys, tarfile
from pathlib import Path
root, *args = sys.argv[1:]
root = Path(root)
version = args[0] if args else "2.4.0-1"
package = args[1] if len(args) > 1 else "luci-app-drcom-auth"
arch = args[2] if len(args) > 2 else "all"
name = "luci-app-drcom-auth_" + version + "_all.ipk"
def archive(entries):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w:gz") as tar:
        for name, content in entries:
            data = content.encode() if isinstance(content, str) else content
            item = tarfile.TarInfo("./" + name); item.size = len(data)
            tar.addfile(item, io.BytesIO(data))
    return out.getvalue()
control = archive([("control", f"Package: {package}\nVersion: {version}\nArchitecture: {arch}\n")])
data = archive([("debian-binary", "2.0\n"), ("control.tar.gz", control), ("data.tar.gz", archive([]))])
(root / "fixtures/package.ipk").write_bytes(data)
(root / "fixtures/checksum").write_bytes((hashlib.sha256(data).hexdigest() + " *" + name + "\r\n").encode())
base = "https://github.com/azurekiln2333/luci-app-hstc-drcom-auth/releases/download/v2.4.0/"
metadata = {"tag_name": "v2.4.0", "draft": False, "prerelease": False, "assets": [
    {"name": name, "browser_download_url": base + name},
    {"name": name + ".sha256.txt", "browser_download_url": base + name + ".sha256.txt"}]}
(root / "fixtures/release.json").write_text(json.dumps(metadata))
PY
}
reset() {
	rm -rf "$TMP/state"
	mkdir -p "$TMP/state"
	rm -f "$TMP"/fail_* "$TMP"/hold_* "$TMP"/ready_* "$TMP"/release_* "$TMP/wrong_installed_version"
	: > "$TMP/install.log"
	printf '2.3.1-1\n' > "$TMP/version"
	printf "config drcom_auth 'main'\n\toption auto_update '0'\n" > "$TMP/config"
	fixture
}
install_error() {
	run install > "$TMP/start"
	contains "$TMP/start" 'state=installing'
	await_terminal error
	contains "$TMP/result" "$1"
}

reset
run status > "$TMP/result"
contains "$TMP/result" 'state=idle'
contains "$TMP/result" 'current_version=2.3.1-1'
run check > "$TMP/result"
contains "$TMP/result" 'state=available'
contains "$TMP/result" 'latest_version=2.4.0-1'
grep -Eq '^checked_at=[0-9]{4}-[0-9]{2}-[0-9]{2} ' "$TMP/result" || fail 'timestamp is not readable'
[ ! -s "$TMP/install.log" ] || fail 'checking installed a package'
for installed in 2.4.0-1 2.5.0-1; do
	printf '%s\n' "$installed" > "$TMP/version"
	run check > "$TMP/result"
	contains "$TMP/result" 'state=up_to_date'
	run install > "$TMP/start"
	await_terminal up_to_date
	[ ! -s "$TMP/install.log" ] || fail 'same/newer package was reinstalled'
done
fixture 2.4.0-2
printf '2.4.0-1\n' > "$TMP/version"
run check > "$TMP/result"
contains "$TMP/result" 'latest_version=2.4.0-2'
contains "$TMP/result" 'state=available'
echo 'OK: check/update/equal/older versions and packaging release bumps'

for kind in bad_tag prerelease draft missing_checksum foreign_url duplicate wrong_version malformed_json; do
	reset
	python - "$TMP/fixtures/release.json" "$kind" <<'PY'
import json, sys
from pathlib import Path
p = Path(sys.argv[1]); d = json.loads(p.read_text()); kind = sys.argv[2]
if kind == "bad_tag": d["tag_name"] = "v2.4.0;reboot"
if kind in ["prerelease", "draft"]: d[kind] = True
if kind == "missing_checksum": d["assets"].pop()
if kind == "foreign_url": d["assets"][0]["browser_download_url"] = "https://example.invalid/wrong.ipk"
if kind == "duplicate": d["assets"].append(dict(d["assets"][0]))
if kind == "wrong_version": d["assets"][0]["name"] = d["assets"][0]["name"].replace("2.4.0", "2a4b0")
p.write_text("{" if kind == "malformed_json" else json.dumps(d))
PY
	reject check
	[ ! -s "$TMP/install.log" ] || fail "bad metadata installed: $kind"
done
reset
touch "$TMP/fail_api"
reject check
contains "$TMP/result" 'Cannot download the latest GitHub release'
echo 'OK: release metadata, asset pairing, canonical URL, API failure rejection'

reset
touch "$TMP/hold_api"
run install > "$TMP/start"
contains "$TMP/start" 'state=installing'
await_file "$TMP/ready_api"
run status > "$TMP/result"
contains "$TMP/result" 'state=installing'
cp "$TMP/state/status" "$TMP/status.before"
if run check > "$TMP/busy"; then fail 'overlapping check acquired install lock'; fi
contains "$TMP/busy" 'already running'
cmp "$TMP/state/status" "$TMP/status.before" || fail 'busy call overwrote install status'
if ! run schedule > "$TMP/schedule"; then
	cat "$TMP/schedule" >&2
	fail 'postinst schedule failed during installation'
fi
cmp "$TMP/state/status" "$TMP/status.before" || fail 'postinst schedule overwrote install status'
touch "$TMP/release_api"
await_terminal installed
contains "$TMP/result" 'current_version=2.4.0-1'
grep -Eq '^installed_at=[0-9]{4}-' "$TMP/result" || fail 'install timestamp missing'
[ "$(wc -l < "$TMP/install.log" | tr -d ' ')" -eq 1 ] || fail 'valid update did not install exactly once'
echo 'OK: detached installation, inherited real kernel lock, concurrent status and postinst schedule'

for kind in bad_hash bad_filename malformed_checksum duplicate_checksum fail_checksum fail_package invalid_ipk wrong_package wrong_version wrong_arch fail_install wrong_installed_version; do
	reset
	case "$kind" in
		bad_hash) printf '%064d *luci-app-drcom-auth_2.4.0-1_all.ipk\n' 0 > "$TMP/fixtures/checksum" ;;
		bad_filename) sed 's/_all.ipk/_other.ipk/' "$TMP/fixtures/checksum" > "$TMP/checksum.new"; mv "$TMP/checksum.new" "$TMP/fixtures/checksum" ;;
		malformed_checksum) printf 'not-a-checksum\n' > "$TMP/fixtures/checksum" ;;
		duplicate_checksum) cat "$TMP/fixtures/checksum" "$TMP/fixtures/checksum" > "$TMP/checksum.new"; mv "$TMP/checksum.new" "$TMP/fixtures/checksum" ;;
		invalid_ipk) printf 'not a package\n' > "$TMP/fixtures/package.ipk"; hash=$(sha256sum "$TMP/fixtures/package.ipk"); printf '%s *luci-app-drcom-auth_2.4.0-1_all.ipk\n' "${hash%% *}" > "$TMP/fixtures/checksum" ;;
		wrong_package) fixture 2.4.0-1 unexpected-package ;;
		wrong_version) fixture 2.4.0-2; sed 's/2.4.0-2/2.4.0-1/g' "$TMP/fixtures/release.json" > "$TMP/meta.new"; mv "$TMP/meta.new" "$TMP/fixtures/release.json"; sed 's/2.4.0-2/2.4.0-1/g' "$TMP/fixtures/checksum" > "$TMP/checksum.new"; mv "$TMP/checksum.new" "$TMP/fixtures/checksum" ;;
		wrong_arch) fixture 2.4.0-1 luci-app-drcom-auth aarch64 ;;
		*) touch "$TMP/$kind" ;;
	esac
	case "$kind" in
		bad_hash) expected='SHA-256 mismatch' ;;
		bad_filename|malformed_checksum|duplicate_checksum) expected='checksum file must contain one' ;;
		fail_checksum|fail_package) expected='Cannot download the update package' ;;
		invalid_ipk|wrong_package|wrong_version|wrong_arch) expected='Invalid IPK control metadata' ;;
		fail_install) expected='opkg installation failed' ;;
		wrong_installed_version) expected='installed version could not be verified' ;;
	esac
	install_error "$expected"
	case "$kind" in fail_install|wrong_installed_version) ;; *) [ ! -s "$TMP/install.log" ] || fail "unsafe package reached opkg: $kind" ;; esac
done
echo 'OK: checksum/filename/hash/archive/control/download/opkg failure paths'

reset
printf 'old-pid=999999\n' > "$TMP/state/work.lock"
printf 'state=installing\nmessage=$(touch SHOULD_NOT_EXIST)\n' > "$TMP/state/status"
run status > "$TMP/result"
contains "$TMP/result" 'state=error'
contains "$TMP/result" 'previous update was interrupted'
absent "$ROOT/SHOULD_NOT_EXIST"
run check > "$TMP/result"
contains "$TMP/result" 'state=available'
mv "$TMP/bin/opkg" "$TMP/bin/opkg.hidden"
run status > "$TMP/result"
contains "$TMP/result" 'state=unsupported'
contains "$TMP/result" 'apk systems are not supported'
mv "$TMP/bin/opkg.hidden" "$TMP/bin/opkg"
echo 'OK: stale status/lock recovery, status remains data, unsupported package manager'

reset
printf '7 3 * * * echo keep\n# user note\n1 1 * * * obsolete # drcom-auth-auto-update\n' > "$TMP/crontab"
printf "config drcom_auth 'main'\n\toption auto_update '1'\n\toption update_hour '4'\n\toption update_minute '15'\n" > "$TMP/config"
run schedule > "$TMP/result"
contains "$TMP/crontab" '7 3 * * * echo keep'
contains "$TMP/crontab" '# user note'
contains "$TMP/crontab" '15 4 * * * [ ! -f /usr/share/drcom-auth/update.sh ]'
[ "$(grep -c ' # drcom-auth-auto-update$' "$TMP/crontab")" -eq 1 ] || fail 'duplicate cron entries'
contains "$TMP/cron.log" 'enable'
contains "$TMP/cron.log" 'start'
cp "$TMP/crontab.write" "$TMP/writes.before"
run schedule > "$TMP/result"
cmp "$TMP/crontab.write" "$TMP/writes.before" || fail 'unchanged schedule rewrote crontab'
[ "$(grep -c '^start$' "$TMP/cron.log")" -eq 1 ] || fail 'running cron was started again'
printf "config drcom_auth 'main'\n\toption auto_update '0'\n" > "$TMP/config"
run schedule > "$TMP/result"
if grep -q 'drcom-auth-auto-update' "$TMP/crontab"; then fail 'disabled schedule still present'; fi
contains "$TMP/crontab" '7 3 * * * echo keep'
cp "$TMP/http.log" "$TMP/http.before"
run scheduled
cmp "$TMP/http.log" "$TMP/http.before" || fail 'disabled scheduled command accessed network'
printf "config drcom_auth 'main'\n\toption auto_update '1'\n\toption update_hour '24'\n" > "$TMP/config"
cp "$TMP/crontab" "$TMP/cron.before"
reject schedule
cmp "$TMP/crontab" "$TMP/cron.before" || fail 'invalid schedule changed crontab'
sed "s/'24'/'4'/" "$TMP/config" > "$TMP/config.new"; mv "$TMP/config.new" "$TMP/config"
touch "$TMP/fail_crontab_read"
reject schedule
cmp "$TMP/crontab" "$TMP/cron.before" || fail 'read failure lost root jobs'
rm "$TMP/fail_crontab_read" "$TMP/cron_running"
touch "$TMP/fail_cron"
reject schedule
contains "$TMP/result" 'cron service could not be activated'
echo 'OK: committed settings, cron preservation/idempotence/disable, daemon enable/start and errors'

# Init entry points remain available with auth disabled.
(
	. "$ROOT/root/etc/init.d/drcom_auth"
	APP_DIR="$TMP/app"
	mkdir -p "$APP_DIR"
	printf '#!/bin/sh\nprintf "%%s\\n" "$1" >> "$MOCK_ROOT/init.calls"\n' > "$APP_DIR/update.sh"
	for action in update_status update_check update_install update_schedule; do "$action"; done
	config_load() { :; }
	config_get_bool() { enabled=0; }
	start_service
	procd_add_reload_trigger() { [ "$1" = drcom_auth ] || exit 1; }
	service_triggers
)
printf 'status\ncheck\ninstall\nschedule\nschedule\n' > "$TMP/init.expected"
cmp "$TMP/init.calls" "$TMP/init.expected" || fail 'init wrapper/disabled-auth schedule integration'
echo 'OK: init commands, disabled-auth scheduling, UCI reload trigger'
echo 'All offline updater tests passed.'
