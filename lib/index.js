const path = require('path')
const url = require('url')
const fs = require('fs')
const os = require('os')
const https = require('https')
const WebSocket = require('ws')
const Util = require('./util')
const Chrome = require('./chrome')
const AWS = require('aws-sdk')
const S3Sync = require('./s3-sync')
const shuffleSeed = require('shuffle-seed')

require('sugar').extend()

// load the config with some defaults
let config = require(path.join(process.cwd(), process.argv[2]))
let appRoot = path.resolve(process.cwd(), config.appRoot || '')
let port = config.port || 3100
let testDependencies = config.testDependencies || []
config.s3Url = `https://s3-${config.aws.region}.amazonaws.com/${config.aws.assetBucket}/${config.aws.assetPrefix}/index.html`

// tmpDir is where we cache files between runs
config.tmpDir = path.join(config.tmpDir || os.tmpdir(), 'zen')
Util.ensureDir(config.tmpDir)
console.log('Using tmpDir', config.tmpDir)

let runId = 1
let grep = null
let compile = {status: 'compiling'}
let firstCompile = Util.semaphore()
let head = null
let workers = Array.construct(8, id => ({id}))
let lambdaCount = 0
let workingSet = []
let remaining = []
let results = []

AWS.config.update(config.aws)
let s3Sync = new S3Sync(config, sendStatus)
let lambda = new AWS.Lambda()
https.globalAgent.maxSockets = 2000 // TODO multiplex over fewer connections

// start up the local webserver
let app = require('connect')()
let server = require('http').createServer(app).listen(port)
app.use('/lib', Util.serveWith404(__dirname)) // serve up stuff out of lib
app.use('/node_modules', Util.serveWith404(path.resolve(__dirname, '../node_modules'))) // serve up stuff out of lib
app.use('/base', Util.serveWith404(appRoot)) // base serves things out of the application's root
app.use('/svelte', Util.serveSvelte)

config.webpack && require('./webpack')(config, app, (stats) => {
  compile = stats
  if (stats.status == 'done')
    firstCompile.resolve()
  run({codeChange: true}) // NB `run` aborts early if the code failed to compile, but it always sends status to `head`.
})

// host worker and head
app.use(async (req, resp) => {
  await firstCompile
  resp.end(indexHtml(req.url.match(/^\/worker/) ? 'worker' : 'head'))
})

let chrome = new Chrome() // headless chrome instance
chrome.launch({port: 9222})
workers.forEach(w => chrome.openTab(`http://localhost:${port}/worker?id=${w.id}`, `w${w.id}`).then(t => w.tab = t))

new WebSocket.Server({server}).on('connection', function connection(ws, req) {
  head = ws
  ws.on('message', run)
  sendStatus()
})

function run(msg) {
  msg = typeof(msg) == 'string' ? JSON.parse(msg) : msg || {}

  if (msg.reload)
    workers.forEach(w => w.tab.reload())

  if (!grep && msg.codeChange)
    return sendStatus() // full runs are only explicitly run by the user

  if (msg.filterFailed) { // filter down to the tests that failed in the last full run
    workingSet = results.filter(r => r.error).map(r => r.fullName)

  } else if (msg.testNames && (msg.grep != grep || msg.force)) { // user has changed the filter, or forced us to run
    workingSet = msg.testNames
    grep = msg.grep

  } else // nothing to do. Probably a page load that didn't change the grep
    return sendStatus()

  if (compile.status != 'done')
    return sendStatus() // stop for now if the code isn't ready

  results = []
  runId++
  lambdaCount = 0
  remaining = workingSet.clone()
  sendStatus()

  if (!grep) // should this be if the tests will take longer than x seconds?
    runOnLambda()
  else
    workers.forEach(runWorker)
}

async function runOnLambda() {
  await s3Sync.run({compile, indexHtml: indexHtml('worker', true)})
  let tranches = shuffleSeed.shuffle(workingSet, 'yo').inGroupsOf(5)
  lambdaCount = tranches.length
  sendStatus()

  tranches.forEach(async toRun => {
    let response = await Util.invoke(lambda, 'serverless-zen-dev-workTests', {url: config.s3Url, toRun: toRun.compact(), runId})

    if (response.errorMessage) {
      console.error('Error while runnning', toRun)
      return console.error(response.errorMessage)
    }

    if (response.body[0].runId != runId) return
    results.push.apply(results, response.body)
    Util.wsSend(head, {results: response.body})
  })
}

async function runWorker(w) {
  while (remaining.length > 0) {
    let result = await w.tab.assignTest({codeHash: compile.hash, runId, toRun: remaining.pop()})
    if (!result) break // if the run was aborted
    results.push(result)
    Util.wsSend(head, {results: [result]})
  }
}

function sendStatus() {
  Util.wsSend(head, {
    results, runId, lambdaCount,
    totalCount: workingSet.length,
    s3: s3Sync.status,
    compile: Object.select(compile, ['hash', 'status', 'errors']) // exclude files array, which has contains content
  })
}

function indexHtml(pageType, forS3) {
  let deps = ['lib/latte.js', `lib/${pageType}.js`]
  if (pageType == 'head')
    deps.push('node_modules/svelte/store.umd.js', 'svelte/mini.js', 'svelte/command.js')

  if (forS3) {
    deps.push((config.alsoServe || []).map(as => as.addToIndex && path.basename(as.filePath)))
    deps.push(compile.files.map(f => f.path))
  } else {
    deps.push(testDependencies.map(t => t.replace(appRoot, '/base')))
    deps.push(compile.files.map(f => `//localhost:3100/webpack/${f.path}`))
  }

  let scripts = deps.flatten().compact(true).map(d => `<script src='${d}'></script>`)
  return `<body>${scripts.join('\n')}</body>`
}

global.Zen = {head, workers}
