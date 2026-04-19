# Collaborative Gantt Manager

This project implements the workflow defined in `dev_note.json` with the current published Google Sheets source:

`Published Google Sheets CSV -> Python normalization -> data/tasks.json -> Frappe Gantt web view`

The current implementation is aligned with the latest requirements:

- Data source is the published CSV URL configured in `config/settings.json`
- Hierarchy is fixed to `CATEGORY -> SESSION -> TASK`
- Parent dates are automatically rolled up from child tasks
- The frontend supports `planned`, `actual`, and `planned + actual`
- Default grid view is `Week`
- Minimum calculation unit is `Day`
- `CATEGORY` and `SESSION` can be collapsed from the UI, and the default state is expanded

## Project Structure

```text
config/
  settings.json
data/
  sample_tasks.json
  tasks.json
scripts/
  fetch_sheets.py
  transform.py
  export_json.py
web/
  index.html
  app.js
  style.css
main.py
requirements.txt
README.md
```

## Current Data Model

The source sheet currently exposes these columns:

```text
CATEGORY
SESSION
TASK
START_planned
START_actual
END_planned
END_actual
```

The Python pipeline converts them into a normalized three-level task tree and exports a JSON payload with:

- `meta`: frontend defaults and supported modes
- `tasks`: flattened hierarchical records with planned and actual dates

## Workflow

1. `scripts/fetch_sheets.py` downloads the published CSV from `config/settings.json`
2. `scripts/transform.py` normalizes date formats and builds `CATEGORY -> SESSION -> TASK`
3. Parent `CATEGORY` and `SESSION` rows inherit start and end dates from child tasks
4. `scripts/export_json.py` writes the final payload to `data/tasks.json`
5. `web/index.html` loads the JSON payload and renders the timeline

## Run Locally

Generate the exported JSON:

```bash
python main.py
```

Or on this Windows project setup:

```bash
.\.venv\Scripts\python.exe main.py
```

Start the preview server directly:

```bash
.\.venv\Scripts\python.exe main.py --serve
```

Open:

```text
http://127.0.0.1:8765/web/
```

`main.py` without `--serve` only exports JSON. It does not open a browser or start a web server.

You can also change host and port:

```bash
.\.venv\Scripts\python.exe main.py --serve --host 127.0.0.1 --port 8765
```

## Timeline Modes

The UI supports three timeline display modes:

- `Planned only`: shows only planned bars
- `Actual only`: shows only actual bars
- `Planned + Actual`: shows both bars for the same task

When both are visible:

- planned bars use the same color with higher transparency
- actual bars use the same color with stronger opacity

If a task has no dates for the selected mode, no bar is rendered for that mode.

## Auto Refresh

The current preview flow supports periodic refresh.

- The backend can regenerate `data/tasks.json` on a fixed interval
- The frontend polls the exported JSON and updates the page when data changes
- The refresh interval is configured in `config/settings.json`

Current default:

```text
60 seconds
```

For near-real-time updates such as every `10s`, the main tradeoffs are:

- more requests to Google Sheets
- higher chance of temporary rate limits or fetch failures
- more frequent page redraws in the browser

For a public published CSV, `30-60s` is usually safer than `10s` for long-running use.

## GitHub Pages Deployment

This repository is prepared for low-cost deployment with `GitHub Pages + GitHub Actions`.

### Deployment Model

1. GitHub Actions runs `python main.py`
2. The workflow regenerates `data/tasks.json` from the published Google Sheets CSV
3. The workflow builds a static Pages artifact containing:
   - `index.html`
   - `web/`
   - `data/`
4. GitHub Pages serves the published artifact

### Included Workflow

The deployment workflow is:

```text
.github/workflows/deploy-pages.yml
```

It runs on:

- push to `master`
- manual trigger
- schedule every 30 minutes

### GitHub Settings Required

In your GitHub repository:

1. Push this repository to GitHub
2. Open `Settings -> Pages`
3. Set `Source` to `GitHub Actions`
4. Make sure Actions are allowed for the repository

After the first successful workflow run, GitHub Pages will publish the site.

### Expected Public URL

The Pages site will typically be available at:

```text
https://<your-github-username>.github.io/<your-repository-name>/
```

The root `index.html` redirects to `./web/`, so users can open the repository root URL directly.

### Updating Frequency

The current workflow refreshes the published data every 30 minutes.

If you want a different cadence, edit the cron line in:

```text
.github/workflows/deploy-pages.yml
```

Example:

- every 15 minutes: `*/15 * * * *`
- every hour: `0 * * * *`

### Cost

For this project shape, `GitHub Pages + GitHub Actions` is usually the lowest-cost deployment path.

- GitHub Pages hosting can be free depending on your repository/account setup
- GitHub Actions usage is often enough for this workload, especially with a 30-minute schedule
- You do not need a separate VPS for the current read-transform-publish workflow

## Hierarchy Controls

The UI includes:

- `Expand all`
- `Collapse CATEGORY`
- `Collapse SESSION`
- Per-node toggle buttons in the hierarchy panel

The default load state is fully expanded.

## Requirements

See `requirements.txt`.

The current code path uses only the Python standard library, because the source is a public CSV. External packages can be added later if the project moves to authenticated Google Sheets access, richer validation, or dataframe-based processing.

## Next Information Still Needed

The current implementation is usable, but these details still affect the final product behavior:

1. Whether `actual` dates will definitely be filled later for the same rows
2. Whether `progress` should be added to the sheet or derived automatically
3. Whether dependencies between `TASK` rows should be modeled explicitly
4. Whether `Quarter` or custom view modes should be added now
5. Whether the frontend should eventually support inline editing, not just visualization
