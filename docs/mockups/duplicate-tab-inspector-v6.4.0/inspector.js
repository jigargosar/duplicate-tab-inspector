const state = {
  mode: 'exact',
  tabs: [],
  windowsMeta: new Map(),
  windowAliases: {},
  previews: new Map(),
  selfTabId: null,
  isCapturing: false
};

const groupsContainer = document.getElementById('groupsContainer');
const summaryText = document.getElementById('summaryText');
const emptyState = document.getElementById('emptyState');
const captureBtn = document.getElementById('captureBtn');
const versionBadge = document.getElementById('versionBadge');

function initVersion() {
  const manifest = chrome.runtime.getManifest();
  if (manifest && manifest.version) {
    versionBadge.textContent = `v${manifest.version}`;
  }
}

async function loadAliases() {
  try {
    const data = await chrome.storage.local.get('windowAliases');
    state.windowAliases = data.windowAliases || {};
  } catch {
    state.windowAliases = {};
  }
}

async function saveAlias(winId, label) {
  const clean = label.trim();
  if (clean) {
    state.windowAliases[String(winId)] = clean;
  } else {
    delete state.windowAliases[String(winId)];
  }
  await chrome.storage.local.set({ windowAliases: state.windowAliases });
}

function getDomain(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return u.hostname.replace(/^www\./, '');
    }
    return u.protocol.replace(':', '');
  } catch {
    return '';
  }
}

function isRestrictedUrl(urlStr) {
  if (!urlStr) return true;
  return /^(chrome|edge|about|brave|opera|vivaldi|devtools|view-source|chrome-extension):/i.test(urlStr) ||
    /^https:\/\/chromewebstore\.google\.com/i.test(urlStr) ||
    /^https:\/\/chrome\.google\.com\/webstore/i.test(urlStr);
}

function normalizeUrl(urlStr, mode) {
  if (!urlStr) return '';
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      if (mode === 'domain') return `${u.protocol}//${u.hostname}`;
      if (mode === 'path' || mode === 'no-hash') return `${u.protocol}//${u.hostname}${u.pathname}`;
      return urlStr;
    }

    const host = u.hostname.toLowerCase();
    const port = u.port ? `:${u.port}` : '';
    const origin = `${u.protocol}//${host}${port}`;

    if (mode === 'domain') {
      return host;
    }

    const cleanPath = u.pathname.replace(/\/+$/, '') || '/';
    if (mode === 'path') {
      return `${origin}${cleanPath}`;
    }

    const params = Array.from(u.searchParams.entries()).sort((a, b) => {
      if (a[0] === b[0]) return a[1].localeCompare(b[1]);
      return a[0].localeCompare(b[0]);
    });
    const sortedSearch = params.length
      ? '?' + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
      : '';

    if (mode === 'no-hash') {
      return `${origin}${cleanPath}${sortedSearch}`;
    }

    return `${origin}${cleanPath}${sortedSearch}${u.hash}`;
  } catch {
    return urlStr;
  }
}

function formatGroupLabel(key, mode) {
  if (mode === 'domain') return key;
  return key.replace(/^https?:\/\/(www\.)?/i, '');
}

async function refreshTabsAndWindows() {
  const [currentTab, windows, allTabs] = await Promise.all([
    chrome.tabs.getCurrent(),
    chrome.windows.getAll({ populate: false }),
    chrome.tabs.query({})
  ]);

  state.selfTabId = currentTab ? currentTab.id : null;
  const currentWinId = currentTab ? currentTab.windowId : null;

  // Deterministic window ordering: current window first, then ascending window ID
  const sortedWindows = [...windows].sort((a, b) => {
    if (a.id === currentWinId) return -1;
    if (b.id === currentWinId) return 1;
    return a.id - b.id;
  });

  const winOrderMap = new Map();
  sortedWindows.forEach((w, idx) => winOrderMap.set(w.id, idx + 1));

  // Group tabs by window to compute stable window summaries (dominant domain + tab count)
  const tabsByWin = new Map();
  for (const t of allTabs) {
    if (!tabsByWin.has(t.windowId)) tabsByWin.set(t.windowId, []);
    tabsByWin.get(t.windowId).push(t);
  }

  const windowsMeta = new Map();
  for (const w of sortedWindows) {
    const wTabs = tabsByWin.get(w.id) || [];
    const domainCounts = new Map();
    for (const t of wTabs) {
      const d = getDomain(t.url);
      if (d && d !== 'chrome' && d !== 'chrome-extension') {
        domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
      }
    }
    let topDomain = '';
    let topCount = 0;
    for (const [d, c] of domainCounts.entries()) {
      if (c > topCount) {
        topDomain = d;
        topCount = c;
      }
    }

    windowsMeta.set(w.id, {
      id: w.id,
      order: winOrderMap.get(w.id) || 1,
      isCurrent: w.id === currentWinId,
      incognito: Boolean(w.incognito),
      tabCount: wTabs.length,
      topDomain
    });
  }

  // Prune stale preview entries whose URL changed or tab closed
  const liveKeys = new Set(allTabs.map(t => `${t.id}::${t.url}`));
  for (const k of state.previews.keys()) {
    if (!liveKeys.has(k)) {
      state.previews.delete(k);
    }
  }

  // Sort tabs deterministically by window order, then tab index left-to-right
  const sortedTabs = [...allTabs].sort((a, b) => {
    const wa = winOrderMap.get(a.windowId) ?? 999;
    const wb = winOrderMap.get(b.windowId) ?? 999;
    if (wa !== wb) return wa - wb;
    return a.index - b.index;
  });

  state.windowsMeta = windowsMeta;
  state.tabs = sortedTabs;
  render();
}

function getDuplicateGroups() {
  const map = new Map();
  for (const tab of state.tabs) {
    if (!tab.url) continue;
    const key = normalizeUrl(tab.url, state.mode);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(tab);
  }

  const groups = [];
  for (const [key, items] of map.entries()) {
    if (items.length > 1) {
      groups.push({ key, tabs: items });
    }
  }
  return groups;
}

function getProtectedTabId(groupTabs) {
  const selfMatch = groupTabs.find(t => t.id === state.selfTabId);
  if (selfMatch) return selfMatch.id;
  const pinned = groupTabs.find(t => t.pinned);
  if (pinned) return pinned.id;
  const audible = groupTabs.find(t => t.audible);
  if (audible) return audible.id;
  return groupTabs[0].id;
}

function buildWindowLabel(winId) {
  const meta = state.windowsMeta.get(winId);
  if (!meta) return 'Win';
  const alias = state.windowAliases[String(winId)];
  if (alias) {
    return `${alias} · ${meta.tabCount} tabs`;
  }
  const base = `Win ${meta.order}`;
  const parts = [base];
  if (meta.incognito) parts.push('Private');
  parts.push(`${meta.tabCount} tabs`);
  if (meta.topDomain) parts.push(meta.topDomain);
  return parts.join(' · ');
}

function render() {
  const groups = getDuplicateGroups();
  const totalOpen = state.tabs.length;
  const matchingTabs = groups.reduce((acc, g) => acc + g.tabs.length, 0);
  const extraTabs = matchingTabs - groups.length;

  summaryText.textContent = `${groups.length} ${groups.length === 1 ? 'group' : 'groups'} · ${extraTabs} extra ${extraTabs === 1 ? 'tab' : 'tabs'} (${matchingTabs} matching of ${totalOpen} open)`;

  groupsContainer.innerHTML = '';

  if (groups.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'group-section';

    const header = document.createElement('div');
    header.className = 'group-header';

    const meta = document.createElement('div');
    meta.className = 'group-meta';

    const keyEl = document.createElement('span');
    keyEl.className = 'group-key';
    keyEl.textContent = formatGroupLabel(group.key, state.mode);
    keyEl.title = group.key;

    const countEl = document.createElement('span');
    countEl.className = 'group-count';
    countEl.textContent = `${group.tabs.length} tabs`;

    meta.append(keyEl, countEl);

    const protectedId = getProtectedTabId(group.tabs);
    const closableTabs = group.tabs.filter(t => t.id !== protectedId && t.id !== state.selfTabId);

    header.appendChild(meta);

    if (closableTabs.length > 0) {
      const bulkBtn = document.createElement('button');
      bulkBtn.type = 'button';
      bulkBtn.className = 'bulk-close-btn';
      bulkBtn.textContent = `Close ${closableTabs.length} Extra`;
      bulkBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await closeTabs(closableTabs.map(t => t.id));
      });
      header.appendChild(bulkBtn);
    }

    const grid = document.createElement('div');
    grid.className = 'cards-grid';

    for (const tab of group.tabs) {
      const card = document.createElement('article');
      card.className = 'tab-card';
      card.title = `${tab.title || 'Untitled'}
${tab.url}`;

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'thumb-wrap';

      const previewKey = `${tab.id}::${tab.url}`;
      const previewUrl = state.previews.get(previewKey);

      if (previewUrl) {
        const img = document.createElement('img');
        img.className = 'thumb-img';
        img.src = previewUrl;
        img.alt = '';
        thumbWrap.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'thumb-placeholder';
        if (isRestrictedUrl(tab.url)) {
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

      const winPill = document.createElement('span');
      winPill.className = 'win-pill';
      winPill.textContent = buildWindowLabel(tab.windowId);
      winPill.title = 'Click to rename this window label';

      const flags = [];
      if (tab.id === state.selfTabId) flags.push('Current');
      if (tab.pinned) flags.push('Pinned');
      if (tab.audible) flags.push('Audio');
      if (flags.length > 0) {
        const tag = document.createElement('span');
        tag.className = 'status-tag';
        tag.textContent = `· ${flags.join(' · ')}`;
        winPill.appendChild(tag);
      }

      winPill.addEventListener('click', async (e) => {
        e.stopPropagation();
        const currentAlias = state.windowAliases[String(tab.windowId)] || '';
        const next = window.prompt('Custom label for this window (leave blank to reset):', currentAlias);
        if (next !== null) {
          await saveAlias(tab.windowId, next);
          render();
        }
      });

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'close-btn';
      closeBtn.textContent = '×';
      closeBtn.title = 'Close tab';
      closeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await closeTabs([tab.id]);
      });

      overlay.append(winPill, closeBtn);
      thumbWrap.appendChild(overlay);

      const body = document.createElement('div');
      body.className = 'card-body';

      const titleLine = document.createElement('div');
      titleLine.className = 'title-line';

      if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) {
        const fav = document.createElement('img');
        fav.className = 'favicon';
        fav.src = tab.favIconUrl;
        fav.alt = '';
        fav.onerror = () => fav.remove();
        titleLine.appendChild(fav);
      }

      const titleEl = document.createElement('div');
      titleEl.className = 'card-title';
      titleEl.textContent = tab.title || tab.url;

      titleLine.appendChild(titleEl);

      const urlEl = document.createElement('div');
      urlEl.className = 'card-url';
      urlEl.textContent = tab.url;

      body.append(titleLine, urlEl);
      card.append(thumbWrap, body);

      card.addEventListener('click', async () => {
        try {
          await chrome.windows.update(tab.windowId, { focused: true });
          await chrome.tabs.update(tab.id, { active: true });
        } catch {
          await refreshTabsAndWindows();
        }
      });

      grid.appendChild(card);
    }

    section.append(header, grid);
    groupsContainer.appendChild(section);
  }
}

async function closeTabs(tabIds) {
  if (!tabIds.length) return;
  try {
    await chrome.tabs.remove(tabIds);
  } catch {
    // Ignore already-closed tabs
  }
  const removedSet = new Set(tabIds);
  state.tabs = state.tabs.filter(t => !removedSet.has(t.id));
  render();
}

function waitPaint() {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

async function captureAllPreviews() {
  if (state.isCapturing) return;
  const groups = getDuplicateGroups();
  const candidates = [];
  const seen = new Set();

  for (const g of groups) {
    for (const t of g.tabs) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      if (t.id === state.selfTabId) continue;
      if (isRestrictedUrl(t.url) || t.discarded) continue;
      candidates.push(t);
    }
  }

  if (candidates.length === 0) return;

  state.isCapturing = true;
  const originalText = captureBtn.textContent;
  captureBtn.disabled = true;

  const currentTab = await chrome.tabs.getCurrent();
  const originWinId = currentTab ? currentTab.windowId : null;
  const originTabId = currentTab ? currentTab.id : null;

  try {
    for (let i = 0; i < candidates.length; i++) {
      const target = candidates[i];
      captureBtn.textContent = `Capturing ${i + 1}/${candidates.length}...`;
      try {
        await chrome.windows.update(target.windowId, { focused: true });
        await chrome.tabs.update(target.id, { active: true });
        await waitPaint();
        await new Promise(r => setTimeout(r, 90));
        const dataUrl = await chrome.tabs.captureVisibleTab(target.windowId, {
          format: 'jpeg',
          quality: 72
        });
        if (dataUrl) {
          state.previews.set(`${target.id}::${target.url}`, dataUrl);
        }
      } catch {
        // Skip tabs that cannot be captured
      }
    }
  } finally {
    if (originWinId !== null && originTabId !== null) {
      try {
        await chrome.windows.update(originWinId, { focused: true });
        await chrome.tabs.update(originTabId, { active: true });
      } catch {
        // Ignore
      }
    }
    state.isCapturing = false;
    captureBtn.disabled = false;
    captureBtn.textContent = originalText;
    render();
  }
}

document.querySelectorAll('.seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.mode = btn.dataset.mode;
    render();
  });
});

captureBtn.addEventListener('click', captureAllPreviews);

// Refresh window/tab inventory only when user switches back to this tab (zero background load)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !state.isCapturing) {
    refreshTabsAndWindows();
  }
});

(async () => {
  initVersion();
  await loadAliases();
  await refreshTabsAndWindows();
})();
