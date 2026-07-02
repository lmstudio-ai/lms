#!/usr/bin/env bash
# Build llama.cpp with the Metal backend on an Intel Mac (AMD dGPU supported).
# See BUILD-macos-intel.md for the full guide.
#
# Overridable environment variables:
#   LLAMA_WORKSPACE  where sources/builds/models live (default: ~/llama-macos-intel)
#   LLAMA_REPO       git repo to build from          (default: upstream ggml-org/llama.cpp)
#   LLAMA_METAL_REF  git branch/tag to build         (default: master)
set -euo pipefail

REPO="${LLAMA_REPO:-https://github.com/ggml-org/llama.cpp}"
REF="${LLAMA_METAL_REF:-master}"
ROOT="${LLAMA_WORKSPACE:-$HOME/llama-macos-intel}"
SRC="$ROOT/src-metal"

say()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || die "This script must run on macOS."
xcode-select -p >/dev/null 2>&1 \
  || die "Xcode Command Line Tools not found. Install with: xcode-select --install"
command -v cmake >/dev/null 2>&1 \
  || die "cmake not found. Install with: brew install cmake"
command -v git >/dev/null 2>&1 || die "git not found (should ship with the CLT)."

if [[ "$(uname -m)" != "x86_64" ]]; then
  say "Note: you are on $(uname -m), not an Intel Mac. The build will still work,"
  say "but this kit is aimed at Intel Macs with AMD GPUs."
fi

mkdir -p "$ROOT" "$ROOT/models" "$ROOT/logs"

if [[ -d "$SRC/.git" ]]; then
  say "Updating existing checkout at $SRC (ref: $REF)"
  git -C "$SRC" fetch --depth 1 origin "$REF"
  git -C "$SRC" checkout -q FETCH_HEAD
else
  say "Cloning $REPO (ref: $REF) into $SRC"
  git clone --depth 1 --branch "$REF" "$REPO" "$SRC"
fi

say "Configuring (Metal backend — enabled by default on macOS)"
cmake -S "$SRC" -B "$SRC/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DGGML_METAL=ON

say "Building (this takes a few minutes)"
cmake --build "$SRC/build" --config Release -j "$(sysctl -n hw.ncpu)"

BIN="$SRC/build/bin/llama-server"
[[ -x "$BIN" ]] || die "Build finished but $BIN is missing — check the output above."

say "Done. Metal build is at: $BIN"
say "Sanity check GPU detection with:"
say "  \"$BIN\" --list-devices"
say "Then start chatting via: ./llama.sh metal -m <model.gguf>   (WebUI on http://127.0.0.1:8080)"
