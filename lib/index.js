const connect = require('connect')
const http = require('http')
const path = require('path')
const url = require('url')
const serveStatic = require('serve-static')
const WebSocket = require('ws')

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

// host worker and head
app.use((req, resp) => {
  let pageType = req.url.match(/^\/worker/) ? 'worker' : 'head'
  let deps = [`/lib/${pageType}.js`, '/lib/latte.js'].concat(testDependencies)
  let scripts = deps.map(d => `<script src='${d}'></script>`)
  resp.end(`<!DOCTYPE html><html>
    <head><title>Zen</title></head>
    <body>${scripts.join('\n')}</body>
  </html>`)
})

let heads = [], workers = []

new WebSocket.Server({server}).on('connection', function connection(ws, req) {

  const location = url.parse(req.url, true)
  1
})

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
