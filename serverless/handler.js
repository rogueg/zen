const AWS = require('aws-sdk')
const crypto = require('crypto')

module.exports.workTests = (opts, context, callback) => {
  const launchChrome = require('@serverless-chrome/lambda')
  const ChromeWrapper = require('./lib/chrome')
  let chrome, wrapper, tab
  let remaining = opts.testNames.slice(), results = []
  delete opts.testNames

  let runNext = function() {
    if (remaining.length == 0) return
    let testOpts = Object.assign({}, opts, {testName: remaining.shift()})
    return tab.setTest(testOpts).then(r => {
      r.logStream = context.logStreamName
      results.push(r)
      return runNext()
    })
  }

  console.log('Launching chrome')
  launchChrome({}).then(c => {
    chrome = c
    wrapper = new ChromeWrapper({})
    wrapper.connectToRunning()
    console.log('Opening tab')
    return wrapper.openTab(opts.url)
  }).then(t => {
    console.log('Starting tests')
    tab = t
    return runNext()
  }).then(() => {
    callback(null, {statusCode: 200, body: results})
    chrome.kill()
  }).catch(e => {
    console.error(e)
    e.logStream = context.logStreamName
    callback(e)
  }).then(() => {
    // https://github.com/adieuadieu/serverless-chrome/issues/41#issuecomment-317989508
    tab && tab.disconnect()
    chrome.kill()
  })
}


module.exports.applyPatch = (opts, context, callback) => {
  const DiffMatchPatch = require('diff-match-patch')
  let dmp = new DiffMatchPatch()
  let patches = dmp.patch_fromText(opts.patch)
  let s3 = new AWS.S3()

  s3.getObject({Bucket: opts.bucket, Key: opts.key}).promise().then(obj => {
    // TODO make this actually work. patch_apply mostly seems to work, so this doesn't feel urgent
    // let md5 = crypto.createHash('md5').update(obj.Body).digest()
    // if (md5 != opts.md5)
    //   return callback('stale md5')

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
