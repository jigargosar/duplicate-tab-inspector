const state = {
  mode: 'exact',
  tabs: [],
  windows: [],
  windowAliases: {},
  screenshots: new Map(), // key: `${tab.id}::${tab.url}` -> dataUrl
  isCapturing: false,
  selfTabId: null,
  selfWindowId: null
};

const RESTRICTED_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'about:',
  'view-source:',
  'devtools://',
  'https://chrome.google.com/webstore',
  'https://chromewebstore.google.com'
];

function isRestrictedUrl(url) {
  if (!url) return true;
  return RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function getDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname || parsed.protocol.replace(':', '');
  } catch {
    return 'unknown';
  }
}

function normalizeUrl(rawUrl, mode) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    const isWeb = u.protocol === 'http:' || u.protocol === 'https:';
    if (!isWeb) {
      if (mode === 'domain') return u.protocol + '//' + u.hostname;
      if (mode === 'path') return u.protocol + '//' + u.hostname + u.pathname;
      if (mode === 'no-hash') return u.protocol + '//' + u.hostname + u.pathname + u.search;
      return rawUrl;
    }

    const host = u.hostname.toLowerCase();
    const cleanPath = u.pathname.replace(/\/+$/, '') || '/';

    if (mode === 'domain') {
      return host;
    }
    if (mode === 'path') {
      return host + cleanPath;
    }
    if (mode === 'no-hash') {
      const params = Array.from(u.searchParams.entries()).sort((a, b) =>
        a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])
      );
      const sortedSearch = params.length
        ? '?' + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
        : '';
      return host + cleanPath + sortedSearch;
    }
    return host + cleanPath + u.search + u.hash;
  } catch {
    return rawUrl;
  }
}

function formatGroupLabel(key) {
  return key.replace(/^www\./, '');
}

function buildWindowMeta(windows, tabs, selfWindowId) {
  const ordered = [...windows].sort((a, b) => {
    if (a.id === selfWindowId) return -1;
    if (b.id === selfWindowId) return 1;
    return a.id - b.id;
  });

  const tabsByWin = new Map();
  for (const t of tabs) {
    if (!tabsByWin.has(t.windowId)) tabsByWin.set(t.windowId, []);
    tabsByWin.get(t.windowId).push(t);
  }

  const meta = new Map();
  ordered.forEach((win, idx) => {
    const winTabs = tabsByWin.get(win.id) || [];
    const domainCounts = new Map();
    for (const t of winTabs) {
      if (!t.url || isRestrictedUrl(t.url)) continue;
      const d = getDomain(t.url).replace(/^www\./, '');
      domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
    }
    let topDomain = '';
    let maxCount = 0;
    for (const [d, count] of domainCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        topDomain = d;
      }
    }

    const customName = state.windowAliases[String(win.id)];
    const baseName = customName ? customName : `Win ${idx + 1}`;
    const details = [`${winTabs.length} tabs`];
    if (topDomain) details.push(topDomain);
    if (win.incognito) details.push('Private');

    meta.set(win.id, {
      order: idx,
      shortLabel: `${baseName} · ${details.join(' · ')}`,
      baseName
    });
  });

  return meta;
}

function computeDuplicateGroups() {
  const windowMeta = buildWindowMeta(state.windows, state.tabs, state.selfWindowId);

  const sortedTabs = [...state.tabs].sort((a, b) => {
    const wa = windowMeta.get(a.windowId)?.order ?? 9999;
    const wb = windowMeta.get(b.windowId)?.order ?? 9999;
    if (wa !== wb) return wa - wb;
    return a.index - b.index;
  });

  const buckets = new Map();
  for (const tab of sortedTabs) {
    const key = normalizeUrl(tab.url, state.mode);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(tab);
  }

  const groups = [];
  for (const [key, groupTabs] of buckets.entries()) {
    if (groupTabs.length > 1) {
      groups.push({ key, tabs: groupTabs });
    }
  }

  return { groups, windowMeta };
}

function pickKeeperTab(groupTabs) {
  const selfTab = groupTabs.find((t) => t.id === state.selfTabId);
  if (selfTab) return selfTab;
  const pinned = groupTabs.find((t) => t.pinned);
  if (pinned) return pinned;
  const audible = groupTabs.find((t) => t.audible);
  if (audible) return audible;
  return groupTabs[0];
}

function getPreviewStatus(tab) {
  const cacheKey = `${tab.id}::${tab.url}`;
  if (state.screenshots.has(cacheKey)) {
    return { type: 'image', src: state.screenshots.get(cacheKey) };
  }
  if (tab.id === state.selfTabId) {
    return { type: 'label', text: 'Current Inspector Tab' };
  }
  if (tab.discarded) {
    return { type: 'label', text: 'Sleeping Tab' };
  }
  if (isRestrictedUrl(tab.url)) {
    return { type: 'label', text: 'System Page' };
  }
  return { type: 'label', text: 'No Preview Yet' };
}

function render() {
  const container = document.getElementById('groups-container');
  const summaryEl = document.getElementById('summary-text');
  const { groups, windowMeta } = computeDuplicateGroups();

  const totalDupTabs = groups.reduce((acc, g) => acc + g.tabs.length, 0);
  const extraTabs = totalDupTabs - groups.length;

  summaryEl.textContent =
    groups.length === 0
      ? `0 duplicate groups across ${state.tabs.length} open tabs`
      : `${groups.length} group${groups.length === 1 ? '' : 's'} · ${extraTabs} extra tab${extraTabs === 1 ? '' : 's'} (${totalDupTabs} matching of ${state.tabs.length} open)`;

  container.innerHTML = '';

  if (groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = `
      <h2>No duplicate tabs at "${state.mode}" level</h2>
      <p>Switch URL matching to a broader level on the right, or continue browsing.</p>
    `;
    container.appendChild(empty);
    return;
  }

  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'group-section';

    const header = document.createElement('div');
    header.className = 'group-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'group-title-wrap';

    const keyEl = document.createElement('span');
    keyEl.className = 'group-key';
    keyEl.textContent = formatGroupLabel(group.key);
    keyEl.title = group.key;

    const countEl = document.createElement('span');
    countEl.className = 'group-count';
    countEl.textContent = `${group.tabs.length} tabs`;

    titleWrap.appendChild(keyEl);
    titleWrap.appendChild(countEl);

    const keeper = pickKeeperTab(group.tabs);
    const closable = group.tabs.filter((t) => t.id !== keeper.id && t.id !== state.selfTabId);

    header.appendChild(titleWrap);

    if (closable.length > 0) {
      const closeExtraBtn = document.createElement('button');
      closeExtraBtn.type = 'button';
      closeExtraBtn.className = 'close-extra-btn';
      closeExtraBtn.textContent = `Close ${closable.length} Extra`;
      closeExtraBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await closeTabsByIds(closable.map((t) => t.id));
      });
      header.appendChild(closeExtraBtn);
    }

    const grid = document.createElement('div');
    grid.className = 'cards-grid';

    for (const tab of group.tabs) {
      const card = document.createElement('article');
      card.className = 'tab-card';

      card.addEventListener('click', async () => {
        try {
          await chrome.windows.update(tab.windowId, { focused: true });
          await chrome.tabs.update(tab.id, { active: true });
        } catch {
          await reloadTabsAndRender();
        }
      });

      const previewBox = document.createElement('div');
      previewBox.className = 'preview-box';

      const previewStatus = getPreviewStatus(tab);
      if (previewStatus.type === 'image') {
        const img = document.createElement('img');
        img.className = 'preview-img';
        img.src = previewStatus.src;
        img.alt = tab.title || 'Tab preview';
        previewBox.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'preview-placeholder';
        ph.textContent = previewStatus.text;
        previewBox.appendChild(ph);
      }

      const overlay = document.createElement('div');
      overlay.className = 'preview-overlay';

      const overlayLeft = document.createElement('div');
      overlayLeft.className = 'overlay-left';

      const winInfo = windowMeta.get(tab.windowId);
      const winPill = document.createElement('span');
      winPill.className = 'win-pill';
      winPill.textContent = winInfo ? winInfo.shortLabel : `Win ${tab.windowId}`;
      winPill.title = 'Click to rename this window label';
      winPill.addEventListener('click', async (e) => {
        e.stopPropagation();
        const current = state.windowAliases[String(tab.windowId)] || '';
        const next = window.prompt('Custom label for this window (leave blank to reset):', current);
        if (next === null) return;
        const trimmed = next.trim();
        if (trimmed) {
          state.windowAliases[String(tab.windowId)] = trimmed;
        } else {
          delete state.windowAliases[String(tab.windowId)];
        }
        await chrome.storage.local.set({ windowAliases: state.windowAliases });
        render();
      });
      overlayLeft.appendChild(winPill);

      if (tab.pinned) {
        const pinTag = document.createElement('span');
        pinTag.className = 'state-tag';
        pinTag.textContent = 'Pinned';
        overlayLeft.appendChild(pinTag);
      }
      if (tab.audible) {
        const audioTag = document.createElement('span');
        audioTag.className = 'state-tag';
        audioTag.textContent = 'Audio';
        overlayLeft.appendChild(audioTag);
      }

      overlay.appendChild(overlayLeft);

      if (tab.id !== state.selfTabId) {
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

      previewBox.appendChild(overlay);

      const meta = document.createElement('div');
      meta.className = 'card-meta';

      const titleLine = document.createElement('div');
      titleLine.className = 'title-line';

      if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) {
        const fav = document.createElement('img');
        fav.className = 'favicon';
        fav.src = tab.favIconUrl;
        fav.alt = '';
        fav.onerror = () => {
          fav.style.display = 'none';
        };
        titleLine.appendChild(fav);
      }

      const titleEl = document.createElement('div');
      titleEl.className = 'tab-title';
      titleEl.textContent = tab.title || tab.url || 'Untitled';
      titleEl.title = tab.title || '';
      titleLine.appendChild(titleEl);

      const urlEl = document.createElement('div');
      urlEl.className = 'tab-url';
      urlEl.textContent = tab.url || '';
      urlEl.title = tab.url || '';

      meta.appendChild(titleLine);
      meta.appendChild(urlEl);

      card.appendChild(previewBox);
      card.appendChild(meta);
      grid.appendChild(card);
    }

    section.appendChild(header);
    section.appendChild(grid);
    container.appendChild(section);
  }
}

async function closeTabsByIds(ids) {
  if (!ids.length) return;
  try {
    await chrome.tabs.remove(ids);
  } catch {
    // Ignore already-closed tabs
  }
  const closedSet = new Set(ids);
  state.tabs = state.tabs.filter((t) => !closedSet.has(t.id));
  for (const key of Array.from(state.screenshots.keys())) {
    const id = Number(key.split('::')[0]);
    if (closedSet.has(id)) {
      state.screenshots.delete(key);
    }
  }
  render();
}

async function reloadTabsAndRender() {
  const [windows, tabs] = await Promise.all([
    chrome.windows.getAll({ populate: false }),
    chrome.tabs.query({})
  ]);
  state.windows = windows;
  state.tabs = tabs;

  const validKeys = new Set(tabs.map((t) => `${t.id}::${t.url}`));
  for (const key of Array.from(state.screenshots.keys())) {
    if (!validKeys.has(key)) {
      state.screenshots.delete(key);
    }
  }

  render();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTabComplete(tabId, timeoutMs = 2500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t.status === 'complete' && !t.discarded) return t;
    } catch {
      return null;
    }
    await sleep(120);
  }
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function captureVisibleSafe(windowId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, {
        format: 'jpeg',
        quality: 68
      });
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (msg.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')) {
        await sleep(650);
      } else {
        await sleep(250);
      }
    }
  }
  return null;
}

async function captureAllPreviews() {
  if (state.isCapturing) return;

  const captureBtn = document.getElementById('capture-btn');
  const { groups } = computeDuplicateGroups();

  const targets = [];
  const seenIds = new Set();
  for (const g of groups) {
    for (const t of g.tabs) {
      if (seenIds.has(t.id)) continue;
      seenIds.add(t.id);
      if (t.id === state.selfTabId) continue;
      if (t.discarded) continue;
      if (isRestrictedUrl(t.url)) continue;
      targets.push(t);
    }
  }

  if (targets.length === 0) {
    captureBtn.textContent = 'Nothing to Capture';
    setTimeout(() => {
      captureBtn.textContent = 'Capture Previews';
    }, 1200);
    return;
  }

  state.isCapturing = true;
  captureBtn.disabled = true;

  // Remember previously active tab per window so we leave windows clean
  const originalActiveByWindow = new Map();
  for (const t of state.tabs) {
    if (t.active) {
      originalActiveByWindow.set(t.windowId, t.id);
    }
  }

  let userInterrupted = false;
  const onFocusChanged = (newWinId) => {
    if (!state.isCapturing) return;
    if (newWinId === chrome.windows.WINDOW_ID_NONE) return;
  };
  chrome.windows.onFocusChanged.addListener(onFocusChanged);

  try {
    for (let i = 0; i < targets.length; i++) {
      if (!state.isCapturing) {
        userInterrupted = true;
        break;
      }

      const target = targets[i];
      captureBtn.textContent = `Capturing ${i + 1}/${targets.length}...`;

      let liveTab;
      try {
        liveTab = await chrome.tabs.get(target.id);
      } catch {
        continue;
      }

      if (liveTab.discarded || isRestrictedUrl(liveTab.url)) {
        continue;
      }

      await chrome.windows.update(liveTab.windowId, { focused: true });
      await chrome.tabs.update(liveTab.id, { active: true });

      const readyTab = await waitForTabComplete(liveTab.id, 1800);
      if (!readyTab || isRestrictedUrl(readyTab.url)) {
        continue;
      }

      // Allow Chrome compositor one frame + rate-limit buffer
      await sleep(550);

      const dataUrl = await captureVisibleSafe(readyTab.windowId);
      if (dataUrl) {
        state.screenshots.set(`${readyTab.id}::${readyTab.url}`, dataUrl);
      }
    }
  } finally {
    chrome.windows.onFocusChanged.removeListener(onFocusChanged);

    // Restore original active tabs in other windows
    for (const [winId, origTabId] of originalActiveByWindow.entries()) {
      if (winId === state.selfWindowId) continue;
      try {
        await chrome.tabs.update(origTabId, { active: true });
      } catch {
        // Ignore closed tabs
      }
    }

    // Return focus to the inspector tab
    if (!userInterrupted && state.selfTabId && state.selfWindowId) {
      try {
        await chrome.windows.update(state.selfWindowId, { focused: true });
        await chrome.tabs.update(state.selfTabId, { active: true });
      } catch {
        // Ignore
      }
    }

    state.isCapturing = false;
    captureBtn.disabled = false;
    captureBtn.textContent = 'Capture Previews';
    await reloadTabsAndRender();
  }
}

async function init() {
  const manifest = chrome.runtime.getManifest();
  document.getElementById('version-badge').textContent = `v${manifest.version}`;

  const currentTab = await chrome.tabs.getCurrent();
  if (currentTab) {
    state.selfTabId = currentTab.id;
    state.selfWindowId = currentTab.windowId;
  }

  const stored = await chrome.storage.local.get(['windowAliases']);
  if (stored.windowAliases && typeof stored.windowAliases === 'object') {
    state.windowAliases = stored.windowAliases;
  }

  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;
      render();
    });
  });

  document.getElementById('capture-btn').addEventListener('click', captureAllPreviews);

  // Refresh only when user switches back to this tab, never during capture
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !state.isCapturing) {
      reloadTabsAndRender();
    }
  });

  await reloadTabsAndRender();
}

init();
