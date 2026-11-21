# Duplicate Tab Inspector (v6.4.0)

Lightweight Manifest V3 Chrome extension to inspect, preview, and close duplicate tabs with zero background polling.

## Features
- **Zero Background Load:** Refreshes tab/window state on open and when returning to the inspector tab.
- **Left-to-Right URL Matching:** Switch between `Domain`, `Path`, `No Hash`, and `Exact` URL grouping.
- **Deterministic Window & Tab Ordering:** Current window first, then ascending window order and left-to-right tab position.
- **Window Context & Custom Labels:** Displays `Win # · tab count · dominant domain` (never leaking an unrelated active tab onto a card), with click-to-rename window labels.
- **On-Demand Preview Capture:** Single bulk `Capture Previews` button captures visual snapshots of duplicate tabs.

## Installation
1. Extract this zip archive.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted folder.
