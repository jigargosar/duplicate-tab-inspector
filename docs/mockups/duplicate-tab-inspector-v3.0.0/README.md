# Duplicate Tab Inspector v3.0.0

A minimal, zero-dependency Manifest V3 Chrome extension for reviewing and closing duplicate tabs visually in dark mode.

## Installation
1. Extract `duplicate-tab-inspector-v3.0.0.zip` to a local folder.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the extracted folder (or reload your existing extension).

## What's New in v3.0.0
- **Live Tab Snapshots:** Automatically caches thumbnails of tabs as you browse, plus includes per-card **Snapshot** and top-bar **Capture Previews** buttons for tabs opened prior to installing.
- **Refined Visual Hierarchy:** 16:9 preview header, clear primary vs. duplicate badges, compact title + scrollable full URL well, and right-aligned compact card actions.
- **Flexible Grid Sizing:** Cards auto-fit cleanly (`minmax(290px, 1fr)`) across wide or narrow screens without stretched full-width button bars.
