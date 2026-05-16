# KataGo — Implementation Notes

## Current state

The server-side wiring is complete. `engine_katago.go` manages a persistent KataGo subprocess over GTP, mirrors the GnuGo interface exactly, and scales strength via visit counts (10 visits at level 1 up to 6400 at level 10). The engine is gated behind `KATAGO_ENABLED=true` so it initialises only when explicitly enabled.

## Why it's done this way

GnuGo and KataGo both speak GTP, so they share the same board-replay and coordinate logic. The plan is to expose KataGo as an extension of the existing difficulty slider — levels 1–10 stay as GnuGo, levels 11+ (to be added to the UI) map to KataGo with increasing visit counts. No frontend changes are needed until then.

## What's needed to activate it

**1. Dockerfile** — add KataGo to the runtime image. The apt version is usually outdated; prefer downloading a prebuilt binary from the KataGo GitHub releases:
```dockerfile
RUN apt-get install -y --no-install-recommends wget && \
    wget -q https://github.com/lightvector/KataGo/releases/download/vX.X.X/katago-vX.X.X-opencl-linux-x86_64.zip && \
    unzip katago-*.zip -d /usr/local/bin && chmod +x /usr/local/bin/katago
```
Check the latest release and pick the right build (OpenCL or CPU-only).

**2. Model weights** — download a `.bin.gz` network file from the KataGo model library. The `b18c384nbt` (18-block) network is a good balance of strength and speed. Bake it into the image or fetch it at build time. Store it at a known path, e.g. `/app/katago-model.bin.gz`.

**3. Config file** — KataGo needs a GTP config. Generate a default one with:
```
katago genconfig -model /app/katago-model.bin.gz -output /app/katago.cfg
```
Bake the generated config into the image. Tune `numSearchThreads` and `maxVisits` in the config as a ceiling.

**4. Render env vars**
```
KATAGO_ENABLED=true
KATAGO_MODEL=/app/katago-model.bin.gz
KATAGO_CONFIG=/app/katago.cfg
KATAGO_BIN=/usr/local/bin/katago   # optional, defaults to 'katago' on PATH
```

**5. Verify** — after deploy, `/health` should return `{"gnugo":true,"katago":true}`. Then test `kata-set-param maxVisits` is accepted by the version you installed; if not, use `time_settings` or a fixed visit count in the config instead.

## Render tier

KataGo is CPU-hungry. The Starter tier ($7/mo) will be too slow at high visit counts. Plan for the Standard tier ($25/mo) or higher when enabling it.
