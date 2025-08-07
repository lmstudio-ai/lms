#!/usr/bin/env bash

# storelm.sh - Copy a local LM Studio model directory to an external drive,
# erase the local directory's contents, and symlink all files back from the external drive.

set -euo pipefail

# --- Default Configuration ---
LOCAL_LM_STUDIO_MODELS_BASE="${LOCAL_LM_STUDIO_MODELS_BASE:-$HOME/.cache/lm-studio/models}"
EXTERNAL_DRIVE_MODELS_BASE="${EXTERNAL_DRIVE_MODELS_BASE:-/mnt/external_drive/lmstudio_models}"
DRY_RUN=0

# --- Argument Parsing ---
usage() {
  echo "Usage: $(basename \"$0\") [--local <local_path>] [--external <external_path>] [--dry-run] <directory_name>"
  echo "Run this from within a creator's directory, e.g., $HOME/.cache/lm-studio/models/SomeCreatorName/"
  echo "Options:"
  echo "  --local <path>      Set local LM Studio models base directory"
  echo "  --external <path>   Set external drive models base directory"
  echo "  --dry-run           Preview actions without making changes"
  echo "  --help              Show this help message"
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --local)
      LOCAL_LM_STUDIO_MODELS_BASE="$2"; shift 2;;
    --external)
      EXTERNAL_DRIVE_MODELS_BASE="$2"; shift 2;;
    --dry-run)
      DRY_RUN=1; shift;;
    --help)
      usage; exit 0;;
    --)
      shift; break;;
    -*)
      echo "Unknown option: $1"; usage; exit 1;;
    *)
      break;;
  esac
done

# --- Directory Argument ---
if [ -z "${1-}" ]; then
  usage
  exit 1
fi
LOCAL_MODEL_DIR_NAME="$1"
CURRENT_WORKING_DIR="$PWD"
LOCAL_MODEL_FULL_PATH="${CURRENT_WORKING_DIR}/${LOCAL_MODEL_DIR_NAME}"

# --- Sanity Checks ---
if [[ "$CURRENT_WORKING_DIR" != "$LOCAL_LM_STUDIO_MODELS_BASE/"* ]] || [[ "$CURRENT_WORKING_DIR" == "$LOCAL_LM_STUDIO_MODELS_BASE" ]]; then
  echo "Error: Run from within a creator's directory under '$LOCAL_LM_STUDIO_MODELS_BASE'." >&2
  exit 1
fi

if [ ! -d "$LOCAL_MODEL_FULL_PATH" ]; then
  echo "Error: Local model directory '$LOCAL_MODEL_FULL_PATH' not found." >&2
  exit 1
fi

CREATOR_NAME=$(basename "$CURRENT_WORKING_DIR")
EXTDRIVE_CREATOR_DIR="${EXTERNAL_DRIVE_MODELS_BASE}/${CREATOR_NAME}"
EXTDRIVE_MODEL_FULL_PATH="${EXTDRIVE_CREATOR_DIR}/${LOCAL_MODEL_DIR_NAME}"

echo "--------------------------------------------------"
echo "🚀 Backing up model:"
echo "  Local Model: $LOCAL_MODEL_FULL_PATH"
echo "  Creator: $CREATOR_NAME"
echo "  Target EXTDRIVE Path: $EXTDRIVE_MODEL_FULL_PATH"
echo "  Dry Run: $DRY_RUN"
echo "--------------------------------------------------"

# --- Prepare EXTDRIVE Destination ---
if [ ! -d "$EXTDRIVE_CREATOR_DIR" ]; then
  echo "🛠️ Creating creator directory '$EXTDRIVE_CREATOR_DIR' on EXTDRIVE drive..."
  if [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$EXTDRIVE_CREATOR_DIR" || { echo "Failed to create $EXTDRIVE_CREATOR_DIR" >&2; exit 1; }
  fi
fi

if [ -e "$EXTDRIVE_MODEL_FULL_PATH" ]; then
  read -rp "⚠️ '$EXTDRIVE_MODEL_FULL_PATH' already exists on EXTDRIVE. Overwrite? (y/n): " answer
  if ! [[ "$answer" =~ ^[Yy]$ ]]; then
    echo "↪️ Skipping copy. No changes made."
    exit 0
  fi
  echo "🗑️ Removing existing target..."
  if [ "$DRY_RUN" -eq 0 ]; then
    rm -rf "$EXTDRIVE_MODEL_FULL_PATH" || { echo "Failed to remove $EXTDRIVE_MODEL_FULL_PATH" >&2; exit 1; }
  fi
fi

echo "📦 Copying '$LOCAL_MODEL_DIR_NAME' to EXTDRIVE..."
if [ "$DRY_RUN" -eq 0 ]; then
  cp -Rp "$LOCAL_MODEL_FULL_PATH" "$EXTDRIVE_MODEL_FULL_PATH" || { echo "Copy failed!" >&2; exit 1; }
  echo "✅ Copy complete."
else
  echo "[DRY RUN] Would copy $LOCAL_MODEL_FULL_PATH to $EXTDRIVE_MODEL_FULL_PATH"
fi

read -rp "❓ Replace all files in '$LOCAL_MODEL_DIR_NAME' with symlinks to EXTDRIVE? (y/n): " confirm_replace

if [[ "$confirm_replace" =~ ^[Yy]$ ]]; then
  # Extra safety: make sure we're not about to delete something dangerous
  if [[ "$LOCAL_MODEL_FULL_PATH" == "$LOCAL_LM_STUDIO_MODELS_BASE"* ]] && [[ "$LOCAL_MODEL_FULL_PATH" != "$LOCAL_LM_STUDIO_MODELS_BASE" ]]; then
    echo "🗑️ Removing contents of local model directory: $LOCAL_MODEL_FULL_PATH"
    if [ "$DRY_RUN" -eq 0 ]; then
      find "$LOCAL_MODEL_FULL_PATH" -mindepth 1 -exec rm -rf {} + || { echo "Failed to clean $LOCAL_MODEL_FULL_PATH" >&2; exit 1; }
    else
      echo "[DRY RUN] Would remove contents of $LOCAL_MODEL_FULL_PATH"
    fi
  else
    echo "❌ Refusing to delete: path sanity check failed."
    exit 1
  fi

  echo "🔗 Creating symlinks for each file from EXTDRIVE to local directory..."
  (
    cd "$EXTDRIVE_MODEL_FULL_PATH"
    find . -type f -print0 | while IFS= read -r -d '' relpath; do
      srcfile="$EXTDRIVE_MODEL_FULL_PATH/${relpath#./}"
      targetfile="$LOCAL_MODEL_FULL_PATH/${relpath#./}"
      if [ "$DRY_RUN" -eq 0 ]; then
        mkdir -p "$(dirname "$targetfile")"
        [ -e "$targetfile" ] && rm -f "$targetfile"
        ln -s "$srcfile" "$targetfile" || { echo "Failed to symlink $targetfile" >&2; exit 1; }
        echo "  Symlinked: $targetfile"
      else
        echo "[DRY RUN] Would symlink $srcfile to $targetfile"
      fi
    done
  )
  echo "✅ All files symlinked. '$LOCAL_MODEL_DIR_NAME' is now a directory of symlinks to EXTDRIVE."
else
  echo "Local directory retained. Backup is at '$EXTDRIVE_MODEL_FULL_PATH'."
fi

echo "--------------------------------------------------"
echo "🎉 Operation finished."
exit 0
