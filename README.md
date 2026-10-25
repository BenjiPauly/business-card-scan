# Card Scanner

Scan business cards from the camera or from image files. Text is read on the device (Tesseract OCR in the browser), parsed into fields, shown for a quick check, then saved to a Google Sheet. No sign-up, no account, nothing to install.

## Set up (10 minutes, once)

1. Open the sheet, then Extensions > Apps Script. Paste `apps-script/Code.gs`, save.
2. Run `setupSheet` once and approve the permissions. It creates the `Cards` header row, filter and formatting.
3. Optional: Project Settings > Script properties > add `TOKEN` with any secret string.
4. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Copy the Web app URL.
5. Host the `public/` folder on any HTTPS static host (Cloudflare Pages, GitHub Pages, Netlify), or run locally with `npm start` and open http://localhost:8080. Phones need HTTPS for the live camera.
6. In the app, tap Settings, paste the Web app URL (and the secret), tap Test connection, Save.

## Use

Scan with camera (phone opens the camera app, desktop opens a live preview), or choose or drop images, or paste with Ctrl+V. Several at once is fine. Check the fields, tap Save to sheet or Save all. Scanning the same person again updates their row instead of adding a duplicate (matched on email, else phone, else name plus company).

If the sheet is unreachable, Download CSV gives you the same columns to import.

## Sheet columns

Scanned At, Full Name, First Name, Last Name, Job Title, Company, Email, Mobile, Phone, Fax, Website, LinkedIn, Street, Postal Code, City, Country, Notes, Raw Text, Source, Confidence, Card ID.

Notes holds anything the parser could not place. Confidence is 0 to 1; rows below 0.6 can be highlighted from the Card Scanner menu. Card ID is the de-duplication key.

## Sheet menu (macros)

Card Scanner > Set up sheet, Add test card, Remove duplicates, Sort by company, Highlight low confidence.

## Test

`npm test` runs the whole chain with the fake card `test/sample-card.png`: OCR, parsing, then Code.gs against an in-memory sheet (add, update, wrong token, formula-like text). To also write the test card into the real sheet:

`SHEET_URL=<web app url> SHEET_TOKEN=<secret if set> npm test`

## Notes

- OCR languages default to English and German. Change them in Settings (for example `eng+fra+ita`).
- Works with photos at an angle, dark cards with light text, small or large images, and HEIC from iPhones.
- Very stylised logos and script fonts can still misread. The review step is there for that.
- Anyone with the Web app URL can add rows. Use the secret to prevent that.
