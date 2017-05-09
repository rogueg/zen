const connect = require('connect')
const http = require('http')
const path = require('path')
const serveStatic = require('serve-static')

const app = connect()

// serve up any file in the directory
app.use(serveStatic(path.join(__dirname, '..')))

app.use((req, resp) => {
  if (req.url.match(/^\/worker/))
    resp.end(makeHtml(`
      <script>window._workerId = ${1}</script>
      <script src='/lib/worker.js'></script>
    `))
  else
    resp.end(makeHtml(`
      <script src='/lib/head.js'></script>
    `))
})

http.createServer(app).listen(3111);

function makeHtml(body) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Zen</title>
    </head>
    <body>
      ${body}
    </body>
    </html>
  `
}
