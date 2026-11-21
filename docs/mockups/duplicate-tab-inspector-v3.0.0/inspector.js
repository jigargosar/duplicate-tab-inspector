const matchState = {
  domain: true,
  path: true,
  query: true,
  hash: false
};

let snapshots = {};
let windowOrderMap = new Map();

function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return rawUrl;
    }
    let key = u.hostname.toLowerCase();
    if (matchState.path) {
      const cleanPath = u.pathname.replace(/\/+$/, '') || '/';
      key += cleanPath;
    }
    if (matchState.query && u.search) {
      const params = Array.from(u.searchParams.entries()).sort((a, b) =>
        a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])
      );
      const sortedQuery = new URLSearchParams(params).toString();
      if (sortedQuery) key += '?' + sortedQuery;
    }
    if (matchState.hash && u.hash) {
      key += u.hash;
    }
    return key;
  } catch (_) {
    return rawUrl;
  }
}

function getHostname(rawUrl) {
  try {
    return new URL(rawUrl).hostname;
  } catch (_) {
    return 'Browser Page';
  }
}

async function fetchSnapshots() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_SNAPSHOTS' });
    if (res && typeof res === 'object') {
      snapshots = res;
    }
  } catch (_) {}
}

async function focusTab(tab) {
  try {
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
  } catch (_) {}
}

async function closeTabs(tabIds) {
  if (!tabIds.length) return;
  try {
    await chrome.tabs.remove(tabIds);
  } catch (_) {}
  await render();
}

async function captureSingleTab(tabId, btnEl) {
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = 'Capturing...';
  }
  try {
    const res = await chrome.runtime.sendMessage({ type: 'CAPTURE_TAB', tabId });
    if (res && res.ok && res.dataUrl) {
      snapshots[String(tabId)] = res.dataUrl;
    }
  } catch (_) {}
  await render();
}

async function render() {
  const selfUrl = chrome.runtime.getURL('inspector.html');
  const allTabs = await chrome.tabs.query({});
  const candidateTabs = allTabs.filter((t) => t.url && t.url !== selfUrl);

  windowOrderMap = new Map();
  let winCounter = 1;
  for (const t of candidateTabs) {
    if (!windowOrderMap.has(t.windowId)) {
      windowOrderMap.set(t.windowId, winCounter++);
    }
  }

  const groups = new Map();
  for (const tab of candidateTabs) {
    const key = normalizeUrl(tab.url);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tab);
  }

  const duplicateGroups = Array.from(groups.entries())
    .filter(([, tabs]) => tabs.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  const totalExtra = duplicateGroups.reduce((acc, [, tabs]) => acc + (tabs.length - 1), 0);
  const statsEl = document.getElementById('summary-stats');
  statsEl.textContent = `${duplicateGroups.length} group${duplicateGroups.length === 1 ? '' : 's'} · ${totalExtra} extra tab${totalExtra === 1 ? '' : 's'}`;

  const container = document.getElementById('groups-container');
  const emptyEl = document.getElementById('empty-state');
  container.innerHTML = '';

  if (duplicateGroups.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }
  emptyEl.classList.add('hidden');

  for (const [key, tabs] of duplicateGroups) {
    const section = document.createElement('section');
    section.className = 'group-section';

    const header = document.createElement('div');
    header.className = 'group-header';

    const titleArea = document.createElement('div');
    titleArea.className = 'group-title-area';

    const countBadge = document.createElement('span');
    countBadge.className = 'group-count-badge';
    countBadge.textContent = `${tabs.length} tabs`;

    const keyText = document.createElement('span');
    keyText.className = 'group-key';
    keyText.textContent = key;
    keyText.title = key;

    titleArea.append(countBadge, keyText);

    const actions = document.createElement('div');
    actions.className = 'group-actions';

    const closeExtrasBtn = document.createElement('button');
    closeExtrasBtn.type = 'button';
    closeExtrasBtn.className = 'btn-close-dups';
    closeExtrasBtn.textContent = `Close ${tabs.length - 1} Extra`;
    closeExtrasBtn.addEventListener('click', () => {
      const toClose = tabs.slice(1).map((t) => t.id);
      closeTabs(toClose);
    });

    actions.append(closeExtrasBtn);
    header.append(titleArea, actions);

    const grid = document.createElement('div');
    grid.className = 'cards-grid';

    tabs.forEach((tab, idx) => {
      const card = document.createElement('article');
      card.className = 'tab-card' + (idx === 0 ? ' is-primary' : '');

      const previewBox = document.createElement('div');
      previewBox.className = 'preview-box';
      previewBox.title = 'Click to jump to this tab';
      previewBox.addEventListener('click', () => focusTab(tab));

      const snapUrl = snapshots[String(tab.id)];
      if (snapUrl) {
        const img = document.createElement('img');
        img.src = snapUrl;
        img.alt = tab.title || 'Tab preview';
        previewBox.appendChild(img);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'preview-placeholder';
        if (tab.favIconUrl) {
          const bigIcon = document.createElement('img');
          bigIcon.className = 'big-favicon';
          bigIcon.src = tab.favIconUrl;
          bigIcon.alt = '';
          placeholder.appendChild(bigIcon);
        }
        const dom = document.createElement('div');
        dom.className = 'preview-placeholder-domain';
        dom.textContent = getHostname(tab.url);

        const hint = document.createElement('div');
        hint.className = 'preview-placeholder-hint';
        hint.textContent = tab.discarded ? 'Suspended tab · Click Snapshot below' : 'No snapshot yet · Click Snapshot below';

        placeholder.append(dom, hint);
        previewBox.appendChild(placeholder);
      }

      const badges = document.createElement('div');
      badges.className = 'preview-badges';

      const roleBadge = document.createElement('span');
      roleBadge.className = idx === 0 ? 'badge badge-keep' : 'badge badge-dup';
      roleBadge.textContent = idx === 0 ? 'Keep · #1' : `Copy #${idx + 1}`;

      const winBadge = document.createElement('span');
      winBadge.className = 'badge badge-win';
      winBadge.textContent = `Win ${windowOrderMap.get(tab.windowId) || 1}${tab.discarded ? ' · Slept' : ''}`;

      badges.append(roleBadge, winBadge);
      previewBox.appendChild(badges);

      const body = document.createElement('div');
      body.className = 'card-body';

      const titleRow = document.createElement('div');
      titleRow.className = 'card-title-row';

      if (tab.favIconUrl) {
        const fav = document.createElement('img');
        fav.className = 'card-favicon';
        fav.src = tab.favIconUrl;
        fav.alt = '';
        titleRow.appendChild(fav);
      }

      const titleEl = document.createElement('h3');
      titleEl.className = 'card-title';
      titleEl.textContent = tab.title || tab.url;
      titleEl.title = tab.title || tab.url;
      titleEl.addEventListener('click', () => focusTab(tab));
      titleRow.appendChild(titleEl);

      const urlEl = document.createElement('div');
      urlEl.className = 'card-url';
      urlEl.textContent = tab.url;

      body.append(titleRow, urlEl);

      const footer = document.createElement('div');
      footer.className = 'card-footer';

      const snapBtn = document.createElement('button');
      snapBtn.type = 'button';
      snapBtn.className = 'btn-card';
      snapBtn.textContent = snapUrl ? 'Re-snap' : 'Snapshot';
      snapBtn.title = 'Capture a live visual snapshot of this tab';
      snapBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        captureSingleTab(tab.id, snapBtn);
      });

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn-card-danger';
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTabs([tab.id]);
      });

      footer.append(snapBtn, closeBtn);
      card.append(previewBox, body, footer);
      grid.appendChild(card);
    });

    section.append(header, grid);
    container.appendChild(section);
  }
}

document.querySelectorAll('.pill[data-level]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const level = btn.dataset.level;
    if (level === 'domain') return;
    matchState[level] = !matchState[level];
    btn.classList.toggle('active', matchState[level]);
    render();
  });
});

document.getElementById('refresh-btn').addEventListener('click', async () => {
  await fetchSnapshots();
  await render();
});

document.getElementById('capture-all-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Capturing...';
  try {
    const selfUrl = chrome.runtime.getURL('inspector.html');
    const allTabs = await chrome.tabs.query({});
    const candidateTabs = allTabs.filter(
      (t) => t.url && t.url !== selfUrl && (t.url.startsWith('http://') || t.url.startsWith('https://'))
    );
    const groups = new Map();
    for (const tab of candidateTabs) {
      const key = normalizeUrl(tab.url);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(tab);
    }
    const dupTabs = Array.from(groups.values())
      .filter((tabs) => tabs.length > 1)
      .flat();

    for (const tab of dupTabs) {
      if (!snapshots[String(tab.id)]) {
        const res = await chrome.runtime.sendMessage({ type: 'CAPTURE_TAB', tabId: tab.id });
        if (res && res.ok && res.dataUrl) {
          snapshots[String(tab.id)] = res.dataUrl;
        }
      }
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Capture Previews';
    await render();
  }
});

chrome.tabs.onRemoved.addListener(() => render());
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === 'complete' || info.title || info.url) {
    render();
  }
});

(async () => {
  await fetchSnapshots();
  await render();
})();
