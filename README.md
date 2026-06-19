# SimTeacher V2 Risk-Based Audit Task Picker

Google Apps Script web application for generating risk-based audit samples from:

- Historical labeler performance CSV
- Audit population CSV
- TL availability and audit duration
- Optional batch criticality multipliers
- Reproducible random seed

## Files

- `Code.gs` - server-side Apps Script processing, sampling, summaries, exports, saved config, and history
- `Index.html` - Bootstrap web UI with drag-and-drop upload, TL configuration, dashboard, and downloads
- `appsscript.json` - Apps Script manifest

## Deploy

1. Create a Google Apps Script project.
2. Add the three files in this folder to the project.
3. Deploy as a Web App.
4. Set execution as the deploying user and grant access according to your team policy.

## CSV Requirements

The audit population CSV must include:

```text
imerit_task_id,qc_replay_link,batch_id,simteacher_v2_labeler,v2_end_date_ist,selectQcResult,failureReason,qc_confidence
```

The historical performance CSV must use `simteacher_v2_labeler` as the first column and batch IDs as score columns.

## Notes

- Blank or missing historical scores use default risk weight `3`.
- `qc_confidence=low` uses confidence weight `2`; all other confidence values use `1`.
- The random seed makes selection reproducible for the same CSVs and configuration.
- Excel export is generated as an `.xls` HTML workbook for Apps Script compatibility.
