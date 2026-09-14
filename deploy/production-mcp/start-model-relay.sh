#!/bin/sh
set -eu

# The shared directory belongs exclusively to this application. Never clean
# arbitrary paths, regular files, symlinks, or sockets owned by a live process.
socket=/run/model/relay.sock
lock=/run/model/relay.lock
fail() { echo "model-relay: $*" >&2; exit 1; }

[ -d /run/model ] && [ ! -L /run/model ] || fail "invalid socket directory"
[ "$(stat -c %u /run/model)" = "$(id -u)" ] || fail "socket directory owner mismatch"
[ ! -L "$lock" ] || fail "lock must not be a symlink"
if [ -e "$lock" ]; then
  [ -f "$lock" ] && [ "$(stat -c %u "$lock")" = "$(id -u)" ] || fail "invalid lock file"
fi
umask 077
exec 9>>"$lock"
flock -n 9 || fail "another relay holds the startup lock"
# FD 9 stays open across exec and for the complete nginx lifetime. Kernel locks
# disappear on SIGKILL/reboot, unlike a PID file or mkdir-based lock.

[ -r /proc/net/unix ] || fail "cannot inspect live Unix sockets"
if awk -v socket="$socket" '$8 == socket { found = 1 } END { exit !found }' /proc/net/unix; then
  fail "socket belongs to a live process; refusing to unlink"
else
  scan_status=$?
  [ "$scan_status" -eq 1 ] || fail "cannot read live Unix sockets"
fi
[ ! -L "$socket" ] || fail "socket must not be a symlink"
if [ -e "$socket" ]; then
  [ -S "$socket" ] || fail "socket path is not a Unix socket"
  [ "$(stat -c %u "$socket")" = "$(id -u)" ] || fail "socket owner mismatch"
  rm -- "$socket"
  echo "model-relay: removed stale Unix socket" >&2
fi

exec nginx -g 'daemon off;'
