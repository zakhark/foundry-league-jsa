// Downloads the league Google Sheet as an .xlsx workbook.
const fs = require('fs');
const path = require('path');
const config = require('./config');

async function main() {
  if (!/^[\w-]{20,}$/.test(config.sheetId)) {
    throw new Error(
      'SHEET_ID is not set. Locally: copy .env.example to .env and fill it in. ' +
        'On GitHub: add a repository secret named SHEET_ID (gh secret set SHEET_ID).'
    );
  }
  const url = `https://docs.google.com/spreadsheets/d/${config.sheetId}/export?format=xlsx`;
  // Don't print the URL: build logs of a public repo are public too.
  console.log('Downloading the league spreadsheet');
  const res = await fetch(url, { redirect: 'follow' });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !type.includes('spreadsheetml')) {
    throw new Error(
      `Download failed (HTTP ${res.status}, ${type}). Is the sheet shared as "Anyone with the link can view"?`
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(config.dataFile), { recursive: true });
  fs.writeFileSync(config.dataFile, buf);
  console.log(`Saved ${config.dataFile} (${(buf.length / 1024).toFixed(0)} KB)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
