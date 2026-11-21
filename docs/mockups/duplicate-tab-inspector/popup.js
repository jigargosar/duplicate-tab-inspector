const state = {
    path: true,
    query: true,
    hash: false,
    allWindows: true,
}

const elPath = document.getElementById('level-path')
const elQuery = document.getElementById('level-query')
const elHash = document.getElementById('level-hash')
const elAllWindows = document.getElementById('all-windows')
const elSummary = document.getElementById('summary')
const elCloseAll = document.getElementById('close-all-btn')
const elContainer = document.getElementById('groups-container')

function normalizeKey(rawUrl) {
    try {
        const u = new URL(rawUrl)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            return null
        }
        let key = u.hostname.toLowerCase()
        if (state.path) {
            key += u.pathname.replace(/\/$/, '') || '/'
        }
        if (state.query && u.search) {
            const params = new URLSearchParams(u.search)
            params.sort()
            const sorted = params.toString()
            if (sorted) {
                key += '?' + sorted
            }
        }
        if (state.hash && u.hash) {
            key += u.hash
        }
        return key
    } catch {
        return null
    }
}

async function focusTab(tab) {
    await chrome.windows.update(tab.windowId, { focused: true })
    await chrome.tabs.update(tab.id, { active: true })
}

async function closeTabs(tabIds) {
    if (!tabIds.length) {
        return
    }
    await chrome.tabs.remove(tabIds)
    await render()
}

function createTabRow(tab, index) {
    const row = document.createElement('div')
    row.className = 'tab-row' + (tab.active ? ' is-active' : '')

    const icon = document.createElement('img')
    icon.className = 'tab-favicon'
    icon.src = tab.favIconUrl || ''
    icon.onerror = () => {
        icon.style.visibility = 'hidden'
    }

    const info = document.createElement('div')
    info.className = 'tab-info'
    info.title = 'Click to switch to this tab'
    info.addEventListener('click', () => focusTab(tab))

    const title = document.createElement('div')
    title.className = 'tab-title'
    title.textContent = tab.title || '(Untitled)'

    const url = document.createElement('div')
    url.className = 'tab-url'
    url.textContent = tab.url

    info.appendChild(title)
    info.appendChild(url)

    row.appendChild(icon)
    row.appendChild(info)

    if (tab.active) {
        const badge = document.createElement('span')
        badge.className = 'tab-meta'
        badge.textContent = 'Active'
        row.appendChild(badge)
    } else if (index === 0) {
        const badge = document.createElement('span')
        badge.className = 'tab-meta'
        badge.textContent = 'Keep'
        row.appendChild(badge)
    }

    const closeBtn = document.createElement('button')
    closeBtn.className = 'close-one'
    closeBtn.textContent = 'Close'
    closeBtn.title = 'Close this tab'
    closeBtn.addEventListener('click', () => closeTabs([tab.id]))
    row.appendChild(closeBtn)

    return row
}

async function render() {
    const queryOpts = state.allWindows ? {} : { currentWindow: true }
    const tabs = await chrome.tabs.query(queryOpts)

    const groups = new Map()
    for (const tab of tabs) {
        const key = normalizeKey(tab.url)
        if (!key) {
            continue
        }
        if (!groups.has(key)) {
            groups.set(key, [])
        }
        groups.get(key).push(tab)
    }

    const duplicateGroups = []
    let extraCount = 0
    const allExtraIds = []

    for (const [key, groupTabs] of groups.entries()) {
        if (groupTabs.length > 1) {
            groupTabs.sort((a, b) => Number(b.active) - Number(a.active))
            duplicateGroups.push({ key, tabs: groupTabs })
            const extras = groupTabs.slice(1).map((t) => t.id)
            extraCount += extras.length
            allExtraIds.push(...extras)
        }
    }

    elSummary.textContent = `${extraCount} extra across ${duplicateGroups.length} group${duplicateGroups.length === 1 ? '' : 's'}`
    elCloseAll.disabled = extraCount === 0
    elCloseAll.onclick = () => closeTabs(allExtraIds)

    elContainer.innerHTML = ''

    if (!duplicateGroups.length) {
        const empty = document.createElement('div')
        empty.className = 'empty-state'
        empty.textContent = 'No duplicate tabs match the selected URL levels.'
        elContainer.appendChild(empty)
        return
    }

    for (const group of duplicateGroups) {
        const card = document.createElement('section')
        card.className = 'group'

        const header = document.createElement('div')
        header.className = 'group-header'

        const keyLabel = document.createElement('span')
        keyLabel.className = 'group-key'
        keyLabel.textContent = `${group.key} (${group.tabs.length})`
        keyLabel.title = group.key

        const groupCloseBtn = document.createElement('button')
        groupCloseBtn.textContent = `Keep 1, Close ${group.tabs.length - 1}`
        groupCloseBtn.addEventListener('click', () => {
            closeTabs(group.tabs.slice(1).map((t) => t.id))
        })

        header.appendChild(keyLabel)
        header.appendChild(groupCloseBtn)
        card.appendChild(header)

        group.tabs.forEach((tab, idx) => {
            card.appendChild(createTabRow(tab, idx))
        })

        elContainer.appendChild(card)
    }
}

elPath.addEventListener('change', () => {
    state.path = elPath.checked
    if (!state.path) {
        state.query = false
        state.hash = false
        elQuery.checked = false
        elHash.checked = false
    }
    render()
})

elQuery.addEventListener('change', () => {
    state.query = elQuery.checked
    if (state.query && !state.path) {
        state.path = true
        elPath.checked = true
    }
    render()
})

elHash.addEventListener('change', () => {
    state.hash = elHash.checked
    if (state.hash && !state.path) {
        state.path = true
        elPath.checked = true
    }
    render()
})

elAllWindows.addEventListener('change', () => {
    state.allWindows = elAllWindows.checked
    render()
})

render()
