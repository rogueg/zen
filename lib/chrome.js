const CDP = require('chrome-remote-interface')
const path = require('path')
const spawn = require('child_process').spawn
const net = require('net')
const fs = require('fs')
const AWS = require('aws-sdk')
import * as ChromeLauncher from 'chrome-launcher'
import * as Util from './util'

module.exports = class ChromeWrapper {
  // locally, we start a headless chrome instance to run tests
  launchLocal(opts) {
    const { width = 800, height = 600 } = Zen.config.chrome || {}
    this.getBrowser = ChromeLauncher.launch({
      port: opts.port,
      chromePath:
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      chromeFlags: ['--headless', '--disable-gpu', `--window-size=${width},${height}`],
    }).then((chrome) => {
      Util.writeFile(path.join(Zen.config.tmpDir, 'chrome.pid'), chrome.pid)
      return CDP({ port: opts.port })
    })
  }

  // Specially tuned to launch from a lambda layer. Inspired by a few projects:
  // https://github.com/alixaxel/chrome-aws-lambda - chrome binaries and most of the flags
  // https://github.com/GoogleChrome/puppeteer - useful reference fo Google' canonical approach
  // https://github.com/adieuadieu/serverless-chrome/tree/master/packages/lambda - the old launch I used to use
  // https://github.com/GoogleChrome/chrome-launcher/ - yet another launcher
  async launchLambda() {
    const { width = 800, height = 600 } = Zen.config.chrome || {}
    let flags = [
      '--disable-background-timer-throttling',
      '--disable-breakpad',
      '--disable-extensions',
      '--disable-client-side-phishing-detection',
      '--disable-cloud-import',
      '--disable-default-apps',
      '--disable-popup-blocking',
      '--disable-dev-shm-usage',
      '--disable-gesture-typing',
      '--disable-print-preview',
      '--disable-prompt-on-repost',
      '--disable-hang-monitor',
      '--disable-infobars',
      '--disable-notifications',
      '--disable-offer-store-unmasked-wallet-cards',
      '--disable-offer-upload-credit-cards',
      '--disable-setuid-sandbox',
      '--disable-speech-api',
      '--disable-sync',
      '--disable-tab-for-desktop-share',
      '--disable-translate',
      '--disable-voice-input',
      '--disable-wake-on-wifi',
      '--enable-async-dns',
      '--enable-simple-cache-backend',
      '--enable-tcp-fast-open',
      '--hide-scrollbars',
      '--media-cache-size=33554432',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-default-browser-check',
      '--no-first-run',
      '--no-pings',
      '--no-sandbox',
      '--no-zygote',
      '--password-store=basic',
      '--prerender-from-omnibox=disabled',
      '--use-mock-keychain',
      '--memory-pressure-off',
      '--enable-webgl',
      '--ignore-gpu-blacklist',
      '--use-gl=swiftshader',
      '--headless',
      '--single-process',
      '--remote-debugging-port=9222',
      `--window-size=${width},${height}`,
      '--user-data-dir=/tmp/chromeUserData',
      '--enable-logging',
      '--log-level=0',
      '--v=1',
      '--disable-web-security', // TODO figure out why S3 fetch requests are blocked, then remove this
      // The default referrer policy was changed in chrome 85, this reverts
      // it to the way it worked before https://www.chromestatus.com/feature/6251880185331712
      '--force-legacy-default-referrer-policy'
    ]

    this.process = spawn(
      await require('chrome-aws-lambda').executablePath,
      flags,
      {
        detached: true,
        env: { ...process.env, TZ: 'America/New_York' },
        stdio: [
          'ignore',
          fs.openSync('/tmp/chrome-out.log', 'a'),
          fs.openSync('/tmp/chrome-err.log', 'a'),
        ],
      }
    )
    console.log('Chrome spawned')

    // Repeatedly try and open a socket to the devtools port
    let connected = false,
      socket
    while (!connected) {
      await new Promise((r) => setTimeout(r, 200))
      connected = await new Promise((resolve) => {
        socket = net.createConnection(9222)
        socket.once('connect', () => resolve(true))
        socket.once('error', () => resolve(false))
      })
      socket.destroy()
    }
    console.log('Connection completed', connected)

    this.s3 = new AWS.S3({ params: { Bucket: process.env.ASSET_BUCKET } })
    this.getBrowser = CDP({ host: 'localhost', port: 9222 })
  }

  async kill() {
    if (this.process) this.process.kill()
  }

  async openTab(url, id, config = {}, manifest) {
    let browser = await this.getBrowser
    let target = await browser.Target.createTarget({ url: 'chrome://about' })
    let cdp = await CDP({ target: target.targetId })
    await Promise.all([
      cdp.Console.enable(),
      cdp.Page.enable(),
      cdp.Runtime.enable(),
      cdp.Network.enable(),
    ])
    await cdp.Fetch.enable({
      patterns: [{ urlPattern: '*', requestStage: 'Request' }],
    })
    await cdp.Target.activateTarget({ targetId: cdp.target })

    let ua = await cdp.Runtime.evaluate({
      expression: 'navigator.userAgent',
      returnByValue: true,
    })
    console.log(`Opening ${url} in ${ua.value}`) // Useful when debugging different versions

    let tab = new ChromeTab(cdp, id, config, manifest, this.s3)
    await cdp.Page.navigate({ url })
    return tab
  }
}

// State is one of:
// loading: waiting for the page to load
// badCode: there was an error while loading. Nothing we can do until the code changes
// idle: Code is loaded, and we're waiting for a test
// hotReload: trying to update without a full page load
// running: a test is in progress
class ChromeTab {
  constructor(cdp, id, config, manifest, s3) {
    this.id = id || 'Dev'
    this.config = config
    this.cdp = cdp
    this.state = 'loading'
    this.manifest = manifest
    this.s3 = s3
    this.codeHash = null // the version we'd like to be running
    this.test = null // the test we're supposed to run
    this.resolveWork = null // function to call when we have test results

    cdp.Console.messageAdded(this.onMessageAdded.bind(this))
    cdp.Runtime.exceptionThrown(this.onExceptionThrown.bind(this))
    cdp.Fetch.requestPaused(this.onRequestPaused.bind(this))
    this.networkLogging() // TODO toggle this on via config

    this.onTimeout = this.onTimeout.bind(this)
    this.timeout = setTimeout(this.onTimeout, 10 * 1000)
  }

  async resizeWindow ({ width, height }) {
    const target = await this.cdp.Browser.getWindowForTarget({targetId: this.cdp.target})
    await this.cdp.Browser.setWindowBounds({
      windowId: target.windowId,
      bounds: { width, height }
    })
  }

  disconnect() {
    return CDP.Close({ id: this.cdp.target }).then(() => {
      return this.cdp.close()
    })
  }

  changeState(state) {
    clearTimeout(this.timeout)
    this.state = state
  }

  setCodeHash(codeHash) {
    this.codeHash = codeHash
    if (this.state == 'idle') this.hotReload()
    else if (this.state == 'badCode') this.reload() // webpack hot reload can't recover from badCode
    // {loading,running,hotReload} will hot reload after they finish
  }

  setTest(opts) {
    if (this.test) this.resolveWork(null) // resolve the previous test

    let promise = new Promise((res) => (this.resolveWork = res))
    this.test = opts

    if (this.state == 'idle') this.run()
    else if (this.state == 'running') this.reload()
    else if (this.state == 'badCode')
      this.failTest(this.badCodeError, this.badCodeStack)
    // {loading,hotReload} will run the test after they finish
    return promise
  }

  getTestNames() {
    let promise = new Promise(
      (resolve, reject) => (this.listRequest = { resolve, reject })
    )
    return promise
  }

  // Attempt to hot reload the latest code
  hotReload() {
    if (this.config.skipHotReload) return this.reload()
    this.changeState('hotReload')
    this.timeout = setTimeout(this.onTimeout, 5000)
    this.cdp.Runtime.evaluate({
      expression: `Zen.upgrade(${JSON.stringify(this.codeHash)})`,
    })
    this.codeHash = null
  }

  run() {
    this.changeState('running')
    this.startAt = new Date()
    this.timeout = setTimeout(this.onTimeout, 20 * 1000)
    this.cdp.Target.activateTarget({ targetId: this.cdp.target }) // force the tab to have focus, otherwise focus events don't fire
    this.cdp.Runtime.evaluate({
      expression: `Zen.run(${JSON.stringify(this.test)})`,
    })
  }

  badCode(msg, stack) {
    this.changeState('badCode')
    this.badCodeError = msg
    this.badCodeStack = stack.join('\n')
    if (this.test) this.failTest(msg, stack.join('\n'))
    if (this.listRequest) this.listRequest.reject(msg)
  }

  async listTests() {
    let { result, exceptionDetails } = await this.cdp.Runtime.evaluate({
      expression: `Latte.flatten().map(t => t.fullName)`,
      returnByValue: true,
    })
    if (exceptionDetails) {
      console.log('ListTest exception', exceptionDetails)
      this.listRequest.reject(exceptionDetails.message)
    }
    this.listRequest.resolve(result.value)
  }

  // We've finished our current task (hotReload or test) safely
  // If there's additional tasks, do them now.
  becomeIdle() {
    this.changeState('idle')
    if (this.codeHash) this.hotReload()
    else if (this.test) this.run()
    else if (this.listRequest) this.listTests()
  }

  reload() {
    this.changeState('loading')
    this.timeout = setTimeout(this.onTimeout, 10 * 1000)
    this.codeHash = null
    this.requestMap = {}
    console.log(`[${this.id}] reloading`)
    this.cdp.Page.reload() // TODO navigate to the correct url, in case the test has changed our location
  }

  onTimeout() {
    if (this.state == 'running') {
      this.failTest('Chrome-level test timeout')
    } else if (this.state == 'hotReload') {
      console.log(`[${this.id}] timeout while hotReloading`)
    } else if (this.state === 'loading') {
      console.log(`[${this.id}] timeout while loading`)
    }

    // If we hit a timeout, the page is likely stuck and we don't really know
    // if it's safe to run tests. The best we can do is reload.
    this.reload()
  }

  onMessageAdded({ message }) {
    const text = message.text
    const register = ((name, cb) => {
      if (text.startsWith(name)) {
        const value = text.slice(name.length).trim()
        console.log(value)
        cb(value && JSON.parse(value))
      }
    })

    register('Zen.idle', () => {
      if (this.state === 'loading') this.becomeIdle()
    })
    register('Zen.hotReload', () => {
      if (this.state === 'hotReload') this.becomeIdle()
    })

    register('Zen.results', () => {
      if (this.state === 'running') {
        let msg = JSON.parse(message.text.slice(12))
        this.finishTest(msg)
        this.becomeIdle()
      }
    })
    register('Zen.resizeWindow', this.resizeWindow.bind(this))
  }

  failTest(error, stack) {
    const result = { error, stack, fullName: this.test.testName }

    this.finishTest(result)
  }

  finishTest(msg) {
    msg.time = new Date() - this.startAt

    if (!this.test.logs || !this.test.logs.console) {
      delete msg.log
    }

    if (this.resolveWork) {
      this.resolveWork(msg)
    }
    this.resolveWork = null
    this.test = null
  }

  onExceptionThrown(opts) {
    let ex = opts.exceptionDetails,
      message

    if (ex.exception && ex.exception.className)
      message = `${ex.exception.className} ${
        ex.exception.description.split('\n')[0]
      }`
    else if (ex.exception.value) message = ex.exception.value
    else message = ex.text

    let stack = (ex.stackTrace && ex.stackTrace.callFrames) || []
    stack = stack.map((f) => `${f.functionName} ${f.url}:${f.lineNumber}`)
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

    // Errors in either of these probably mean it's safer to reload
    else if (this.state === 'abort') this.reload()
    else if (this.state == 'hotReload') this.reload()
  }

  networkLogging() {
    this.requestMap = {}
    this.cdp.Network.requestWillBeSent(({ requestId, request }) => {
      this.requestMap[requestId] = request.url
    })

    this.cdp.Network.loadingFailed(({ requestId }) => {
      console.log('Request failed', this.requestMap[requestId])
      delete this.requestMap[requestId]
    })

    this.cdp.Network.loadingFinished(({ requestId }) => {
      delete this.requestMap[requestId]
    })
  }

  async onRequestPaused({ requestId, request }) {
    let gatewayUrl = process.env.GATEWAY_URL
    let isToGateway = gatewayUrl && request.url.indexOf(gatewayUrl) >= 0
    if (!this.manifest || !isToGateway) {
      return this.cdp.Fetch.continueRequest({ requestId })
    }

    let path = decodeURIComponent(request.url.replace(`${gatewayUrl}/`, ''))
    if (path.match(/^index\.html/)) {
      console.log('sending index')
      let responseHeaders = [{ name: 'Content-Type', value: 'text/html' }]
      let body = Buffer.from(this.manifest.index, 'binary').toString('base64')
      return this.cdp.Fetch.fulfillRequest({
        requestId,
        responseCode: 200,
        responseHeaders,
        body,
      })
    }

    let key = this.manifest.fileMap[path]
    if (key) {
      try {
        let url = `${this.manifest.assetUrl}/${key}`
        console.log(`${path} redirected to ${url}`)
        if (!this.s3) throw new Error('s3 not defined')

        const response = await this.s3
          .getObject({
            Bucket: process.env.ASSET_BUCKET,
            Key: key,
          })
          .promise()
        const responseHeaders = [
          { name: 'Content-Type', value: response.ContentType },
        ]
        const body = response.Body.toString('base64')

        await this.cdp.Fetch.fulfillRequest({
          requestId,
          responseCode: 200,
          body,
          responseHeaders,
        })
      } catch (e) {
        // There is a chance for a redirect or new tab while this s3 request is going through
        // if we try to fulfill a request that has been canceled chrome gets really angry
        console.error(e)
      }
    } else {
      console.log(`${path} missing from manifest`)
      let responseHeaders = [{ name: 'Content-Type', value: 'text/plain' }]
      let body = Buffer.from('Missing from manifest', 'binary').toString(
        'base64'
      )
      this.cdp.Fetch.fulfillRequest({
        requestId,
        responseCode: 404,
        responseHeaders,
        body,
      })
    }
  }
}
