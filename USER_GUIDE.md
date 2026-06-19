# SimTeacher Risk-Based Audit Task Picker User Guide

## Purpose

Use this tool to generate audit samples from two CSV files:

- Historical Performance CSV
- Audit Population CSV

The app prioritizes audit tasks based on labeler performance, batch risk, low-confidence tasks, and available TL capacity.

## Required Files

### 1. Historical Performance CSV

Upload this file in **Upload Historical Performance CSV**.

Expected format:

```text
simteacher_v2_labeler,batch_1,batch_2,batch_3
user1@imerit.net,95%,80%,60%
user2@imerit.net,70%,50%,90%
```

Rules:

- First column must be `simteacher_v2_labeler`.
- Other columns should be batch names.
- Values should be historical accuracy percentages.
- Blank scores are allowed. The app uses default risk weight `3`.

### 2. Audit Population CSV

Upload this file in **Upload Audit Population CSV**.

Required columns:

```text
imerit_task_id
qc_replay_link
batch_id
simteacher_v2_labeler
v2_end_date_ist
selectQcResult
failureReason
qc_confidence
```

Rules:

- Each row should be one task eligible for audit.
- `imerit_task_id` must be unique.
- `qc_confidence` should usually be `high` or `low`.
- The app removes duplicate task IDs automatically.

## Audit Configuration

### Minutes Per Audit Task

Enter how many minutes one audit usually takes.

Example:

- Minutes per task = `5`
- TL available hours = `3`
- Capacity = `3 x 60 / 5 = 36 audits`

### Random Seed

The random seed makes the selection reproducible.

Same CSV files + same TL capacity + same seed = same selected audit tasks.

Change the seed if you want a different random sample.

Example seeds:

```text
audit-run-01
june-review
batch-check-2
```

### Batch Criticality

This is auto-calculated. No manual input is needed.

The app increases batch priority based on:

- Batch volume
- Average historical labeler risk
- Low-confidence task rate

## TL Capacity

Use this section to add TL availability.

Example:

```text
Anupam | 3 hours
Monika | 4 hours
Rakesh | 2 hours
```

The app calculates each TL's audit capacity automatically:

```text
Available Hours x 60 / Minutes Per Audit Task
```

Use **Add TL** to add more reviewers.

Use **Remove** to remove a reviewer.

## Generate Audit Sample

After both CSVs are loaded and TL capacity is entered:

1. Click **Generate Audit Sample**.
2. Review the dashboard.
3. Download the final output as CSV or Excel.

If generation fails, read the red error message under the progress bar. It usually explains a missing column, missing TL capacity, or wrong CSV type.

## Dashboard Tabs

### Summary

Shows batch-level results:

- Batch Name
- Population
- Average Historical Accuracy
- Auto Criticality Multiplier
- Risk Score
- Allocated Audits
- Selected Audits

### Labeler Summary

Shows labeler-level coverage:

- Labeler
- Historical Score
- Risk Weight
- Population
- Selected Audits

### TL Summary

Shows TL assignment:

- TL Name
- Hours
- Capacity
- Assigned Audits
- Remaining Capacity

### Final Output

Shows selected audit tasks with assigned TL.

The final export includes:

```text
imerit_task_id
qc_replay_link
batch_id
simteacher_v2_labeler
v2_end_date_ist
selectQcResult
failureReason
qc_confidence
historical_score
risk_weight
confidence_weight
batch_criticality_multiplier
priority_score
assigned_tl
```

## Header Buttons

### Load Settings

Loads previously saved configuration from the same browser.

This includes:

- Minutes per audit task
- Random seed
- TL names and hours

### Save Settings

Saves the current configuration in the same browser.

This does not upload data anywhere.

### Run History

Shows previous audit samples generated in the same browser.

History is stored locally in your browser.

## Export Options

### Download CSV

Downloads the selected audit sample as a `.csv` file.

Use this for most workflows.

### Download Excel

Downloads the selected audit sample as an `.xls` file.

Use this if the team prefers opening the output directly in Excel.

## Important Notes

- Files must be CSV, not `.xlsx`.
- If your file is in Excel, use **Save As -> CSV UTF-8 (*.csv)**.
- The app runs fully in the browser.
- CSV files are not uploaded to a server.
- Vercel only hosts the web page.
- Saved settings and run history are stored in browser local storage.
- Clearing browser data may remove saved settings and history.

## Troubleshooting

### File loads but generation fails

Check that the Audit Population CSV has all required columns.

### Output is different from the last run

Use the same random seed, same CSV files, and same TL capacity to reproduce a previous sample.

### Selected audit count is lower than capacity

This happens when the population has fewer eligible unique task IDs than total TL capacity.

### Some labelers get only one task

The app first tries to ensure labeler coverage, then distributes remaining audits by risk.

### Batch allocation seems higher for one batch

That batch likely has higher volume, lower historical performance, more low-confidence tasks, or a combination of these.
