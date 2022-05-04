const connect = require('connect')
const serveStatic = require('serve-static')
const path = require('path')
const fs = require('fs')
const svelte = require('svelte')
const WebSocket = require('ws')
const fetch = require('node-fetch')

module.exports = Util = {}

Util.serveWith404 = function (dir) {
  return connect()
    .use(serveStatic(dir))
    .use((i, o) => {
      o.statusCode = 404
      o.end()
    })
}

Util.serveSvelte = function (req, res) {
  let name = path.basename(req.url, '.js')
  fs.readFile(
    path.join(__dirname, '../lib', name + '.html'),
    'utf8',
    function (err, data) {
      if (err) throw err
      name = name[0].toUpperCase() + name.slice(1)
      try {
        let { js, css } = svelte.compile(data, {
          format: 'iife',
          name: name,
          store: true,
        })
        let code = js.code.replace(`var ${name} =`, `Zen.${name} =`)
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
        })
        res.end(code, 'utf8')
      } catch (e) {
        res.statusCode = 500
        console.error(e)
        res.end()
      }
    }
  )
}

let iconCache = null
Util.serveIcons = async function (req, res) {
  if (iconCache) return res.end(iconCache)
  let icons = {}
  let root = path.join(__dirname, '../assets')
  await Promise.all(
    fs.readdirSync(root).map(async (fname) => {
      if (!fname.match(/([\w_\-]+)\.svg$/)) return null
      icons[RegExp.$1.camelize()] = await Util.readFileAsync(
        path.join(root, fname)
      )
    })
  )

  iconCache = 'Zen.icons = ' + JSON.stringify(icons)
  res.end(iconCache)
}

Util.wsSend = function (ws, obj) {
  if (!ws || ws.readyState != WebSocket.OPEN) return
  ws.send(JSON.stringify(obj), (error) => {
    if (error) console.error('Websocket error', error)
  })
}

Util.post = async function (url, obj) {
  let resp = await fetch(url, { method: 'POST', body: JSON.stringify(obj) })
  let body = await resp.text()

  if (resp.status === 200) {
    return JSON.parse(body)
  } else {
    throw new Error(`Error on ${url}: ${resp.status} ${body}`)
  }
}

Util.readFile = function (p, encoding) {
  if (encoding === undefined) encoding = 'utf8'
  Util.ensureDir(path.dirname(p))
  if (!fs.existsSync(p)) return ''
  return fs.readFileSync(p, encoding)
}

Util.readFileAsync = async function (p, encoding) {
  if (encoding === undefined) encoding = 'utf8'
  Util.ensureDir(path.dirname(p))
  return new Promise((res, rej) => {
    fs.readFile(p, encoding, (err, data) => res(data))
  })
}

Util.writeFile = async function (p, data = '') {
  Util.ensureDir(path.dirname(p))
  return new Promise((res, rej) => {
    fs.writeFile(p, data, (err) => res())
  })
}

Util.ensureDir = function (dir) {
  let parent = path.dirname(dir)
  fs.existsSync(parent) || Util.ensureDir(parent)
  fs.existsSync(dir) || fs.mkdirSync(dir)
}

Util.invoke = async function (name, args) {
  let result = await Zen.lambda
    .invoke({ FunctionName: name, Payload: JSON.stringify(args) })
    .promise()

  if (result.StatusCode != 200) throw new Error(result)

  let payload = JSON.parse(result.Payload)

  if (payload.errorMessage) {
    let err = new Error(payload.errorMessage)
    // err.stack = payload.stackTrace ? payload.stackTrace.join('\n') : err.stack
    throw err
  }

  return payload
}
