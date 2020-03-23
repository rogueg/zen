import { Zen, Util } from '../../client/index'

function timeSince(t0: Date) {
  return (new Date()).valueOf() - t0.valueOf()
}

export async function run() {

  let t0 = new Date()

  if (Zen.webpack) {
    console.log('Webpack building')
    let previousPercentage = 0
    Zen.webpack.on('status', (_, stats) => {
      if (stats.percentage && stats.percentage > previousPercentage) {
        previousPercentage = stats.percentage
        console.log(`${stats.percentage}% ${stats.message}`)
      }
    })
    await Zen.webpack.build()
    console.log(`Took ${timeSince(t0)}ms`)
  }

  t0 = new Date()
  console.log('Syncing to S3')
  Zen.s3Sync.on('status', msg => process.env.DEBUG && console.log(msg))
  await Zen.s3Sync.run(Zen.indexHtml('worker', true))
  console.log(`Took ${timeSince(t0)}ms`)

  t0 = new Date()
  console.log('Getting test names')
  let workingSet = await Util.invoke('zen-listTests', { sessionId: Zen.config.sessionId })
  let groups = Zen.journal.groupTests(workingSet, Zen.config.lambdaConcurrency)
  console.log(`Took ${timeSince(t0)}ms`)

  let failed = 0
  t0 = new Date()
  console.log(`Running ${workingSet.length} tests on ${groups.length} workers`)
  await Promise.all(groups.map(async group => {
    try {
      let response = await Util.invoke('zen-workTests', {
        deflakeLimit: 3,
        testNames: group.tests,
        sessionId: Zen.config.sessionId
      })
      response.forEach(r => {
        if (r.attempts > 1 && !r.error)
          console.log(`⚠️ ${r.fullName} (flaked ${r.attempts - 1}x)`)
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
  console.log(`Took ${timeSince(t0)}ms`)
  console.log(`${failed ? '😢' : '🎉'} ${failed} failed test${failed == 1 ? '' : 's'}`)
  process.exit(failed ? 1 : 0)
}