#!/usr/bin/env python3
"""llamactl — tiny local control panel for switching llama.cpp backends.

The llama.cpp chat WebUI is served *by* llama-server, and the compute backend
(Metal vs Vulkan) is fixed when the server starts. This panel sits one level
above: pick a backend and a model, hit Start, and it (re)launches llama-server
via llama.sh, then links you to the chat WebUI.

Usage:
    python3 llamactl.py            # panel on http://127.0.0.1:8090
                                   # chat WebUI on http://127.0.0.1:8080 once started

Only Python 3 standard library. Binds to localhost only.

Environment variables:
    LLAMA_WORKSPACE   workspace dir            (default: ~/llama-macos-intel)
    LLAMA_PORT        llama-server/WebUI port  (default: 8080)
    LLAMACTL_PORT     this panel's port        (default: 8090)
"""

import json
import os
import signal
import subprocess
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(os.environ.get("LLAMA_WORKSPACE", Path.home() / "llama-macos-intel"))
SERVER_PORT = int(os.environ.get("LLAMA_PORT", "8080"))
PANEL_PORT = int(os.environ.get("LLAMACTL_PORT", "8090"))
LLAMA_SH = Path(__file__).resolve().parent / "llama.sh"
MODELS_DIR = ROOT / "models"
LOG_FILE = ROOT / "logs" / "llama-server.log"

state = {"proc": None, "backend": None, "model": None, "log": None}


def built(backend):
    return (ROOT / f"src-{backend}" / "build" / "bin" / "llama-server").exists()


def list_models():
    if not MODELS_DIR.is_dir():
        return []
    return sorted(
        str(p.relative_to(MODELS_DIR))
        for p in MODELS_DIR.rglob("*.gguf")
        if not p.name.lower().startswith("mmproj")
    )


def server_running():
    proc = state["proc"]
    return proc is not None and proc.poll() is None


def server_healthy():
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{SERVER_PORT}/health", timeout=1
        ) as resp:
            return resp.status == 200
    except Exception:
        return False


def stop_server():
    proc = state["proc"]
    if proc is None:
        return
    if proc.poll() is None:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=10)
        except Exception:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except Exception:
                pass
    if state["log"] is not None:
        state["log"].close()
    state.update(proc=None, backend=None, model=None, log=None)


def start_server(backend, model, ngl, ctx):
    if backend not in ("metal", "vulkan"):
        raise ValueError("backend must be 'metal' or 'vulkan'")
    if not built(backend):
        raise ValueError(f"no {backend} build found — run ./build-{backend}.sh first")
    model_path = MODELS_DIR / model
    if not model_path.is_file():
        raise ValueError(f"model not found: {model_path}")
    stop_server()
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    log = open(LOG_FILE, "w")
    cmd = [
        "bash", str(LLAMA_SH), backend,
        "-m", str(model_path),
        "-ngl", str(int(ngl)),
        "-c", str(int(ctx)),
    ]
    state["proc"] = subprocess.Popen(
        cmd, stdout=log, stderr=subprocess.STDOUT, start_new_session=True
    )
    state["backend"] = backend
    state["model"] = model
    state["log"] = log


PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><title>llamactl — backend switcher</title>
<style>
  body{font:15px -apple-system,system-ui,sans-serif;background:#14161a;color:#e8eaed;
       max-width:680px;margin:2.5rem auto;padding:0 1rem}
  h1{font-size:1.25rem} .sub{color:#9aa0a6;margin-top:-.6rem}
  fieldset{border:1px solid #33373d;border-radius:10px;margin:1rem 0;padding:.9rem 1rem}
  legend{color:#9aa0a6;padding:0 .4rem;font-size:.85rem}
  label.radio{margin-right:1.4rem;cursor:pointer}
  select,input{background:#1d2127;color:#e8eaed;border:1px solid #33373d;
       border-radius:6px;padding:.35rem .5rem;font-size:.95rem}
  select{min-width:320px;max-width:100%}
  .row{margin:.5rem 0}
  button{border:0;border-radius:8px;padding:.55rem 1.1rem;font-size:.95rem;
       cursor:pointer;margin-right:.6rem}
  #start{background:#2e7d46;color:#fff} #stop{background:#6b3030;color:#fff}
  a.chat{color:#8ab4f8}
  .pill{display:inline-block;border-radius:999px;padding:.15rem .7rem;font-size:.85rem}
  .on{background:#1e3a28;color:#7ee2a0} .off{background:#3a2020;color:#f28b82}
  .warn{background:#3a3320;color:#fdd663}
  pre{background:#0d0f12;border:1px solid #26292e;border-radius:8px;padding:.8rem;
      font-size:.78rem;max-height:280px;overflow:auto;white-space:pre-wrap}
  .dis{color:#5f6368}
</style></head><body>
<h1>llamactl</h1>
<p class="sub">Metal ⇄ Vulkan switcher for llama.cpp on Intel Macs</p>

<fieldset><legend>Backend</legend>
  <label class="radio"><input type="radio" name="backend" value="metal"> Metal
    <span id="metal-missing" class="dis"></span></label>
  <label class="radio"><input type="radio" name="backend" value="vulkan"> Vulkan (MoltenVK)
    <span id="vulkan-missing" class="dis"></span></label>
</fieldset>

<fieldset><legend>Model (.gguf files in the workspace models/ folder)</legend>
  <div class="row"><select id="model"></select></div>
  <div class="row">
    GPU layers <input id="ngl" type="number" value="999" min="0" style="width:5.5rem">
    &nbsp; Context <input id="ctx" type="number" value="8192" min="512" step="512" style="width:6.5rem">
  </div>
</fieldset>

<p>
  <button id="start">Start / Switch</button>
  <button id="stop">Stop</button>
  <span id="status" class="pill off">stopped</span>
</p>
<p id="chatline" style="display:none">Chat WebUI:
  <a class="chat" id="chatlink" target="_blank"></a></p>

<fieldset><legend>Server log</legend><pre id="log">(not started)</pre></fieldset>

<script>
const $ = s => document.querySelector(s);
let chosen = null;

async function refresh() {
  const s = await (await fetch('/api/state')).json();
  $('#metal-missing').textContent  = s.built.metal  ? '' : '(not built)';
  $('#vulkan-missing').textContent = s.built.vulkan ? '' : '(not built)';
  document.querySelectorAll('input[name=backend]').forEach(r => {
    r.disabled = !s.built[r.value];
    if (chosen === null && s.built[r.value] && !r.disabled &&
        !document.querySelector('input[name=backend]:checked')) r.checked = true;
  });
  const sel = $('#model');
  if (sel.options.length !== s.models.length) {
    sel.innerHTML = '';
    for (const m of s.models) sel.add(new Option(m, m));
  }
  if (!s.models.length) { sel.innerHTML = '<option>(no .gguf files found)</option>'; }
  const st = $('#status');
  if (s.running && s.healthy) {
    st.className = 'pill on'; st.textContent = 'running · ' + s.backend + ' · ' + s.model;
  } else if (s.running) {
    st.className = 'pill warn'; st.textContent = 'starting (' + s.backend + ') — loading model…';
  } else {
    st.className = 'pill off'; st.textContent = 'stopped';
  }
  $('#chatline').style.display = (s.running && s.healthy) ? '' : 'none';
  $('#chatlink').textContent = 'http://127.0.0.1:' + s.port;
  $('#chatlink').href = 'http://127.0.0.1:' + s.port;
  if (s.running || s.log) $('#log').textContent = s.log || '';
}

$('#start').onclick = async () => {
  const b = document.querySelector('input[name=backend]:checked');
  chosen = b ? b.value : null;
  const body = JSON.stringify({backend: chosen, model: $('#model').value,
                               ngl: $('#ngl').value, ctx: $('#ctx').value});
  const r = await fetch('/api/start', {method: 'POST', body});
  if (!r.ok) alert(await r.text());
  refresh();
};
$('#stop').onclick = async () => { await fetch('/api/stop', {method: 'POST'}); refresh(); };
refresh(); setInterval(refresh, 2500);
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/":
            self._send(200, PAGE, "text/html; charset=utf-8")
        elif self.path == "/api/state":
            log_tail = ""
            if LOG_FILE.exists():
                lines = LOG_FILE.read_text(errors="replace").splitlines()
                log_tail = "\n".join(lines[-60:])
            self._send(200, json.dumps({
                "running": server_running(),
                "healthy": server_healthy(),
                "backend": state["backend"],
                "model": state["model"],
                "port": SERVER_PORT,
                "built": {"metal": built("metal"), "vulkan": built("vulkan")},
                "models": list_models(),
                "log": log_tail,
            }))
        else:
            self._send(404, "not found", "text/plain")

    def do_POST(self):
        if self.path == "/api/start":
            length = int(self.headers.get("Content-Length", 0))
            try:
                req = json.loads(self.rfile.read(length) or b"{}")
                start_server(req.get("backend"), req.get("model"),
                             req.get("ngl", 999), req.get("ctx", 8192))
                self._send(200, "{}")
            except Exception as exc:
                self._send(400, str(exc), "text/plain")
        elif self.path == "/api/stop":
            stop_server()
            self._send(200, "{}")
        else:
            self._send(404, "not found", "text/plain")


def main():
    if not LLAMA_SH.exists():
        raise SystemExit(f"llama.sh not found next to this script ({LLAMA_SH})")
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", PANEL_PORT), Handler)
    print(f"llamactl panel:  http://127.0.0.1:{PANEL_PORT}")
    print(f"chat WebUI:      http://127.0.0.1:{SERVER_PORT}  (once a model is started)")
    print(f"workspace:       {ROOT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop_server()


if __name__ == "__main__":
    main()
