const path = require('path')
const http = require('http')
const connect = require('connect')
const WebSocket = require('ws')
const Util = require('./util')
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

    // start up the local webserver for `head` to connect to
    let app = connect()
    let server = http.createServer(app).listen(Zen.config.port)
    app.use('/lib', Util.serveWith404(__dirname)) // serve up stuff out of lib
    app.use('/node_modules', Util.serveWith404(path.resolve(__dirname, '../node_modules'))) // serve up stuff out of lib
    app.use('/base', Util.serveWith404(Zen.config.appRoot)) // base serves things out of the application's root
    app.use('/svelte', Util.serveSvelte)
    app.use('/icons', Util.serveIcons)

    if (Zen.webpack) {
      Zen.webpack.startDevServer(app)
      Zen.webpack.on('status', stats => {
        if (Zen.webpack.status == 'done') {
          this.workers.forEach(w => w.tab && w.tab.setCodeHash(Zen.webpack.compile.hash))
        }
        this.sendStatus() // notify head of the compile status
      })
    }

    Zen.s3Sync.on('status', this.sendStatus.bind(this))

    this.chrome = new ChromeWrapper() // headless chrome instance
    this.chrome.launchLocal({port: 9222})
    new WebSocket.Server({server}).on('connection', this.onWebsocket.bind(this))

    // create a server for each worker. This gives us different origins and isolates things like localStorage
    this.workers = Array.construct(8, id => {
      id = id + 1
      let port = Zen.config.port + id
      http.createServer(app).listen(port)
      let worker = {id, port}
      this.chrome.openTab(`http://localhost:${port}/worker?id=${id}`, `w${id}`, Zen.config)
        .then(t => worker.tab = t)
      return worker
    })

    // host worker and head. NB this should go last after all other `app.use()` calls
    app.use(async (req, resp) => {
      resp.end(Zen.indexHtml(req.url.match(/^\/worker/) ? 'worker' : 'head'))
    })
  }

  run (msg) {
    if (msg.reload)
      this.workers.forEach(w => w.tab.reload())

    if (msg.filterFailed) { // filter down to the tests that failed in the last full run
      this.workingSet = this.results.filter(r => r.error).map(r => r.fullName)

      // if the user changed (but didn't clear) grep, or sent `force`, we should run tests
    } else if (msg.testNames && ((msg.grep != this.grep && msg.grep) || msg.force)) {
      this.workingSet = msg.testNames
      this.grep = msg.grep

    } else // nothing to do. Probably a page load that didn't change the grep
      return

    if (Zen.webpack.status != 'done')
      return // stop for now if the code isn't ready

    this.results = []
    this.passedFocus = []
    this.runId++

    this.grep ? this.runLocally() : this.runOnLambda() // should this be if the tests will take less than x seconds?
    this.sendStatus()
  }

  async runOnLambda () {
    let startingRunId = this.runId
    let runGroups = Zen.journal.groupTests(this.workingSet, Zen.config.lambdaConcurrency)
    this.isLambda = true
    this.workerCount = runGroups.length

    // send manifest to proxy
    await Zen.s3Sync.run(indexHtml('worker', true))
    this.sendStatus()

    runGroups.forEach(async (group, groupIndex) => {
      try {
        let url = Zen.config.proxyUrl + `/index.html?id=L${groupIndex}` // give each lambda worker an id so the batchId is useful
        let response = await Util.invoke('serverless-zen-dev-workTests', {url, testNames: group.tests, Bucket: Zen.config.aws.assetBucket, sessionId: Zen.config.sessionId})
        if (startingRunId !== this.runId) return
        this.onResults(response.body)
      } catch (e) {
        if (startingRunId !== this.runId) return
        this.onResults(testNames.map((fullName, testNumber) => {
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
      if (msg.type === 'run') this.run(msg)
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
      Object.select(this, 'runId results isLambda workerCount, passedFocus'.split(' ')), {
        workingSetLength: this.workingSet.length,
        s3: Zen.s3Sync.status,
        compile: Object.select(Zen.webpack.compile, ['hash', 'status', 'errors', 'percentage', 'message']) // exclude files array, which has contains content
      }
    ))
  }
}
