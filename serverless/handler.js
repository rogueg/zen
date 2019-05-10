const AWS = require('aws-sdk')

module.exports.workTests = async (opts, context, callback) => {
  const ChromeWrapper = require('./lib/chrome')
  let wrapper, manifest, remaining = opts.testNames.slice(), results = []
  delete opts.testNames

  try {
    console.log('Starting')
    wrapper = new ChromeWrapper({})

    await Promise.all([
      wrapper.launchLambda(),
      getManifest(opts.Bucket, opts.sessionId).then(m => manifest = m)
    ])

    console.log('Opening tab')
    let tab = await wrapper.openTab(opts.url)
    tab.manifest = manifest

    if (opts.sessionId && !manifest) { // temp to handle old clients
      throw new Error(`Missing manifest for ${opts.sessionId}`)
    }

    console.log('Starting tests')
    while (remaining.length > 0) {
      let testOpts = Object.assign({}, opts, {testName: remaining.shift()})
      let r = await tab.setTest(testOpts)
      r.logStream = context.logStreamName
      results.push(r)
    }

    callback(null, {statusCode: 200, body: results})

  } catch (e) {
    console.error(e)
    e.logStream = context.logStreamName
    callback(e)

  } finally {
    if (wrapper) wrapper.kill()
  }
}

module.exports.sync = async (manifest) => {
  let s3 = new AWS.S3({params: {Bucket: manifest.bucket}})

  // Write the updated session manifest to S3
  let manifestWrite = s3.putObject({
    Key: `session-${manifest.sessionId}.json`,
    Body: JSON.stringify(manifest)
  }).promise()

  // TODO: it might be faster to use listObjectsV2, especially if there are many files
  // to check, and S3 is pruned to have less than 2k files. Blame this comment for an example.
  let needed = []
  let toCheck = manifest.files.filter(f => f.toCheck)
  console.log(`Checking ${toCheck.length} files`)
  await Promise.all(toCheck.map(async f => {
    try {
      let resp = await s3.headObject({Key: f.versionedPath}).promise()
      // console.log('Found', f.versionedPath, resp)
    } catch (e) {
      if (e.code === 'NotFound') needed.push(f)
      // console.log('Error heading', f.versionedPath, e)
    }
  }))

  await manifestWrite
  console.log('Manifest written')
  return {needed}
}

module.exports.routeRequest = async (event) => {
  let [Bucket, sessionId, ...rest] = event.path.split('/').slice(1)
  let manifest = await getManifest(Bucket, sessionId)
  let path = decodeURIComponent(rest.join('/'))
  console.log('Routing', Bucket, sessionId, path)

  if (!manifest) {
    return {statusCode: 404, headers: {}, body: 'manifest not found'}
  }

  if (path === 'index.html') {
    return {statusCode: 200, headers: {"content-type": "text/html"}, body: manifest.index}
  }

  let key = manifest.files[path]
  if (!key) {
    return {statusCode: 404, headers: {}, body: 'path not found in manifest'}
  }

  return {statusCode: 301, headers: {Location: `https://s3-us-west-2.amazonaws.com/${Bucket}/${encodeURIComponent(key)}`}}
}

async function getManifest (Bucket, sessionId) {
  if (!sessionId) return // temp to support old clients
  try {
    let s3 = new AWS.S3()
    let resp = await s3.getObject({Bucket, Key: `session-${sessionId}.json`}).promise()
    let manifest = JSON.parse(resp.Body.toString('utf-8'))
    manifest.fileMap = {}
    manifest.files.forEach(f => manifest.fileMap[f.urlPath] = f.versionedPath)
    return manifest
  } catch (e) {
    console.log(e)
    return null
  }
}
