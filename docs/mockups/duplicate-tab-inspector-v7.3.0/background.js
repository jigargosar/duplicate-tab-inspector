const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function openOrFocusInspector() {
    const inspectorUrl = chrome.runtime.getURL('inspector.html')
    const existing = await chrome.tabs.query({ url: inspectorUrl })
    if (existing.length > 0) {
        const target = existing[0]
        await chrome.windows.update(target.windowId, { focused: true })
        await chrome.tabs.update(target.id, { active: true })
        return
    }
    await chrome.tabs.create({ url: inspectorUrl })
}

chrome.action.onClicked.addListener(() => {
    openOrFocusInspector()
})

function isCapturableUrl(url) {
    if (!url) return false
    return (
        url.startsWith('http://') ||
        url.startsWith('https://') ||
        url.startsWith('file://')
    )
}

async function waitForTabComplete(tabId, timeoutMs = 1500) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
        try {
            const t = await chrome.tabs.get(tabId)
            if (t.status === 'complete' && !t.discarded) {
                return true
            }
        } catch (err) {
            return false
        }
        await sleep(80)
    }
    return true
}

async function captureVisibleWithRetry(windowId) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await chrome.tabs.captureVisibleTab(windowId, {
                format: 'jpeg',
                quality: 65,
            })
        } catch (err) {
            const msg = String(err && err.message ? err.message : err)
            if (msg.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')) {
                await sleep(550)
                continue
            }
            return null
        }
    }
    return null
}

async function runBatchCapture(targets, originTabId, originWindowId) {
    const snapshots = {}
    if (!Array.isArray(targets) || targets.length === 0) {
        return snapshots
    }

    const byWindow = new Map()
    for (const item of targets) {
        if (!isCapturableUrl(item.url)) continue
        if (!byWindow.has(item.windowId)) {
            byWindow.set(item.windowId, [])
        }
        byWindow.get(item.windowId).push(item)
    }

    const orderedWindowIds = Array.from(byWindow.keys()).sort((a, b) => {
        if (a === originWindowId) return -1
        if (b === originWindowId) return 1
        return a - b
    })

    for (const winId of orderedWindowIds) {
        let winInfo
        try {
            winInfo = await chrome.windows.get(winId, { populate: true })
        } catch (err) {
            continue
        }
        if (!winInfo || winInfo.state === 'minimized') {
            continue
        }

        const originalActive = (winInfo.tabs || []).find((t) => t.active)
        const winTargets = byWindow.get(winId) || []

        try {
            await chrome.windows.update(winId, { focused: true })
            await sleep(120)
        } catch (err) {
            continue
        }

        for (const item of winTargets) {
            try {
                const liveTab = await chrome.tabs.get(item.tabId)
                if (!liveTab || liveTab.discarded || !isCapturableUrl(liveTab.url)) {
                    continue
                }
                if (!liveTab.active) {
                    await chrome.tabs.update(item.tabId, { active: true })
                    await waitForTabComplete(item.tabId, 1200)
                    await sleep(160)
                }
                const dataUrl = await captureVisibleWithRetry(winId)
                if (dataUrl) {
                    snapshots[`${item.tabId}::${liveTab.url}`] = dataUrl
                }
            } catch (err) {
                // Skip closed or restricted tabs safely
            }
        }

        if (originalActive && originalActive.id !== originTabId) {
            try {
                await chrome.tabs.update(originalActive.id, { active: true })
            } catch (err) {
                // Ignore if original tab closed
            }
        }
    }

    try {
        if (originWindowId) {
            await chrome.windows.update(originWindowId, { focused: true })
        }
        if (originTabId) {
            await chrome.tabs.update(originTabId, { active: true })
        }
    } catch (err) {
        // Ignore if inspector tab closed
    }

    return snapshots
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'CAPTURE_PREVIEWS') {
        const originTabId = sender && sender.tab ? sender.tab.id : null
        const originWindowId = sender && sender.tab ? sender.tab.windowId : null
        runBatchCapture(message.targets || [], originTabId, originWindowId)
            .then((snapshots) => {
                sendResponse({ ok: true, snapshots })
            })
            .catch((err) => {
                sendResponse({ ok: false, error: String(err), snapshots: {} })
            })
        return true
    }
    return false
})
