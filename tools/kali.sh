#!/usr/bin/env bash
# Run a command inside a long-lived Kali container.
#
# The whole verification approach rests on executing a real binary, so a tool
# that is not installed on this Mac cannot be documented. This is the way round
# that: one container, kept alive between runs so apt's cache and installed
# packages persist, and every tool read and executed inside it.
#
#   tools/kali.sh up                 start (or reuse) the container
#   tools/kali.sh install nikto      apt-get install inside it
#   tools/kali.sh run nikto -Help    run a command inside it
#   tools/kali.sh have nikto         is it installed?
#   tools/kali.sh down               stop and remove it
#
# Nothing here touches the host. The container is named so it can never be
# confused with one of Atharva's own, and `down` removes only that name.
set -uo pipefail
NAME=commander-kali
IMAGE=kalilinux/kali-rolling

running() { [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" = "true" ]; }

case "${1:-}" in
  up)
    if running; then echo "already up: $NAME"; exit 0; fi
    docker rm -f "$NAME" >/dev/null 2>&1
    docker run -d --name "$NAME" --network bridge "$IMAGE" sleep infinity >/dev/null
    docker exec "$NAME" bash -c 'apt-get update -qq' >/dev/null 2>&1
    echo "up: $NAME ($IMAGE)"
    ;;
  install)
    shift
    running || { echo "not up — run: tools/kali.sh up" >&2; exit 1; }
    docker exec "$NAME" bash -c "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends $* >/dev/null 2>&1"
    for p in "$@"; do
      docker exec "$NAME" bash -c "command -v $p >/dev/null 2>&1" \
        && echo "  installed: $p" || echo "  NOT on PATH after install: $p"
    done
    ;;
  have)
    shift
    running || exit 1
    docker exec "$NAME" bash -c "command -v $1 >/dev/null 2>&1" && echo "yes" || echo "no"
    ;;
  run)
    shift
    running || { echo "not up — run: tools/kali.sh up" >&2; exit 1; }
    docker exec "$NAME" "$@"
    ;;
  sh)
    shift
    running || { echo "not up" >&2; exit 1; }
    docker exec "$NAME" bash -c "$*"
    ;;
  down)
    docker rm -f "$NAME" >/dev/null 2>&1 && echo "removed: $NAME" || echo "not running"
    ;;
  *)
    echo "usage: tools/kali.sh up|install <pkg...>|have <cmd>|run <cmd...>|sh <script>|down" >&2
    exit 2
    ;;
esac
