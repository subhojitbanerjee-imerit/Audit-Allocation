# SimTeacher V2 Risk-Based Audit Task Picker

Vercel-ready static web application for generating risk-based audit samples from:

- Historical labeler performance CSV
- Audit population CSV
- TL availability and audit duration
- Auto-calculated batch criticality
- Reproducible random seed

## Files

- `index.html` - complete static web app with CSV upload, parsing, audit allocation, dashboard, and downloads
- `vercel.json` - Vercel static deployment settings
- `Code.gs`, `appsscript.json` - legacy Apps Script version kept for reference

## Deploy To Vercel

1. Push this repository to GitHub.
2. Import the repository in Vercel.
3. Keep the framework preset as `Other`.
4. Leave build command and output directory empty.
5. Deploy.

The app runs fully in the browser. CSV files are not uploaded to a server.

## CSV Requirements

The audit population CSV must include:

```text
imerit_task_id,qc_replay_link,batch_id,simteacher_v2_labeler,v2_end_date_ist,selectQcResult,failureReason,qc_confidence
```

The historical performance CSV must use `simteacher_v2_labeler` as the first column and batch IDs as score columns.

## Notes

- Blank or missing historical scores use default risk weight `3`.
- `qc_confidence=low` uses confidence weight `2`; all other confidence values use `1`.
- Batch criticality is auto-calculated from batch volume, average historical risk, and low-confidence task rate.
- The random seed makes selection reproducible for the same CSVs and configuration.
- Excel export is generated as an `.xls` HTML workbook for Apps Script compatibility.
- If your data is in Excel, export it as `CSV UTF-8 (*.csv)` before uploading.
