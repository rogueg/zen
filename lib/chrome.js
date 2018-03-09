const ChromeLauncher = require("chrome-launcher")
const CDP = require("chrome-remote-interface")
const path = require("path")

module.exports = class ChromeWrapper {
  constructor() {}

  launch(opts) {
    this.getBrowser = ChromeLauncher.launch({
      port: opts.port,
      autoSelectChrome: true, // False to manually select which Chrome install.
      chromeFlags: ["--headless", "--disable-gpu"]
    }).then(() => {
      return CDP({port: opts.port})
    })
  }

  connectToRunning() {
    this.getBrowser = CDP({host: 'localhost', port: 9222})
  }

  openTab(url, id) {
    return this.getBrowser
    .then(browser => browser.Target.createTarget({url}))
    .then(target => CDP({target: target.targetId}))
    .then(cdp => {
      return Promise.all([cdp.Console.enable(), cdp.Page.enable(), cdp.Runtime.enable()])
        .then(() => new ChromeTab(cdp, id))
    })
  }
}

class ChromeTab {
  constructor(cdp, id) {
    this.id = id
    this.cdp = cdp
    this.loading = true
    cdp.Console.messageAdded(this.onMessageAdded.bind(this))
    cdp.Runtime.exceptionThrown(this.onExceptionThrown.bind(this))
  }

  assignTest(opts) {
    this.mostRecent = opts
    if (this.resolveWork)
      this.resolveWork(null) // abort any previous work we were sent

    if (opts.reload || this.failedDuringLoad)
      this.reload()

    this.maybeSendWork()

    return new Promise(res => this.resolveWork = res)
  }

  maybeSendWork() {
    if (this.loading || !this.mostRecent) return
    this.cdp.Runtime.evaluate({expression: `ZenRunTestByName(${JSON.stringify(this.mostRecent)})`})
  }

  reload() {
    this.loading = true
    this.failedDuringLoad = false
    this.cdp.Page.reload() // TODO navigate to the correct url, in case the test has changed our location
  }

  onMessageAdded({message}) {
    console.log(`[${this.id}]`, message.text)
    if (message.text == 'zen worker ready') {
      this.loading = false
      this.maybeSendWork()
    }

    if (message.text.startsWith('zen results ') && this.resolveWork) {
      let msg = JSON.parse(message.text.slice(12))
      if (msg.runId != this.mostRecent.runId) return
      this.resolveWork(msg)
      this.resolveWork = null
      this.mostRecent = null
    }
  }

  onExceptionThrown(opts) {
    let ex = opts.exceptionDetails
    console.log(`[${this.id}]`, ex.text)
    if (ex.exception)
      console.log(ex.exception)
    if (ex.stackTrace && ex.stackTrace.callFrames)
      ex.stackTrace.callFrames.forEach(f => console.log(`${f.functionName} ${f.url}:${f.lineNumber}`))
    if (this.loading)
      this.failedDuringLoad = true
    else
      this.reload() // exceptions are fatal. Reload the tab.
  }
}
