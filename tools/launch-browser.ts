import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Browser, computeExecutablePath } from '@puppeteer/browsers'
import puppeteer from 'puppeteer-core'

const executablePath = computeExecutablePath({
    browser: Browser.CHROME,
    buildId: '149.0.7827.22',
    cacheDir: join(homedir(), '.cache', 'puppeteer'),
})

const extensionPath = resolve('.output/chrome-mv3-dev')

const browser = await puppeteer.launch({
    executablePath,
    headless: false,
    defaultViewport: null,
    enableExtensions: [extensionPath],
    userDataDir: resolve('.wxt/test-profile'),
    args: ['--remote-debugging-port=9222'],
})

console.log(`browser ${await browser.version()}`)
console.log(`ws ${browser.wsEndpoint()}`)

const extensionTarget = await browser.waitForTarget(
    (target) => target.url().startsWith('chrome-extension://'),
    { timeout: 10_000 },
)
console.log(`extension ${extensionTarget.url()}`)

browser.on('disconnected', () => {
    console.log('browser closed')
    process.exit(0)
})
