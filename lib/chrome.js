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
    if (this.toRun) // abort any previous work we were sent
      this.resolveWork(null)

    // TODO: if a test is already running, it might be faster to let it finish and hot-reload the code,
    // instead of completely reloading the tab.
    if (opts.reload || this.hasFailed || this.toRun)
      this.reload()

    this.toRun = opts
    this.runTest()
    return new Promise(res => this.resolveWork = res)
  }

  runTest() {
    if (this.loading || !this.toRun) return
    this.startAt = new Date()
    this._timeout = setTimeout(this.failTest.bind(this, {message: 'Chrome timeout'}), 20 * 1000)
    this.cdp.Runtime.evaluate({expression: `ZenRunTestByName(${JSON.stringify(this.toRun)})`})
  }

  reload() {
    this.loading = true
    this.hasFailed = false
    clearTimeout(this._timeout)
    this.cdp.Page.reload() // TODO navigate to the correct url, in case the test has changed our location
  }

  onMessageAdded({message}) {
    console.log(`[${this.id}]`, message.text)
    if (message.text == 'zen worker ready') {
      this.loading = false
      this.runTest()
    }

    if (message.text.startsWith('zen results ') && this.toRun) {
      let msg = JSON.parse(message.text.slice(12))
      if (msg.runId != this.toRun.runId) return
      this.finishTest(msg)
    }
  }

  failTest(error) {
    this.hasFailed = true
    this.finishTest({runId: this.toRun.runId, error, fullName: this.toRun.testName})
  }

  finishTest(msg) {
    msg.time = new Date() - this.startAt
    clearTimeout(this._timeout)
    if (this.resolveWork)
      this.resolveWork(msg)
    this.resolveWork = null
    this.toRun = null
  }

  onExceptionThrown(opts) {
    let ex = opts.exceptionDetails, stack = [], message

    if (ex.exception && ex.exception.className)
      message = `${ex.exception.className} ${ex.exception.description.split('\n')[0]}`
    else if (ex.exception.value)
      message = ex.exception.value
    else
      message = ex.text
    console.log(`[${this.id}]`, message)

    if (ex.stackTrace && ex.stackTrace.callFrames) {
      stack = ex.stackTrace.callFrames.map(f => `${f.functionName} ${f.url}:${f.lineNumber}`)
      stack.forEach(l => console.log(l))
    }

    if (this.toRun)
      this.reload()
    //   this.failTest({message, stack: stack.join('\n')})
  }
}
