from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Thread
from time import sleep

from scripts.export_json import export_tasks_json
from scripts.fetch_sheets import load_records, load_settings
from scripts.transform import transform_records


ROOT = Path(__file__).resolve().parent


class PreviewServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def generate_tasks_json() -> Path:
    records = load_records()
    payload = transform_records(records)
    output_path = export_tasks_json(payload)
    print(f"Exported {len(payload['tasks'])} tasks to {output_path}")
    return output_path


def run_preview_server(host: str, port: int) -> None:
    handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT))
    server = PreviewServer((host, port), handler)
    print(f"Preview server running at http://{host}:{port}/web/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def start_auto_refresh(stop_event: Event) -> Thread | None:
    settings = load_settings()
    refresh_settings = settings.get("refresh", {})
    if not refresh_settings.get("enabled", False):
        return None

    interval_seconds = int(refresh_settings.get("interval_seconds", 60))

    def worker() -> None:
        while not stop_event.is_set():
            sleep(interval_seconds)
            if stop_event.is_set():
                return
            try:
                generate_tasks_json()
            except Exception as error:
                print(f"Auto-refresh failed: {error}")

    thread = Thread(target=worker, daemon=True)
    thread.start()
    print(f"Auto-refresh enabled every {interval_seconds} seconds.")
    return thread


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate tasks.json and optionally serve the web preview.")
    parser.add_argument("--serve", action="store_true", help="Start a local preview server after exporting tasks.")
    parser.add_argument("--host", default="127.0.0.1", help="Preview server host. Default: 127.0.0.1")
    parser.add_argument("--port", type=int, default=8765, help="Preview server port. Default: 8765")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    generate_tasks_json()

    if not args.serve:
        return

    stop_event = Event()
    auto_refresh_thread = start_auto_refresh(stop_event)
    try:
        run_preview_server(args.host, args.port)
    finally:
        stop_event.set()
        if auto_refresh_thread is not None:
            auto_refresh_thread.join(timeout=1)


if __name__ == "__main__":
    main()
