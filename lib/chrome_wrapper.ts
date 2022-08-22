import Puppeteer from 'puppeteer-core'
import { S3 } from 'aws-sdk'

const localChromeFlags = ['--headless', '--disable-gpu']
const lambdaChromeFlags = [
  '--autoplay-policy=user-gesture-required',
  '--disable-background-networking',
  '--disable-backgrounding-occluded-windows',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--disable-features=AudioServiceOutOfProcess',
  '--disable-ipc-flooding-protection',
  '--disable-renderer-backgrounding',
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
  `--window-size=800,600`,
  '--user-data-dir=/tmp/chromeUserData',
  '--enable-logging',
  '--log-level=0',
  '--v=1',
  '--disable-web-security', // TODO figure out why S3 fetch requests are blocked, then remove this
  // The default referrer policy was changed in chrome 85, this reverts
  // it to the way it worked before https://www.chromestatus.com/feature/6251880185331712
  '--force-legacy-default-referrer-policy',
]

type WindowSize = {
  width: number
  height: number
}

type ChromeTabConfig = {
  skipHotReload: boolean
  failOnExceptions: boolean
}
type ChromeTabState =
  | 'starting'
  | 'idle'
  | 'badCode'
  | 'running'
  | 'hotReload'
  | 'loading'
type log = { console: string[] }
type Test = {
  testName: string
  logs: { console: string }
}
type FileManifest = {
  index: string
  fileMap: Record<string, undefined | string>
  assetUrl: string
}

class ChromeTab {
  codeHash?: string
  test?: Test
  timeout: NodeJS.Timeout
  state: ChromeTabState
  config: ChromeTabConfig
  requestMap: Record<string, string | undefined>

  constructor(
    private browser: Puppeteer.Browser,
    private page: Puppeteer.Page,
    private id: string = 'Dev',
    config: Partial<ChromeTabConfig>,
    private manifest?: FileManifest,
    private s3?: S3
  ) {
    this.config = { skipHotReload: false, failOnExceptions: false, ...config }
    this.state = 'starting'
    this.timeout = setTimeout(this.onTimeout, 10_000)
    this.requestMap = {}
    this.page.setRequestInterception(true)
    this.page.on('request', this.onRequestPaused)
    this.page.on('console', async (message) => {
      console.log(message)
      this.onMessageAdded(message.text())
    })
    this.page.on('error', (error) => {
      this.onExceptionThrown(error)
    })
  }

  async resizeWindow({ width, height }: { width: number; height: number }) {
    return this.page.setViewport({ width, height })
  }

  disconnect() {
    return this.page.close()
  }

  changeState(state: ChromeTabState) {
    clearTimeout(this.timeout)
    this.state = state
  }

  setCodeHash(codeHash: string) {
    this.codeHash = codeHash
    if (this.state === 'idle' || this.state === 'badCode') {
      this.reload()
    }
  }

  resolveWork?: (value: unknown) => void
  setTest(test: Test) {
    if (this.test) {
      this.resolveWork?.(null)
    }

    const promise = new Promise((res) => {
      this.resolveWork = res
    })
    this.test = test
    if (this.state === 'idle') {
      this.run()
    } else if (this.state === 'running') {
      this.reload()
    } else if (this.state === 'badCode') {
      this.failTest(this.badCodeError || '', this.badCodeStack || '')
    }

    return promise
  }

  listRequest?: {
    resolve: (value: unknown) => void
    reject: (reason: unknown) => void
  }
  getTestNames() {
    const promise = new Promise((resolve, reject) => {
      this.listRequest = { resolve, reject }
    })
    return promise
  }

  _evaluate(code: string) {
    return this._retryOnClose(() => this.page.evaluate(code))
  }

  // Attempt to hot reload the latest code
  hotReload() {
    if (this.config.skipHotReload) {
      return this.reload()
    }

    this.changeState('hotReload')
    this.timeout = setTimeout(this.onTimeout, 5_000)
    this._evaluate(`Zen.upgrade(${JSON.stringify(this.codeHash)})`)
    this.codeHash = undefined
  }

  startAt?: Date
  async run() {
    this.changeState('running')
    this.startAt = new Date()
    this.timeout = setTimeout(this.onTimeout, 20_000)

    await this._retryOnClose(() => this.page.focus('body'))
    this.page.evaluate(`Zen.run(${JSON.stringify(this.test)})`)
  }

  badCodeError?: string
  badCodeStack?: string
  badCode(msg: string, stack: string[]) {
    this.changeState('badCode')
    this.badCodeError = msg
    this.badCodeStack = stack.join('\n')

    if (this.test) {
      this.failTest(msg, stack.join('\n'))
    }
    if (this.listRequest) {
      this.listRequest.reject(msg)
    }
  }

  async listTests() {
    // TODO clean up this typing
    const { result, exceptionDetails } = (await this._evaluate(
      `Latte.flatten().map(t => t.fullName)`
    )) as { result: { value: string }; exceptionDetails: { message: string } }

    // TODO there should be a way to encode listRequest in the types as non-nullable
    if (!this.listRequest) {
      throw new Error('this.listRequest is not defined when listing tests')
    }

    if (exceptionDetails) {
      console.log('ListTest exception', exceptionDetails)
      this.listRequest.reject(exceptionDetails.message)
    }
    this.listRequest.resolve(result.value)
  }

  becomeIdle() {
    this.changeState('idle')
    if (this.codeHash) this.hotReload()
    else if (this.test) this.run()
    else if (this.listRequest) this.listTests()
  }

  async _retryOnClose<A>(cb: () => A): Promise<A | undefined> {
    try {
      return await cb()
    } catch (e) {
      if (e instanceof Error && e.message.includes('Session closed')) {
        const oldUrl = this.page.url()
        this.page = await this.browser.newPage()
        await this.page.goto(oldUrl)
        return await cb()
      }
    }
  }

  async reload() {
    this.changeState('loading')
    this.timeout = setTimeout(this.onTimeout, 10 * 1000)
    this.codeHash = undefined
    this.requestMap = {}
    console.log(`[${this.id}] reloading`)
    // TODO navigate to the correct url, in case the test has changed our location
    return await this._retryOnClose(() => this.page.reload())
  }

  onTimeout = () => {
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

  onMessageAdded(text: string) {
    const register = (name: string, cb: (value?: unknown) => void) => {
      if (text.startsWith(name)) {
        const value = text.slice(name.length).trim()
        console.log(value)
        cb(value && JSON.parse(value))
      }
    }

    register('Zen.idle', () => {
      if (this.state === 'loading') this.becomeIdle()
    })
    register('Zen.hotReload', () => {
      if (this.state === 'hotReload') this.becomeIdle()
    })

    register('Zen.results', () => {
      if (this.state === 'running') {
        const msg = JSON.parse(text.slice(12))
        this.finishTest(msg)
        this.becomeIdle()
      }
    })
    register('Zen.resizeWindow', (args) => {
      this.resizeWindow(args)
    })
  }

  failTest(error: string, stack = '') {
    const result = { error, stack, fullName: this.test?.testName || '' }

    this.finishTest(result)
  }

  finishTest(rawMessage: {
    error?: string
    stack?: string
    fullName: string
    log?: log
  }) {
    const message = {
      ...rawMessage,
      time: this.startAt && new Date().getTime() - this.startAt.getTime(),
    }

    if (!this.test?.logs || !this.test.logs.console) {
      delete message.log
    }

    if (this.resolveWork) {
      this.resolveWork(message)
    }

    this.resolveWork = undefined
    this.test = undefined
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
    } else if (this.state == 'hotReload') this.reload()
  }

  onRequestPaused = async (request: Puppeteer.HTTPRequest) => {
    const gatewayUrl = process.env.GATEWAY_URL
    const requestUrl = request.url()
    const isToGateway = gatewayUrl && requestUrl.indexOf(gatewayUrl) >= 0

    const defaultReturn = async () => {
      try {
        return request.continue()
      } catch (error) {
        console.error('Non-fatal error from cdp.Fetch.continueRequest', error)
      }
    }

    if (!this.manifest || !isToGateway) {
      return defaultReturn()
    }

    const path = decodeURIComponent(requestUrl.replace(`${gatewayUrl}/`, ''))
    if (path.match(/^index\.html/)) {
      return request.respond({
        status: 200,
        contentType: 'text/html',
        body: this.manifest.index,
      })
    }

    const key = this.manifest.fileMap[path]
    if (key) {
      try {
        const url = `${this.manifest.assetUrl}/${key}`
        console.log(`${path} redirected to ${url}`)
        if (!this.s3) throw new Error('s3 not defined')
        if (!process.env.ASSET_BUCKET)
          throw new Error('ASSET_BUCKET is not defined')

        const response = await this.s3
          .getObject({
            Bucket: process.env.ASSET_BUCKET,
            Key: key,
          })
          .promise()
        const body = response.Body?.toString()

        await request.respond({
          status: 200,
          contentType: response.ContentType,
          body,
        })
      } catch (e) {
        // There is a chance for a redirect or new tab while this s3 request is going through
        // if we try to fulfill a request that has been canceled chrome gets really angry
        console.error(e)
      }
    } else {
      console.log(`${path} missing from manifest`)
      return request.respond({
        status: 404,
        body: 'Missing from manifest',
        headers: { 'Content-Type': 'text/plain' },
      })
    }
  }
}

export default class ChromeWrapper {
  browser?: Promise<Puppeteer.Browser>
  s3?: S3

  async launchLocal({
    port,
    windowSize: { width, height } = { width: 800, height: 600 },
  }: {
    port: number
    windowSize: WindowSize
  }): Promise<void> {
    try {
      // When running locally, just use puppeteer because it bundles chromium with it
      const Puppeteer = require('puppeteer')
      this.browser = Puppeteer.launch({
        debuggingPort: port,
        headless: true,
        args: [...localChromeFlags, `--window-size=${width},${height}`],
      })
    } catch (e) {
      console.error(e)
    }
  }

  async launchLambda(): Promise<Puppeteer.Browser | undefined> {
    try {
      this.s3 = new S3({ params: { Bucket: process.env.ASSET_BUCKET } })
      const executablePath = await require('chrome-aws-lambda').executablePath
      this.browser = Puppeteer.launch({
        debuggingPort: 9222,
        executablePath,
        env: { ...process.env, TZ: 'America/New_York' },
        args: lambdaChromeFlags,
      })
      return await this.browser
    } catch (e) {
      console.error(e)
    }
  }

  async openTab(
    url: string,
    id: string,
    config: ChromeTabConfig,
    manifest?: FileManifest
  ): Promise<ChromeTab> {
    if (!this.browser) throw new Error('Browser not setup')

    const browser = await this.browser
    const page = await browser.newPage()
    const tab = new ChromeTab(browser, page, id, config, manifest, this.s3)

    // TODO clean up order, right now it makes tab before goto to make the url stuff work properly
    await page.goto(url)
    return tab
  }

  async kill(): Promise<void> {
    if (!this.browser) return
    const browser = await this.browser

    return browser.close()
  }
}
