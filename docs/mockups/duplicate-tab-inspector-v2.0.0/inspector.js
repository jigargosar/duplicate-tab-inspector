const state = {
    path: true,
    query: true,
    hash: false,
    allWindows: true
};

const contentEl = document.getElementById('content');
const summaryEl = document.getElementById('summary-stats');
const allWindowsCheckbox = document.getElementById('all-windows');
const refreshBtn = document.getElementById('refresh-btn');
const groupTpl = document.getElementById('group-template');
const cardTpl = document.getElementById('card-template');

const INSPECTOR_URL = chrome.runtime.getURL('inspector.html');

function buildMatchKey(rawUrl) {
    try {
        const u = new URL(rawUrl);
        if (u.protocol === 'chrome:' || u.protocol === 'chrome-extension:' || u.protocol === 'about:') {
            return null;
        }
        let key = u.hostname.toLowerCase();
        if (state.path) {
            const cleanPath = u.pathname.replace(/\/+$/, '') || '/';
            key += cleanPath;
        }
        if (state.query && u.search) {
            const params = new URLSearchParams(u.search);
            const sorted = new URLSearchParams([...params.entries()].sort());
            const qStr = sorted.toString();
            if (qStr) {
                key += '?' + qStr;
            }
        }
        if (state.hash && u.hash) {
            key += u.hash;
        }
        return key;
    } catch {
        return null;
    }
}

function fallbackIcon(hostname) {
    const letter = (hostname || '?')[0].toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="3" fill="#30363d"/><text x="8" y="12" font-size="10" font-family="sans-serif" fill="#e6edf3" text-anchor="middle">${letter}</text></svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

async function closeTabsSafe(tabIds) {
    if (!tabIds || tabIds.length === 0) return;
    try {
        await chrome.tabs.remove(tabIds);
    } catch (err) {
        console.warn('Some tabs were already closed:', err);
    }
    await render();
}

async function focusTabSafe(tab) {
    try {
        await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.tabs.update(tab.id, { active: true });
    } catch (err) {
        console.warn('Could not switch to tab:', err);
        await render();
    }
}

async function render() {
    const queryOptions = state.allWindows ? {} : { currentWindow: true };
    const tabs = await chrome.tabs.query(queryOptions);

    const windowIds = [...new Set(tabs.map(t => t.windowId))];
    const windowIndexMap = new Map(windowIds.map((id, idx) => [id, idx + 1]));

    const groups = new Map();
    for (const tab of tabs) {
        if (!tab.url || tab.url.startsWith(INSPECTOR_URL)) continue;
        const key = buildMatchKey(tab.url);
        if (!key) continue;
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(tab);
    }

    const dupGroups = [...groups.entries()]
        .filter(([, list]) => list.length > 1)
        .sort((a, b) => b[1].length - a[1].length);

    const totalDupTabs = dupGroups.reduce((sum, [, list]) => sum + list.length, 0);
    const removableCount = dupGroups.reduce((sum, [, list]) => sum + (list.length - 1), 0);

    summaryEl.textContent = dupGroups.length === 0
        ? '0 duplicates found'
        : `${dupGroups.length} groups · ${totalDupTabs} tabs (${removableCount} extra)`;

    contentEl.innerHTML = '';

    if (dupGroups.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = '<h2>No duplicate tabs at this match level</h2><p>Try turning off Query or Path filters above to group by broader URL levels.</p>';
        contentEl.appendChild(empty);
        return;
    }

    for (const [key, list] of dupGroups) {
        const groupFrag = groupTpl.content.cloneNode(true);
        const groupEl = groupFrag.querySelector('.dup-group');
        groupEl.querySelector('.group-count').textContent = `${list.length} tabs`;
        const keyEl = groupEl.querySelector('.group-key');
        keyEl.textContent = key;
        keyEl.title = key;

        const keepOneBtn = groupEl.querySelector('.keep-one-btn');
        keepOneBtn.addEventListener('click', () => {
            const extraIds = list.slice(1).map(t => t.id);
            closeTabsSafe(extraIds);
        });

        const gridEl = groupEl.querySelector('.cards-grid');

        list.forEach((tab, idx) => {
            const cardFrag = cardTpl.content.cloneNode(true);
            const cardEl = cardFrag.querySelector('.tab-card');
            if (idx === 0) {
                cardEl.classList.add('is-primary');
            }

            let hostname = '';
            try {
                hostname = new URL(tab.url).hostname;
            } catch {}

            const iconEl = cardEl.querySelector('.favicon');
            iconEl.src = tab.favIconUrl || fallbackIcon(hostname);
            iconEl.onerror = () => {
                iconEl.src = fallbackIcon(hostname);
            };

            cardEl.querySelector('.window-badge').textContent = `Win ${windowIndexMap.get(tab.windowId) || 1}`;

            const statusEl = cardEl.querySelector('.status-badge');
            if (idx === 0) {
                statusEl.textContent = 'First Copy';
                statusEl.classList.add('keep');
            } else if (tab.discarded) {
                statusEl.textContent = 'Suspended';
                statusEl.classList.add('discarded');
            } else {
                statusEl.textContent = `Copy #${idx + 1}`;
            }

            cardEl.querySelector('.preview-domain').textContent = hostname || 'Tab';
            cardEl.querySelector('.preview-title').textContent = tab.title || '(Untitled Tab)';
            cardEl.querySelector('.full-url').textContent = tab.url;

            cardEl.querySelector('.focus-btn').addEventListener('click', () => focusTabSafe(tab));
            cardEl.querySelector('.close-btn').addEventListener('click', () => closeTabsSafe([tab.id]));

            gridEl.appendChild(cardFrag);
        });

        contentEl.appendChild(groupFrag);
    }
}

document.querySelectorAll('.pill[data-level]').forEach((btn) => {
    const level = btn.dataset.level;
    if (level === 'domain') return;
    btn.addEventListener('click', () => {
        state[level] = !state[level];
        btn.classList.toggle('active', state[level]);
        render();
    });
});

allWindowsCheckbox.addEventListener('change', () => {
    state.allWindows = allWindowsCheckbox.checked;
    render();
});

refreshBtn.addEventListener('click', render);

chrome.tabs.onRemoved.addListener(() => render());
chrome.tabs.onUpdated.addListener((_id, changeInfo) => {
    if (changeInfo.url || changeInfo.title) {
        render();
    }
});

render();
