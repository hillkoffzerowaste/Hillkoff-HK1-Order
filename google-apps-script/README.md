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
New orders are appended through the `appendOrder` action, which loads the current sheet data first and merges the new order before writing. This prevents a newly opened device with empty local cache from replacing existing sheet data.

The `Settings` sheet stores shared app settings such as `webAppUrl`. The same value is also written to the `webAppUrl` column in the `Store` sheet. Devices that already have an older working Web app URL can read this central value and automatically switch to the latest URL.

When updating `Code.gs`, go to Deploy > Manage deployments, edit the existing Web app deployment, choose New version, and deploy again.
