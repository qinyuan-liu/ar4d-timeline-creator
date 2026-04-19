const ganttRoot = document.getElementById("gantt");
const statusNode = document.getElementById("status");
const workspaceLabelNode = document.getElementById("workspace-label");
const projectTitleNode = document.getElementById("project-title");
const projectSubtitleNode = document.getElementById("project-subtitle");
const timelineModeSelect = document.getElementById("timeline-mode");
const rangeStartInput = document.getElementById("range-start");
const rangeEndInput = document.getElementById("range-end");
const applyRangeButton = document.getElementById("apply-range");
const resetRangeButton = document.getElementById("reset-range");
const zoomFitButton = document.getElementById("zoom-fit");
const zoomLevelNode = document.getElementById("zoom-level");
const expandAllButton = document.getElementById("expand-all");
const collapseCategoriesButton = document.getElementById("collapse-categories");
const collapseSessionsButton = document.getElementById("collapse-sessions");
const legendRoot = document.getElementById("legend");
const showGroupBarsInput = document.getElementById("show-group-bars");

let payload = { meta: {}, tasks: [] };
let tasksById = new Map();
let childIdsByParent = new Map();
let collapsedIds = new Set();
let lastSignature = "";
let refreshTimerId = null;
let colorByCategory = new Map();
let selectedRange = null;
let zoomFactor = 1;

async function loadTasks({ silent = false } = {}) {
  if (!silent) {
    statusNode.textContent = "Loading tasks...";
  }

  const response = await fetch(`../data/tasks.json?ts=${Date.now()}`);
  if (!response.ok) {
    throw new Error(`Unable to load tasks.json: ${response.status}`);
  }

  const nextPayload = await response.json();
  const nextSignature = JSON.stringify(nextPayload.tasks);
  const shouldUpdateUi = lastSignature !== nextSignature;

  payload = nextPayload;
  initializeState();
  updateProjectText();

  if (!lastSignature) {
    timelineModeSelect.value = payload.meta.default_timeline_mode || "planned";
    showGroupBarsInput.checked = false;
    setDefaultRange();
  }

  if (shouldUpdateUi || !lastSignature) {
    lastSignature = nextSignature;
    buildCategoryColors();
    renderLegend();
    renderTimeline();
    if (silent) {
      statusNode.textContent = `Auto-refreshed at ${new Date().toLocaleTimeString()}.`;
    }
  } else if (silent) {
    statusNode.textContent = `Checked for updates at ${new Date().toLocaleTimeString()}.`;
  }
}

function initializeState() {
  tasksById = new Map(payload.tasks.map((task) => [task.id, task]));
  childIdsByParent = new Map();

  payload.tasks.forEach((task) => {
    const children = childIdsByParent.get(task.parent) || [];
    children.push(task.id);
    childIdsByParent.set(task.parent, children);
  });
}

function updateProjectText() {
  const projectName = payload.meta.project_name || "Project Timeline";
  const workspaceLabel = payload.meta.project_workspace_label || "Project Timeline Workspace";
  const projectSubtitle = payload.meta.project_subtitle || "";

  document.title = projectName;
  workspaceLabelNode.textContent = workspaceLabel;
  projectTitleNode.textContent = projectName;
  projectSubtitleNode.textContent = projectSubtitle;
}

function toggleCollapsed(taskId) {
  if (collapsedIds.has(taskId)) {
    collapsedIds.delete(taskId);
  } else {
    collapsedIds.add(taskId);
  }
  renderTimeline();
}

function getVisibleTasks() {
  return payload.tasks.filter((task) => !isHiddenByAncestor(task));
}

function isHiddenByAncestor(task) {
  let currentParentId = task.parent;
  while (currentParentId) {
    if (collapsedIds.has(currentParentId)) {
      return true;
    }
    const parent = tasksById.get(currentParentId);
    currentParentId = parent ? parent.parent : "";
  }
  return false;
}

function renderTimeline() {
  const visibleTasks = getVisibleTasks();
  const timelineMode = timelineModeSelect.value;
  const rawBars = buildBarEntries(visibleTasks, timelineMode);

  ganttRoot.innerHTML = "";
  if (!rawBars.length) {
    statusNode.textContent = "No tasks available for the current filters.";
    return;
  }

  const range = buildRange(rawBars);
  const bars = clipBarsToRange(rawBars, range);
  const units = buildUnits(range.start, range.end);
  const timeline = document.createElement("div");
  timeline.className = "timeline";
  timeline.style.setProperty("--label-column-width", `${getLabelColumnWidth()}px`);
  timeline.style.setProperty("--unit-column-width", `${getUnitWidth()}px`);
  timeline.style.setProperty("--week-column-width", `${getUnitWidth() * 7}px`);

  timeline.appendChild(createMonthHeader(units));

  visibleTasks.forEach((task) => {
    const rowBars = bars.filter((bar) => bar.taskId === task.id);
    timeline.appendChild(createTimelineRow(task, rowBars, units));
  });

  ganttRoot.appendChild(timeline);
  updateZoomLevel();
  statusNode.textContent = `Showing ${bars.length} bars across ${visibleTasks.length} visible tasks.`;
}

function clipBarsToRange(bars, range) {
  return bars
    .map((bar) => {
      const clippedStart = new Date(Math.max(bar.start.getTime(), range.start.getTime()));
      const clippedEnd = new Date(Math.min(bar.end.getTime(), range.end.getTime()));
      if (clippedStart > clippedEnd) {
        return null;
      }
      return {
        ...bar,
        start: clippedStart,
        end: clippedEnd,
        originalStart: bar.originalStart || bar.start,
        originalEnd: bar.originalEnd || bar.end,
      };
    })
    .filter(Boolean);
}

function buildBarEntries(tasks, timelineMode) {
  const entries = [];
  const includeGroupBars = showGroupBarsInput.checked;

  tasks.forEach((task) => {
    if (!includeGroupBars && task.level !== "TASK") {
      return;
    }

    if (timelineMode === "planned" || timelineMode === "both") {
      const planned = createBarEntry(task, "planned");
      if (planned) {
        entries.push(planned);
      }
    }

    if (timelineMode === "actual" || timelineMode === "both") {
      const actual = createBarEntry(task, "actual");
      if (actual) {
        entries.push(actual);
      }
    }
  });

  return entries;
}

function createBarEntry(task, mode) {
  const start = task[`${mode}_start`];
  const end = task[`${mode}_end`];
  if (!start || !end) {
    return null;
  }

  return {
    id: `${task.id}__${mode}`,
    taskId: task.id,
    level: task.level,
    category: getRootCategoryName(task),
    mode,
    start: new Date(`${start}T00:00:00`),
    end: new Date(`${end}T00:00:00`),
    originalStart: new Date(`${start}T00:00:00`),
    originalEnd: new Date(`${end}T00:00:00`),
  };
}

function buildRange(bars) {
  if (selectedRange) {
    return {
      start: normalizeDate(new Date(`${selectedRange.start}T00:00:00`)),
      end: normalizeDate(new Date(`${selectedRange.end}T00:00:00`)),
    };
  }

  const starts = bars.map((bar) => bar.start);
  const ends = bars.map((bar) => bar.end);
  return {
    start: normalizeDate(new Date(Math.min(...starts))),
    end: normalizeDate(new Date(Math.max(...ends))),
  };
}

function buildUnits(start, end) {
  const units = [];
  let cursor = normalizeDate(new Date(start));
  let previousMonthKey = "";

  while (cursor <= end) {
    const monthKey = `${cursor.getFullYear()}-${cursor.getMonth()}`;
    units.push({
      key: cursor.toISOString(),
      start: new Date(cursor),
      monthStart: monthKey !== previousMonthKey,
      weekStart: cursor.getDay() === 1,
    });
    previousMonthKey = monthKey;
    cursor = addDays(cursor, 1);
  }

  return units;
}

function createMonthHeader(units) {
  const row = document.createElement("div");
  row.className = "timeline-months";

  const labelCell = document.createElement("div");
  labelCell.className = "timeline-task-cell timeline-months-label";
  labelCell.textContent = "Task";
  row.appendChild(labelCell);

  const grid = document.createElement("div");
  grid.className = "timeline-grid timeline-months-grid";
  grid.style.gridTemplateColumns = buildGridTemplate(units.length);

  buildMonthGroups(units).forEach((group) => {
    const cell = document.createElement("div");
    cell.className = "timeline-month-unit";
    cell.textContent = group.label;
    cell.style.gridColumn = `${group.start + 1} / ${group.end + 2}`;
    grid.appendChild(cell);
  });

  row.appendChild(grid);
  return row;
}

function createTimelineRow(task, rowBars, units) {
  const row = document.createElement("div");
  row.className = `timeline-row timeline-row-${task.level.toLowerCase()}`;

  const labelCell = document.createElement("div");
  labelCell.className = "timeline-task-cell";
  labelCell.appendChild(buildTaskLabel(task));
  row.appendChild(labelCell);

  const grid = document.createElement("div");
  grid.className = "timeline-grid";
  grid.style.gridTemplateColumns = buildGridTemplate(units.length);

  units.forEach((unit) => {
    const cell = document.createElement("div");
    cell.className = "timeline-unit-cell";
    if (unit.monthStart) {
      cell.classList.add("month-boundary");
    }
    grid.appendChild(cell);
  });

  rowBars.forEach((bar) => {
    const barWrap = document.createElement("div");
    barWrap.className = "timeline-bar-wrap";
    const startIndex = findUnitIndex(units, bar.start);
    const endIndex = findUnitIndex(units, bar.end);
    barWrap.style.gridColumn = `${startIndex + 1} / ${endIndex + 2}`;

    const startLabel = document.createElement("span");
    startLabel.className = "timeline-date-label start";
    startLabel.textContent = formatBarDate(bar.originalStart || bar.start);
    barWrap.appendChild(startLabel);

    const barNode = document.createElement("div");
    barNode.className = `timeline-bar ${bar.mode}-bar level-${task.level.toLowerCase()}`;
    barNode.style.background = resolveBarColor(bar.category);
    barWrap.appendChild(barNode);

    const endLabel = document.createElement("span");
    endLabel.className = "timeline-date-label end";
    endLabel.textContent = formatBarDate(bar.originalEnd || bar.end);
    barWrap.appendChild(endLabel);

    grid.appendChild(barWrap);
  });

  row.appendChild(grid);
  return row;
}

function findUnitIndex(units, date) {
  const target = normalizeDate(date).getTime();
  const index = units.findIndex((unit) => unit.start.getTime() === target);
  return index >= 0 ? index : 0;
}

function buildTaskLabel(task) {
  const wrapper = document.createElement("div");
  wrapper.className = "task-label";

  const indent = document.createElement("span");
  indent.className = "task-indent";
  indent.style.width = `${getIndentLevel(task.level) * 18}px`;
  wrapper.appendChild(indent);

  const chip = document.createElement("span");
  chip.className = "category-chip";
  chip.style.background = resolveBarColor(getRootCategoryName(task));
  wrapper.appendChild(chip);

  if (task.level !== "TASK") {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "task-toggle";
    toggle.textContent = collapsedIds.has(task.id) ? "+" : "-";
    toggle.addEventListener("click", () => toggleCollapsed(task.id));
    wrapper.appendChild(toggle);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "task-toggle-spacer";
    wrapper.appendChild(spacer);
  }

  const name = document.createElement("span");
  name.className = "task-name";
  name.textContent = task.name;
  wrapper.appendChild(name);
  return wrapper;
}

function getIndentLevel(level) {
  if (level === "SESSION") {
    return 1;
  }
  if (level === "TASK") {
    return 2;
  }
  return 0;
}

function getRootCategoryName(task) {
  let current = task;
  while (current && current.parent) {
    current = tasksById.get(current.parent);
  }
  return current ? current.name : task.name;
}

function buildCategoryColors() {
  const palette = ["#2059d6", "#159957", "#e17b1f", "#8c52ff", "#d03b55", "#008b8b", "#7a56d8", "#b56f00"];
  colorByCategory = new Map();
  payload.tasks
    .filter((task) => task.level === "CATEGORY")
    .forEach((task, index) => {
      colorByCategory.set(task.name, palette[index % palette.length]);
    });
}

function resolveBarColor(categoryName) {
  return colorByCategory.get(categoryName) || "#2059d6";
}

function renderLegend() {
  legendRoot.innerHTML = "";
  payload.tasks
    .filter((task) => task.level === "CATEGORY")
    .forEach((task) => {
      const item = document.createElement("div");
      item.className = "legend-item";

      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = resolveBarColor(task.name);
      item.appendChild(swatch);

      const text = document.createElement("span");
      text.textContent = task.name;
      item.appendChild(text);

      legendRoot.appendChild(item);
    });
}

function buildMonthGroups(units) {
  const groups = [];
  units.forEach((unit, index) => {
    const key = `${unit.start.getFullYear()}-${unit.start.getMonth()}`;
    const label = unit.start.toLocaleDateString(undefined, { month: "short", year: "numeric" });
    const existing = groups[groups.length - 1];
    if (!existing || existing.key !== key) {
      groups.push({ key, label, start: index, end: index });
      return;
    }
    existing.end = index;
  });
  return groups;
}

function getUnitWidth() {
  const timelineWidth = ganttRoot.clientWidth || ganttRoot.getBoundingClientRect().width || 1200;
  const usableWidth = Math.max(timelineWidth - getLabelColumnWidth() - 4, 240);
  const unitCount = getCurrentUnitCount();
  const rawWidth = (usableWidth / Math.max(unitCount, 1)) * zoomFactor;
  return Math.max(rawWidth, 2);
}

function getLabelColumnWidth() {
  const timelineWidth = ganttRoot.clientWidth || ganttRoot.getBoundingClientRect().width || 1200;
  if (timelineWidth < 760) {
    return 220;
  }
  if (timelineWidth < 1080) {
    return 260;
  }
  return 320;
}

function buildGridTemplate(unitCount) {
  const width = getUnitWidth();
  return `repeat(${unitCount}, minmax(0, ${width}px))`;
}

function getCurrentUnitCount() {
  const taskDates = payload.tasks.flatMap((task) => [task.planned_start, task.planned_end, task.actual_start, task.actual_end].filter(Boolean));
  if (!taskDates.length) {
    return 1;
  }

  const bars = buildBarEntries(getVisibleTasks(), timelineModeSelect.value || payload.meta.default_timeline_mode || "planned");
  if (!bars.length) {
    return 1;
  }
  const range = buildRange(bars);
  return buildUnits(range.start, range.end).length;
}

function changeZoom(direction) {
  if (direction === "fit") {
    selectedRange = null;
    setRangeFromVisibleTasks();
    zoomFactor = 1;
    renderTimeline();
    return;
  }

  const nextFactor = direction === "in" ? zoomFactor * 1.4 : zoomFactor / 1.4;
  zoomFactor = Math.min(Math.max(nextFactor, 0.35), 12);
  renderTimeline();
}

function updateZoomLevel() {
  zoomLevelNode.textContent = `${Math.round(zoomFactor * 100)}%`;
}

function setDefaultRange() {
  const taskDates = payload.tasks.flatMap((task) => [task.planned_start, task.planned_end, task.actual_start, task.actual_end].filter(Boolean));
  if (!taskDates.length) {
    return;
  }

  const years = taskDates.map((value) => Number(value.slice(0, 4)));
  const startYear = Math.min(...years);
  const endYear = Math.max(...years);
  selectedRange = {
    start: `${startYear}-01-01`,
    end: `${endYear}-12-31`,
  };
  rangeStartInput.value = selectedRange.start;
  rangeEndInput.value = selectedRange.end;
}

function setRangeFromVisibleTasks() {
  const visibleTasks = getVisibleTasks();
  const bars = buildBarEntries(visibleTasks, timelineModeSelect.value || "planned");
  if (!bars.length) {
    return;
  }

  const earliest = new Date(Math.min(...bars.map((bar) => bar.start.getTime())));
  const latest = new Date(Math.max(...bars.map((bar) => bar.end.getTime())));
  selectedRange = {
    start: earliest.toISOString().slice(0, 10),
    end: latest.toISOString().slice(0, 10),
  };
  rangeStartInput.value = selectedRange.start;
  rangeEndInput.value = selectedRange.end;
}

function applySelectedRange() {
  if (!rangeStartInput.value || !rangeEndInput.value) {
    return;
  }
  selectedRange = {
    start: rangeStartInput.value,
    end: rangeEndInput.value,
  };
  renderTimeline();
}

function formatBarDate(date) {
  const day = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${day}/${month}`;
}

function normalizeDate(date) {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

timelineModeSelect.addEventListener("change", renderTimeline);
showGroupBarsInput.addEventListener("change", renderTimeline);
applyRangeButton.addEventListener("click", applySelectedRange);
resetRangeButton.addEventListener("click", () => {
  setDefaultRange();
  renderTimeline();
});
zoomFitButton.addEventListener("click", () => changeZoom("fit"));

expandAllButton.addEventListener("click", () => {
  collapsedIds = new Set();
  renderTimeline();
});

collapseCategoriesButton.addEventListener("click", () => {
  collapsedIds = new Set(payload.tasks.filter((task) => task.level === "CATEGORY").map((task) => task.id));
  renderTimeline();
});

collapseSessionsButton.addEventListener("click", () => {
  collapsedIds = new Set(payload.tasks.filter((task) => task.level === "SESSION").map((task) => task.id));
  renderTimeline();
});

function startAutoRefresh() {
  const intervalSeconds = payload.meta.refresh_interval_seconds || 60;
  if (refreshTimerId) {
    clearInterval(refreshTimerId);
  }

  refreshTimerId = window.setInterval(() => {
    loadTasks({ silent: true }).catch((error) => {
      statusNode.textContent = error.message;
    });
  }, intervalSeconds * 1000);
}

window.addEventListener("resize", () => {
  if (payload.tasks.length) {
    renderTimeline();
  }
});

ganttRoot.addEventListener(
  "wheel",
  (event) => {
    if (!event.ctrlKey) {
      return;
    }
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? "in" : "out");
  },
  { passive: false }
);

loadTasks()
  .then(() => {
    startAutoRefresh();
  })
  .catch((error) => {
    statusNode.textContent = error.message;
  });
