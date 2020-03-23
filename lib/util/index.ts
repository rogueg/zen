import * as connect from 'connect'
import * as serveStatic from 'serve-static'
import * as path from 'path'
import * as fs from 'fs'
import * as svelte from 'svelte'
import * as WebSocket from 'ws'
import * as fetch from 'node-fetch'
import './sugar'

export function serveWith404(dir) {
  return connect().use(serveStatic(dir)).use((_, o) => { o.statusCode = 404; o.end() })
}

export function serveSvelte(req, res) {
  let name = path.basename(req.url, '.js')
  fs.readFile(path.join(__dirname, '../client/', name + '.html'), 'utf8', function (err, data) {
    if (err) throw err
    name = name[0].toUpperCase() + name.slice(1)
    try {
      let {js} = svelte.compile(data, { format: 'iife', name: name, store: true })
      let code = js.code.replace(`var ${name} =`, `Zen.${name} =`)
      res.writeHead(200, {"Content-Type": "application/javascript; charset=utf-8"})
      res.end(code, 'utf8')
    } catch (e) {
      res.statusCode = 500
      console.error(e)
      res.end()
    }
  })
}

let iconCache = null
export async function serveIcons(_, res) {
  if (iconCache) return res.end(iconCache)
  let icons = {}
  let root = path.join(__dirname, '../client/assets')
  await Promise.all(fs.readdirSync(root).map(async (fname: any) => {
    if (!fname.match(/([\w_\-]+)\.svg$/)) return null
    icons[RegExp.$1.camelize()] = await readFileAsync(path.join(root, fname))
  }))

  iconCache = 'Zen.icons = ' + JSON.stringify(icons)
  res.end(iconCache)
}

export function wsSend(ws, obj) {
  if (!ws || ws.readyState != WebSocket.OPEN) return
  ws.send(JSON.stringify(obj), error => {
    if (error)
      console.error('Websocket error', error)
  })
}

export async function post(url, obj) {
  let resp = await fetch(url, {method: 'POST', body: JSON.stringify(obj)})
  let body = await resp.text()

  if (resp.status === 200) {
    return JSON.parse(body)
  } else {
    throw new Error(`Error on ${url}: ${resp.status} ${body}`)
  }
}

export function readFile(p, encoding='utf8') {
  ensureDir(path.dirname(p))
  if (!fs.existsSync(p)) return ''
  return fs.readFileSync(p, encoding)
}

export function readFileAsync(p, encoding='utf8') {
  ensureDir(path.dirname(p))
  return new Promise((res) => {
    fs.readFile(p, encoding, (_, data) => res(data))
  })
}

export function writeFile(p, data) {
  ensureDir(path.dirname(p))
  return new Promise((res) => {
    fs.writeFile(p, data, () => res())
  })
}

export function ensureDir(dir) {
  let parent = path.dirname(dir)
  fs.existsSync(parent) || ensureDir(parent)
  fs.existsSync(dir) || fs.mkdirSync(dir)
}

declare var global: any
export async function invoke(name, args) {
  let result = await global.Zen.lambda.invoke({FunctionName: name, Payload: JSON.stringify(args)}).promise()

  if (result.StatusCode != 200)
    throw new Error(result)

  let payload = JSON.parse(result.Payload)

  if (payload.errorMessage) {
    let err = new Error(payload.errorMessage)
    // err.stack = payload.stackTrace ? payload.stackTrace.join('\n') : err.stack
    throw err
  }

  return payload
}
