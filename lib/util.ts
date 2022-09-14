import connect from 'connect'
import serveStatic from 'serve-static'
import path from 'path'
import fs from 'fs'
// @ts-expect-error we depend on such and old version of svelte there is no @types...
import svelte from 'svelte'
import WebSocket from 'ws'
import fetch from 'node-fetch'
import type http from 'http'
import { AWSError } from 'aws-sdk'

export function serveWith404(dir: string): connect.Server {
  return connect()
    .use(serveStatic(dir))
    .use((i, o) => {
      o.statusCode = 404
      o.end()
    })
}

export function serveSvelte(
  req: http.IncomingMessage,
  res: http.ServerResponse
): void {
  if (!req.url) return

  let name = path.basename(req.url, '.js')
  fs.readFile(
    path.join(__dirname, '../lib', name + '.html'),
    'utf8',
    function (err, data) {
      if (err) throw err
      name = name[0].toUpperCase() + name.slice(1)
      try {
        const { js } = svelte.compile(data, {
          format: 'iife',
          name: name,
          store: true,
        })
        const code = js.code.replace(`var ${name} =`, `Zen.${name} =`)
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

let iconCache: string | null = null
export async function serveIcons(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  if (iconCache) return res.end(iconCache)
  const icons: Record<string, string | undefined> = {}
  const root = path.join(__dirname, '../assets')
  await Promise.all(
    fs.readdirSync(root).map(async (fname) => {
      if (!fname.match(/([\w_-]+)\.svg$/)) return null
      // TODO remove sugar
      // @ts-expect-error using a sugar method
      const name: string = RegExp.$1.camelize()
      icons[name] = await readFileAsync(path.join(root, fname))
    })
  )

  iconCache = 'Zen.icons = ' + JSON.stringify(icons)
  res.end(iconCache)
}

export function wsSend(ws: WebSocket, obj: unknown): void {
  if (!ws || ws.readyState != WebSocket.OPEN) return
  ws.send(JSON.stringify(obj), (error: Error | undefined) => {
    if (error) console.error('Websocket error', error)
  })
}

export async function post(url: string, obj: unknown): Promise<unknown> {
  const resp = await fetch(url, { method: 'POST', body: JSON.stringify(obj) })
  const body = await resp.text()

  if (resp.status === 200) {
    return JSON.parse(body)
  } else {
    throw new Error(`Error on ${url}: ${resp.status} ${body}`)
  }
}

export function readFile(p: string, encoding: BufferEncoding = 'utf8'): string {
  ensureDir(path.dirname(p))
  if (!fs.existsSync(p)) return ''
  return fs.readFileSync(p, encoding)
}

export async function readFileAsync(
  p: string,
  encoding: BufferEncoding = 'utf8'
): Promise<string | undefined> {
  ensureDir(path.dirname(p))
  return new Promise((res) => {
    fs.readFile(p, encoding, (_err, data) => res(data))
  })
}

export async function writeFile(p: string, data = ''): Promise<void> {
  ensureDir(path.dirname(p))
  return new Promise((res) => {
    fs.writeFile(p, data, () => res(undefined))
  })
}

export function ensureDir(dir: string): void {
  const parent = path.dirname(dir)
  fs.existsSync(parent) || ensureDir(parent)
  fs.existsSync(dir) || fs.mkdirSync(dir)
}

function isRetryableError(error: Error) {
  return error.message.includes('Rate Exceeded.')
}

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function invoke(
  name: string,
  args: unknown,
  retry = 3
): Promise<unknown> {
  // @ts-expect-error Zen global is janky but I don't want to migrate it right now
  const lambda = Zen.lambda as AWS.Lambda
  try {
    const result = await lambda
      .invoke({ FunctionName: name, Payload: JSON.stringify(args) })
      .promise()

    if (result.StatusCode != 200 || !result.Payload) throw result

    // @ts-expect-error This appears to work :shrug:, it is not worth fixing until real changes here
    const payload = JSON.parse(result.Payload)

    if (payload.errorMessage) {
      const err = new Error(payload.errorMessage)
      throw err
    }
    return payload
  } catch (e) {
    if (retry > 0 && e instanceof Error && isRetryableError(e)) {
      // 10s is arbitrary but hopefully it gives time for things like rate-limiting to resolve
      await timeout(10_000)
      return invoke(name, args, retry - 1)
    }

    throw e
  }
}
