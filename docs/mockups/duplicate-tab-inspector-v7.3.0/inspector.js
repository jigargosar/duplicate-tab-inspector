let currentLevel = 'exact'
let isCapturing = false
let windowAliases = {}
const snapshotCache = new Map()

const groupsContainer = document.getElementById('groupsContainer')
const summaryText = document.getElementById('summaryText')
const captureBtn = document.getElementById('captureBtn')
const versionBadge = document.getElementById('versionBadge')

function initVersionBadge() {
    try {
        const manifest = chrome.runtime.getManifest()
        if (manifest && manifest.version) {
            versionBadge.textContent = `v${manifest.version}`
        }
    } catch (err) {
        // Fallback already in HTML
    }
}

async function loadWindowAliases() {
    try {
        const stored = await chrome.storage.local.get('windowAliases')
        windowAliases = stored.windowAliases || {}
    } catch (err) {
        windowAliases = {}
    }
}

async function saveWindowAlias(winId, label) {
    const key = String(winId)
    const trimmed = label.trim()
    if (trimmed) {
        windowAliases[key] = trimmed
    } else {
        delete windowAliases[key]
    }
    try {
        await chrome.storage.local.set({ windowAliases })
    } catch (err) {
        // Ignore storage error
    }
}

function normalizeKey(rawUrl, level) {
    if (!rawUrl) return ''
    try {
        const u = new URL(rawUrl)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            if (level === 'domain') return `${u.protocol}//${u.hostname}`
            if (level === 'path' || level === 'no-hash') {
                return `${u.protocol}//${u.hostname}${u.pathname}`
            }
            return rawUrl
        }
        const host = u.hostname.replace(/^www\./i, '').toLowerCase()
        if (level === 'domain') {
            return host
        }
        const cleanPath = u.pathname.replace(/\/+$/, '') || '/'
        if (level === 'path') {
            return `${host}${cleanPath}`
        }
        const sortedParams = new URLSearchParams(u.searchParams)
        sortedParams.sort()
        const query = sortedParams.toString()
        const withQuery = query ? `${host}${cleanPath}?${query}` : `${host}${cleanPath}`
        if (level === 'no-hash') {
            return withQuery
        }
        return u.hash ? `${withQuery}${u.hash}` : withQuery
    } catch (err) {
        return rawUrl
    }
}

function isSystemPage(url) {
    if (!url) return true
    return !(
        url.startsWith('http://') ||
        url.startsWith('https://') ||
        url.startsWith('file://')
    )
}

function isProtectedTab(tab, currentInspectorTabId) {
    return Boolean(
        tab.pinned ||
        tab.audible ||
        tab.id === currentInspectorTabId
    )
}

async function scanAndRender() {
    const [allWindows, currentTab] = await Promise.all([
        chrome.windows.getAll({ populate: true }),
        chrome.tabs.getCurrent(),
    ])

    const currentWinId = currentTab ? currentTab.windowId : null
    const currentTabId = currentTab ? currentTab.id : null

    const sortedWindows = [...allWindows].sort((a, b) => {
        if (a.id === currentWinId) return -1
        if (b.id === currentWinId) return 1
        return a.id - b.id
    })

    const windowLabelMap = new Map()
    sortedWindows.forEach((win, idx) => {
        const baseName = windowAliases[String(win.id)] || `Win ${idx + 1}`
        const fullLabel = win.incognito ? `${baseName} · Incognito` : baseName
        windowLabelMap.set(win.id, { baseName, fullLabel })
    })

    const orderedTabs = []
    for (const win of sortedWindows) {
        const winTabs = [...(win.tabs || [])].sort((a, b) => a.index - b.index)
        for (const t of winTabs) {
            orderedTabs.push(t)
        }
    }

    const groupsMap = new Map()
    for (const tab of orderedTabs) {
        const key = normalizeKey(tab.url, currentLevel)
        if (!key) continue
        if (!groupsMap.has(key)) {
            groupsMap.set(key, [])
        }
        groupsMap.get(key).push(tab)
    }

    const duplicateGroups = []
    let extraCount = 0
    let matchingTotal = 0

    for (const [key, tabs] of groupsMap.entries()) {
        if (tabs.length > 1) {
            duplicateGroups.push({ key, tabs })
            matchingTotal += tabs.length
            extraCount += tabs.length - 1
        }
    }

    summaryText.textContent =
        duplicateGroups.length === 0
            ? `No duplicate tabs found (${orderedTabs.length} open)`
            : `${duplicateGroups.length} group${duplicateGroups.length === 1 ? '' : 's'} · ${extraCount} extra tab${extraCount === 1 ? '' : 's'} (${matchingTotal} of ${orderedTabs.length} open)`

    renderGroups(duplicateGroups, windowLabelMap, currentTabId)
}

function renderGroups(groups, windowLabelMap, currentTabId) {
    groupsContainer.innerHTML = ''

    if (groups.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'empty-state'
        empty.innerHTML = `
            <h2>No duplicate tabs at this level</h2>
            <p>Switch to a broader URL matching level above or open more tabs.</p>
        `
        groupsContainer.appendChild(empty)
        return
    }

    for (const group of groups) {
        const section = document.createElement('section')
        section.className = 'group-section'

        const header = document.createElement('div')
        header.className = 'group-header'

        const titleWrap = document.createElement('div')
        titleWrap.className = 'group-title-wrap'

        const keyEl = document.createElement('span')
        keyEl.className = 'group-key'
        keyEl.textContent = group.key
        keyEl.title = group.key

        const countEl = document.createElement('span')
        countEl.className = 'group-count'
        countEl.textContent = `${group.tabs.length} tabs`

        titleWrap.appendChild(keyEl)
        titleWrap.appendChild(countEl)
        header.appendChild(titleWrap)

        const protectedTabs = group.tabs.filter((t) => isProtectedTab(t, currentTabId))
        const keeperIds = new Set(protectedTabs.map((t) => t.id))
        if (keeperIds.size === 0 && group.tabs.length > 0) {
            keeperIds.add(group.tabs[0].id)
        }
        const closableTabs = group.tabs.filter((t) => !keeperIds.has(t.id))

        if (closableTabs.length > 0) {
            const closeExtraBtn = document.createElement('button')
            closeExtraBtn.type = 'button'
            closeExtraBtn.className = 'close-extra-btn'
            closeExtraBtn.textContent = `Close ${closableTabs.length} Extra`
            closeExtraBtn.addEventListener('click', async () => {
                const ids = closableTabs.map((t) => t.id)
                try {
                    await chrome.tabs.remove(ids)
                } catch (err) {
                    // Ignore already-closed tabs
                }
                await scanAndRender()
            })
            header.appendChild(closeExtraBtn)
        }

        section.appendChild(header)

        const grid = document.createElement('div')
        grid.className = 'cards-grid'

        for (const tab of group.tabs) {
            const card = buildTabCard(tab, windowLabelMap, currentTabId)
            grid.appendChild(card)
        }

        section.appendChild(grid)
        groupsContainer.appendChild(section)
    }
}

function buildTabCard(tab, windowLabelMap, currentTabId) {
    const card = document.createElement('article')
    card.className = 'tab-card'

    card.addEventListener('click', async () => {
        try {
            await chrome.windows.update(tab.windowId, { focused: true })
            await chrome.tabs.update(tab.id, { active: true })
        } catch (err) {
            await scanAndRender()
        }
    })

    const previewBox = document.createElement('div')
    previewBox.className = 'preview-box'

    const cacheKey = `${tab.id}::${tab.url}`
    const cachedSnap = snapshotCache.get(cacheKey)

    if (cachedSnap) {
        const img = document.createElement('img')
        img.className = 'preview-img'
        img.src = cachedSnap
        img.alt = ''
        previewBox.appendChild(img)
    } else {
        const placeholder = document.createElement('span')
        placeholder.className = 'preview-placeholder'
        if (isSystemPage(tab.url)) {
            placeholder.textContent = 'System Page'
        } else if (tab.discarded) {
            placeholder.textContent = 'Sleeping Tab'
        } else {
            placeholder.textContent = 'No Preview'
        }
        previewBox.appendChild(placeholder)
    }

    const overlay = document.createElement('div')
    overlay.className = 'preview-overlay'

    const tags = document.createElement('div')
    tags.className = 'overlay-tags'

    const winMeta = windowLabelMap.get(tab.windowId) || { baseName: 'Win 1', fullLabel: 'Win 1' }
    const winPill = document.createElement('span')
    winPill.className = 'win-pill'
    winPill.textContent = winMeta.fullLabel
    winPill.title = 'Click to rename window'
    winPill.addEventListener('click', async (e) => {
        e.stopPropagation()
        const nextName = prompt('Window name:', winMeta.baseName)
        if (nextName !== null) {
            await saveWindowAlias(tab.windowId, nextName)
            await scanAndRender()
        }
    })
    tags.appendChild(winPill)

    if (tab.id === currentTabId) {
        tags.appendChild(makeStatePill('Current'))
    }
    if (tab.pinned) {
        tags.appendChild(makeStatePill('Pinned'))
    }
    if (tab.audible) {
        tags.appendChild(makeStatePill('Audio'))
    }

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'close-tab-btn'
    closeBtn.textContent = '×'
    closeBtn.title = 'Close tab'
    closeBtn.addEventListener('click', async (e) => {
        e.stopPropagation()
        try {
            await chrome.tabs.remove(tab.id)
        } catch (err) {
            // Ignore already-closed tab
        }
        await scanAndRender()
    })

    overlay.appendChild(tags)
    overlay.appendChild(closeBtn)
    previewBox.appendChild(overlay)
    card.appendChild(previewBox)

    const body = document.createElement('div')
    body.className = 'card-body'

    const titleRow = document.createElement('div')
    titleRow.className = 'card-title-row'

    if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) {
        const fav = document.createElement('img')
        fav.className = 'favicon'
        fav.src = tab.favIconUrl
        fav.alt = ''
        fav.addEventListener('error', () => {
            fav.style.display = 'none'
        })
        titleRow.appendChild(fav)
    }

    const titleEl = document.createElement('div')
    titleEl.className = 'card-title'
    titleEl.textContent = tab.title || tab.url || 'Untitled'
    titleEl.title = tab.title || ''
    titleRow.appendChild(titleEl)

    const urlEl = document.createElement('div')
    urlEl.className = 'card-url'
    urlEl.textContent = tab.url || ''
    urlEl.title = tab.url || ''

    body.appendChild(titleRow)
    body.appendChild(urlEl)
    card.appendChild(body)

    return card
}

function makeStatePill(label) {
    const span = document.createElement('span')
    span.className = 'state-pill'
    span.textContent = label
    return span
}

document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
        const level = btn.dataset.level
        if (!level || level === currentLevel) return
        currentLevel = level
        document.querySelectorAll('.filter-btn').forEach((b) => {
            b.classList.toggle('active', b.dataset.level === currentLevel)
        })
        await scanAndRender()
    })
})

captureBtn.addEventListener('click', async () => {
    if (isCapturing) return
    isCapturing = true
    captureBtn.disabled = true
    captureBtn.textContent = 'Capturing...'

    try {
        const allTabs = await chrome.tabs.query({})
        const groupsMap = new Map()
        for (const t of allTabs) {
            const key = normalizeKey(t.url, currentLevel)
            if (!key) continue
            if (!groupsMap.has(key)) groupsMap.set(key, [])
            groupsMap.get(key).push(t)
        }

        const targets = []
        for (const tabs of groupsMap.values()) {
            if (tabs.length <= 1) continue
            for (const t of tabs) {
                if (!isSystemPage(t.url) && !t.discarded) {
                    targets.push({
                        tabId: t.id,
                        windowId: t.windowId,
                        url: t.url,
                    })
                }
            }
        }

        const response = await chrome.runtime.sendMessage({
            type: 'CAPTURE_PREVIEWS',
            targets,
        })

        if (response && response.snapshots) {
            for (const [k, v] of Object.entries(response.snapshots)) {
                snapshotCache.set(k, v)
            }
        }
    } catch (err) {
        // Ignore capture interruption
    } finally {
        isCapturing = false
        captureBtn.disabled = false
        captureBtn.textContent = 'Capture Previews'
        await scanAndRender()
    }
})

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !isCapturing) {
        scanAndRender()
    }
})

;(async () => {
    initVersionBadge()
    await loadWindowAliases()
    await scanAndRender()
})()
