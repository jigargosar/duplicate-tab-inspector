import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import puppeteer, { type Page } from 'puppeteer-core'

const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html')
    res.end(`<title>page ${req.url}</title><h1>${req.url}</h1>`)
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })

const worker = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().startsWith('chrome-extension://'),
    { timeout: 10_000 },
)
const popupUrl = `chrome-extension://${new URL(worker.url()).host}/popup.html`

const blank = await browser.newPage()
for (const page of await browser.pages()) {
    if (page !== blank) {
        await page.close()
    }
}

const openPaths =['/a', '/a', '/a', '/b', '/b', '/c']
const testPages: Page[] = []
for (const path of openPaths) {
    const page = await browser.newPage()
    await page.goto(base + path)
    testPages.push(page)
}

const popup = await browser.newPage()
popup.on('pageerror', (err) => console.log(`POPUP ERROR ${err}`))
popup.on('console', (msg) => console.log(`POPUP CONSOLE ${msg.type()} ${msg.text()}`))
await popup.goto(popupUrl, { waitUntil: 'networkidle0' })

async function summary() {
    return popup.$eval('#summary', (el) => el.textContent)
}

async function remainingPaths() {
    const urls = await popup.evaluate(async () => {
        const tabs = await (globalThis as any).chrome.tabs.query({})
        return tabs.map((t: { url: string }) => t.url) as string[]
    })
    return urls
        .filter((url) => url.startsWith(base))
        .map((url) => new URL(url).pathname)
        .sort()
}

async function clickAndWait(selectorText: string) {
    const before = await summary()
    const button = await popup.waitForSelector(`::-p-text(${selectorText})`, { timeout: 5_000 })
    await button!.click()
    await popup.waitForFunction(
        (prev) => document.querySelector('#summary')?.textContent !== prev,
        { timeout: 5_000 },
        before,
    )
}

const results: { step: string; expected: string; actual: string }[] = []
function check(step: string, expected: string, actual: string) {
    results.push({ step, expected, actual })
    console.log(`${expected === actual ? 'PASS' : 'FAIL'}  ${step}: expected "${expected}", got "${actual}"`)
}

check('summary at start', '3 extra across 2 groups', String(await summary()))
check('tabs at start', '/a /a /a /b /b /c', (await remainingPaths()).join(' '))

await clickAndWait('Keep 1, Close 2')
check('after Keep 1 on /a', '/a /b /b /c', (await remainingPaths()).join(' '))
check('summary after Keep 1', '1 extra across 1 group', String(await summary()))

await clickAndWait('Close Extra Copies')
check('after Close Extra Copies', '/a /b /c', (await remainingPaths()).join(' '))
check('summary at end', '0 extra across 0 groups', String(await summary()))

for (const page of testPages) {
    if (!page.isClosed()) {
        await page.close()
    }
}
await popup.close()
await browser.disconnect()
server.close()

process.exit(results.some((r) => r.expected !== r.actual) ? 1 : 0)
