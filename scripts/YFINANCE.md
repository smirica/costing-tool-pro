# Local commodity prices

The cost page requests only current market prices for HRC=F, ALI=F and HG=F, with units and quote timestamps. Yahoo quotes may be delayed. No dividends or company information is used. A small price-history request initializes Yahoo chart metadata; corporate actions are disabled.

Local setup (Python 3.10+):
```powershell
python -m venv .venv-yfinance
.\.venv-yfinance\Scripts\python.exe -m pip install -r scripts/requirements-yfinance.txt
```
The environment is already installed in this checkout. Start the existing development command when ready to review locally. The Vite middleware runs this Python executable on demand, with no separate service or port. An optional YFINANCE_PYTHON environment variable overrides the executable path.

Each page mount and Reload requests new data. Concurrent requests share one in-flight process; completed prices are not cached. Keep yfinance's normal timezone/cookie cache. Debug logging is off, and no proxy is required on the tested network. Do not remove curl_cffi from yfinance's dependencies.

Prices convert from USD/short ton for steel (2,000 lb), USD/metric ton for aluminum (2,204.6226218488 lb), and USD/lb for copper. The adapter rejects missing timestamps, nonpositive/nonfinite prices, and unexpected currencies. It times out after 45 seconds. An individual ticker failure remains visible without preventing other quotes. Existing Tempel/vendor calculations and monthly BLS comparisons retain their original behavior.

This integration is local-only. Vite serves the authenticated adapter before the Worker. The production route returns an explicit unavailable response; deployment requires a separately hosted Python service. No deployment was performed.

The material-reference workbook is in outputs/metal-reference-20260908. Its companion app/material-reference-snapshot.json stores research candidates for later use; it does not override costing. Workbook edits do not automatically sync to the app. MPB prices remain unset for 510 parts because no compatible electrical-steel products were verified.

Validation:
```powershell
.\.venv-yfinance\Scripts\python.exe scripts/test-metal-quotes.py
node scripts/test-yfinance-plugin.mjs
npm run build
```


## Current-cost estimate

The headline now uses winding-sheet steel weight. Each matched part uses the newest usable dated Tempel or Dongan supplier rate normalized to USD/lb. For vendor costs per piece, a matching Tempel net weight per 1,000 pieces is required for conversion.

Estimated rate = historical supplier USD/lb × latest HRC USD/lb ÷ historical HRC USD/lb.
Estimated total = winding-sheet steel weight × estimated rate.

This is a proportional HRC pricing assumption, not an electrical-steel quote. Historical HRC closes are fetched only to calculate this adjustment. Dividends and corporate actions remain disabled. A historical quote must be on or before the supplier date and no more than seven days earlier. The actual historical date and latest quote timestamp appear on the page.

For multiple parts, allocate winding-sheet weight proportionally to positive catalog weights. If any weight, supplier rate, approved match, or market comparison is missing, withhold the headline total rather than showing a partial sum. Historical item-cost comparisons continue to use design-packet quantities and are labeled separately.

The monthly BLS endpoint is retained for compatibility but is no longer called by the cost workspace. The cost workspace uses the same yfinance response for the compact quote strip and headline calculation; Reload refreshes both.

Source-data links open authenticated previews of the catalog records used by the app and offer CSV downloads for Excel. They are exports of imported values, not copies of the original spreadsheets.
