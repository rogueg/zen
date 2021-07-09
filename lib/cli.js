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

console.log(process.env.RERUN_LIMIT)
async function run () {
  let t0 = new Date()
  if (Zen.webpack) {
    console.log('Webpack building')
    let previousPercentage = 0
    Zen.webpack.on('status', (status, stats) => {
      if (stats.percentage && stats.percentage > previousPercentage) {
        previousPercentage = stats.percentage
        console.log(`${stats.percentage}% ${stats.message}`)
      }
    })
    await Zen.webpack.build()
    console.log(`Took ${new Date() - t0}ms`)
  }

  t0 = new Date()
  console.log('Syncing to S3')
  Zen.s3Sync.on('status', msg => process.env.DEBUG && console.log(msg))
  await Zen.s3Sync.run(Zen.indexHtml('worker', true))
  console.log(`Took ${new Date() - t0}ms`)

  t0 = new Date()
  console.log('Getting test names')
  let workingSet = await Util.invoke('zen-listTests', {sessionId: Zen.config.sessionId})
  let groups = Zen.journal.groupTests(workingSet, Zen.config.lambdaConcurrency)
  console.log(`Took ${new Date() - t0}ms`)

  let failed = 0
  t0 = new Date()
  console.log(`Running ${workingSet.length} tests on ${groups.length} workers`)
  await Promise.all(groups.map(async group => {
    try {
      let deflakeLimit = parseInt(process.env.RERUN_LIMIT)
      if (isNaN(deflakeLimit)) deflakeLimit = 3

      let response = await Util.invoke('zen-workTests', {
        deflakeLimit,
        testNames: group.tests,
        sessionId: Zen.config.sessionId
      })
      response.forEach(r => {
        if (r.attempts > 1 && !r.error)
          console.log(`⚠️ ${r.fullName} (flaked ${r.attempts-1}x)`)
        if (r.error) {
          failed++
          console.log(`🔴 ${r.fullName} ${r.error} (tried ${r.attempts || 1} times)`)
        }
      })
    } catch (e) {
      console.error(e)
      failed += group.tests.length
    }
  }))
  console.log(`Took ${new Date() - t0}ms`)
  console.log(`${failed ? '😢' : '🎉'} ${failed} failed test${failed.length == 1 ? '' : 's'}`)
  process.exit(failed ? 1 : 0)
}
