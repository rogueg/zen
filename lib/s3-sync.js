const os = require('os')
const path = require('path')
const fs = require('fs')
const AWS = require('aws-sdk')
const klaw = require('klaw')
const mime = require('mime-types')
const DiffMatchPatch = require('diff-match-patch')
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

  async run({compile, indexHtml}) {
    this.status = {}
    // first, get all the directories we'd like to sync
    let syncedDirs = [{filePath: __dirname, webPath: '/lib', filter: (p) => p.match(/worker.js|latte.js/)}]
    syncedDirs = syncedDirs.concat(this.config.alsoServe || [])

    // recursively stat every directory, getting a list of files
    let files = await Promise.all(syncedDirs.map(recursiveStat))
    files = files.flatten()
    files.forEach(f => f.hash = f.stats.mtime.getTime()) // hash files by mtime

    files = files.concat(compile.files) // include the results from the last webpack compile
    files.push({path: 'index.html', body: indexHtml}) // and index.html

    // ensure files we have in memory (like webpack) have a hash, so we don't re-upload them every time
    files.forEach(f => {
      if (!f.hash && !f.body) throw new Error('missing hash or body')
      f.hash = f.hash || crypto.createHash('md5').update(f.body).digest('hex')
    })

    // start uploading changed files
    let changed = files.filter(f => this.cache[f.path] != f.hash)
    this.announce({statd: true, uploaded: 0, changed: changed.length})

    await workInPool(changed, 20, async (f) => {
      let dir = f.dir || {}
      let trimmedPath = f.path.replace(dir.filePath || '', '') || path.basename(dir.filePath)
      let Key = path.join(this.config.aws.assetPrefix, dir.webPath || '', trimmedPath)
      let Body = f.body || await util.readFileAsync(f.path, null)
      let ContentType = f.contentType || mime.contentType(path.basename(f.path)) || 'application/octet-stream'

      let result = await this.s3.upload({Bucket: this.config.aws.assetBucket, Key, Body, ContentType}).promise()
      // TODO handle an individual upload failure

      this.announce({uploaded: this.status.uploaded + 1})
      console.log(`${this.status.uploaded}/${this.status.changed} ${Key}`)
      this.cache[f.path] = f.hash
    })

    this.announce({done: true})
    util.writeFile(this.cachePath, JSON.stringify(this.cache))
  }

  announce(change) {
    this.onStatusChange(Object.assign(this.status, change))
  }

  // TODO: I'd like to revisit this at some point. I was attempting to make uploads faster when only
  // a small part of a large file changed. Unfortunately the patch got really expensive to generate with
  // webpack's devtools:eval when many files changed.
  // async applyPatch(file) {
  //   if (file.path != 'bundle.js') return false // TODO when should we do this? big files?
  //   let lastWrite = await util.readFileAsync(file.cachePath)
  //   if (!lastWrite) return false

  //   let dmp = new DiffMatchPatch()
  //   let patches = dmp.patch_make(lastWrite.toString(), file.body.toString())
  //   let result = await util.invoke(this.lambda, 'serverless-zen-dev-applyPatch', {
  //     bucket: this.config.aws.assetBucket,
  //     key: file.key,
  //     // md5: crypto.createHash('md5').update(lastWrite).digest('hex'), // TODO see comment in handler.js
  //     patch: dmp.patch_toText(patches)
  //   })

  //   if (result.success != true)
  //     console.log('Failed to apply patch. Uploading full file')
  //   return result.success == true
  // }
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
