# AI RTL

Persian/English typography and right-to-left text for AI websites. Includes Chromium and Firefox Manifest V3 source, bundled Vazirmatn (SIL OFL), per-site text scaling, independent Persian/English font selection, and browser regression tests.

متن دارای حروف فارسی حتی با شروع انگلیسی راست‌چین می‌شود؛ متن کاملاً انگلیسی، کد و فرمول جهت اصلی خود را حفظ می‌کنند. تنظیم اندازه برای هر سایت جداگانه است.

## Install

Download a release ZIP and extract it. In Chrome/Edge open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the extracted `ai-rtl` folder. Refresh the AI website. To keep settings, overwrite the previously loaded folder, reload the extension and refresh pages.

Firefox source is in `ai-rtl-firefox/`. Temporary development loading uses `about:debugging`; permanent distribution requires Mozilla signing.

GitHub stores the source and downloadable builds. An unpacked installation still needs a local folder: do not delete it while Chrome uses it. Moving the repository does not provide automatic extension updates or publish to either browser store.

## Development

Node.js 20+ and Playwright are required. Run `npm ci`, `npx playwright install chromium`, then `npm test`. Browser tests use local fixtures and mocked storage, without signing into AI services. `CHROME_PATH` can select an existing Chrome executable.

The two browser folders share JavaScript/CSS/HTML assets, with separate browser manifests. Keep shared files synchronized when editing. Generated screenshots, ZIP files, account data, and local workspace notes are excluded from Git.

## Privacy and permissions

The extension detects text locally and saves preferences using browser extension storage. It does not send chat text to a server. The broad content-script match permits manually enabling other websites; by default processing is limited to configured sites. Antigravity's official cross-origin iframe is handled separately. Google processing is limited to search result/answer content.

## Releases

`node scripts/package.cjs` creates browser ZIPs under `dist/`. The GitHub Actions release workflow builds these ZIPs on version tags (`v*`) and attaches them to a GitHub Release. Keep both manifest versions in sync before tagging. No store publication is performed.

The Vazirmatn license is retained in each browser folder at `fonts/OFL.txt`. No additional license grant for the project's original code has been selected yet.
