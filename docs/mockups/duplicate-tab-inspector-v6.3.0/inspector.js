let allTabs = []
let windowMetaMap = new Map()
let currentMode = 'exact'
let currentInspectorTabId = null
const screenshotCache = new Map()

const summaryEl = document.getElementById('summary')
const groupsContainer = document.getElementById('groups-container')
const captureBtn = document.getElementById('capture-btn')
const segButtons = Array.from(document.querySelectorAll('.seg-btn'))

function getMatchKey(rawUrl, mode) {
    if (!rawUrl) return ''
    try {
        const u = new URL(rawUrl)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            if (mode === 'domain') return `${u.protocol}//${u.host}`
            return `${u.protocol}//${u.host}${u.pathname}`
        }
        const host = u.hostname.replace(/^www\./i, '').toLowerCase()
        if (mode === 'domain') {
            return host
        }
        const cleanPath = u.pathname.replace(/\/+$/, '') || '/'
        if (mode === 'path') {
            return `${host}${cleanPath}`
        }
        const params = Array.from(u.searchParams.entries()).sort((a, b) =>
            a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])
        )
        const sortedSearch = params.length
            ? '?' + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
            : ''
        if (mode === 'no-hash') {
            return `${host}${cleanPath}${sortedSearch}`
        }
        return `${host}${cleanPath}${sortedSearch}${u.hash || ''}`
    } catch {
        return rawUrl
    }
}

function getWindowBadge(windowId) {
    const meta = windowMetaMap.get(windowId)
    if (!meta) return 'Win'
    const parts = [`Win ${meta.num}`]
    if (meta.context) parts.push(meta.context)
    if (meta.incognito) parts.push('Private')
    return parts.join(' · ')
}

function buildDuplicateGroups() {
    const buckets = new Map()
    for (const tab of allTabs) {
        const url = tab.url || tab.pendingUrl || ''
        if (!url) continue
        const key = getMatchKey(url, currentMode)
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key).push(tab)
    }

    const groups = []
    for (const [key, tabs] of buckets.entries()) {
        if (tabs.length < 2) continue
        tabs.sort((a, b) => {
            const wa = windowMetaMap.get(a.windowId)?.num ?? 999
            const wb = windowMetaMap.get(b.windowId)?.num ?? 999
            if (wa !== wb) return wa - wb
            return a.index - b.index
        })
        groups.push({ key, tabs })
    }

    groups.sort((a, b) => b.tabs.length - a.tabs.length || a.key.localeCompare(b.key))
    return groups
}

function pickKeptTab(tabs) {
    const currentInspector = tabs.find(t => t.id === currentInspectorTabId)
    if (currentInspector) return currentInspector
    const pinned = tabs.find(t => t.pinned)
    if (pinned) return pinned
    const audible = tabs.find(t => t.audible)
    if (audible) return audible
    return tabs[0]
}

function render() {
    const groups = buildDuplicateGroups()
    const totalDuplicateTabs = groups.reduce((acc, g) => acc + g.tabs.length, 0)
    const extraCount = groups.reduce((acc, g) => acc + (g.tabs.length - 1), 0)

    summaryEl.textContent =
        groups.length === 0
            ? `No duplicate tabs found (${allTabs.length} open)`
            : `${groups.length} group${groups.length === 1 ? '' : 's'} · ${extraCount} extra tab${extraCount === 1 ? '' : 's'} (${totalDuplicateTabs} matching of ${allTabs.length} open)`

    groupsContainer.innerHTML = ''

    if (groups.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'empty-state'
        empty.innerHTML = `<h2>No duplicates at "${currentMode}" level</h2><p>Switch to a broader filter (like Domain or Path) to group related pages.</p>`
        groupsContainer.appendChild(empty)
        return
    }

    for (const group of groups) {
        const section = document.createElement('section')
        section.className = 'group-section'

        const keptTab = pickKeptTab(group.tabs)
        const closableTabs = group.tabs.filter(t => t.id !== keptTab.id && !t.pinned)

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

        titleWrap.append(keyEl, countEl)
        header.appendChild(titleWrap)

        if (closableTabs.length > 0) {
            const closeExtraBtn = document.createElement('button')
            closeExtraBtn.type = 'button'
            closeExtraBtn.className = 'close-extra-btn'
            closeExtraBtn.textContent = `Close ${closableTabs.length} Extra`
            closeExtraBtn.addEventListener('click', async () => {
                const ids = closableTabs.map(t => t.id)
                await closeTabs(ids)
            })
            header.appendChild(closeExtraBtn)
        }

        const grid = document.createElement('div')
        grid.className = 'cards-grid'

        for (const tab of group.tabs) {
            const card = document.createElement('article')
            card.className = 'tab-card'

            const previewBox = document.createElement('div')
            previewBox.className = 'preview-box'

            const snap = screenshotCache.get(tab.id)
            if (snap) {
                const img = document.createElement('img')
                img.className = 'preview-img'
                img.src = snap
                img.alt = ''
                previewBox.appendChild(img)
            } else {
                const placeholder = document.createElement('div')
                placeholder.className = 'preview-placeholder'
                if (tab.favIconUrl) {
                    const icon = document.createElement('img')
                    icon.src = tab.favIconUrl
                    icon.alt = ''
                    icon.onerror = () => icon.remove()
                    placeholder.appendChild(icon)
                }
                const label = document.createElement('span')
                const url = tab.url || ''
                if (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('chrome-extension://')) {
                    label.textContent = 'System Page'
                } else if (tab.discarded) {
                    label.textContent = 'Sleeping Tab'
                } else {
                    label.textContent = 'No Preview Captured'
                }
                placeholder.appendChild(label)
                previewBox.appendChild(placeholder)
            }

            const overlay = document.createElement('div')
            overlay.className = 'preview-overlay'

            const tags = document.createElement('div')
            tags.className = 'overlay-tags'

            const winBadge = document.createElement('span')
            winBadge.className = 'win-badge'
            winBadge.textContent = getWindowBadge(tab.windowId)
            winBadge.title = `${getWindowBadge(tab.windowId)} (${windowMetaMap.get(tab.windowId)?.tabCount || 0} tabs)`
            tags.appendChild(winBadge)

            if (tab.id === currentInspectorTabId) {
                const tag = document.createElement('span')
                tag.className = 'state-tag'
                tag.textContent = 'Current'
                tags.appendChild(tag)
            }
            if (tab.pinned) {
                const tag = document.createElement('span')
                tag.className = 'state-tag'
                tag.textContent = 'Pinned'
                tags.appendChild(tag)
            }
            if (tab.audible) {
                const tag = document.createElement('span')
                tag.className = 'state-tag is-audible'
                tag.textContent = 'Audio'
                tags.appendChild(tag)
            }

            overlay.appendChild(tags)

            if (tab.id !== currentInspectorTabId) {
                const closeBtn = document.createElement('button')
                closeBtn.type = 'button'
                closeBtn.className = 'close-card-btn'
                closeBtn.textContent = '×'
                closeBtn.title = 'Close tab'
                closeBtn.setAttribute('aria-label', 'Close tab')
                closeBtn.addEventListener('click', async e => {
                    e.stopPropagation()
                    await closeTabs([tab.id])
                })
                overlay.appendChild(closeBtn)
            }

            previewBox.appendChild(overlay)

            const body = document.createElement('div')
            body.className = 'card-body'

            const titleRow = document.createElement('div')
            titleRow.className = 'title-row'

            const fav = document.createElement('img')
            fav.className = 'favicon'
            fav.src = tab.favIconUrl || 'icons/icon-16.png'
            fav.alt = ''
            fav.onerror = () => {
                fav.src = 'icons/icon-16.png'
            }

            const titleEl = document.createElement('div')
            titleEl.className = 'tab-title'
            titleEl.textContent = tab.title || tab.url || 'Untitled Tab'
            titleEl.title = tab.title || ''

            titleRow.append(fav, titleEl)

            const urlEl = document.createElement('div')
            urlEl.className = 'tab-url'
            urlEl.textContent = tab.url || tab.pendingUrl || ''
            urlEl.title = tab.url || tab.pendingUrl || ''

            body.append(titleRow, urlEl)
            card.append(previewBox, body)

            card.addEventListener('click', async () => {
                try {
                    await chrome.windows.update(tab.windowId, { focused: true })
                    await chrome.tabs.update(tab.id, { active: true })
                } catch {}
            })

            grid.appendChild(card)
        }

        section.append(header, grid)
        groupsContainer.appendChild(section)
    }
}

async function closeTabs(tabIds) {
    const safeIds = tabIds.filter(id => id !== currentInspectorTabId)
    if (safeIds.length === 0) return
    try {
        await chrome.tabs.remove(safeIds)
    } catch {}
    const removedSet = new Set(safeIds)
    allTabs = allTabs.filter(t => !removedSet.has(t.id))
    for (const id of safeIds) screenshotCache.delete(id)
    render()
}

function nextPaint() {
    return new Promise(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(resolve))
    })
}

async function captureAllPreviews() {
    const groups = buildDuplicateGroups()
    const targets = []
    for (const group of groups) {
        for (const tab of group.tabs) {
            const url = tab.url || ''
            const isSystem =
                url.startsWith('chrome://') ||
                url.startsWith('edge://') ||
                url.startsWith('chrome-extension://') ||
                url.startsWith('https://chromewebstore.google.com/')
            if (!isSystem && !tab.discarded && tab.id !== currentInspectorTabId) {
                targets.push(tab)
            }
        }
    }

    if (targets.length === 0) return

    captureBtn.disabled = true
    const originalLabel = captureBtn.textContent
    const inspectorTab = await chrome.tabs.getCurrent()

    try {
        for (let i = 0; i < targets.length; i++) {
            const target = targets[i]
            captureBtn.textContent = `Capturing ${i + 1}/${targets.length}...`
            try {
                await chrome.windows.update(target.windowId, { focused: true })
                await chrome.tabs.update(target.id, { active: true })
                await nextPaint()
                await new Promise(r => setTimeout(r, 120))
                const dataUrl = await chrome.tabs.captureVisibleTab(target.windowId, {
                    format: 'jpeg',
                    quality: 68
                })
                if (dataUrl) {
                    screenshotCache.set(target.id, dataUrl)
                }
            } catch {}
        }
    } finally {
        if (inspectorTab) {
            try {
                await chrome.windows.update(inspectorTab.windowId, { focused: true })
                await chrome.tabs.update(inspectorTab.id, { active: true })
            } catch {}
        }
        captureBtn.disabled = false
        captureBtn.textContent = originalLabel
        render()
    }
}

async function loadInitialState() {
    const currentTab = await chrome.tabs.getCurrent()
    currentInspectorTabId = currentTab ? currentTab.id : null

    const windows = await chrome.windows.getAll({ populate: true })
    allTabs = []
    windowMetaMap = new Map()

    windows.forEach((win, idx) => {
        const tabs = win.tabs || []
        const activeTab = tabs.find(t => t.active && t.id !== currentInspectorTabId) || tabs[0]
        let context = ''
        if (activeTab && activeTab.url) {
            try {
                const u = new URL(activeTab.url)
                if (u.protocol === 'http:' || u.protocol === 'https:') {
                    context = u.hostname.replace(/^www\./i, '')
                }
            } catch {}
        }
        windowMetaMap.set(win.id, {
            num: idx + 1,
            tabCount: tabs.length,
            incognito: Boolean(win.incognito),
            context
        })
        allTabs.push(...tabs)
    })

    render()
}

segButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        currentMode = btn.dataset.mode
        segButtons.forEach(b => b.classList.toggle('is-active', b === btn))
        render()
    })
})

captureBtn.addEventListener('click', captureAllPreviews)

loadInitialState()
