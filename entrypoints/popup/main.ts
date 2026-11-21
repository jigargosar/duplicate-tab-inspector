const tabs = await browser.tabs.query({})
document.body.append(`${tabs.length} tabs open`)
