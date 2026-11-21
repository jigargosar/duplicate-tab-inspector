chrome.action.onClicked.addListener(async () => {
  const inspectorUrl = chrome.runtime.getURL("inspector.html");
  const existing = await chrome.tabs.query({ url: inspectorUrl });
  if (existing.length > 0) {
    const target = existing[0];
    await chrome.windows.update(target.windowId, { focused: true });
    await chrome.tabs.update(target.id, { active: true });
    return;
  }
  await chrome.tabs.create({ url: inspectorUrl });
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCapturableUrl(url) {
  if (!url) return false;
  return /^(https?|file):/i.test(url);
}

async function waitForTabReady(tabId, timeoutMs = 1800) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete" && !tab.discarded) {
        return true;
      }
    } catch (_) {
      return false;
    }
    await sleep(120);
  }
  return true;
}

async function captureWithRetry(windowId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
        format: "jpeg",
        quality: 68
      });
      if (dataUrl) return dataUrl;
    } catch (err) {
      await sleep(550);
    }
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "CAPTURE_PREVIEWS") {
    return false;
  }

  (async () => {
    const results = {};
    const originTabId = sender.tab ? sender.tab.id : null;
    const originWindowId = sender.tab ? sender.tab.windowId : null;

    try {
      const windows = await chrome.windows.getAll({ populate: true });
      const winMap = new Map(windows.map((w) => [w.id, w]));
      const byWindow = new Map();

      for (const item of msg.targets || []) {
        if (!isCapturableUrl(item.url)) continue;
        if (!byWindow.has(item.windowId)) {
          byWindow.set(item.windowId, []);
        }
        byWindow.get(item.windowId).push(item);
      }

      const orderedWindowIds = Array.from(byWindow.keys()).sort((a, b) => {
        if (a === originWindowId) return -1;
        if (b === originWindowId) return 1;
        return a - b;
      });

      for (const winId of orderedWindowIds) {
        const win = winMap.get(winId);
        if (!win || win.state === "minimized") continue;

        const originalActive = (win.tabs || []).find((t) => t.active);
        const items = byWindow.get(winId) || [];

        if (winId !== originWindowId) {
          await chrome.windows.update(winId, { focused: true });
          await sleep(180);
        }

        for (const item of items) {
          try {
            const currentTab = await chrome.tabs.get(item.id);
            if (!isCapturableUrl(currentTab.url)) continue;

            await chrome.tabs.update(item.id, { active: true });
            await waitForTabReady(item.id, 1800);
            await sleep(220);

            const dataUrl = await captureWithRetry(winId);
            if (dataUrl) {
              results[`${item.id}::${currentTab.url}`] = dataUrl;
            }
          } catch (_) {
            // Skip tabs closed mid-capture
          }
        }

        if (originalActive && originalActive.id !== originTabId) {
          try {
            await chrome.tabs.update(originalActive.id, { active: true });
          } catch (_) {}
        }
      }
    } finally {
      if (originWindowId !== null) {
        try {
          await chrome.windows.update(originWindowId, { focused: true });
        } catch (_) {}
      }
      if (originTabId !== null) {
        try {
          await chrome.tabs.update(originTabId, { active: true });
        } catch (_) {}
      }
    }

    sendResponse({ ok: true, previews: results });
  })();

  return true;
});
