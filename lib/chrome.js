const ChromeLauncher = require("chrome-launcher")
const CDP = require("chrome-remote-interface")
const path = require("path")

module.exports = class ChromeWrapper {
  constructor(config) {
    this.config = config
  }

  // locally, we start a headless chrome instance to run tests
  launch(opts) {
    this.getBrowser = ChromeLauncher.launch({
      port: opts.port,
      chromeFlags: ["--headless", "--disable-gpu"]
    }).then(chrome => {
      require('./util').writeFile(path.join(this.config.tmpDir, 'chrome.pid'), chrome.pid)
      return CDP({port: opts.port})
    })
  }

  // On lambda, chrome is already running and we just need to connect
  connectToRunning() {
    this.getBrowser = CDP({host: 'localhost', port: 9222})
  }

  openTab(url, id) {
    return this.getBrowser
    .then(browser => browser.Target.createTarget({url}))
    .then(target => CDP({target: target.targetId}))
    .then(cdp => {
      return Promise.all([cdp.Console.enable(), cdp.Page.enable(), cdp.Runtime.enable()])
        .then(() => new ChromeTab(cdp, id, this.config))
    })
  }
}

// State is one of:
// loading: waiting for the page to load
// badCode: there was an error while loading. Nothing we can do until the code changes
// ready: Code is loaded, and we're waiting for a test
// hotReload: trying to update without a full page load
// running: a test is in progress
// abort: briefly wait for the current test to finish
class ChromeTab {
  constructor(cdp, id, config) {
    this.id = id
    this.cdp = cdp
    this.config = config
    this.state = 'loading'
    this.codeHash = null // the version we'd like to be running
    this.test = null // the test we're supposed to run
    this.resolveWork = null // function to call when we have test results

    cdp.Console.messageAdded(this.onMessageAdded.bind(this))
    cdp.Runtime.exceptionThrown(this.onExceptionThrown.bind(this))
    this.onTimeout = this.onTimeout.bind(this)
  }

  setCodeHash(codeHash) {
    this.codeHash = codeHash
    if (this.state == 'badCode') this.reload() // webpack hot reload can't recover from bad code
    if (this.state == 'idle') this.hotReload()
    if (this.state == 'running') this.abort()
    if (this.state == 'loading') this.abort()
  }

  setTest(opts) {
    // abort any previous work we were sent
    if (this.test) this.resolveWork(null)

    this.test = opts
    if (this.state == 'running') this.abort()
    if (this.state == 'idle') this.run()
    return new Promise(res => this.resolveWork = res)
  }

  hotReload() {
    if (this.config.skipHotReload) return this.reload()
    this.state = 'hotReload'
    this.timeout = setTimeout(this.onTimeout, 5000)
    this.cdp.Runtime.evaluate({expression: `Zen.upgrade(${JSON.stringify(this.codeHash)})`})
    this.codeHash = null
  }

  abort() {
    this.state = 'abort'
    this.timeout = setTimeout(this.onTimeout, 500)
  }

  run() {
    this.state = 'running'
    this.startAt = new Date()
    this.timeout = setTimeout(this.onTimeout, 20 * 1000)
    this.cdp.Runtime.evaluate({expression: `Zen.run(${JSON.stringify(this.test)})`})
  }

  reload() {
    this.state = 'loading'
    this.codeHash = null
    console.log(`[${this.id}] reloading`)
    this.cdp.Page.reload() // TODO navigate to the correct url, in case the test has changed our location
  }

  onTimeout() {
    if (this.state == 'running')
      this.failTest({message: 'Chrome tab timeout'})

    if (this.state == 'abort' || this.state == 'hotReload')
      this.reload()
  }

  onMessageAdded({message}) {
    console.log(`[${this.id}]`, message.text)
    if (message.text == 'Zen.idle') {
      this.state = 'idle'
      if (this.codeHash) this.hotReload()
      if (this.test) this.run()
    }

    if (message.text.startsWith('Zen.hotReload')) {
      clearTimeout(this.timeout)
      if (this.codeHash) this.hotReload() // another change came in while applying this one
      else if (this.test) this.run()
      else this.state = 'idle'
    }

    if (message.text.startsWith('Zen.results ') && this.test) {
      let msg = JSON.parse(message.text.slice(12))
      if (msg.runId != this.test.runId) return
      clearTimeout(this.timeout)
      this.finishTest(msg)
    }
  }

  failTest(error) {
    this.finishTest({runId: this.test.runId, error, fullName: this.test.testName})
  }

  finishTest(msg) {
    msg.time = new Date() - this.startAt
    clearTimeout(this._timeout)
    if (this.resolveWork)
      this.resolveWork(msg)
    this.resolveWork = null
    this.test = null
    this.state = 'idle'
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

    // If an error happens while loading, it's probably bad code
    if (this.state == 'loading') {
      clearTimeout(this.timeout)
      this.state == 'badCode'
    }

    // Some test suites (ie Superhuman) throw random errors that don't actually fail the test promise.
    // I'd like to track these all down and fix, but until then let us silently ignore, like karma.
    else if (this.state == 'running' && this.config.failOnExceptions) {
      clearTimeout(this.timeout)
      this.failTest({message, stack: stack.join('\n')})
    }

    // If there's an error trying to hot reload
    else if (this.state == 'hotReload' || this.state == 'abort') {
      clearTimeout(this.timeout)
      this.reload()
    }
  }
}
