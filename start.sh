#!/bin/bash
PORT=${PORT:-8080}

if command -v go &>/dev/null; then
    PORT=$PORT go run main.go
else
    echo "Go not found — using Python fallback."
    echo "Open your browser at: http://localhost:$PORT"
    python3 - <<EOF
import http.server, os, sys

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory="static", **kwargs)
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()
    def log_message(self, fmt, *args):
        pass  # suppress per-request noise

port = int(os.environ.get("PORT", $PORT))
httpd = http.server.HTTPServer(("", port), NoCacheHandler)
httpd.serve_forever()
EOF
fi
