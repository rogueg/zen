const path = require('path')
const http = require('http')
const connect = require('connect')
const WebSocket = require('ws')
const Util = require('./util')
const ChromeWrapper = require('./chrome_wrapper').default

module.exports = class Server {
  constructor() {
    this.runId = 1
    this.head = null
    this.workers = Array.construct(8, (id) => ({ id: id + 1 }))
    this.isLambda = false
    this.workerCount = 0
    this.workingSet = []
    this.results = [] // results of all tests run
    this.passedFocus = [] // all tests that passed after running

    // start up the local webserver for `head` to connect to
    let app = connect()
    let server = http.createServer(app).listen(Zen.config.port)
    app.use('/build', Util.serveWith404(path.join(__dirname))) // serve up stuff out of lib
    app.use(
      '/node_modules',
      Util.serveWith404(path.resolve(Zen.config.appRoot, './node_modules'))
    ) // serve up stuff out of lib
    app.use('/base', Util.serveWith404(Zen.config.appRoot)) // base serves things out of the application's root
    app.use('/svelte', Util.serveSvelte)
    app.use('/icons', Util.serveIcons)

    if (Zen.webpack) {
      Zen.webpack.startDevServer(app)
      Zen.webpack.on('status', (stats) => {
        if (Zen.webpack.status == 'done') {
          this.workers.forEach(
            (w) => w.tab && w.tab.setCodeHash(Zen.webpack.compile.hash)
          )
        }
        this.sendStatus() // notify head of the compile status
      })
    }

    Zen.s3Sync.on('status', this.sendStatus.bind(this))

    this.chrome = new ChromeWrapper() // headless chrome instance
    this.chrome.launchLocal({ port: 9222 })
    new WebSocket.Server({ server }).on(
      'connection',
      this.onWebsocket.bind(this)
    )

    // create a server for each worker. This gives us different origins and isolates things like localStorage
    this.workersPromises = []
    this.workers = Array.construct(8, (id) => {
      id = id + 1
      let port = Zen.config.port + id
      http.createServer(app).listen(port)
      let worker = { id, port }
      this.workersPromises.push(this.chrome
          .openTab(
              `http://localhost:${port}/worker?id=${id}`,
              `w${id}`,
              Zen.config,
              { }
          )
          .then((t) => {
            console.log("TAB", t)
            worker.tab = t
          })
      )
      return worker
    })

    // host worker and head. NB this should go last after all other `app.use()` calls
    app.use(async (req, resp) => {
      resp.end(Zen.indexHtml(req.url.match(/^\/worker/) ? 'worker' : 'head'))
    })
  }

  filterTests(msg) {
    // If nothing has changed and we're not running, leave the state unchanged.
    // When you refresh `head`, we don't want to run or clear out results unless the grep changed.
    if (!msg.run && this.grep === msg.grep) return

    if (msg.failed) {
      this.workingSet = this.results
        .filter((r) => r.error)
        .map((r) => r.fullName)
    } else {
      this.workingSet = msg.testNames
    }

    this.grep = msg.grep
    this.results = []
    this.passedFocus = []

    if (msg.run && Zen.webpack.status == 'done') {
      if (msg.reload) {
        this.workers.forEach((w) => w.tab.reload())
      }

      this.runId++
      this.grep ? this.runLocally() : this.runOnLambda(msg) // should this be if the tests will take less than x seconds?
      this.sendStatus()
    }
  }

  async runOnLambda({ logs }) {
    let startingRunId = this.runId
    let runGroups = Zen.journal.groupTests(
      this.workingSet,
      Zen.config.lambdaConcurrency
    )
    this.isLambda = true
    this.workerCount = runGroups.length

    // send manifest to proxy
    await Zen.s3Sync.run(Zen.indexHtml('worker', true))
    this.sendStatus()

    runGroups.forEach(async (group) => {
      const testNames = group.tests
      try {
        let response = await Util.invoke(Zen.config.lambdaNames.workTests, {
          testNames,
          sessionId: Zen.config.sessionId,
          logs,
        })
        if (startingRunId !== this.runId) return
        this.onResults(response)
      } catch (e) {
        if (startingRunId !== this.runId) return
        this.onResults(
          testNames.map((fullName, testNumber) => {
            return {
              error: e.message,
              fullName,
              // batchId: workerId,
              testNumber,
            }
          })
        )
      }
    })
  }

  async runLocally() {
    let startingRunId = this.runId,
      remaining = this.workingSet.clone()
    this.isLambda = false
    this.workerCount = this.workers.length
    await Promise.all(this.workersPromises)
    console.log(this.workers)
    this.workers.forEach(async (w) => {
      while (remaining.length > 0) {
        let result = await w.tab.setTest({ testName: remaining.pop() })
        if (!result || startingRunId !== this.runId) break // if the run was aborted
        this.onResults([result])
      }
    })
  }

  onWebsocket(ws) {
    this.head = ws
    ws.on('message', (msg) => {
      msg = JSON.parse(msg)
      if (msg.type === 'filterTests') this.filterTests(msg)
      if (msg.type === 'passedFocus') this.passedFocus.push(msg.test)
      this.sendStatus()
    })
    ws.on('error', (err) => {
      console.error('Websocket error', err)
      this.head = null
    })
    this.sendStatus()
  }

  onResults(step) {
    this.results.push.apply(this.results, step)
    step.forEach((r) => Zen.journal.record(r))
    Util.wsSend(this.head, { results: step })
  }

  sendStatus() {
    Util.wsSend(
      this.head,
      Object.assign(
        Object.select(
          this,
          'runId results isLambda workerCount passedFocus'.split(' ')
        ),
        {
          workingSetLength: this.workingSet.length,
          s3: Zen.s3Sync.status,
          compile: Object.select(Zen.webpack.compile, [
            'hash',
            'status',
            'errors',
            'percentage',
            'message',
          ]), // exclude files array, which has contains content
        }
      )
    )
  }
}
