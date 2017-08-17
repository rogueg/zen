const connect = require('connect')
const http = require('http')
const path = require('path')
const url = require('url')
const fs = require('fs')
const serveStatic = require('serve-static')
const WebSocket = require('ws')
const svelte = require('svelte')

let config = require(path.join(process.cwd(), process.argv[2]))

let appRoot = process.cwd()
if (config.appRoot)
  appRoot = path.resolve(process.cwd(), config.appRoot)

let testDependencies = (config.testDependencies || []).map(t => t.replace(appRoot, '/base'))

let app = connect()
let server = http.createServer(app).listen(config.port || 3100)

let serveWith404 = (dir) =>
  connect().use(serveStatic(dir)).use((i, o) => { o.statusCode = 404; o.end() })

app.use('/lib', serveWith404(__dirname)) // serve up stuff out of lib
app.use('/base', serveWith404(appRoot)) // base serves things out of the application's root

app.use('/ui', (req, res) => {
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
  let deps = ['/lib/latte.js', '/ui/mini.js', `/lib/${pageType}.js`].concat(testDependencies)
  let scripts = deps.map(d => `<script src='${d}'></script>`)
  resp.end(`<!DOCTYPE html><html>
    <head><title>Zen</title></head>
    <body>${scripts.join('\n')}</body>
  </html>`)
})

let grep = ''
let workerCount = 1
let heads = [], workers = []

for(let i=0; i<workerCount; i++)
  workers.push({position: i, completed: []})

new WebSocket.Server({server}).on('connection', function connection(ws, req) {
  // when a worker starts up, we send it the work it needs to do
  let workerMatch = req.url.match(/\/worker\/(\d+)/)
  if (workerMatch) {
    let worker = workers[parseInt(workerMatch[1])]
    worker.ws = ws
    ws.on('message', workerMessage.bind(null, worker))
    sendWork(worker)

  // when a head starts up, we send all the known test results
  } else {
    heads.push(ws)
    ws.on('close', () => heads = heads.splice(heads.indexOf(ws), 1))
    ws.on('message', headMessage.bind(null, ws))
  }
})

function headMessage(head, msg) {
  msg = JSON.parse(msg)
  if (msg.grep == grep) {
    let results = workers.reduce((all, w) => all.concat(w.completed), [])
    wsSend(head, {results})
  } else {
    grep = msg.grep
    workers.map(w => {
      w.completed = []
      sendWork(w)
    })
  }
}

function workerMessage(worker, msg) {
  msg = JSON.parse(msg)
  worker.completed.push(msg)
  heads.map(h => wsSend(h, {results: [msg]}))
}

function sendWork(worker) {
  if (!worker.ws) return
  wsSend(worker.ws, {
    grep: grep,
    position: worker.position,
    count: workerCount,
    completed: worker.completed.map(r => r.name)
  })
}

function wsSend(ws, obj) {
  if (ws.readyState != WebSocket.OPEN) return
  ws.send(JSON.stringify(obj))
}

if (config.webpack) {
  const webpack = require('webpack')
  const WebpackDevServer = require('webpack-dev-server')
  testDependencies.push("//localhost:3101/bundle.js")

  config.webpack.plugins.push(new webpack.HotModuleReplacementPlugin())
  config.webpack.plugins.push(new webpack.NamedModulesPlugin())

  new WebpackDevServer(webpack(config.webpack), {
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
