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
      chromePath: '/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome',
      chromeFlags: ["--headless", "--disable-gpu"]
    }).then(chrome => {
      require('./util').writeFile(path.join(this.config.tmpDir, 'chrome.pid'), chrome.pid)
      return CDP({port: opts.port})
    })
  }

  // On lambda, chrome is already running and we just need to connect to it
  connectToRunning() {
    this.getBrowser = CDP({host: 'localhost', port: 9222})
  }

  openTab(url, id) {
    return this.getBrowser
    .then(browser => browser.Target.createTarget({url: 'chrome://about'}))
    .then(target => CDP({target: target.targetId}))
    .then(cdp => {
      return Promise.all([cdp.Console.enable(), cdp.Page.enable(), cdp.Runtime.enable(), cdp.Network.enable()])
        .then(() => new ChromeTab(cdp, id, url, this.config))
    })
  }
}

// State is one of:
// loading: waiting for the page to load
// badCode: there was an error while loading. Nothing we can do until the code changes
// ready: Code is loaded, and we're waiting for a test
// hotReload: trying to update without a full page load
// running: a test is in progress
// abort: briefly wait for the current test to finish, so we can hot-reload
class ChromeTab {
  constructor(cdp, id, url, config) {
    this.id = id
    this.cdp = cdp
    this.config = config
    this.state = 'loading'
    this.codeHash = null // the version we'd like to be running
    this.test = null // the test we're supposed to run
    this.resolveWork = null // function to call when we have test results

    cdp.Console.messageAdded(this.onMessageAdded.bind(this))
    cdp.Runtime.exceptionThrown(this.onExceptionThrown.bind(this))

    this.requestMap = {}
    cdp.Network.requestWillBeSent(opts => {
      if (!opts.request.url.startsWith('data:'))
        this.requestMap[opts.requestId] = {url: opts.request.url, result: 'pending'}
    })
    cdp.Network.loadingFailed(opts => { if (this.requestMap[opts.requestId]) this.requestMap[opts.requestId].result = 'failed' })
    cdp.Network.loadingFinished(opts => { if (this.requestMap[opts.requestId]) this.requestMap[opts.requestId].result = 'finished' })

    this.onTimeout = this.onTimeout.bind(this)
    this.timeout = setTimeout(this.onTimeout, 10 * 1000)
    cdp.Page.navigate({url})
  }

  disconnect() {
    return CDP.Close({id: this.cdp.target}).then(() => {
      return this.cdp.close()
    })
  }

  changeState(state) {
    clearTimeout(this.timeout)
    this.state = state
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

    let promise = new Promise(res => this.resolveWork = res)
    this.test = opts
    if (this.state == 'running') this.abort()
    if (this.state == 'idle') this.run()
    if (this.state == 'badCode')
      this.failTest(this.badCodeError, this.badCodeStack)
    return promise
  }

  hotReload() {
    if (this.config.skipHotReload) return this.reload()
    this.changeState('hotReload')
    this.timeout = setTimeout(this.onTimeout, 5000)
    this.cdp.Runtime.evaluate({expression: `Zen.upgrade(${JSON.stringify(this.codeHash)})`})
    this.codeHash = null
  }

  abort() {
    this.changeState('abort')
    this.timeout = setTimeout(this.onTimeout, 500)
  }

  run() {
    this.changeState('running')
    this.startAt = new Date()
    this.timeout = setTimeout(this.onTimeout, 20 * 1000)
    this.cdp.Runtime.evaluate({expression: `Zen.run(${JSON.stringify(this.test)})`})
  }

  badCode(msg, stack) {
    this.changeState('badCode')
    this.badCodeError = msg
    this.badCodeStack = stack.join('\n')
    if (this.test)
      this.failTest(msg, stack.join('\n'))
  }

  reload() {
    this.changeState('loading')
    this.timeout = setTimeout(this.onTimeout, 10 * 1000)
    this.codeHash = null
    console.log(`[${this.id}] reloading`)
    this.cdp.Page.reload() // TODO navigate to the correct url, in case the test has changed our location
  }

  onTimeout() {
    if (this.state == 'running') {
      this.failTest('Chrome-level test timeout')
    } else if (this.state == 'abort' || this.state == 'hotReload') {
      console.log(`[${this.id}] timeout while hotReloading`)
    } else if  (this.state === 'loading') {
      console.log(`[${this.id}] timeout while loading`, Object.values(this.requestMap))
    }

    // If we hit a timeout, the page is likely stuck and we don't really know
    // if it's safe to run tests. The best we can do is reload.
    this.reload()
  }

  onMessageAdded({message}) {
    console.log(`[${this.id}]`, message.text)
    if (message.text == 'Zen.idle' && this.state == 'loading') {
      this.changeState('idle')
      if (this.codeHash) this.hotReload()
      if (this.test) this.run()
    }

    if (message.text.startsWith('Zen.hotReload') && this.state == 'hotReload') {
      if (this.codeHash) this.hotReload() // another change came in while applying this one
      else if (this.test) this.run()
      else this.changeState('idle')
    }

    if (message.text.startsWith('Zen.results ') && this.test) {
      let msg = JSON.parse(message.text.slice(12))
      if (msg.runId != this.test.runId) return
      this.finishTest(msg)
      this.changeState('idle')
    }
  }

  failTest(error, stack) {
    this.finishTest({runId: this.test.runId, error, stack, fullName: this.test.testName})
  }

  finishTest(msg) {
    msg.time = new Date() - this.startAt
    if (this.resolveWork)
      this.resolveWork(msg)
    this.resolveWork = null
    this.test = null
  }

  onExceptionThrown(opts) {
    let ex = opts.exceptionDetails, message

    if (ex.exception && ex.exception.className)
      message = `${ex.exception.className} ${ex.exception.description.split('\n')[0]}`
    else if (ex.exception.value)
      message = ex.exception.value
    else
      message = ex.text

    let stack = (ex.stackTrace && ex.stackTrace.callFrames) || []
    stack = stack.map(f => `${f.functionName} ${f.url}:${f.lineNumber}`)
    console.log(`[${this.id}]`, message, stack)

    // If an error happens while loading, your code is bad and we can't run anything
    if (this.state === 'loading') {
      this.badCode(message, stack)
    }

    // Some test suites (ie Superhuman) throw random errors that don't actually fail the test promise.
    // I'd like to track these all down and fix, but until then let us silently ignore, like karma.
    // Since we don't know which exceptions are safe to ignore, just reload.
    else if (this.state === 'running' && this.config.failOnExceptions) {
      this.failTest(message, stack.join('\n'))
      this.reload()
    }

    // If there's an error trying to hot reload
    else if (this.state == 'hotReload' || this.state === 'abort') {
      this.reload()
    }
  }

  onLoadingFailed(opts) {
    if (opts.errorText !== 'net::ERR_ABORTED') {
      console.log(`[${this.id}]`, opts.errorText)
    }
    // TODO: I once had a js file that was 11MB, and Chrome would sometimes fail to load it with `net::ERR_CACHE_WRITE_FAILURE`
    // Reloading sometimes helped, though really you shouldn't have that much js :)
  }
}
