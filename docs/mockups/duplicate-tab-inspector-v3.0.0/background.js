const MAX_CACHE_ENTRIES = 60;
const snapshotCache = new Map();

function saveSnapshot(tabId, dataUrl) {
    if (!tabId || !dataUrl) return;
    if (snapshotCache.has(tabId)) {
        snapshotCache.delete(tabId);
    }
    snapshotCache.set(tabId, dataUrl);
    if (snapshotCache.size > MAX_CACHE_ENTRIES) {
        const oldestKey = snapshotCache.keys().next().value;
        snapshotCache.delete(oldestKey);
    }
    chrome.storage.session.set({ ['snap_' + tabId]: dataUrl }).catch(() => {});
}

async function captureActiveTab(windowId) {
    try {
        const [activeTab] = await chrome.tabs.query({ active: true, windowId });
        if (!activeTab || !activeTab.id) return;
        if (activeTab.url && (activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('chrome-extension://'))) {
            return;
        }
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
            format: 'jpeg',
            quality: 55
        });
        saveSnapshot(activeTab.id, dataUrl);
    } catch (_) {}
}

chrome.tabs.onActivated.addListener(({ windowId }) => {
    setTimeout(() => captureActiveTab(windowId), 250);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active) {
        setTimeout(() => captureActiveTab(tab.windowId), 300);
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    snapshotCache.delete(tabId);
    chrome.storage.session.remove('snap_' + tabId).catch(() => {});
});

async function openOrFocusInspector() {
    const currentWin = await chrome.windows.getCurrent();
    await captureActiveTab(currentWin.id);

    const inspectorUrl = chrome.runtime.getURL('inspector.html');
    const existing = await chrome.tabs.query({ url: inspectorUrl });
    if (existing.length > 0) {
        const tab = existing[0];
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return;
    }
    await chrome.tabs.create({ url: inspectorUrl });
}

chrome.action.onClicked.addListener(openOrFocusInspector);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'GET_SNAPSHOTS') {
        chrome.storage.session.get(null).then((all) => {
            const result = {};
            for (const [k, v] of Object.entries(all)) {
                if (k.startsWith('snap_')) {
                    result[k.slice(5)] = v;
                }
            }
            for (const [k, v] of snapshotCache.entries()) {
                result[String(k)] = v;
            }
            sendResponse(result);
        }).catch(() => {
            const fallback = {};
            for (const [k, v] of snapshotCache.entries()) {
                fallback[String(k)] = v;
            }
            sendResponse(fallback);
        });
        return true;
    }
    if (msg && msg.type === 'CAPTURE_TAB') {
        (async () => {
            try {
                const target = await chrome.tabs.get(msg.tabId);
                const prevActive = await chrome.tabs.query({ active: true, windowId: target.windowId });
                await chrome.tabs.update(target.id, { active: true });
                await new Promise((r) => setTimeout(r, 220));
                const dataUrl = await chrome.tabs.captureVisibleTab(target.windowId, {
                    format: 'jpeg',
                    quality: 60
                });
                saveSnapshot(target.id, dataUrl);
                if (prevActive.length > 0 && prevActive[0].id !== target.id) {
                    await chrome.tabs.update(prevActive[0].id, { active: true });
                }
                sendResponse({ ok: true, dataUrl });
            } catch (err) {
                sendResponse({ ok: false, error: String(err) });
            }
        })();
        return true;
    }
});
