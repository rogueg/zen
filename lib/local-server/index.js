const path = require('path')
const http = require('http')
const connect = require('connect')
const WebSocket = require('ws')
const Util = require('../util')
const ChromeWrapper = require('./chrome')

module.exports = class Server {
  constructor () {
    this.runId = 1
    this.head = null
    this.workers = Array.construct(8, id => ({id: id + 1}))
    this.isLambda = false
    this.workerCount = 0
    this.workingSet = []
    this.results = [] // results of all tests run
    this.passedFocus = [] // all tests that passed after running

    const {app, server} = this.createWebApp(Zen.config)
    this.startWebpackServer(Zen.webpack, app)

    Zen.s3Sync.on('status', this.sendStatus.bind(this))
    new WebSocket.Server({server}).on('connection', this.onWebsocket.bind(this))

    this.chrome = new ChromeWrapper() // headless chrome instance
    this.chrome.launchLocal({port: 9222})

    this.startWorkers(Zen.config, app)
  }

  createWebApp(config) {
    // start up the local webserver for `head` to connect to
    const app = connect()
    const server = http.createServer(app).listen(config.port)
    app.use('/lib', Util.serveWith404(path.join(__dirname, '..'))) // serve up stuff out of lib
    app.use('/node_modules', Util.serveWith404(path.resolve(config.appRoot, './node_modules'))) // TODO: this doesn't work when yarn link'd
    app.use('/base', Util.serveWith404(config.appRoot)) // base serves things out of the application's root
    app.use('/svelte', Util.serveSvelte)
    app.use('/icons', Util.serveIcons)

    // host worker and head
    app.use(async (req, resp, next) => {
      let pageType
      if (req.url.match(/^\/worker/)) {
        pageType = 'worker'
      } else {
        const pathname = req._parsedUrl.pathname
        if (pathname.match(/^\/(index(\.htm(l)?)?)?$/)) {
          pageType = 'head'
        }
      }

      if (pageType) {
        resp.end(Zen.indexHtml(pageType))
      } else {
        next()
      }
    })

    return {app, server}
  }

  startWebpackServer(webpack, app) {
    if (webpack) {
      webpack.startDevServer(app)
      webpack.on('status', stats => {
        if (webpack.status == 'done') {
          this.workers.forEach(w => w.tab && w.tab.setCodeHash(webpack.compile.hash))
        }
        this.sendStatus() // notify head of the compile status
      })
    }
  }

  startWorkers(config, app) {
    // create a server for each worker. This gives us different origins and isolates things like localStorage
    this.workers = Array.construct(8, id => {
      id = id + 1
      let port = config.port + id
      http.createServer(app).listen(port)
      let worker = {id, port}
      this.chrome.openTab(`http://localhost:${port}/worker?id=${id}`, `w${id}`, config)
        .then(t => worker.tab = t)
        .catch(e => console.error(e.message))
      return worker
    })
  }

  filterTests (msg) {
    // If nothing has changed and we're not running, leave the state unchanged.
    // When you refresh `head`, we don't want to run or clear out results unless the grep changed.
    if (!msg.run && this.grep === msg.grep) return

    if (msg.failed) {
      this.workingSet = this.results.filter(r => r.error).map(r => r.fullName)
    } else {
      this.workingSet = msg.testNames
    }

    this.grep = msg.grep
    this.results = []
    this.passedFocus = []

    if (msg.run && Zen.webpack.status == 'done') {
      if (msg.reload)
        this.workers.forEach(w => w.tab.reload())
      this.runId++
      this.grep ? this.runLocally() : this.runOnLambda() // should this be if the tests will take less than x seconds?
      this.sendStatus()
    }
  }

  async runOnLambda () {
    let startingRunId = this.runId
    let runGroups = Zen.journal.groupTests(this.workingSet, Zen.config.lambdaConcurrency)
    this.isLambda = true
    this.workerCount = runGroups.length

    // send manifest to proxy
    await Zen.s3Sync.run(Zen.indexHtml('worker', true))
    this.sendStatus()

    runGroups.forEach(async (group, workerId) => {
      try {
        let response = await Util.invoke('zen-workTests', {testNames: group.tests, sessionId: Zen.config.sessionId})
        if (startingRunId !== this.runId) return
        this.onResults(response)
      } catch (e) {
        if (startingRunId !== this.runId) return
        this.onResults(group.tests.map((fullName, testNumber) => {
          return {error: e.message, fullName, batchId: workerId, testNumber}
        }))
      }
    })
  }

  async runLocally() {
    let startingRunId = this.runId, remaining = this.workingSet.clone()
    this.isLambda = false
    this.workerCount = this.workers.length

    this.workers.forEach(async w => {
      while (remaining.length > 0) {
        let result = await w.tab.setTest({testName: remaining.pop()})
        if (!result || startingRunId !== this.runId) break // if the run was aborted
        this.onResults([result])
      }
    })
  }

  onWebsocket (ws) {
    this.head = ws
    ws.on('message', msg => {
      msg = JSON.parse(msg)
      if (msg.type === 'filterTests') this.filterTests(msg)
      if (msg.type === 'passedFocus') this.passedFocus.push(msg.test)
      this.sendStatus()
    })
    ws.on('error', err => {
      console.error('Websocket error', err)
      this.head = null
    })
    this.sendStatus()
  }

  onResults (step) {
    this.results.push.apply(this.results, step)
    step.forEach(r => Zen.journal.record(r))
    Util.wsSend(this.head, {results: step})
  }

  sendStatus () {
    Util.wsSend(this.head, Object.assign(
      Object.select(this, 'runId results isLambda workerCount passedFocus'.split(' ')), {
        workingSetLength: this.workingSet.length,
        s3: Zen.s3Sync.status,
        compile: Object.select(Zen.webpack.compile, ['hash', 'status', 'errors', 'percentage', 'message']) // exclude files array, which has contains content
      }
    ))
  }
}
