const os = require('os')
const path = require('path')
const fs = require('fs')
const AWS = require('aws-sdk')
const klaw = require('klaw')
const mime = require('mime-types')
const DiffMatchPatch = require('diff-match-patch')
const crypto = require('crypto')
const util = require('./util')
const stringHash = require('string-hash')

module.exports = class S3Sync {
  constructor(config, onStatusChange) {
    this.config = config
    this.onStatusChange = onStatusChange
    this.s3 = new AWS.S3({params: {Bucket: config.aws.assetBucket}})
    this.lambda = new AWS.Lambda()
    this.s3.addExpect100Continue = function () { } // https://github.com/andrewrk/node-s3-client/issues/152
    this.cachePath = path.join(config.tmpDir, 'sync.json')
    this.cacheDir = path.join(config.tmpDir, 'sync-cache')

    util.readFile(this.cachePath).then(data => this.cache = JSON.parse(data || '{}'))
  }

  async run({compile, indexHtml}) {
    this.status = {}
    // first, get all the directories we'd like to sync
    let syncedDirs = [{filePath: __dirname, webPath: '/lib', filter: (p) => p.match(/worker.js|latte.js/)}]
    syncedDirs = syncedDirs.concat(this.config.alsoServe || [])

    // recursively stat every directory, getting a list of files
    let files = await Promise.all(syncedDirs.map(recursiveStat))
    files = files.flatten()
    files.forEach(f => f.hash = f.stats.mtime.getTime()) // hash files by mtime

    // include the results from the last webpack compile
    files = files.concat(compile.files)
    files.push({path: 'index.html', hash: stringHash(indexHtml), body: indexHtml})

    // start uploading changed files
    let changed = files.filter(f => this.cache[f.path] != f.hash)
    this.announce({statd: true, uploaded: 0, changed: changed.length})

    await workInPool(changed, 20, async (f) => {
      let dir = f.dir || {}
      f.body = f.body || await util.readFile(f.path)
      let trimmedPath = f.path.replace(dir.filePath || '', '') || path.basename(dir.filePath)
      f.key = path.join(this.config.aws.assetPrefix, dir.webPath || '', trimmedPath)
      f.cachePath = path.join(this.cacheDir, crypto.createHash('md5').update(f.key).digest('hex'))

      await this.upload(f)
      await util.writeFile(f.cachePath, f.body)
      f.body = null // allow body to be gc'd

      // TODO handle an individual upload failure
      this.announce({uploaded: this.status.uploaded + 1})
      console.log(`${this.status.uploaded}/${this.status.changed} ${f.key}`)
      this.cache[f.path] = f.hash
    })

    this.announce({done: true})
    util.writeFile(this.cachePath, JSON.stringify(this.cache))
  }

  announce(change) {
    this.onStatusChange(Object.assign(this.status, change))
  }

  async applyPatch(file) {
    if (file.path != 'bundle.js') return false // TODO when should we do this? big files?
    let lastWrite = await util.readFile(file.cachePath)
    if (!lastWrite) return false

    let dmp = new DiffMatchPatch()
    let patches = dmp.patch_make(lastWrite.toString(), file.body.toString())
    let result = await util.invoke(this.lambda, 'serverless-zen-dev-applyPatch', {
      bucket: this.config.aws.assetBucket,
      key: file.key,
      // md5: crypto.createHash('md5').update(lastWrite).digest('hex'), // TODO see comment in handler.js
      patch: dmp.patch_toText(patches)
    })

    if (result.success != true)
      console.log('Failed to apply patch. Uploading full file')
    return result.success == true
  }

  async upload(file) {
    let result = await this.s3.upload({
      Bucket: this.config.aws.assetBucket,
      Key: file.key,
      Body: file.body,
      ContentType: file.contentType || mime.contentType(path.basename(file.path)) || 'application/octet-stream'
    }).promise()
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
