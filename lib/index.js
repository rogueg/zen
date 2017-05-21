const connect = require('connect')
const http = require('http')
const path = require('path')
const serveStatic = require('serve-static')
const webpack = require('webpack')
const WebpackDevServer = require('webpack-dev-server')

let config = require(path.join(process.cwd(), process.argv[2]))

let appRoot = process.cwd()
if (config.appRoot)
  appRoot = path.resolve(process.cwd(), config.appRoot)

let app = connect()
app.use('/lib', serveStatic(__dirname)) // serve up stuff out of lib

// serve up stuff out of caller's directory
let base = connect()
base.use(serveStatic(appRoot))
base.use((req, resp) => { resp.statusCode = 404; resp.end() })
app.use('/base', base)

// host worker and head
app.use((req, resp) => {
  if (req.url.match(/^\/worker/)) {
    resp.end(makeWorker())
  } else
    resp.end(makeHtml(`
      <script src='/lib/head.js'></script>
    `))
})

http.createServer(app).listen(3100)

config.webpack.plugins.push(new webpack.HotModuleReplacementPlugin())
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

function makeWorker() {
  // testDependencies are things like chai/sinon. Equivalent to karma's frameworks
  deps = (config.testDependencies || []).map(t => {
    let path = t.replace(appRoot, '/base')
    return `<script src='${path}'></script>`
  })

  return makeHtml(`
    <script>window._workerId = ${1}</script>
    <script src='/lib/worker.js'></script>
    <script src='/lib/latte.js'></script>
    ${deps.join('\n')}
    <script src='//localhost:3101/bundle.js'></script>
  `)
}

function makeHtml(body) {
  return `<!DOCTYPE html>
    <html><head>
      <title>Zen</title>
    </head><body>
      ${body}
    </body></html>`
}
