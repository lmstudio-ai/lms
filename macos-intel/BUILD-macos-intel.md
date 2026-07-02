# GPU-accelerated local LLMs on Intel Macs (AMD GPU) — Metal + Vulkan

This kit gets **llama.cpp** — the same inference engine LM Studio wraps — running
with **GPU acceleration on an Intel Mac with an AMD GPU** (e.g. the Radeon Pro
5600M in the 16″ MacBook Pro 2019). You get two interchangeable engine builds
plus a chat WebUI:

| Backend | How | Recommendation |
|---|---|---|
| **Metal** | llama.cpp's native macOS backend — works on AMD dGPUs too, not just Apple Silicon | **Primary.** ~1.9× faster prompt processing than Vulkan on Intel Mac + AMD ([benchmark](https://github.com/ggml-org/llama.cpp/discussions/19187)) |
| **Vulkan** | via MoltenVK (Vulkan→Metal translation layer) | Alternative / comparison. **Pinned to `b8142`** — see [Why Vulkan is pinned](#why-the-vulkan-build-is-pinned-to-b8142) |

> **Why not LM Studio itself?** LM Studio on macOS
> [requires Apple Silicon](https://lmstudio.ai/docs/app/system-requirements).
> The `lms` CLI and `lmstudio-js` (this repo and its sibling) are pure
> TypeScript *clients* for the closed-source desktop app — they contain no
> inference code, so there is nothing in them to "compile for Intel". The
> engine has to come from llama.cpp directly, which is what this kit builds.

## Contents

```
macos-intel/
├── BUILD-macos-intel.md   ← you are here
├── build-metal.sh         ← builds llama.cpp with the Metal backend (latest)
├── build-vulkan.sh        ← builds llama.cpp with Vulkan/MoltenVK (pinned b8142)
├── llama.sh               ← launcher: ./llama.sh metal|vulkan [server args]
└── llamactl.py            ← local GUI panel to switch backends & models
```

Everything is built into a workspace at `~/llama-macos-intel/` (override with
`LLAMA_WORKSPACE`). Models go in `~/llama-macos-intel/models/`.

## Quick start (TL;DR)

```bash
# 0. One-time prerequisites
xcode-select --install          # if you don't have the Command Line Tools yet
brew install cmake

# 1. Build the Metal engine (recommended first — no extra dependencies)
./build-metal.sh

# 2. Drop a .gguf model into ~/llama-macos-intel/models/  (see "Get a model")

# 3. Run it — chat WebUI appears at http://127.0.0.1:8080
./llama.sh metal -m ~/llama-macos-intel/models/<your-model>.gguf
```

Then, optionally, build the Vulkan variant (`./build-vulkan.sh`) and use the
switcher GUI (`python3 llamactl.py`) to flip between the two.

## 1. Prerequisites

- Intel Mac with an AMD GPU, macOS 13 Ventura or newer recommended
  (Metal 3 support for the Radeon Pro 5000/6000 series).
- **Xcode Command Line Tools**: `xcode-select --install`
- **Homebrew** ([brew.sh](https://brew.sh)) and **cmake**: `brew install cmake`
- ~3 GB free disk for sources/builds, plus room for models (4–8 GB each).

## 2. Build the Metal engine (recommended)

```bash
./build-metal.sh
```

That's it — Metal is llama.cpp's default backend on macOS and needs no extra
dependencies. The script clones llama.cpp (upstream `master` by default) into
`~/llama-macos-intel/src-metal/` and builds it.

Despite the common assumption, Metal here is **not** Apple-Silicon-only: that's
true of Apple's MLX framework, but llama.cpp's Metal backend runs on AMD dGPUs
in Intel Macs, and recent releases specifically improved AMD performance
(Apple-first `simdgroup` matrix paths are automatically disabled on AMD).

Verify the GPU is seen:

```bash
./llama.sh metal --list-devices
```

You should see your AMD GPU listed as a Metal device.

Options (environment variables): `LLAMA_METAL_REF` to pin a tag (e.g. a
`bXXXX` release), `LLAMA_REPO` to build from a fork instead of upstream, e.g.
`LLAMA_REPO=https://github.com/CAND3REL/llama.cpp ./build-metal.sh`.

## 3. Build the Vulkan engine (alternative, pinned)

### Why the Vulkan build is pinned to `b8142`

llama.cpp builds **after `b8142`** have a known regression that makes the
Vulkan backend on Intel Macs produce gibberish output. The affected-hardware
list **explicitly includes the Radeon Pro 5600M**:

- Regression report (last good: `b8142`): [ggml-org/llama.cpp#20029](https://github.com/ggml-org/llama.cpp/issues/20029)
- Gibberish on Intel Macs, multiple AMD GPUs incl. 5600M: [ggml-org/llama.cpp#20104](https://github.com/ggml-org/llama.cpp/issues/20104)

`build-vulkan.sh` therefore checks out tag `b8142`. Once the issues above are
closed upstream, unpin with:

```bash
LLAMA_VULKAN_REF=master ./build-vulkan.sh
```

### Install a Vulkan toolchain (pick one)

**Option A — LunarG Vulkan SDK (recommended):**

1. Download the macOS SDK from <https://vulkan.lunarg.com/sdk/home> and install
   it (default location: `~/VulkanSDK/<version>/`). It bundles MoltenVK and the
   `glslc` shader compiler — everything the build needs.
2. No further setup required — `build-vulkan.sh` finds and sources the SDK's
   `setup-env.sh` automatically.

**Option B — Homebrew:**

```bash
brew install molten-vk vulkan-headers vulkan-loader shaderc glslang
```

`build-vulkan.sh` detects this automatically if no LunarG SDK is present.

### Build

```bash
./build-vulkan.sh
```

This clones llama.cpp at `b8142` into `~/llama-macos-intel/src-vulkan/`, builds
with `-DGGML_VULKAN=1 -DGGML_METAL=OFF` (Metal off so this binary is purely
Vulkan), and writes `~/llama-macos-intel/env-vulkan.sh` with the MoltenVK
driver environment (`VK_ICD_FILENAMES` etc.) that the launcher sources for you.

Verify the GPU is seen through MoltenVK:

```bash
./llama.sh vulkan --list-devices     # expect something like: Vulkan0: AMD Radeon Pro 5600M
```

## 4. Get a model

Put `.gguf` files in `~/llama-macos-intel/models/`. For the 5600M's **8 GB of
VRAM**, the sweet spot is **7–8B models at Q4** quantization (≈4.5–5 GB, fully
GPU-resident). Examples:

```bash
# Download with the built-in downloader (fetches from Hugging Face, then serves):
./llama.sh metal -hf bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q4_K_M

# ...or download any .gguf from huggingface.co in your browser and drop it into
# ~/llama-macos-intel/models/
```

Rough sizing for 8 GB VRAM: 7–8B @ Q4 → fully offloaded (fast); 13–14B @ Q4 →
partial offload (set GPU layers ~28–32 instead of 999); bigger → CPU-heavy,
not recommended.

## 5. Run it — the chat WebUI

`llama-server` serves an OpenAI-compatible API **and a built-in chat WebUI**:

```bash
./llama.sh metal  -m ~/llama-macos-intel/models/<model>.gguf   # Metal
./llama.sh vulkan -m ~/llama-macos-intel/models/<model>.gguf   # Vulkan
```

Open **<http://127.0.0.1:8080>** for the chat UI. The launcher adds sensible
defaults (`--host 127.0.0.1 --port 8080 -ngl 999` = offload all layers); any
extra flags you pass go straight to `llama-server` (e.g. `-c 16384` for a
bigger context, `--port 9090`, `-ngl 30` for partial offload).

## 6. Switching between Metal and Vulkan

The backend is baked in when `llama-server` starts, so the chat WebUI itself
can't switch it — the switch lives one level up. Two ways:

**CLI:** stop the server (Ctrl-C) and relaunch with the other backend:

```bash
./llama.sh vulkan -m <model>.gguf    # was metal, now vulkan
```

**GUI (recommended):** run the control panel —

```bash
python3 llamactl.py
```

Open **<http://127.0.0.1:8090>**: pick *Metal* or *Vulkan* with radio buttons,
choose a model from the dropdown, set GPU layers/context, and hit
**Start / Switch** — it restarts `llama-server` on the chosen backend and links
you to the chat WebUI. It also shows live server logs, which is handy for
confirming GPU offload (look for lines mentioning your GPU during model load).

## 7. Benchmark Metal vs Vulkan on your machine

Both builds include `llama-bench`:

```bash
~/llama-macos-intel/src-metal/build/bin/llama-bench  -m ~/llama-macos-intel/models/<model>.gguf
source ~/llama-macos-intel/env-vulkan.sh
~/llama-macos-intel/src-vulkan/build/bin/llama-bench -m ~/llama-macos-intel/models/<model>.gguf
```

Expected (based on [Intel Mac + AMD results](https://github.com/ggml-org/llama.cpp/discussions/19187)):
Metal ≈1.9× faster at prompt processing (`pp512`), token generation (`tg128`)
roughly equal. Trust your own numbers over anyone else's.

## 8. Troubleshooting

- **Vulkan output is gibberish** — you're on a build newer than `b8142`.
  Re-run `./build-vulkan.sh` (which re-pins), and watch
  [#20029](https://github.com/ggml-org/llama.cpp/issues/20029) for the fix.
- **`--list-devices` shows no GPU (Vulkan)** — the MoltenVK driver isn't found.
  `source ~/llama-macos-intel/env-vulkan.sh` and check `VK_ICD_FILENAMES`
  points at an existing `MoltenVK_icd.json`. LunarG SDK users: re-run
  `source ~/VulkanSDK/<version>/setup-env.sh` then retry.
- **Slow generation / GPU idle** — model didn't fit in VRAM and layers spilled
  to CPU. Use a smaller quant (Q4_K_M) or lower `-ngl`. Watch VRAM pressure in
  Activity Monitor → GPU tab (or `sudo powermetrics --samplers gpu_power`).
- **Build fails on `glslc not found` (Vulkan)** — install the LunarG SDK or
  `brew install shaderc`, then re-run `./build-vulkan.sh`.
- **First token is slow on Metal** — first run compiles Metal shaders; later
  runs are faster.
- **`lms` / LM Studio integration** — not possible: these builds speak the
  OpenAI-compatible HTTP API, while `lms`/`lmstudio-js` speak LM Studio's
  proprietary WebSocket protocol to the (Apple-Silicon-only) desktop app. Any
  OpenAI-compatible client works with `llama-server`, though.

## Notes

- Scripts build from upstream `ggml-org/llama.cpp` by default so you get tags
  and fixes as they land; set `LLAMA_REPO=https://github.com/CAND3REL/llama.cpp`
  to build from the fork instead.
- Nothing here needs `sudo`; everything lives under `~/llama-macos-intel/` and
  this directory. To uninstall, delete both.
