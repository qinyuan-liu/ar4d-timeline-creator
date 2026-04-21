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
        datasets = settings.get("datasets", [])
        if datasets:
            return _load_published_csv_records(datasets[0]["published_csv_url"])
        return _load_published_csv_records(settings["published_csv_url"])
    raise ValueError(f"Unsupported source_mode: {source_mode}")


def load_dataset_records() -> dict[str, list[dict[str, Any]]]:
    settings = load_settings()
    source_mode = settings.get("source_mode", "sample")
    if source_mode == "sample":
        sample_records = _load_sample_records()
        default_key = settings.get("defaults", {}).get("dataset_key", "AR4D")
        return {default_key: sample_records}
    if source_mode != "published_csv":
        raise ValueError(f"Unsupported source_mode: {source_mode}")

    datasets = settings.get("datasets", [])
    if not datasets:
        published_csv_url = settings.get("published_csv_url")
        default_key = settings.get("defaults", {}).get("dataset_key", "AR4D")
        if not published_csv_url:
            raise ValueError("No dataset configuration found.")
        return {default_key: _load_published_csv_records(published_csv_url)}

    records_by_dataset: dict[str, list[dict[str, Any]]] = {}
    for dataset in datasets:
        records_by_dataset[dataset["key"]] = _load_published_csv_records(dataset["published_csv_url"])
    return records_by_dataset


def load_recurring_records() -> list[dict[str, Any]]:
    settings = load_settings()
    recurring_csv_url = settings.get("recurring_csv_url")
    if not recurring_csv_url:
        return []
    return _load_published_csv_records(recurring_csv_url)


def _load_sample_records() -> list[dict[str, Any]]:
    with SAMPLE_DATA_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


def _load_published_csv_records(csv_url: str) -> list[dict[str, Any]]:
    with urlopen(csv_url) as response:
        content = response.read().decode("utf-8-sig")
    return list(csv.DictReader(content.splitlines()))
