const path = require('path')
const klaw = require('klaw')
const mime = require('mime-types')
const AWS = require('aws-sdk')
const crypto = require('crypto')
const util = require('./util')

module.exports = class S3Sync {
  constructor(config, onStatusChange) {
    this.config = config
    this.onStatusChange = onStatusChange
    this.s3 = new AWS.S3({params: {Bucket: config.aws.assetBucket}})
    this.lambda = new AWS.Lambda()
    this.s3.addExpect100Continue = function () { } // https://github.com/andrewrk/node-s3-client/issues/152
    this.cachePath = path.join(config.tmpDir, 'sync.json')
    this.cacheDir = path.join(config.tmpDir, 'sync-cache')

    this.cache = JSON.parse(util.readFile(this.cachePath) || '{}')
  }

  async run(compile, index) {
    this.files = {}
    this.status = {}

    // first, get all the directories we'd like to sync
    let syncedDirs = [
      {filePath: __dirname, webPath: '/lib', filter: (p) => p.match(/worker.js|latte.js/)}
    ].concat(this.config.alsoServe || [])

    // recursively stat every directory, getting a list of files
    let diskFiles = await Promise.all(syncedDirs.map(recursiveStat))
    diskFiles.flatten().forEach(f => {
      // We want to preserve the part of the path relative to the specified filePath, unless that would remove the filename
      f.urlPath = f.path === f.dir.filePath ? path.basename(f.dir.filePath) : f.path.replace(f.dir.filePath, '')
      f.urlPath = path.join(f.dir.webPath || '', f.urlPath).replace(/^\//, '')
      f.hash = f.stats.mtime.getTime() // hash files by mtime
      // TODO, I'm not sue hashing by mtime is good enough when the proxy shares files from various machines
      // but it is quite fast locally. maybe we should use it as a first pass to decide if we need to hash the contents
      this.files[f.urlPath] = f
    })

    // include the results from the last webpack compile, and give them a hash
    compile.files.forEach(f => {
      // TODO our webpack glue should really handle this part
      f.urlPath = f.path
      f.hash = f.hash || crypto.createHash('md5').update(f.body).digest('hex')
      this.files[f.urlPath] = f
    })

    this.announce({readFromDisk: true})

    // tell the proxy about all the files that will be required to run the tests
    let fileMap = {} // maps path to the s3 key we'll store the object at
    Object.keys(this.files).forEach(k => {
      let p = path.parse(k)
      fileMap[k] = path.join(p.dir, p.name + '-' + this.files[k].hash + p.ext)
    })

    let manifest = {
      sessionId: this.config.sessionId,
      bucket: this.config.aws.assetBucket,
      proxyUrl: this.config.proxyUrl,
      s3Url: this.config.s3Url,
      files: fileMap,
      index
    }
    let {needed} = await Util.invoke(this.lambda, 'serverless-zen-dev-sync', manifest)

    // start uploading changed files
    this.announce({synced: true, uploaded: 0, changed: needed.length})
    await workInPool(needed, 20, async need => {
      let f = this.files[need.path]
      let Key = need.key
      let Body = f.body || await util.readFileAsync(f.path, null)
      Body = Body instanceof Buffer ? Body : Buffer.from(Body)
      let ContentType = f.contentType || mime.contentType(path.basename(f.path)) || 'application/octet-stream'

      let result = await this.s3.upload({Bucket: this.config.aws.assetBucket, Key, Body, ContentType}).promise()
      // TODO handle an individual upload failure
      this.announce({uploaded: this.status.uploaded + 1})
      console.log(`${this.status.uploaded}/${this.status.changed} ${need.path}`)
    })

    this.announce({done: true})
  }

  announce(change) {
    this.onStatusChange(Object.assign(this.status, change))
  }
}

function workInPool(list, concurrency, fn) {
  let remaining = list.clone()
  return Promise.all(concurrency.times(async function() {
    while (remaining.length > 0)
      await fn(remaining.pop())
  }))
}

function recursiveStat(syncedDir) {
  return new Promise((res, rej) => {
    let files = []
    klaw(syncedDir.filePath)
      .on('data', item => {
        if (item.stats.isDirectory()) return
        if (syncedDir.filter && !syncedDir.filter(item.path)) return
        files.push(Object.assign({dir: syncedDir}, item))
      })
      .on('error', rej)
      .on('end', () => res(files))
  })
}
