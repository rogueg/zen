const connect = require('connect')
const serveStatic = require('serve-static')
const path = require('path')
const fs = require('fs')
const svelte = require('svelte')
const WebSocket = require('ws')
const AWS = require('aws-sdk')

module.exports = Util = {}

Util.serveWith404 = function(dir) {
  return connect().use(serveStatic(dir)).use((i, o) => { o.statusCode = 404; o.end() })
}

Util.serveSvelte = function(req, res) {
  let name = path.basename(req.url, '.js')
  fs.readFile(path.join(__dirname, name + '.html'), 'utf8', function (err, data) {
    if (err) throw err
    name = name[0].toUpperCase() + name.slice(1)
    try {
      let { code, map } = svelte.compile(data, { format: 'iife', name: name, store: true })
      code = code.replace(`var ${name} =`, `Zen.${name} =`)
      res.end(code)
    } catch (e) {
      res.statusCode = 500
      console.error(e)
      res.end()
    }
  })
}

Util.wsSend = function(ws, obj) {
  if (!ws || ws.readyState != WebSocket.OPEN) return
  ws.send(JSON.stringify(obj))
}

Util.readFile = function(p) {
  Util.ensureDir(path.dirname(p))
  if (!fs.existsSync(p)) return ''
  return fs.readFileSync(p)
}

Util.readFileAsync = function(p) {
  Util.ensureDir(path.dirname(p))
  return new Promise((res, rej) => {
    fs.readFile(p, (err, data) => res(data))
  })
}

Util.writeFile = function (p, data) {
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

Util.invoke = async function(lambda, name, args) {
  let result = await lambda.invoke({FunctionName: name, Payload: JSON.stringify(args)}).promise()

  if (result.StatusCode != 200)
    throw new Error(result)

  let payload = JSON.parse(result.Payload)

  if (result.errorMessage)
    throw new Error(result.errorMessage)

  return payload
}

Util.semaphore = function() {
  let resolve = null, reject = null
  let promise = new Promise((rl, rj) => { resolve = rl; reject = rj })
  promise.resolve = resolve
  promise.reject = reject
  return promise
}
