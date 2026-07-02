#!/usr/bin/env bash
# Launch llama-server with either the Metal or the Vulkan build.
#
#   ./llama.sh metal  -m ~/llama-macos-intel/models/some-model.gguf
#   ./llama.sh vulkan -m ~/llama-macos-intel/models/some-model.gguf
#   ./llama.sh metal  --list-devices
#
# Anything after the backend name is passed straight to llama-server, so all
# of its flags work here (-c, -ngl, -hf, --port, ...). Defaults added for you
# unless you override them: --host 127.0.0.1 --port 8080 -ngl 999.
# The chat WebUI is served by llama-server itself at http://127.0.0.1:8080
#
# Overridable environment variables:
#   LLAMA_WORKSPACE  workspace dir (default: ~/llama-macos-intel)
#   LLAMA_PORT       server/WebUI port (default: 8080)
set -euo pipefail

ROOT="${LLAMA_WORKSPACE:-$HOME/llama-macos-intel}"
PORT="${LLAMA_PORT:-8080}"

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

[[ $# -ge 1 ]] || usage
BACKEND="$1"; shift
case "$BACKEND" in
  metal|vulkan) ;;
  *) echo "Unknown backend '$BACKEND' (expected 'metal' or 'vulkan')" >&2; usage ;;
esac

BIN="$ROOT/src-$BACKEND/build/bin/llama-server"
if [[ ! -x "$BIN" ]]; then
  echo "No $BACKEND build found at $BIN" >&2
  echo "Build it first with: ./build-$BACKEND.sh" >&2
  exit 1
fi

# The Vulkan build needs MoltenVK driver paths in the environment.
if [[ "$BACKEND" == "vulkan" && -f "$ROOT/env-vulkan.sh" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/env-vulkan.sh"
fi

# Add defaults only when the caller hasn't set them.
ARGS=("$@")
has_flag() {
  local f
  for f in "${ARGS[@]+"${ARGS[@]}"}"; do
    [[ "$f" == "$1" || "$f" == "$2" ]] && return 0
  done
  return 1
}
has_flag --host --host        || ARGS+=(--host 127.0.0.1)
has_flag --port --port        || ARGS+=(--port "$PORT")
has_flag -ngl --n-gpu-layers  || ARGS+=(-ngl 999)

# Report the port actually in effect (caller may have passed their own --port).
prev=""
for a in "${ARGS[@]}"; do
  [[ "$prev" == "--port" ]] && PORT="$a"
  prev="$a"
done

echo "==> Starting llama-server [$BACKEND] on http://127.0.0.1:$PORT"
exec "$BIN" "${ARGS[@]}"
