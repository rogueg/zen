const AWS = require('aws-sdk')
const crypto = require('crypto')

module.exports.workTests = async (opts, context) => {
  const launchChrome = require('@serverless-chrome/lambda')
  const ChromeWrapper = require('./lib/chrome')
  let chrome, remaining = opts.testNames.slice(), results = []
  delete opts.testNames

  try {
    console.log('Launching chrome')
    chrome = await launchChrome({})
    let wrapper = new ChromeWrapper({})
    wrapper.connectToRunning()
    console.log('Opening tab')
    let tab = await wrapper.openTab(opts.url)

    console.log('Starting tests')
    while (remaining.length > 0) {
      let testOpts = Object.assign({}, opts, {testName: remaining.shift()})
      let r = await tab.setTest(testOpts)
      r.logStream = context.logStreamName
      results.push(r)
    }

    chrome.kill()
    return {statusCode: 200, body: results}

  } catch (e) {
    console.error(e)
    e.logStream = context.logStreamName
    chrome && chrome.kill()
    throw e
  }
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
