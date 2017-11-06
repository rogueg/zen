const connect = require('connect')
const serveStatic = require('serve-static')
const path = require('path')
const fs = require('fs')
const svelte = require('svelte')

module.exports = Util = {}

Util.serveWith404 = function(dir) {
  return connect().use(serveStatic(dir)).use((i, o) => { o.statusCode = 404; o.end() })
}

Util.serveSvelte = function(req, res) {
  let name = path.basename(req.url, '.js')
  fs.readFile(path.join(__dirname, name + '.html'), 'utf8', function (err, data) {
    if (err) throw err
    let { code, map } = svelte.compile(data, { format: 'iife', name: name[0].toUpperCase() + name.slice(1) })
    res.end(code)
  })
}

Util.wsSend = function(ws, obj) {
  if (!ws || ws.readyState != WebSocket.OPEN) return
  ws.send(JSON.stringify(obj))
}
