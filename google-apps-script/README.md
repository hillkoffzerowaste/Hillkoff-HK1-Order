# Google Sheets Storage Setup

1. Create a Google Sheet for HK1 orders.
2. Open Extensions > Apps Script.
3. Copy `Code.gs` into the Apps Script editor.
4. Copy `appsscript.json` into Project Settings > Show appsscript.json manifest file.
5. Deploy > New deployment > Web app.
6. Set Execute as: Me.
7. Set Who has access: Anyone.
8. Copy the Web app URL into `.env` as `VITE_SHEETS_WEB_APP_URL`.
9. Run `npm.cmd run build` again before deploying the website.

The script keeps a full JSON snapshot in the `Store` sheet and also writes readable rows to `Orders` and `Products`.
