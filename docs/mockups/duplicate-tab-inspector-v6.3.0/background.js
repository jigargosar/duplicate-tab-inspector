chrome.action.onClicked.addListener(async () => {
    const url = chrome.runtime.getURL('inspector.html')
    const existing = await chrome.tabs.query({ url })
    if (existing.length > 0) {
        const target = existing[0]
        await chrome.windows.update(target.windowId, { focused: true })
        await chrome.tabs.update(target.id, { active: true })
        return
    }
    await chrome.tabs.create({ url })
})
