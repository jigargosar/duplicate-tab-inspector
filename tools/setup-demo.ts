import puppeteer from 'puppeteer-core'

// Opens a mix of duplicate tabs across two windows in the test Chrome, for trying the popup by hand.
const windowOne = [
    'https://en.wikipedia.org/wiki/Tab_(interface)',
    'https://en.wikipedia.org/wiki/Tab_(interface)',
    'https://en.wikipedia.org/wiki/Tab_(interface)#History',
    'https://example.com/',
    'https://www.example.com/',
    'https://developer.mozilla.org/en-US/docs/Web/API/URL?a=1&b=2',
    'https://developer.mozilla.org/en-US/docs/Web/API/URL?b=2&a=1',
    'https://developer.mozilla.org/en-US/docs/Web/API/URL',
]
const windowTwo = [
    'https://en.wikipedia.org/wiki/Tab_(interface)',
    'https://example.com/',
    'https://github.com/',
    'https://github.com/',
]
const pinnedInWindowOne = 'https://github.com/'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })

const worker = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().startsWith('chrome-extension://'),
    { timeout: 10_000 },
)
const popupUrl = `chrome-extension://${new URL(worker.url()).host}/popup.html`

const helper = await browser.newPage()
await helper.goto(popupUrl, { waitUntil: 'networkidle0' })

await helper.evaluate(
    async (one, two, pinned) => {
        const chrome = (globalThis as any).chrome
        const self = await chrome.tabs.getCurrent()
        const existing = (await chrome.tabs.query({})).filter((t: { id: number }) => t.id !== self.id)

        const w1 = await chrome.windows.create({ url: one, focused: false })
        await chrome.tabs.create({ windowId: w1.id, url: pinned, pinned: true })
        await chrome.windows.create({ url: two, focused: false })

        await chrome.tabs.remove(existing.map((t: { id: number }) => t.id))
        await chrome.windows.update(w1.id, { focused: true })
    },
    windowOne,
    windowTwo,
    pinnedInWindowOne,
)

await helper.close()
await browser.disconnect()
console.log('demo tabs ready')
