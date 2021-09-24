#!/usr/bin/env node

import Server from './server'
import Zen from './index'
import yargs from 'yargs'
import * as Util from './util.js'
import * as Profiler from './profiler'

yargs(process.argv.slice(2))
  .usage('$0 <cmd> [args]')
  .command('server', 'Run zen with a local server', (argv) => {
    console.log("SERVER", argv)
    new Server()
  })
  .command('run', 'Run zen in the console', argv => {
    const args = argv.parseSync()
    run({ logging: args.logging, rerun: args.rerun, debug: args.debug, lambdaCutoff: args.lambdaCutoff })
  })
  .options({
    logging: { type: 'boolean', default: false },
    rerun: { type: 'number', default: 3 },
    lambdaCutoff: { type: 'number', default: 60 },
    debug: { type: 'boolean', default: false }
  })
  .parseSync()

async function run({ logging, rerun, debug, lambdaCutoff }) {
  let t0 = Date.now()
  if (Zen.webpack) {
    console.log('Webpack building')
    let previousPercentage = 0
    Zen.webpack.on(
      'status',
      (_status: string, stats: { message: string; percentage: number }) => {
        if (stats.percentage && stats.percentage > previousPercentage) {
          previousPercentage = stats.percentage
          console.log(`${stats.percentage}% ${stats.message}`)
        }
      }
    )
    await Zen.webpack.build()
    console.log(`Took ${Date.now() - t0}ms`)
  }

  t0 = Date.now()
  console.log('Syncing to S3')
  Zen.s3Sync.on(
    'status',
    (msg: string) => (debug || process.env.DEBUG) && console.log(msg)
  )
  await Zen.s3Sync.run(Zen.indexHtml('worker', true))
  console.log(`Took ${Date.now() - t0}ms`)

  t0 = Date.now()
  console.log('Getting test names')
  let workingSet = await Util.invoke('zen-listTests', {
    sessionId: Zen.config.sessionId,
  })
  let groups = Zen.journal.groupTests(workingSet, Zen.config.lambdaConcurrency)
  console.log(`Took ${Date.now() - t0}ms`)

  let failed = 0
  t0 = Date.now()
  console.log(`Running ${workingSet.length} tests on ${groups.length} workers`)
  let metrics = []
  await Promise.all(
    groups.map(async (group: { tests: unknown[] }) => {
      try {
        let response = await Util.invoke('zen-workTests', {
          deflakeLimit: rerun,
          lambdaCutoff: lambdaCutoff,
          testNames: group.tests,
          sessionId: Zen.config.sessionId,
        })
        response
          .forEach((r: { attempts: number; error: boolean; fullName: string }) => {
            let metric = {
              name: 'log.test_failed',
              fields: {
                value: r.attempts,
                testName: r.fullName,
                error: r.error,
              },
            }

            if (r.attempts > 1 && !r.error) {
              console.log(`⚠️ ${r.fullName} (flaked ${r.attempts - 1}x)`)
              metrics.push(metric)
            } else if (r.error) {
              failed++
              console.log(
                `🔴 ${r.fullName} ${r.error} (tried ${r.attempts || 1} times)`
              )
              metrics.push(metric)
            }
          })
      } catch (e) {
        console.error(e)
        failed += group.tests.length
      }
    })
  )

  if (logging) await Profiler.logBatch(metrics)

  console.log(`Took ${Date.now() - t0}ms`)
  console.log(
    `${failed ? '😢' : '🎉'} ${failed} failed test${failed === 1 ? '' : 's'}`
  )
  process.exit(failed ? 1 : 0)
}
