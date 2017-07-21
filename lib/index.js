const connect = require('connect')
const http = require('http')
const path = require('path')
const serveStatic = require('serve-static')

let config = require(path.join(process.cwd(), process.argv[2]))

let appRoot = process.cwd()
if (config.appRoot)
  appRoot = path.resolve(process.cwd(), config.appRoot)

let testDependencies = (config.testDependencies || []).map(t => {
  let path = t.replace(appRoot, '/base')
  return `<script src='${path}'></script>`
})

let app = connect()
app.use('/lib', serveStatic(__dirname)) // serve up stuff out of lib

// serve up stuff out of caller's directory
let base = connect()
base.use(serveStatic(appRoot))
base.use((req, resp) => { resp.statusCode = 404; resp.end() })
app.use('/base', base)

// host worker and head
app.use((req, resp) => {
  let pageType = req.url.match(/^\/worker/) ? 'worker' : 'head'
  resp.end(`<!DOCTYPE html>
    <html><head>
      <title>Zen</title>
    </head><body>
      <script src='/lib/${pageType}.js'></script>
      <script src='/lib/latte.js'></script>
      ${testDependencies.join('\n')}
    </body></html>
  `)
})

http.createServer(app).listen(3100)

if (config.webpack) {
  const webpack = require('webpack')
  const WebpackDevServer = require('webpack-dev-server')
  testDependencies.push("<script src='//localhost:3101/bundle.js'></script>")

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