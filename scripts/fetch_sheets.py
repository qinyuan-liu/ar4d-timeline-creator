from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parent.parent
SETTINGS_PATH = ROOT / "config" / "settings.json"
SAMPLE_DATA_PATH = ROOT / "data" / "sample_tasks.json"


def load_settings() -> dict[str, Any]:
    with SETTINGS_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


def load_records() -> list[dict[str, Any]]:
    settings = load_settings()
    source_mode = settings.get("source_mode", "sample")
    if source_mode == "sample":
        return _load_sample_records()
    if source_mode == "published_csv":
        return _load_published_csv_records(settings["published_csv_url"])
    raise ValueError(f"Unsupported source_mode: {source_mode}")


def _load_sample_records() -> list[dict[str, Any]]:
    with SAMPLE_DATA_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


def _load_published_csv_records(csv_url: str) -> list[dict[str, Any]]:
    with urlopen(csv_url) as response:
        content = response.read().decode("utf-8-sig")
    return list(csv.DictReader(content.splitlines()))
