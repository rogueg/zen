const connect = require('connect')
const http = require('http')
const path = require('path')
const url = require('url')
const fs = require('fs')
const serveStatic = require('serve-static')
const WebSocket = require('ws')
const svelte = require('svelte')
const Chrome = require('./chrome')
require('sugar').extend()

let config = require(path.join(process.cwd(), process.argv[2]))
let appRoot = path.resolve(process.cwd(), config.appRoot || '')
let port = config.port || 3100
let testDependencies = (config.testDependencies || []).map(t => t.replace(appRoot, '/base'))

let app = connect()
let server = http.createServer(app).listen(port)

let serveWith404 = (dir) =>
  connect().use(serveStatic(dir)).use((i, o) => { o.statusCode = 404; o.end() })

app.use('/lib', serveWith404(__dirname)) // serve up stuff out of lib
app.use('/base', serveWith404(appRoot)) // base serves things out of the application's root

app.use('/svelte', (req, res) => {
  let name = path.basename(req.url, '.js')
  fs.readFile(path.join(__dirname, name + '.html'), 'utf8', function(err, data) {
    if (err) throw err
    let {code, map} = svelte.compile(data, {format: 'iife', name: name[0].toUpperCase() + name.slice(1)})
    res.end(code)
  })
})

// host worker and head
app.use((req, resp) => {
  let pageType = req.url.match(/^\/worker/) ? 'worker' : 'head'
  let deps = ['/lib/latte.js', '/svelte/mini.js', `/lib/${pageType}.js`].concat(testDependencies)
  let scripts = deps.map(d => `<script src='${d}'></script>`)
  resp.end(scripts.join('\n'))
})

let grep = '' // filter of what tests to run in workers
let codeHash = null // current version of the code
let runId = 0 // unique id for each run. Lets us ignore results from stale runs
let head = null
let workerCount = 8 // no real thought went into this number :)
let workers = Array.construct(workerCount, position => ({position, completed: []}))

let chrome = new Chrome({port: 9222}) // headless chrome instance
workers.forEach(w => chrome.openTab(`http://localhost:${port}/worker?id=${w.position}`, `w${w.position}`).then(t => w.tab = t))

new WebSocket.Server({server}).on('connection', function connection(ws, req) {
  // when a worker starts up, we send it the work it needs to do
  let workerMatch = req.url.match(/\/worker\/(\d+)/)
  if (workerMatch) {
    let worker = workers[parseInt(workerMatch[1])]
    worker.ws = ws
    ws.on('message', workerMessage.bind(null, worker))
    sendWork(worker, false)

  } else {
    head = ws
    ws.on('message', headMessage.bind(null, ws))
  }
})

function headMessage(head, msg) {
  msg = JSON.parse(msg)

  // if our grep hasn't changed, we can just send known results.
  if (msg.grep == grep && !msg.force) {
    let results = workers.reduce((all, w) => all.concat(w.completed), [])
    return wsSend(head, {results})
  }
  grep = msg.grep
  run()
}

function workerMessage(worker, msg) {
  if (msg.runId != runId) return
  msg = JSON.parse(msg)
  worker.completed.push(msg)
  wsSend(head, {results: [msg]})
}

function run() {
  runId++
  workers.map(w => sendWork(w, true))
  wsSend(head, {codeHash, runId})
}

function sendWork(worker, clearCompleted) {
  if (!worker.ws) return
  if (clearCompleted) worker.completed = []
  wsSend(worker.ws, {
    grep, codeHash, workerCount, runId,
    position: worker.position,
    completed: worker.completed.map(r => r.fullName)
  })
}

function wsSend(ws, obj) {
  if (!ws || ws.readyState != WebSocket.OPEN) return
  ws.send(JSON.stringify(obj))
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
