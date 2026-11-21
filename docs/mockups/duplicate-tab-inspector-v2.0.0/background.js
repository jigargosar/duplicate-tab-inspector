const INSPECTOR_URL = chrome.runtime.getURL('inspector.html');

async function openOrFocusInspector() {
    const existing = await chrome.tabs.query({ url: INSPECTOR_URL });
    if (existing.length > 0) {
        const target = existing[0];
        await chrome.windows.update(target.windowId, { focused: true });
        await chrome.tabs.update(target.id, { active: true });
        return;
    }
    await chrome.tabs.create({ url: INSPECTOR_URL, active: true });
}

chrome.action.onClicked.addListener(openOrFocusInspector);

chrome.commands.onCommand.addListener((command) => {
    if (command === 'open-inspector') {
        openOrFocusInspector();
    }
});
