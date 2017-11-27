const AWS = require('aws-sdk')
const crypto = require('crypto')

module.exports.workTests = (opts, context, callback) => {
  const launchChrome = require('@serverless-chrome/lambda')
  const ChromeWrapper = require('./chrome')
  let chrome, wrapper, tab
  let remaining = opts.toRun.slice(), results = []

  let runNext = function() {
    if (remaining.length == 0) return
    let testOpts = Object.assign({}, opts, {toRun: remaining.pop()})
    return tab.assignTest(testOpts).then(r => {
      results.push(r)
      return runNext()
    })
  }

  launchChrome({}).then(c => {
    chrome = c
    wrapper = new ChromeWrapper()
    wrapper.connectToRunning()
    return wrapper.openTab(opts.url)
  }).then(t => {
    tab = t
    return runNext()
  }).then(() => {
    callback(null, {statusCode: 200, body: results})
    chrome.kill()
  }).catch(e => {
    console.error(e)
    callback(e)
  })
}


module.exports.applyPatch = (opts, context, callback) => {
  const DiffMatchPatch = require('diff-match-patch')
  let dmp = new DiffMatchPatch()
  let patches = dmp.patch_fromText(opts.patch)
  let s3 = new AWS.S3()

  s3.getObject({Bucket: opts.bucket, Key: opts.key}).promise().then(obj => {
    let md5 = crypto.createHash('md5').update(obj.Body).digest()
    if (md5 != opts.md5)
      return callback('stale md5')

    let [output, status] = dmp.patch_apply(patches, obj.Body)

    if (!status.every(v => !!v))
      return callback('patch application failed')

    return s3.upload({
      Bucket: opts.bucket,
      Key: opts.key,
      ContentType: obj.ContentType,
      Body: output
    }).promise()

  }).then(() => {
    callback(null, {success: true})

  }).catch(e => {
    console.error(e)
    callback(e)
  })
}
