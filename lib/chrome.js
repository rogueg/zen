const ChromeLauncher = require("chrome-launcher")
const CDP = require("chrome-remote-interface")
const path = require("path")

module.exports = class Chrome {
  constructor(opts) {
    this.opts = opts
    this.launcher = ChromeLauncher.launch({
      port: opts.port,
      autoSelectChrome: true, // False to manually select which Chrome install.
      chromeFlags: ["--headless", "--disable-gpu"]
    })

    this.browser = this.launcher.then(() => {
      return CDP({port: opts.port})
    })
  }

  async openTab(url, id) {
    let browser = await this.browser
    let {targetId} = await browser.Target.createTarget({url})
    let cdp = await CDP({target: targetId})
    await Promise.all([cdp.Console.enable(), cdp.Page.enable(), cdp.Runtime.enable()])
    return new ChromeTab(cdp, id)
  }


class ChromeTab {
  constructor(cdp, id) {
    this.id = id
    this.cdp = cdp
    cdp.Console.messageAdded(this.onMessageAdded.bind(this))
    cdp.Runtime.exceptionThrown(this.onExceptionThrown.bind(this))
  }

  assignTest(opts) {
    this.mostRecent = opts
    if (this.resolveWork)
      this.resolveWork(null) // abort any previous work we were sent

    if (opts.reload) this.reload()
    this.maybeSendWork()

    return new Promise(res => this.resolveWork = res)
  }
}

  maybeSendWork() {
    if (!this.ready || !this.mostRecent) return
    this.cdp.Runtime.evaluate({expression: `ZenRunTestByName(${JSON.stringify(this.mostRecent)})`})
  }

  reload() {
    this.ready = false
    this.cdp.Page.reload()
  }

  onMessageAdded({message}) {
    console.log(`[${this.id}]`, message.text)
    if (message.text == 'zen worker ready') {
      this.ready = true
      this.maybeSendWork()
    }

    if (message.text.startsWith('zen results ') && this.resolveWork) {
      let msg = JSON.parse(message.text.slice(12))
      if (msg.runId != this.mostRecent.runId) return
      this.resolveWork(msg)
      this.resolveWork = null
    }
  }

  onExceptionThrown(opts) {
    let ex = opts.exceptionDetails
    console.log(`[${this.id}]`, ex.text)
    if (ex.exception)
      console.log(ex.exception)
    ex.stackTrace.callFrames.forEach(f => console.log(`${f.functionName} ${f.url}:${f.lineNumber}`))
    this.reload() // exceptions are fatal. Reload the tab.
  }
}
