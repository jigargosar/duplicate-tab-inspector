let currentMode = "exact";
let isCapturing = false;
let currentInspectorTabId = null;
let currentInspectorWindowId = null;
let windowAliases = {};
const previewCache = new Map();

const groupsContainer = document.getElementById("groupsContainer");
const summaryText = document.getElementById("summaryText");
const captureBtn = document.getElementById("captureBtn");
const versionBadge = document.getElementById("versionBadge");

versionBadge.textContent = `v${chrome.runtime.getManifest().version}`;

function normalizeKey(rawUrl, mode) {
  if (!rawUrl) return "";
  try {
    const u = new URL(rawUrl);
    if (!/^https?:$/i.test(u.protocol)) {
      if (mode === "domain") return `${u.protocol}//${u.host}`;
      if (mode === "path" || mode === "nohash") return `${u.protocol}//${u.host}${u.pathname}`;
      return rawUrl;
    }

    const host = u.host.toLowerCase();
    const path = u.pathname.replace(/\/+$/, "") || "/";

    if (mode === "domain") {
      return host;
    }
    if (mode === "path") {
      return `${host}${path}`;
    }
    if (mode === "nohash") {
      const params = new URLSearchParams(u.search);
      params.sort();
      const qs = params.toString();
      return qs ? `${host}${path}?${qs}` : `${host}${path}`;
    }
    const params = new URLSearchParams(u.search);
    params.sort();
    const qs = params.toString();
    return `${host}${path}${qs ? `?${qs}` : ""}${u.hash || ""}`;
  } catch (_) {
    return rawUrl;
  }
}

function getDomain(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (/^https?:$/i.test(u.protocol)) {
      return u.host.replace(/^www\./i, "");
    }
    return u.protocol.replace(":", "");
  } catch (_) {
    return "";
  }
}

function isWebUrl(rawUrl) {
  return /^(https?|file):/i.test(rawUrl || "");
}

function buildWindowMetadata(windows, allTabs) {
  const orderedWindows = [...windows].sort((a, b) => {
    if (a.id === currentInspectorWindowId) return -1;
    if (b.id === currentInspectorWindowId) return 1;
    return a.id - b.id;
  });

  const tabsByWin = new Map();
  for (const t of allTabs) {
    if (!tabsByWin.has(t.windowId)) tabsByWin.set(t.windowId, []);
    tabsByWin.get(t.windowId).push(t);
  }

  const meta = new Map();
  orderedWindows.forEach((win, idx) => {
    const winTabs = tabsByWin.get(win.id) || [];
    const domainCounts = new Map();
    for (const t of winTabs) {
      const d = getDomain(t.url);
      if (d && d !== "chrome" && d !== "chrome-extension") {
        domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
      }
    }
    let topDomain = "";
    let topCount = 0;
    for (const [d, c] of domainCounts.entries()) {
      if (c > topCount) {
        topDomain = d;
        topCount = c;
      }
    }

    const num = idx + 1;
    const alias = windowAliases[String(win.id)];
    const label = alias
      ? alias
      : `Win ${num} · ${winTabs.length} tabs${topDomain ? ` · ${topDomain}` : ""}`;

    meta.set(win.id, {
      order: idx,
      num,
      label,
      tabCount: winTabs.length,
      incognito: Boolean(win.incognito)
    });
  });

  return meta;
}

function isProtectedTab(tab) {
  return Boolean(tab.pinned || tab.audible || tab.id === currentInspectorTabId);
}

async function loadAndRender() {
  const [selfTab, windows, allTabs, stored] = await Promise.all([
    chrome.tabs.getCurrent(),
    chrome.windows.getAll(),
    chrome.tabs.query({}),
    chrome.storage.local.get(["windowAliases"])
  ]);

  if (selfTab) {
    currentInspectorTabId = selfTab.id;
    currentInspectorWindowId = selfTab.windowId;
  }
  windowAliases = stored.windowAliases || {};

  const winMeta = buildWindowMetadata(windows, allTabs);
  const groupsMap = new Map();

  for (const tab of allTabs) {
    const key = normalizeKey(tab.url, currentMode);
    if (!key) continue;
    if (!groupsMap.has(key)) groupsMap.set(key, []);
    groupsMap.get(key).push(tab);
  }

  const duplicateGroups = [];
  let extraCount = 0;
  let matchingTabsCount = 0;

  for (const [key, tabs] of groupsMap.entries()) {
    if (tabs.length < 2) continue;

    tabs.sort((a, b) => {
      const wa = winMeta.has(a.windowId) ? winMeta.get(a.windowId).order : 999;
      const wb = winMeta.has(b.windowId) ? winMeta.get(b.windowId).order : 999;
      if (wa !== wb) return wa - wb;
      return a.index - b.index;
    });

    const closableTabs = tabs.filter((t) => !isProtectedTab(t));
    const keepTab = tabs.find((t) => isProtectedTab(t)) || tabs[0];
    const extraTabs = closableTabs.filter((t) => t.id !== keepTab.id);

    duplicateGroups.push({
      key,
      tabs,
      extraTabs
    });

    matchingTabsCount += tabs.length;
    extraCount += extraTabs.length;
  }

  duplicateGroups.sort((a, b) => {
    const wa = winMeta.has(a.tabs[0].windowId) ? winMeta.get(a.tabs[0].windowId).order : 999;
    const wb = winMeta.has(b.tabs[0].windowId) ? winMeta.get(b.tabs[0].windowId).order : 999;
    if (wa !== wb) return wa - wb;
    return a.tabs[0].index - b.tabs[0].index;
  });

  summaryText.textContent = `${duplicateGroups.length} groups · ${extraCount} extra tabs (${matchingTabsCount} matching of ${allTabs.length} open)`;
  renderGroups(duplicateGroups, winMeta);
}

function renderGroups(groups, winMeta) {
  groupsContainer.innerHTML = "";

  if (groups.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <h2>No duplicate tabs found</h2>
      <p>Try switching to a broader URL filter level (such as Path or Domain).</p>
    `;
    groupsContainer.appendChild(empty);
    return;
  }

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "group-section";

    const header = document.createElement("div");
    header.className = "group-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "group-title-wrap";

    const keyEl = document.createElement("span");
    keyEl.className = "group-key";
    keyEl.textContent = group.key;
    keyEl.title = group.key;

    const countEl = document.createElement("span");
    countEl.className = "group-count";
    countEl.textContent = `${group.tabs.length} tabs`;

    titleWrap.append(keyEl, countEl);
    header.appendChild(titleWrap);

    if (group.extraTabs.length > 0) {
      const bulkBtn = document.createElement("button");
      bulkBtn.type = "button";
      bulkBtn.className = "close-extra-btn";
      bulkBtn.textContent = `Close ${group.extraTabs.length} Extra`;
      bulkBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ids = group.extraTabs.map((t) => t.id);
        await chrome.tabs.remove(ids);
        await loadAndRender();
      });
      header.appendChild(bulkBtn);
    }

    const grid = document.createElement("div");
    grid.className = "cards-grid";

    for (const tab of group.tabs) {
      const card = document.createElement("article");
      card.className = "tab-card";
      card.addEventListener("click", async () => {
        try {
          await chrome.windows.update(tab.windowId, { focused: true });
          await chrome.tabs.update(tab.id, { active: true });
        } catch (_) {
          await loadAndRender();
        }
      });

      const previewBox = document.createElement("div");
      previewBox.className = "preview-box";

      const cacheKey = `${tab.id}::${tab.url}`;
      const cachedImg = previewCache.get(cacheKey);

      if (cachedImg) {
        const img = document.createElement("img");
        img.className = "preview-img";
        img.src = cachedImg;
        img.alt = "";
        previewBox.appendChild(img);
      } else {
        const ph = document.createElement("div");
        ph.className = "preview-placeholder";
        if (!isWebUrl(tab.url)) {
          ph.textContent = "System Page";
        } else if (tab.discarded) {
          ph.textContent = "Sleeping Tab";
        } else {
          ph.textContent = "No Preview Yet";
        }
        previewBox.appendChild(ph);
      }

      const overlay = document.createElement("div");
      overlay.className = "overlay-bar";

      const overlayLeft = document.createElement("div");
      overlayLeft.className = "overlay-left";

      const info = winMeta.get(tab.windowId);
      const winPill = document.createElement("span");
      winPill.className = "win-pill";
      winPill.textContent = info ? info.label : "Win";
      winPill.title = "Click to rename this window";
      winPill.addEventListener("click", async (e) => {
        e.stopPropagation();
        const current = windowAliases[String(tab.windowId)] || "";
        const next = window.prompt("Custom label for this window (leave blank to reset):", current);
        if (next === null) return;
        const trimmed = next.trim();
        if (trimmed) {
          windowAliases[String(tab.windowId)] = trimmed;
        } else {
          delete windowAliases[String(tab.windowId)];
        }
        await chrome.storage.local.set({ windowAliases });
        await loadAndRender();
      });
      overlayLeft.appendChild(winPill);

      if (tab.id === currentInspectorTabId) {
        const tag = document.createElement("span");
        tag.className = "state-tag";
        tag.textContent = "Current";
        overlayLeft.appendChild(tag);
      } else if (tab.pinned) {
        const tag = document.createElement("span");
        tag.className = "state-tag";
        tag.textContent = "Pinned";
        overlayLeft.appendChild(tag);
      } else if (tab.audible) {
        const tag = document.createElement("span");
        tag.className = "state-tag";
        tag.textContent = "Audio";
        overlayLeft.appendChild(tag);
      }

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "close-card-btn";
      closeBtn.textContent = "×";
      closeBtn.title = "Close this tab";
      closeBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await chrome.tabs.remove(tab.id);
        } catch (_) {}
        await loadAndRender();
      });

      overlay.append(overlayLeft, closeBtn);
      previewBox.appendChild(overlay);

      const body = document.createElement("div");
      body.className = "card-body";

      const titleRow = document.createElement("div");
      titleRow.className = "card-title-row";

      const fav = document.createElement("img");
      fav.className = "favicon";
      fav.src = tab.favIconUrl || "icons/icon-16.png";
      fav.alt = "";
      fav.onerror = () => {
        fav.src = "icons/icon-16.png";
      };

      const titleEl = document.createElement("div");
      titleEl.className = "card-title";
      titleEl.textContent = tab.title || tab.url;
      titleEl.title = tab.title || tab.url;

      titleRow.append(fav, titleEl);

      const urlEl = document.createElement("div");
      urlEl.className = "card-url";
      urlEl.textContent = tab.url;
      urlEl.title = tab.url;

      body.append(titleRow, urlEl);
      card.append(previewBox, body);
      grid.appendChild(card);
    }

    section.append(header, grid);
    groupsContainer.appendChild(section);
  }
}

document.querySelectorAll(".seg-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.mode;
    await loadAndRender();
  });
});

captureBtn.addEventListener("click", async () => {
  if (isCapturing) return;
  isCapturing = true;
  captureBtn.disabled = true;
  captureBtn.textContent = "Capturing…";

  try {
    const allTabs = await chrome.tabs.query({});
    const groupsMap = new Map();
    for (const tab of allTabs) {
      const key = normalizeKey(tab.url, currentMode);
      if (!key) continue;
      if (!groupsMap.has(key)) groupsMap.set(key, []);
      groupsMap.get(key).push(tab);
    }

    const targets = [];
    for (const tabs of groupsMap.values()) {
      if (tabs.length < 2) continue;
      for (const tab of tabs) {
        if (!isWebUrl(tab.url) || tab.discarded) continue;
        const cacheKey = `${tab.id}::${tab.url}`;
        if (!previewCache.has(cacheKey)) {
          targets.push({ id: tab.id, windowId: tab.windowId, url: tab.url });
        }
      }
    }

    if (targets.length > 0) {
      const response = await chrome.runtime.sendMessage({
        type: "CAPTURE_PREVIEWS",
        targets
      });
      if (response && response.previews) {
        for (const [k, v] of Object.entries(response.previews)) {
          previewCache.set(k, v);
        }
      }
    }
  } finally {
    isCapturing = false;
    captureBtn.disabled = false;
    captureBtn.textContent = "Capture Previews";
    await loadAndRender();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !isCapturing) {
    loadAndRender();
  }
});

loadAndRender();
