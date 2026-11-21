const LEVELS = {
  DOMAIN: 'domain',
  PATH: 'path',
  NO_HASH: 'no-hash',
  EXACT: 'exact'
};

let currentLevel = LEVELS.EXACT;
let allTabs = [];
let windowMeta = new Map();
let customWindowNames = {};
let previewCache = new Map();
let isCapturing = false;
let selfTabId = null;
let selfWindowId = null;

const contentEl = document.getElementById('content');
const summaryEl = document.getElementById('summaryText');
const captureBtn = document.getElementById('captureBtn');
const versionBadge = document.getElementById('versionBadge');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function isCapturableUrl(url) {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://');
}

function getPreviewKey(tab) {
  return `${tab.id}::${tab.url || ''}`;
}

function getDomain(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.hostname.replace(/^www\./, '');
    }
    return parsed.protocol.replace(':', '');
  } catch {
    return 'other';
  }
}

function normalizeUrl(rawUrl, level) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      if (level === LEVELS.DOMAIN) return u.protocol;
      if (level === LEVELS.PATH) return `${u.protocol}//${u.hostname}${u.pathname}`;
      if (level === LEVELS.NO_HASH) return `${u.protocol}//${u.hostname}${u.pathname}${u.search}`;
      return rawUrl;
    }

    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const port = u.port ? `:${u.port}` : '';
    const origin = `${host}${port}`;

    if (level === LEVELS.DOMAIN) {
      return origin;
    }

    const cleanPath = u.pathname.replace(/\/+$/, '') || '/';
    if (level === LEVELS.PATH) {
      return `${origin}${cleanPath}`;
    }

    const params = Array.from(u.searchParams.entries()).sort((a, b) => {
      if (a[0] === b[0]) return a[1].localeCompare(b[1]);
      return a[0].localeCompare(b[0]);
    });
    const sortedSearch = params.length
      ? '?' + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
      : '';

    if (level === LEVELS.NO_HASH) {
      return `${origin}${cleanPath}${sortedSearch}`;
    }

    return `${origin}${cleanPath}${sortedSearch}${u.hash}`;
  } catch {
    return rawUrl;
  }
}

function buildWindowMetadata(windows, tabs) {
  const sortedWindows = [...windows].sort((a, b) => {
    if (a.id === selfWindowId) return -1;
    if (b.id === selfWindowId) return 1;
    return a.id - b.id;
  });

  const meta = new Map();
  sortedWindows.forEach((win, idx) => {
    const winTabs = tabs.filter((t) => t.windowId === win.id);
    const domainCounts = new Map();
    for (const t of winTabs) {
      if (t.id === selfTabId) continue;
      const d = getDomain(t.url);
      if (d && d !== 'chrome' && d !== 'chrome-extension') {
        domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
      }
    }
    let topDomain = '';
    let maxCount = 0;
    for (const [d, count] of domainCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        topDomain = d;
      }
    }

    const orderNum = idx + 1;
    const defaultLabel = topDomain
      ? `Win ${orderNum} · ${winTabs.length} tabs · ${topDomain}`
      : `Win ${orderNum} · ${winTabs.length} tabs`;

    meta.set(win.id, {
      order: orderNum,
      tabCount: winTabs.length,
      incognito: win.incognito,
      state: win.state,
      defaultLabel
    });
  });

  return meta;
}

function getWindowDisplayLabel(windowId) {
  const custom = customWindowNames[String(windowId)];
  const info = windowMeta.get(windowId);
  if (custom && custom.trim()) {
    return info ? `${custom.trim()} (${info.tabCount})` : custom.trim();
  }
  return info ? info.defaultLabel : `Win ${windowId}`;
}

function getDuplicateGroups() {
  const map = new Map();

  for (const tab of allTabs) {
    const key = normalizeUrl(tab.url, currentLevel);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(tab);
  }

  const groups = [];
  for (const [key, groupTabs] of map.entries()) {
    if (groupTabs.length < 2) continue;

    groupTabs.sort((a, b) => {
      const wA = windowMeta.get(a.windowId)?.order ?? 9999;
      const wB = windowMeta.get(b.windowId)?.order ?? 9999;
      if (wA !== wB) return wA - wB;
      return a.index - b.index;
    });

    groups.push({ key, tabs: groupTabs });
  }

  groups.sort((a, b) => {
    const firstA = a.tabs[0];
    const firstB = b.tabs[0];
    const wA = windowMeta.get(firstA.windowId)?.order ?? 9999;
    const wB = windowMeta.get(firstB.windowId)?.order ?? 9999;
    if (wA !== wB) return wA - wB;
    return firstA.index - firstB.index;
  });

  return groups;
}

function pickProtectedTabId(groupTabs) {
  const selfMatch = groupTabs.find((t) => t.id === selfTabId);
  if (selfMatch) return selfMatch.id;
  const pinned = groupTabs.find((t) => t.pinned);
  if (pinned) return pinned.id;
  const audible = groupTabs.find((t) => t.audible);
  if (audible) return audible.id;
  return groupTabs[0].id;
}

function render() {
  const groups = getDuplicateGroups();
  const extraCount = groups.reduce((acc, g) => acc + (g.tabs.length - 1), 0);
  const matchedTotal = groups.reduce((acc, g) => acc + g.tabs.length, 0);

  if (groups.length === 0) {
    summaryEl.textContent = `0 duplicates across ${allTabs.length} open tabs`;
    contentEl.innerHTML = `
      <div class="empty-state">
        <h2>No duplicate tabs found</h2>
        <p>Try switching to a broader URL level (Path or Domain) if you want to group related pages.</p>
      </div>
    `;
    return;
  }

  summaryEl.textContent = `${groups.length} ${groups.length === 1 ? 'group' : 'groups'} · ${extraCount} extra ${extraCount === 1 ? 'tab' : 'tabs'} (${matchedTotal} matching of ${allTabs.length} open)`;

  const frag = document.createDocumentFragment();

  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'group';

    const protectedId = pickProtectedTabId(group.tabs);
    const closableTabs = group.tabs.filter((t) => t.id !== protectedId && !t.pinned && t.id !== selfTabId);

    const header = document.createElement('div');
    header.className = 'group-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'group-title-wrap';

    const keyEl = document.createElement('span');
    keyEl.className = 'group-key';
    keyEl.textContent = group.key;
    keyEl.title = group.key;

    const countEl = document.createElement('span');
    countEl.className = 'group-count';
    countEl.textContent = `${group.tabs.length} tabs`;

    titleWrap.append(keyEl, countEl);
    header.appendChild(titleWrap);

    if (closableTabs.length > 0) {
      const bulkBtn = document.createElement('button');
      bulkBtn.type = 'button';
      bulkBtn.className = 'close-extra-btn';
      bulkBtn.textContent = `Close ${closableTabs.length} Extra`;
      bulkBtn.addEventListener('click', async () => {
        await closeTabsByIds(closableTabs.map((t) => t.id));
      });
      header.appendChild(bulkBtn);
    }

    const grid = document.createElement('div');
    grid.className = 'grid';

    for (const tab of group.tabs) {
      const card = document.createElement('article');
      card.className = 'card';
      card.title = `${tab.title || 'Untitled'}\n${tab.url || ''}`;

      card.addEventListener('click', async () => {
        try {
          await chrome.windows.update(tab.windowId, { focused: true });
          await chrome.tabs.update(tab.id, { active: true });
        } catch {
          await refreshState();
        }
      });

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'thumb-wrap';

      const cachedImg = previewCache.get(getPreviewKey(tab));
      if (cachedImg) {
        const img = document.createElement('img');
        img.className = 'thumb-img';
        img.src = cachedImg;
        img.alt = '';
        thumbWrap.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'thumb-placeholder';
        if (!isCapturableUrl(tab.url)) {
          placeholder.textContent = 'System Page';
        } else if (tab.discarded) {
          placeholder.textContent = 'Sleeping Tab';
        } else {
          placeholder.textContent = 'No Preview';
        }
        thumbWrap.appendChild(placeholder);
      }

      const overlay = document.createElement('div');
      overlay.className = 'thumb-overlay';

      const overlayLeft = document.createElement('div');
      overlayLeft.className = 'overlay-left';

      const winPill = document.createElement('span');
      winPill.className = 'win-pill';
      winPill.textContent = getWindowDisplayLabel(tab.windowId);
      winPill.title = 'Click to rename this window';
      winPill.addEventListener('click', async (e) => {
        e.stopPropagation();
        const currentCustom = customWindowNames[String(tab.windowId)] || '';
        const entered = window.prompt('Custom label for this window (leave empty to reset):', currentCustom);
        if (entered === null) return;
        const trimmed = entered.trim();
        if (trimmed) {
          customWindowNames[String(tab.windowId)] = trimmed;
        } else {
          delete customWindowNames[String(tab.windowId)];
        }
        await chrome.storage.local.set({ customWindowNames });
        render();
      });

      overlayLeft.appendChild(winPill);

      if (tab.id === selfTabId) {
        const tag = document.createElement('span');
        tag.className = 'state-tag';
        tag.textContent = 'Current';
        overlayLeft.appendChild(tag);
      } else if (tab.pinned) {
        const tag = document.createElement('span');
        tag.className = 'state-tag';
        tag.textContent = 'Pinned';
        overlayLeft.appendChild(tag);
      } else if (tab.audible) {
        const tag = document.createElement('span');
        tag.className = 'state-tag';
        tag.textContent = 'Audio';
        overlayLeft.appendChild(tag);
      }

      overlay.appendChild(overlayLeft);

      if (tab.id !== selfTabId) {
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'close-card-btn';
        closeBtn.textContent = '×';
        closeBtn.title = 'Close this tab';
        closeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await closeTabsByIds([tab.id]);
        });
        overlay.appendChild(closeBtn);
      }

      thumbWrap.appendChild(overlay);

      const body = document.createElement('div');
      body.className = 'card-body';

      const titleLine = document.createElement('div');
      titleLine.className = 'title-line';

      if (tab.favIconUrl && (tab.favIconUrl.startsWith('http') || tab.favIconUrl.startsWith('data:'))) {
        const fav = document.createElement('img');
        fav.className = 'favicon';
        fav.src = tab.favIconUrl;
        fav.alt = '';
        fav.onerror = () => fav.remove();
        titleLine.appendChild(fav);
      }

      const titleEl = document.createElement('div');
      titleEl.className = 'card-title';
      titleEl.textContent = tab.title || 'Untitled';
      titleLine.appendChild(titleEl);

      const urlEl = document.createElement('div');
      urlEl.className = 'card-url';
      urlEl.textContent = tab.url || '';

      body.append(titleLine, urlEl);
      card.append(thumbWrap, body);
      grid.appendChild(card);
    }

    section.append(header, grid);
    frag.appendChild(section);
  }

  contentEl.innerHTML = '';
  contentEl.appendChild(frag);
}

async function closeTabsByIds(ids) {
  if (!ids.length) return;
  try {
    await chrome.tabs.remove(ids);
  } catch {
    // Ignore already closed tabs
  }
  const idSet = new Set(ids);
  allTabs = allTabs.filter((t) => !idSet.has(t.id));
  render();
  await refreshState();
}

async function refreshState() {
  const [windows, tabs, currentTab] = await Promise.all([
    chrome.windows.getAll({ populate: false }),
    chrome.tabs.query({}),
    chrome.tabs.getCurrent()
  ]);

  if (currentTab) {
    selfTabId = currentTab.id;
    selfWindowId = currentTab.windowId;
  }

  allTabs = tabs;
  windowMeta = buildWindowMetadata(windows, tabs);

  const validKeys = new Set(tabs.map((t) => getPreviewKey(t)));
  for (const key of previewCache.keys()) {
    if (!validKeys.has(key)) {
      previewCache.delete(key);
    }
  }

  render();
}

async function captureVisibleWithRetry(windowId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
        format: 'jpeg',
        quality: 68
      });
      if (dataUrl) return dataUrl;
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (msg.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')) {
        await sleep(550);
        continue;
      }
      await sleep(160);
    }
  }
  return null;
}

async function captureAllPreviews() {
  if (isCapturing) return;

  const groups = getDuplicateGroups();
  const candidates = [];
  const seenTabIds = new Set();

  for (const g of groups) {
    for (const t of g.tabs) {
      if (seenTabIds.has(t.id)) continue;
      seenTabIds.add(t.id);
      if (t.id === selfTabId) continue;
      if (!isCapturableUrl(t.url)) continue;
      if (t.discarded) continue;
      if (previewCache.has(getPreviewKey(t))) continue;
      candidates.push(t);
    }
  }

  if (candidates.length === 0) {
    captureBtn.textContent = 'Previews Ready';
    await sleep(900);
    captureBtn.textContent = 'Capture Previews';
    return;
  }

  isCapturing = true;
  captureBtn.disabled = true;

  // Group candidates strictly by window order so each window is focused once
  const byWindow = new Map();
  for (const tab of candidates) {
    if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
    byWindow.get(tab.windowId).push(tab);
  }

  const orderedWindowIds = Array.from(byWindow.keys()).sort((a, b) => {
    // Capture other windows first, then finish in the inspector's own window
    if (a === selfWindowId) return 1;
    if (b === selfWindowId) return -1;
    const wA = windowMeta.get(a)?.order ?? 9999;
    const wB = windowMeta.get(b)?.order ?? 9999;
    return wA - wB;
  });

  let completed = 0;
  const total = candidates.length;

  try {
    for (const winId of orderedWindowIds) {
      let winInfo;
      try {
        winInfo = await chrome.windows.get(winId);
      } catch {
        continue;
      }

      // Skip minimized windows so we don't forcibly unminimize user's minimized workspace
      if (winInfo.state === 'minimized') {
        completed += byWindow.get(winId).length;
        continue;
      }

      const [originalActive] = await chrome.tabs.query({ windowId: winId, active: true });
      const winTabs = byWindow.get(winId).sort((a, b) => a.index - b.index);

      try {
        await chrome.windows.update(winId, { focused: true });
        await sleep(140);
      } catch {
        continue;
      }

      for (const tab of winTabs) {
        completed += 1;
        captureBtn.textContent = `Capturing ${completed}/${total}...`;

        try {
          await chrome.tabs.update(tab.id, { active: true });
          await nextFrames();
          await sleep(160);

          const freshTab = await chrome.tabs.get(tab.id);
          if (freshTab.status === 'loading') {
            await sleep(300);
          }

          const dataUrl = await captureVisibleWithRetry(winId);
          if (dataUrl) {
            previewCache.set(getPreviewKey(freshTab), dataUrl);
          }
        } catch {
          // Tab may have closed during capture
        }
      }

      if (originalActive && originalActive.id !== selfTabId) {
        try {
          await chrome.tabs.update(originalActive.id, { active: true });
        } catch {
          // Ignore if original tab closed
        }
      }
    }
  } finally {
    if (selfWindowId !== null) {
      try {
        await chrome.windows.update(selfWindowId, { focused: true });
      } catch {}
    }
    if (selfTabId !== null) {
      try {
        await chrome.tabs.update(selfTabId, { active: true });
      } catch {}
    }

    isCapturing = false;
    captureBtn.disabled = false;
    captureBtn.textContent = 'Capture Previews';
    await refreshState();
  }
}

document.querySelectorAll('.seg-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentLevel = btn.dataset.level;
    render();
  });
});

captureBtn.addEventListener('click', captureAllPreviews);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !isCapturing) {
    refreshState();
  }
});

(async function init() {
  const manifestData = chrome.runtime.getManifest();
  if (manifestData?.version) {
    versionBadge.textContent = `v${manifestData.version}`;
  }

  const stored = await chrome.storage.local.get(['customWindowNames']);
  if (stored?.customWindowNames && typeof stored.customWindowNames === 'object') {
    customWindowNames = stored.customWindowNames;
  }

  await refreshState();
})();
