const connect = require('connect')
const http = require('http')
const path = require('path')
const url = require('url')
const fs = require('fs')
const WebSocket = require('ws')
const Util = require('./util')
const Chrome = require('./chrome')

require('sugar').extend()

let config = require(path.join(process.cwd(), process.argv[2]))
let appRoot = path.resolve(process.cwd(), config.appRoot || '')
let port = config.port || 3100
let testDependencies = (config.testDependencies || []).map(t => t.replace(appRoot, '/base'))

let app = connect()
let server = http.createServer(app).listen(port)
app.use('/lib', Util.serveWith404(__dirname)) // serve up stuff out of lib
app.use('/base', Util.serveWith404(appRoot)) // base serves things out of the application's root
app.use('/svelte', Util.serveSvelte)

// host worker and head
app.use((req, resp) => {
  let pageType = req.url.match(/^\/worker/) ? 'worker' : 'head'
  let deps = ['/lib/latte.js', '/svelte/mini.js', `/lib/${pageType}.js`].concat(testDependencies)
  let scripts = deps.map(d => `<script src='${d}'></script>`)
  resp.end(`<body>${scripts.join('\n')}</body>`)
})

let grep = '' // filter of what tests to run in workers
let codeHash = null // current version of the code
let runId = 0 // unique id for each run. Lets us ignore results from stale runs
let head = null
let workers = Array.construct(8, id => ({id}))
let workingSet = [] // list of tests to run each time
let fullRun = false // whether or not we're doing a full run of all tests
let remaining = [] // tests remaining to run
let inProgress = [] // tests in progress on each worker
let results = [] // keeps track of the current run of tests

let chrome = new Chrome({port: 9222}) // headless chrome instance
workers.forEach(w => chrome.openTab(`http://localhost:${port}/worker?id=${w.id}`, `w${w.id}`).then(t => w.tab = t))

new WebSocket.Server({server}).on('connection', function connection(ws, req) {
  // when a worker starts up, we send it the work it needs to do
  let workerMatch = req.url.match(/\/worker\/(\d+)/)
  if (workerMatch) {
    let worker = workers[parseInt(workerMatch[1])]
    worker.ws = ws
    ws.on('message', workerReady.bind(null, worker))
    workerReady(worker, null)

  } else {
    head = ws
    ws.on('message', run)
  }
})

function workerReady(worker, msg) {
  msg = msg && JSON.parse(msg)
  if (msg && msg.runId != runId) return

  if (msg) { // take care of the result we just got
    results.push(msg)
    Util.wsSend(head, {results: [msg]})
    inProgress[worker.id] = null
  }

  let toRun = inProgress[worker.id] || remaining.pop()
  if (toRun) {
    inProgress[worker.id] = toRun
    Util.wsSend(worker.ws, {codeHash, toRun, runId})
  }
}

function run(msg) {
  msg = (msg && JSON.parse(msg)) || {codeChange: true}

  if (msg.reload)
    workers.forEach(w => w.tab.Page.reload())

  if (grep || msg.grep) { // user specifies what to run
    if (msg.grep == grep && !msg.force) return
    workingSet = msg.testNames
    grep = msg.grep
  }

  else if (msg.fullRun) { // requested a full run
    workingSet = msg.testNames
    fullRun = true
  }

  else if (!msg.force && !msg.codeChange) // no need to re-run
    return

  // if we just did a full run, collapse the working set to what failed
  else if (fullRun) {
    workingSet = results.filter(r => r.error).map(r => r.fullName)
    fullRun = false
  }

  runId++
  inProgress = [], results = [], remaining = workingSet.clone()
  workers.forEach(w => workerReady(w))
  Util.wsSend(head, {results, runId, totalCount: workingSet.length})
}

if (config.webpack) {
  const webpack = require('webpack')
  const WebpackDevServer = require('webpack-dev-server')
  testDependencies.push("//localhost:3101/bundle.js")
  config.webpack.entry.push(path.join(__dirname, 'webpack-client.js'))

  config.webpack.plugins.push(new webpack.HotModuleReplacementPlugin())
  config.webpack.plugins.push(new webpack.NamedModulesPlugin())
  const compiler = webpack(config.webpack)

  compiler.plugin("done", (stats) => {
    if (stats.errors && stats.errors.length > 0) return
    codeHash = stats.hash
    run()
  })

  new WebpackDevServer(compiler, {
    stats: {errorDetails: true},
    hot: true,
    headers: {
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Origin': 'http://localhost:3100'
    }
  }).listen(3101, 'localhost', (err, result) => {
    if (err) console.error(err)
  })
}

global.Zen = {head, workers}
