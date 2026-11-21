# Duplicate Tab Inspector v2.0.0

A minimal, dark-mode Manifest V3 Chrome extension for inspecting and selectively closing duplicate tabs.

## Changes in v2.0.0
- **Full-Tab Grid Layout:** Opens in a dedicated full-page browser tab with smooth outer-page vertical scrolling—no tiny popup height or width caps.
- **Dark-Only Theme:** Native dark color palette designed for low glare.
- **Visual Preview Cards:** Displays each tab's favicon, window badge, status (`First Copy`, `Suspended`, or `Copy #N`), 2-line title preview, and full scrollable URL.
- **Reliable Tab Actions:** Uses `chrome.tabs.remove` with safe error handling and automatic live refresh when tabs are closed or updated.

## Installation
1. Extract `duplicate-tab-inspector-v2.0.0.zip`.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the extracted folder.
5. Click the extension toolbar icon (or press `Alt+Shift+D`) to open the inspector tab.
