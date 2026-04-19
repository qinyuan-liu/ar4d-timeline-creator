from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from scripts.fetch_sheets import load_settings


@dataclass
class TaskNode:
    task: dict[str, Any]
    children: list["TaskNode"] = field(default_factory=list)


def transform_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    settings = load_settings()
    normalized_records = [_normalize_record(record, settings["field_mapping"]) for record in records]
    tasks = _build_three_level_tasks(normalized_records)
    nodes = _build_nodes(tasks)
    _compute_rollups(nodes)
    return _build_payload(nodes, settings)


def _normalize_record(record: dict[str, Any], field_mapping: dict[str, str]) -> dict[str, Any]:
    category = _read_text(record, field_mapping["category"])
    session = _read_text(record, field_mapping["session"])
    task_name = _read_text(record, field_mapping["task"])
    if not category or not session or not task_name:
        raise ValueError(f"Category, session, and task are required: {record}")

    progress_column = field_mapping.get("progress", "progress")
    return {
        "category": category,
        "session": session,
        "task": task_name,
        "planned_start": _parse_date(_read_text(record, field_mapping["planned_start"])),
        "planned_end": _parse_date(_read_text(record, field_mapping["planned_end"])),
        "actual_start": _parse_date(_read_text(record, field_mapping["actual_start"])),
        "actual_end": _parse_date(_read_text(record, field_mapping["actual_end"])),
        "progress": _parse_progress(record.get(progress_column, "")),
    }


def _build_three_level_tasks(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    tasks: list[dict[str, Any]] = []
    categories: dict[str, str] = {}
    sessions: dict[tuple[str, str], str] = {}
    existing_ids: set[str] = set()

    for record in records:
        category_name = record["category"]
        session_name = record["session"]
        task_name = record["task"]

        category_id = categories.setdefault(
            category_name,
            _make_unique_id(existing_ids, _slugify("category", category_name)),
        )
        session_key = (category_name, session_name)
        session_id = sessions.setdefault(
            session_key,
            _make_unique_id(existing_ids, _slugify("session", f"{category_name} {session_name}")),
        )
        task_id = _make_unique_id(existing_ids, _slugify("task", f"{category_name} {session_name} {task_name}"))

        if not any(task["id"] == category_id for task in tasks):
            tasks.append(
                {
                    "id": category_id,
                    "name": category_name,
                    "parent": "",
                    "level": "CATEGORY",
                    "planned_start": "",
                    "planned_end": "",
                    "actual_start": "",
                    "actual_end": "",
                    "progress": 0,
                }
            )

        if not any(task["id"] == session_id for task in tasks):
            tasks.append(
                {
                    "id": session_id,
                    "name": session_name,
                    "parent": category_id,
                    "level": "SESSION",
                    "planned_start": "",
                    "planned_end": "",
                    "actual_start": "",
                    "actual_end": "",
                    "progress": 0,
                }
            )

        tasks.append(
            {
                "id": task_id,
                "name": task_name,
                "parent": session_id,
                "level": "TASK",
                "planned_start": record["planned_start"],
                "planned_end": record["planned_end"],
                "actual_start": record["actual_start"],
                "actual_end": record["actual_end"],
                "progress": record["progress"],
            }
        )

    return tasks


def _build_nodes(tasks: list[dict[str, Any]]) -> list[TaskNode]:
    nodes_by_id = {task["id"]: TaskNode(task=task) for task in tasks}
    roots: list[TaskNode] = []
    for node in nodes_by_id.values():
        parent_id = node.task["parent"]
        if parent_id and parent_id in nodes_by_id:
            nodes_by_id[parent_id].children.append(node)
        else:
            roots.append(node)
    return roots


def _compute_rollups(nodes: list[TaskNode]) -> None:
    for node in nodes:
        _compute_node_rollup(node)


def _compute_node_rollup(node: TaskNode) -> None:
    for child in node.children:
        _compute_node_rollup(child)

    if not node.children:
        return

    _rollup_range(node.task, node.children, "planned_start", "planned_end")
    _rollup_range(node.task, node.children, "actual_start", "actual_end")

    child_progress = [child.task["progress"] for child in node.children]
    node.task["progress"] = round(sum(child_progress) / len(child_progress)) if child_progress else 0


def _rollup_range(task: dict[str, Any], children: list[TaskNode], start_key: str, end_key: str) -> None:
    starts = [child.task[start_key] for child in children if child.task[start_key]]
    ends = [child.task[end_key] for child in children if child.task[end_key]]
    task[start_key] = min(starts) if starts else ""
    task[end_key] = max(ends) if ends else ""


def _build_payload(nodes: list[TaskNode], settings: dict[str, Any]) -> dict[str, Any]:
    serialized_tasks: list[dict[str, Any]] = []
    for node in nodes:
        _flatten_node(node, serialized_tasks)

    return {
        "meta": {
            "project_name": settings["project_name"],
            "project_workspace_label": settings.get("project_workspace_label", "Project Timeline Workspace"),
            "project_subtitle": settings.get("project_subtitle", ""),
            "default_timeline_mode": settings["defaults"]["timeline_mode"],
            "default_view_mode": settings["defaults"]["view_mode"],
            "minimum_time_unit": settings["defaults"]["minimum_time_unit"],
            "refresh_interval_seconds": settings.get("refresh", {}).get("interval_seconds", 60),
            "supported_view_modes": ["Day", "Week", "Month"],
            "supported_timeline_modes": ["planned", "actual", "both"],
            "supported_collapse_levels": ["CATEGORY", "SESSION"],
        },
        "tasks": serialized_tasks,
    }


def _flatten_node(node: TaskNode, output: list[dict[str, Any]]) -> None:
    task = node.task
    output.append(
        {
            "id": task["id"],
            "name": task["name"],
            "parent": task["parent"],
            "level": task["level"],
            "planned_start": task["planned_start"],
            "planned_end": task["planned_end"],
            "actual_start": task["actual_start"],
            "actual_end": task["actual_end"],
            "progress": task["progress"],
            "has_children": bool(node.children),
        }
    )
    for child in node.children:
        _flatten_node(child, output)


def _read_text(record: dict[str, Any], key: str) -> str:
    value = record.get(key, "")
    return str(value).strip()


def _parse_date(value: str) -> str:
    if not value:
        return ""
    for fmt in ("%Y-%m-%d", "%m/%d/%y", "%m/%d/%Y"):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"Unsupported date format: {value}")


def _parse_progress(value: Any) -> int:
    text = str(value).strip()
    if not text:
        return 0
    number = float(text)
    if number <= 1:
        return round(number * 100)
    return round(number)


def _slugify(prefix: str, raw_value: str) -> str:
    cleaned = "".join(char.lower() if char.isalnum() else "_" for char in raw_value)
    condensed = "_".join(part for part in cleaned.split("_") if part)
    return f"{prefix}_{condensed}"


def _make_unique_id(existing_ids: set[str], base_id: str) -> str:
    if base_id not in existing_ids:
        existing_ids.add(base_id)
        return base_id

    suffix = 2
    while f"{base_id}_{suffix}" in existing_ids:
        suffix += 1

    unique_id = f"{base_id}_{suffix}"
    existing_ids.add(unique_id)
    return unique_id
