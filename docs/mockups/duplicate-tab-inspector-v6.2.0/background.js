chrome.action.onClicked.addListener(async () => {
  const inspectorUrl = chrome.runtime.getURL("inspector.html");
  const existing = await chrome.tabs.query({ url: inspectorUrl });
  if (existing.length > 0) {
    const target = existing[0];
    await chrome.tabs.update(target.id, { active: true });
    if (target.windowId !== undefined) {
      await chrome.windows.update(target.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url: inspectorUrl });
});
