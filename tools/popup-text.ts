import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' })

const worker = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().startsWith('chrome-extension://'),
    { timeout: 10_000 },
)
const extensionId = new URL(worker.url()).host
const popupUrl = `chrome-extension://${extensionId}/popup.html`

const pages = await browser.pages()
const existing = pages.find((page) => page.url() === popupUrl)
const page = existing ?? (await browser.newPage())
if (!existing) {
    await page.goto(popupUrl, { waitUntil: 'networkidle0' })
}

console.log(`${existing ? 'existing' : 'opened'} ${popupUrl}`)
console.log(await page.evaluate(() => document.body.innerText))

await browser.disconnect()
