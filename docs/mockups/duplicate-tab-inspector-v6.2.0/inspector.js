const state = {
  level: "exact",
  tabs: [],
  snapshots: new Map(),
  isCapturing: false,
  multiWindow: false,
};

const FALLBACK_ICON = "icons/icon-48.png";

function isRestrictedUrl(url) {
  if (!url) return true;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("view-source:") ||
    url.startsWith("https://chromewebstore.google.com") ||
    url.startsWith("https://chrome.google.com/webstore")
  );
}

function getNormalizedKey(rawUrl, level) {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (level === "domain") {
      return host;
    }
    const cleanPath = u.pathname.replace(/\/$/, "") || "/";
    if (level === "path") {
      return `${host}${cleanPath}`;
    }
    const params = new URLSearchParams(u.search);
    params.sort();
    const sortedSearch = params.toString();
    const queryPart = sortedSearch ? `?${sortedSearch}` : "";
    if (level === "no-hash") {
      return `${host}${cleanPath}${queryPart}`;
    }
    return `${host}${cleanPath}${queryPart}${u.hash}`;
  } catch {
    return rawUrl;
  }
}

function getDuplicateGroups() {
  const buckets = new Map();
  for (const tab of state.tabs) {
    if (!tab.url) continue;
    const key = getNormalizedKey(tab.url, state.level);
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(tab);
  }

  const groups = [];
  for (const [key, items] of buckets.entries()) {
    if (items.length > 1) {
      groups.push({ key, tabs: items });
    }
  }
  return groups;
}

function pickPrimaryTabId(tabs) {
  const pinnedOrAudible = tabs.find((t) => t.pinned || t.audible);
  if (pinnedOrAudible) return pinnedOrAudible.id;
  return tabs[0].id;
}

async function loadInitialTabs() {
  const selfUrl = chrome.runtime.getURL("inspector.html");
  const allTabs = await chrome.tabs.query({});
  const filtered = allTabs.filter((t) => t.url && t.url !== selfUrl);

  filtered.sort((a, b) => {
    if (a.windowId !== b.windowId) return a.windowId - b.windowId;
    return a.index - b.index;
  });

  const windowIds = new Set(filtered.map((t) => t.windowId));
  state.multiWindow = windowIds.size > 1;
  state.tabs = filtered;
  render();
}

async function jumpToTab(tab) {
  try {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch {
    removeTabFromState(tab.id);
  }
}

function removeTabFromState(tabId) {
  state.tabs = state.tabs.filter((t) => t.id !== tabId);
  state.snapshots.delete(tabId);
  render();
}

async function closeTabs(tabIds) {
  if (!tabIds.length) return;
  try {
    await chrome.tabs.remove(tabIds);
  } catch {
    // Ignore already-closed tabs
  }
  const closedSet = new Set(tabIds);
  state.tabs = state.tabs.filter((t) => !closedSet.has(t.id));
  for (const id of closedSet) {
    state.snapshots.delete(id);
  }
  render();
}

async function waitForTabPaint(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    });
  } catch {
    await new Promise((r) => setTimeout(r, 120));
  }
}

async function captureAllDuplicatePreviews() {
  if (state.isCapturing) return;

  const groups = getDuplicateGroups();
  const candidates = [];
  const seen = new Set();

  for (const group of groups) {
    for (const tab of group.tabs) {
      if (seen.has(tab.id)) continue;
      seen.add(tab.id);
      if (state.snapshots.has(tab.id)) continue;
      if (isRestrictedUrl(tab.url) || tab.discarded) continue;
      candidates.push(tab);
    }
  }

  if (candidates.length === 0) {
    render();
    return;
  }

  state.isCapturing = true;
  const captureBtn = document.getElementById("capture-btn");
  captureBtn.disabled = true;

  const currentTab = await chrome.tabs.getCurrent();

  try {
    for (let i = 0; i < candidates.length; i++) {
      const tab = candidates[i];
      captureBtn.textContent = `Capturing ${i + 1}/${candidates.length}…`;

      try {
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId !== undefined) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
        await waitForTabPaint(tab.id);
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: "jpeg",
          quality: 75,
        });
        if (dataUrl) {
          state.snapshots.set(tab.id, dataUrl);
        }
      } catch {
        // Skip tabs that cannot be captured
      }
    }
  } finally {
    if (currentTab && currentTab.id !== undefined) {
      try {
        await chrome.tabs.update(currentTab.id, { active: true });
        if (currentTab.windowId !== undefined) {
          await chrome.windows.update(currentTab.windowId, { focused: true });
        }
      } catch {
        // Inspector tab closed
      }
    }
    state.isCapturing = false;
    captureBtn.disabled = false;
    captureBtn.textContent = "Capture Previews";
    render();
  }
}

function buildPreviewElement(tab) {
  const box = document.createElement("div");
  box.className = "preview-box";

  const snap = state.snapshots.get(tab.id);
  if (snap) {
    const img = document.createElement("img");
    img.className = "preview-img";
    img.src = snap;
    img.alt = "";
    box.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "preview-placeholder";

    const icon = document.createElement("img");
    icon.src = tab.favIconUrl || FALLBACK_ICON;
    icon.onerror = () => {
      icon.src = FALLBACK_ICON;
    };

    const label = document.createElement("span");
    if (isRestrictedUrl(tab.url)) {
      label.textContent = "System Page";
    } else if (tab.discarded) {
      label.textContent = "Sleeping Tab";
    } else {
      label.textContent = "No Preview Captured";
    }

    placeholder.append(icon, label);
    box.appendChild(placeholder);
  }

  return box;
}

function buildCardElement(tab, isPrimary, windowNumbers) {
  const card = document.createElement("article");
  card.className = isPrimary ? "card is-primary" : "card";
  card.addEventListener("click", () => jumpToTab(tab));

  const previewBox = buildPreviewElement(tab);

  const overlay = document.createElement("div");
  overlay.className = "overlay-bar";

  const pills = document.createElement("div");
  pills.className = "meta-pills";

  const pos = document.createElement("span");
  pos.className = "tab-pos";
  const tabNum = tab.index + 1;
  pos.textContent = state.multiWindow
    ? `W${windowNumbers.get(tab.windowId)} · Tab ${tabNum}`
    : `Tab ${tabNum}`;
  pills.appendChild(pos);

  if (isPrimary) {
    const primaryTag = document.createElement("span");
    primaryTag.className = "tag primary-tag";
    primaryTag.textContent = "Primary";
    pills.appendChild(primaryTag);
  }
  if (tab.pinned) {
    const pinTag = document.createElement("span");
    pinTag.className = "tag";
    pinTag.textContent = "Pinned";
    pills.appendChild(pinTag);
  }
  if (tab.audible) {
    const audioTag = document.createElement("span");
    audioTag.className = "tag";
    audioTag.textContent = "Audio";
    pills.appendChild(audioTag);
  }

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "close-btn";
  closeBtn.title = "Close tab";
  closeBtn.setAttribute("aria-label", "Close tab");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeTabs([tab.id]);
  });

  overlay.append(pills, closeBtn);
  previewBox.appendChild(overlay);

  const body = document.createElement("div");
  body.className = "card-body";

  const titleRow = document.createElement("div");
  titleRow.className = "title-row";

  const fav = document.createElement("img");
  fav.className = "favicon";
  fav.src = tab.favIconUrl || FALLBACK_ICON;
  fav.onerror = () => {
    fav.src = FALLBACK_ICON;
  };

  const title = document.createElement("h2");
  title.className = "card-title";
  title.textContent = tab.title || tab.url;
  title.title = tab.title || tab.url;

  titleRow.append(fav, title);

  const urlEl = document.createElement("div");
  urlEl.className = "card-url";
  urlEl.textContent = tab.url;
  urlEl.title = tab.url;

  body.append(titleRow, urlEl);
  card.append(previewBox, body);
  return card;
}

function render() {
  const groups = getDuplicateGroups();
  const content = document.getElementById("content");
  const summary = document.getElementById("summary");

  const totalDuplicateTabs = groups.reduce((acc, g) => acc + g.tabs.length, 0);
  const extraTabs = totalDuplicateTabs - groups.length;

  summary.textContent =
    groups.length === 0
      ? `0 duplicate groups across ${state.tabs.length} open tabs`
      : `${groups.length} ${groups.length === 1 ? "group" : "groups"} · ${extraTabs} extra ${extraTabs === 1 ? "tab" : "tabs"} (${state.tabs.length} open)`;

  content.innerHTML = "";

  if (groups.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const h2 = document.createElement("h2");
    h2.textContent = "No duplicate tabs found";
    const p = document.createElement("p");
    p.textContent = "Switch to a broader match level (Path or Domain) to group related pages.";
    empty.append(h2, p);
    content.appendChild(empty);
    return;
  }

  const windowNumbers = new Map();
  let winCounter = 1;
  for (const t of state.tabs) {
    if (!windowNumbers.has(t.windowId)) {
      windowNumbers.set(t.windowId, winCounter++);
    }
  }

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "group";

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

    const primaryId = pickPrimaryTabId(group.tabs);
    const removableIds = group.tabs
      .filter((t) => t.id !== primaryId && !t.pinned && !t.audible)
      .map((t) => t.id);

    header.appendChild(titleWrap);

    if (removableIds.length > 0) {
      const bulkBtn = document.createElement("button");
      bulkBtn.type = "button";
      bulkBtn.className = "bulk-close-btn";
      bulkBtn.textContent = `Close ${removableIds.length} Extra`;
      bulkBtn.addEventListener("click", () => closeTabs(removableIds));
      header.appendChild(bulkBtn);
    }

    const grid = document.createElement("div");
    grid.className = "grid";

    for (const tab of group.tabs) {
      grid.appendChild(buildCardElement(tab, tab.id === primaryId, windowNumbers));
    }

    section.append(header, grid);
    content.appendChild(section);
  }
}

document.querySelectorAll(".seg-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.level = btn.dataset.level;
    render();
  });
});

document
  .getElementById("capture-btn")
  .addEventListener("click", captureAllDuplicatePreviews);

loadInitialTabs();
