import { resolve } from 'node:path'
import { defineConfig } from 'wxt'

export default defineConfig({
    manifest: {
        name: 'Duplicate Tab Inspector',
        permissions: ['tabs'],
        action: {
            default_title: 'Inspect Duplicate Tabs',
        },
        commands: {
            _execute_action: {
                suggested_key: {
                    default: 'Alt+Shift+D',
                },
                description: 'Open Duplicate Tab Inspector',
            },
        },
    },
    webExt: {
        chromiumProfile: resolve('.wxt/chrome-data'),
        keepProfileChanges: true,
        chromiumArgs: ['--remote-debugging-port=9222'],
    },
})
