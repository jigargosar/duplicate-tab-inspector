const state = {
    level: 'exact',
    tabsSnapshot: [],
    thumbnails: new Map(),
    isCapturing: false,
}

const groupsContainer = document.getElementById('groupsContainer')
const summaryText = document.getElementById('summaryText')
const captureAllBtn = document.getElementById('captureAllBtn')
const captureBtnLabel = document.getElementById('captureBtnLabel')

function normalizeUrl(rawUrl, level) {
    if (!rawUrl) return ''
    try {
        const u = new URL(rawUrl)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            return rawUrl
        }
        const host = u.host.toLowerCase()
        const path = u.pathname.replace(/\/+$/, '') || '/'

        if (level === 'domain') {
            return `${u.protocol}//${host}`
        }
        if (level === 'path') {
            return `${u.protocol}//${host}${path}`
        }
        if (level === 'no-hash') {
            const params = new URLSearchParams(u.search)
            params.sort()
            const qs = params.toString()
            return `${u.protocol}//${host}${path}${qs ? '?' + qs : ''}`
        }
        const params = new URLSearchParams(u.search)
        params.sort()
        const qs = params.toString()
        return `${u.protocol}//${host}${path}${qs ? '?' + qs : ''}${u.hash}`
    } catch {
        return rawUrl
    }
}

function formatRelativeTime(ms) {
    if (!ms) return 'Unknown'
    const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000))
    if (diffSec < 60) return 'Just now'
    const mins = Math.floor(diffSec / 60)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
}

function getDuplicateGroups() {
    const map = new Map()
    for (const tab of state.tabsSnapshot) {
        if (!tab.url || tab.url.startsWith(chrome.runtime.getURL(''))) continue
        const key = normalizeUrl(tab.url, state.level)
        if (!map.has(key)) map.set(key, [])
        map.get(key).push(tab)
    }

    const groups = []
    for (const [key, items] of map.entries()) {
        if (items.length > 1) {
            items.sort((a, b) => {
                if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
                if (a.audible !== b.audible) return a.audible ? -1 : 1
                return (b.lastAccessed || 0) - (a.lastAccessed || 0)
            })
            groups.push({ key, tabs: items })
        }
    }

    groups.sort((a, b) => b.tabs.length - a.tabs.length)
    return groups
}

async function jumpToTab(tab) {
    try {
        await chrome.tabs.update(tab.id, { active: true })
        await chrome.windows.update(tab.windowId, { focused: true })
    } catch {
        removeTabFromSnapshot(tab.id)
        render()
    }
}

function removeTabFromSnapshot(tabId) {
    state.tabsSnapshot = state.tabsSnapshot.filter((t) => t.id !== tabId)
    state.thumbnails.delete(tabId)
}

async function closeSingleTab(tabId, cardEl) {
    if (cardEl) cardEl.classList.add('removing')
    try {
        await chrome.tabs.remove(tabId)
    } catch {
        // Tab may already be closed externally
    }
    setTimeout(() => {
        removeTabFromSnapshot(tabId)
        render()
    }, 130)
}

async function closeGroupDuplicates(group) {
    const toClose = group.tabs.slice(1).filter((t) => !t.pinned && !t.audible)
    const fallbackClose = toClose.length > 0 ? toClose : group.tabs.slice(1)
    const ids = fallbackClose.map((t) => t.id)
    if (ids.length === 0) return

    try {
        await chrome.tabs.remove(ids)
    } catch {
        // Ignore already-closed tabs
    }
    for (const id of ids) {
        removeTabFromSnapshot(id)
    }
    render()
}

function createCardElement(tab, indexInGroup, windowIndexMap) {
    const card = document.createElement('article')
    card.className = 'tab-card'
    card.title = 'Click to jump to tab'

    const thumbBox = document.createElement('div')
    thumbBox.className = 'thumb-box'

    const thumbUrl = state.thumbnails.get(tab.id)
    if (thumbUrl) {
        const img = document.createElement('img')
        img.className = 'thumb-img'
        img.src = thumbUrl
        img.alt = ''
        thumbBox.appendChild(img)
    } else {
        const ph = document.createElement('div')
        ph.className = 'thumb-placeholder'
        if (tab.favIconUrl) {
            const fav = document.createElement('img')
            fav.src = tab.favIconUrl
            fav.alt = ''
            ph.appendChild(fav)
        }
        const label = document.createElement('span')
        label.textContent = tab.discarded ? 'Suspended tab' : 'No preview captured'
        ph.appendChild(label)
        thumbBox.appendChild(ph)
    }

    const overlay = document.createElement('div')
    overlay.className = 'hover-overlay'

    const overlayTop = document.createElement('div')
    overlayTop.className = 'overlay-top'

    const metaChip = document.createElement('span')
    metaChip.className = 'meta-chip'
    const winNum = windowIndexMap.get(tab.windowId) || 1
    metaChip.textContent = `Win ${winNum} · ${formatRelativeTime(tab.lastAccessed)}`

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'close-card-btn'
    closeBtn.title = 'Close tab (Ctrl+Shift+T restores)'
    closeBtn.setAttribute('aria-label', 'Close tab')
    closeBtn.textContent = '×'
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        closeSingleTab(tab.id, card)
    })

    overlayTop.appendChild(metaChip)
    overlayTop.appendChild(closeBtn)

    const jumpPill = document.createElement('span')
    jumpPill.className = 'jump-pill'
    jumpPill.textContent = '↗ Jump to Tab'

    overlay.appendChild(overlayTop)
    overlay.appendChild(jumpPill)
    thumbBox.appendChild(overlay)

    const body = document.createElement('div')
    body.className = 'card-body'

    const titleRow = document.createElement('div')
    titleRow.className = 'card-title-row'

    if (tab.favIconUrl) {
        const fav = document.createElement('img')
        fav.className = 'favicon'
        fav.src = tab.favIconUrl
        fav.alt = ''
        titleRow.appendChild(fav)
    }

    const title = document.createElement('div')
    title.className = 'card-title'
    title.textContent = tab.title || tab.url
    titleRow.appendChild(title)

    const urlEl = document.createElement('div')
    urlEl.className = 'card-url'
    urlEl.textContent = tab.url

    const badges = document.createElement('div')
    badges.className = 'badges-row'

    const roleBadge = document.createElement('span')
    roleBadge.className = indexInGroup === 0 ? 'badge keep' : 'badge'
    roleBadge.textContent = indexInGroup === 0 ? 'Keep · Latest' : `Duplicate #${indexInGroup}`
    badges.appendChild(roleBadge)

    if (tab.pinned) {
        const b = document.createElement('span')
        b.className = 'badge warn'
        b.textContent = 'Pinned'
        badges.appendChild(b)
    }
    if (tab.audible) {
        const b = document.createElement('span')
        b.className = 'badge warn'
        b.textContent = 'Audio'
        badges.appendChild(b)
    }
    if (tab.discarded) {
        const b = document.createElement('span')
        b.className = 'badge'
        b.textContent = 'Suspended'
        badges.appendChild(b)
    }

    body.appendChild(titleRow)
    body.appendChild(urlEl)
    body.appendChild(badges)

    card.appendChild(thumbBox)
    card.appendChild(body)

    card.addEventListener('click', () => jumpToTab(tab))
    return card
}

function render() {
    const groups = getDuplicateGroups()
    const totalDupTabs = groups.reduce((acc, g) => acc + g.tabs.length, 0)
    const extraCount = groups.reduce((acc, g) => acc + (g.tabs.length - 1), 0)

    summaryText.textContent =
        groups.length === 0
            ? `0 duplicate groups across ${state.tabsSnapshot.length} open tabs`
            : `${groups.length} group${groups.length === 1 ? '' : 's'} · ${extraCount} extra tab${extraCount === 1 ? '' : 's'} (${totalDupTabs} total)`

    groupsContainer.innerHTML = ''

    if (groups.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'empty-state'
        empty.innerHTML = `
            <h2>No duplicate tabs at "${state.level}" level</h2>
            <p>Try switching the URL filter to Path or Domain to spot broader matches.</p>
        `
        groupsContainer.appendChild(empty)
        return
    }

    const windowIds = [...new Set(state.tabsSnapshot.map((t) => t.windowId))]
    const windowIndexMap = new Map(windowIds.map((id, idx) => [id, idx + 1]))

    for (const group of groups) {
        const section = document.createElement('section')
        section.className = 'group-section'

        const header = document.createElement('div')
        header.className = 'group-header'

        const titleWrap = document.createElement('div')
        titleWrap.className = 'group-title-wrap'

        const countBadge = document.createElement('span')
        countBadge.className = 'group-count'
        countBadge.textContent = `${group.tabs.length} tabs`

        const keyText = document.createElement('span')
        keyText.className = 'group-key'
        keyText.textContent = group.key
        keyText.title = group.key

        titleWrap.appendChild(countBadge)
        titleWrap.appendChild(keyText)

        const closeGroupBtn = document.createElement('button')
        closeGroupBtn.type = 'button'
        closeGroupBtn.className = 'group-close-btn'
        const closableCount = group.tabs.slice(1).filter((t) => !t.pinned && !t.audible).length
        closeGroupBtn.textContent = `Close ${closableCount || group.tabs.length - 1} Duplicate${(closableCount || group.tabs.length - 1) === 1 ? '' : 's'}`
        closeGroupBtn.addEventListener('click', () => closeGroupDuplicates(group))

        header.appendChild(titleWrap)
        header.appendChild(closeGroupBtn)

        const grid = document.createElement('div')
        grid.className = 'cards-grid'
        group.tabs.forEach((tab, idx) => {
            grid.appendChild(createCardElement(tab, idx, windowIndexMap))
        })

        section.appendChild(header)
        section.appendChild(grid)
        groupsContainer.appendChild(section)
    }
}

async function captureAllDuplicatePreviews() {
    if (state.isCapturing) return
    const groups = getDuplicateGroups()
    const targets = []
    const seen = new Set()

    for (const g of groups) {
        for (const t of g.tabs) {
            if (!seen.has(t.id) && t.url && (t.url.startsWith('http://') || t.url.startsWith('https://'))) {
                seen.add(t.id)
                targets.push(t)
            }
        }
    }

    if (targets.length === 0) return

    state.isCapturing = true
    captureAllBtn.disabled = true

    const inspectorTab = await chrome.tabs.getCurrent()

    try {
        for (let i = 0; i < targets.length; i++) {
            const tab = targets[i]
            captureBtnLabel.textContent = `Capturing ${i + 1}/${targets.length}...`
            try {
                await chrome.tabs.update(tab.id, { active: true })
                await chrome.windows.update(tab.windowId, { focused: true })
                await new Promise((r) => setTimeout(r, 220))
                const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
                    format: 'jpeg',
                    quality: 65,
                })
                if (dataUrl) {
                    state.thumbnails.set(tab.id, dataUrl)
                }
            } catch {
                // Skip tabs that cannot be captured
            }
        }
    } finally {
        if (inspectorTab) {
            try {
                await chrome.tabs.update(inspectorTab.id, { active: true })
                await chrome.windows.update(inspectorTab.windowId, { focused: true })
            } catch {
                // Ignore if inspector closed
            }
        }
        state.isCapturing = false
        captureAllBtn.disabled = false
        captureBtnLabel.textContent = 'Capture Previews'
        render()
    }
}

document.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'))
        btn.classList.add('active')
        state.level = btn.dataset.level
        render()
    })
})

captureAllBtn.addEventListener('click', captureAllDuplicatePreviews)

async function init() {
    state.tabsSnapshot = await chrome.tabs.query({})
    render()
}

init()
