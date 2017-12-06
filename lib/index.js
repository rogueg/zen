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

let config = require(path.join(process.cwd(), process.argv[2]))
let appRoot = path.resolve(process.cwd(), config.appRoot || '')
let port = config.port || 3100
let testDependencies = config.testDependencies || []
config.s3Url = `https://s3-${config.aws.region}.amazonaws.com/${config.aws.assetBucket}/${config.aws.assetPrefix}/index.html`

// tmpDir is where we cache files between runs
config.tmpDir = path.join(config.tmpDir || os.tmpdir(), 'zen')
Util.ensureDir(config.tmpDir)
console.log('Using tmpDir', config.tmpDir)

// start up the local webserver
let app = require('connect')()
let server = require('http').createServer(app).listen(port)
app.use('/lib', Util.serveWith404(__dirname)) // serve up stuff out of lib
app.use('/base', Util.serveWith404(appRoot)) // base serves things out of the application's root
app.use('/svelte', Util.serveSvelte)

// host worker and head
app.use(async (req, resp) => {
  let pageType = req.url.match(/^\/worker/) ? 'worker' : 'head'
  await firstCompile
  resp.end(indexHtml(pageType))
})

let grep = '' // filter of what tests to run in workers
let runId = 0 // unique id for each run. Lets us ignore results from stale runs
let head = null
let workers = Array.construct(8, id => ({id}))
let firstCompileResolve = null
let firstCompile = new Promise(res => firstCompileResolve = res)
let lastCompile = null // stats from the last webpack run
let singleWorker = false // run tests in one worker. Useful for reproducing errors that only happen headless
let workingSet = [] // list of tests to run each time
let fullRun = false // whether or not we're doing a full run of all tests
let remaining = [] // tests remaining to run
let results = [] // keeps track of the current run of tests

let chrome = new Chrome() // headless chrome instance
chrome.launch({port: 9222})
workers.forEach(w => chrome.openTab(`http://localhost:${port}/worker?id=${w.id}`, `w${w.id}`).then(t => w.tab = t))

AWS.config.update(config.aws)
let s3Sync = new S3Sync(config)
let lambda = new AWS.Lambda()
https.globalAgent.maxSockets = 2000 // TODO multiplex over fewer connections

new WebSocket.Server({server}).on('connection', function connection(ws, req) {
  head = ws
  ws.on('message', run)
  sendStatus()
})

function run(msg) {
  msg = typeof(msg) == 'string' && JSON.parse(msg)

  if (msg.hasOwnProperty('singleWorker'))
    singleWorker = msg.singleWorker

  if (msg.reload)
    workers.forEach(w => w.tab.reload())

  if (msg.fullRun) { // requested a full run
    grep = null
    workingSet = msg.testNames
    fullRun = true
    runId++
    results = []
    sendStatus()
    return runOnLambda()
  }

  else if (msg.grep) { // user specifies what to run
    if (msg.grep == grep && !msg.force) return
    workingSet = msg.testNames || workingSet
    grep = msg.grep
  }

  else if (!msg.force && !msg.codeChange) // no need to re-run
    return

  // if we just did a full run, collapse the working set to what failed
  else if (fullRun) {
    workingSet = results.filter(r => r.error).map(r => r.fullName)
    fullRun = false
  }

  runId++
  results = [], remaining = workingSet.clone()
  workers.forEach(runWorker)
  sendStatus()
}

async function runOnLambda() {
  await s3Sync.run({lastCompile, indexHtml: indexHtml('worker', true)})
  let tranches = shuffleSeed.shuffle(workingSet, 'yo').inGroupsOf(5)
  console.log(`Using ${tranches.length} workers`)

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
    let result = await w.tab.assignTest({codeHash: lastCompile.hash, runId, toRun: remaining.pop()})
    if (!result) break // if the run was aborted
    results.push(result)
    Util.wsSend(head, {results: [result]})
  }
}

function sendStatus() {
  Util.wsSend(head, {results, runId, totalCount: workingSet.length})
}

function indexHtml(pageType, forS3) {
  let deps = ['lib/latte.js', `lib/${pageType}.js`]
  if (pageType == 'head')
    deps.push('svelte/mini.js')

  if (forS3) {
    deps.push((config.alsoServe || []).map(as => as.addToIndex && path.basename(as.filePath)))
    deps.push(lastCompile.files.map(f => f.path))
  } else {
    deps.push(testDependencies.map(t => t.replace(appRoot, '/base')))
    deps.push(lastCompile.files.map(f => `//localhost:3101/${f.path}`))
  }

  let scripts = deps.flatten().compact(true).map(d => `<script src='${d}'></script>`)
  return `<body>${scripts.join('\n')}</body>`
}

config.webpack && require('./webpack')(config, (stats) => {
  lastCompile = stats
  if (firstCompileResolve) {
    firstCompileResolve()
    firstCompileResolve = null
  }
  run({codeChange: true})
})

global.Zen = {head, workers}
