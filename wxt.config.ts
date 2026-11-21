import { resolve } from 'node:path'
import { defineConfig } from 'wxt'

export default defineConfig({
    manifest: {
        name: 'Duplicate Tab Inspector',
        permissions: ['tabs'],
    },
    webExt: {
        chromiumProfile: resolve('.wxt/chrome-data'),
        keepProfileChanges: true,
        chromiumArgs: ['--remote-debugging-port=9222'],
    },
})
