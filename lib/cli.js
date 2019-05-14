#!/usr/bin/env node

// Normalize whether the cli is run directly or via node
if (!process.argv[0].match(/zen$/)) process.argv.shift()

require('./index')

const cmd = process.argv[1] || 'run'
if (cmd == 'server') {
  const Server = require('./server')
  new Server()
}

if (cmd == 'run') {
  run()
}

if (cmd == 'deploy') {
  // TODO serverless deploy
}

async function run () {
  if (Zen.webpack) {
    console.log('Webpack building')
    Zen.webpack.on('status', (status, stats) => process.env.DEBUG && console.log(`${stats.percentage}% ${stats.message}`))
    await Zen.webpack.build()
  }
  console.log('Syncing to S3')
  Zen.s3Sync.on('status', msg => process.env.DEBUG && console.log(msg))
  await Zen.s3Sync.run(Zen.indexHtml('worker', true))

  console.log('Getting test names')
  let workingSet = await Util.invoke('serverless-zen-dev-listTests', {url: `${Zen.config.proxyUrl}/index.html`, Bucket: Zen.config.aws.assetBucket, sessionId: Zen.config.sessionId})
  let groups = Zen.journal.groupTests(workingSet, Zen.config.lambdaConcurrency)

  let failed = 0
  console.log(`Running ${workingSet.length} tests on ${groups.length} workers`)
  await Promise.all(groups.map(async group => {
    let response = await Util.invoke('serverless-zen-dev-workTests', {
      url: Zen.config.proxyUrl + `/index.html`,
      testNames: group.tests,
      Bucket: Zen.config.aws.assetBucket,
      sessionId: Zen.config.sessionId
    })
    response.body.forEach(r => {
      if (!r.error) return
      failed++
      console.log(`🔴 ${r.fullName} ${r.error}`)
    })
  }))
  process.exitCode = failed ? -1 : 0
  console.log(`${failed ? '😢' : '🎉'} ${failed} failed test${failed.length == 1 ? '' : 's'}`)
}
