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

let app = require('connect')()
let server = require('http').createServer(app).listen(port)
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
let singleWorker = false // run tests in one worker. Useful for reproducing errors that only happen headless
let workingSet = [] // list of tests to run each time
let fullRun = false // whether or not we're doing a full run of all tests
let remaining = [] // tests remaining to run
let results = [] // keeps track of the current run of tests

let chrome = new Chrome({port: 9222}) // headless chrome instance
workers.forEach(w => chrome.openTab(`http://localhost:${port}/worker?id=${w.id}`, `w${w.id}`).then(t => w.tab = t))

new WebSocket.Server({server}).on('connection', function connection(ws, req) {
  head = ws
  ws.on('message', run)
  sendStatus()
})

function run(msg) {
  msg = typeof(msg) == 'string' && JSON.parse(msg)

  if (msg.hasOwnProperty(singleWorker))
    singleWorker = msg.singleWorker

  if (grep || msg.grep) { // user specifies what to run
    if (msg.grep == grep && !msg.force) return
    workingSet = msg.testNames || workingSet
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
  workers.forEach(runWorker)
  sendStatus()
}

async function runWorker(w) {
  while (remaining.length > 0) {
    let result = await w.tab.assignTest({codeHash, runId, toRun: remaining.pop()})
    if (!result) break // if the run was aborted
    results.push(result)
    Util.wsSend(head, {results: [result]})
  }
}

function sendStatus() {
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
    run({codeChange: true})
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
