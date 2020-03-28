const path = require('path')
const https = require('https')
const Util = require('../util')
const AWS = require('aws-sdk')
const S3Sync = require('../local-server/s3-sync')
const Journal = require('./journal')
const uuidv4 = require('uuid/v4')

require('sugar').extend()
global.Zen = {}

// load the config with some defaults
let config = Zen.config = require(path.join(process.cwd(), "zen.config.js"))
config.appRoot = path.resolve(process.cwd(), config.appRoot || '')
config.port = config.port || 3100
config.testDependencies = config.testDependencies || []
config.lambdaConcurrency = config.lambdaConcurrency || 400
config.htmlTemplate = config.htmlTemplate || '<body>ZEN_SCRIPTS</body>'
config.sessionId = config.sessionId || uuidv4()
config.useSnapshot = config.useSnapshot === undefined ? true : !!config.useSnapshot

// tmpDir is where we cache files between runs
config.tmpDir = config.tmpDir || path.join(config.appRoot, '.zen')
Util.ensureDir(config.tmpDir)
console.log('Using tmpDir', config.tmpDir)

AWS.config.update(config.aws)
Zen.s3Sync = new S3Sync() // Keeps our local files in sync with S3
Zen.lambda = new AWS.Lambda()
Zen.journal = new Journal()

// Without this, node limits our requests and slows down running on lambda
https.globalAgent.maxSockets = 2000 // TODO multiplex over fewer connections

if (config.webpack) { // boot up webpack (if configured)
  let WebpackAdapter = require('../local-server/webpack')
  Zen.webpack = new WebpackAdapter()
}

Zen.indexHtml = function indexHtml (pageType, forS3) {
  let deps = ['lib/client/latte.js']
  if (pageType == 'head') {
    deps.unshift('icons')
    deps.push('node_modules/fuzzysort/fuzzysort.js', 'svelte/mini.js', 'svelte/command.js')
  }
  deps.push(`lib/client/${pageType}.js`) // after Zen dependencies, but before user code
  let entries = (Zen.webpack && Zen.webpack.compile && Zen.webpack.compile.entrypoints) || []

  if (forS3) {
    deps.push((config.alsoServe || []).map(as => as.addToIndex && path.basename(as.filePath)))
    deps.push(entries.map(e => `webpack/${e}`))
  } else {
    deps.push(Zen.config.testDependencies.map(t => t.replace(Zen.config.appRoot, '/base')))
    deps.push(entries.map(e => `//localhost:3100/webpack/${e}`))
  }

  let scripts = deps.flatten().compact(true).map(d => `<script src='${d}'></script>`)

  // NB it's important that we don't include the config when the index is uploaded to S3
  let cfg = pageType == 'head' ? Zen.config : {}
  scripts.unshift(`<script>
    window.Zen = {config: ${JSON.stringify(cfg)}}
  </script>`)

  return Zen.config.htmlTemplate.replace('ZEN_SCRIPTS', scripts.join('\n'))
}
