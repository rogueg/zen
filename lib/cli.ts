#!/usr/bin/env node

import Server from './server'
import initZen, { Zen } from './index'
import yargs from 'yargs'
import * as Util from './util.js'
import * as Profiler from './profiler'

type testResult = {
  fullName: string
  attempts: number
  error: string
  time: number
}

export type CLIOptions = {
  logging: boolean
  rerun: number
  lambdaCutoff: number
  debug: boolean
  configFile: string
}

yargs(process.argv.slice(2))
  .usage('$0 <cmd> [configFile]')
  .command(['local [configFile]', 'server [configFile]'], 'Run zen with a local server', (yargs) => {
    yargs.positional('file', {
      type: 'string',
      describe: 'Path to the config file',
    })
  }, async (argv : CLIOptions) => {
    await initZen(argv.configFile)
    new Server()
  })
  .command('remote [configFile]', 'Run zen in the console', (yargs) => {
    yargs.positional('file', {
      type: 'string',
      describe: 'Path to the config file',
    })
  }, async (argv : CLIOptions) => {
    const zen = await initZen(argv.configFile)
    run(zen, argv)
  })
  .options({
    logging: { type: 'boolean', default: false },
    rerun: { type: 'number', default: 3 },
    lambdaCutoff: { type: 'number', default: 60 },
    debug: { type: 'boolean', default: false },
  })
  .argv

function createResultMap(
  testFailures: testResult[]
): Partial<Record<string, testResult>> {
  return testFailures.reduce(
    (acc: Partial<Record<string, testResult>>, result: testResult) => {
      acc[result.fullName] = result
      return acc
    },
    {}
  )
}

async function runTests(
  zen: Zen,
  opts: CLIOptions,
  workingSet: string[],
  previousFailures?: Partial<Record<string, testResult>>,
  depth = 0
): Promise<Partial<Record<string, testResult>>> {
  // Here as a safeguard incase of some issue causes an infinite loop
  if (depth > 5 && previousFailures) return previousFailures

  const groups = zen.journal.groupTests(
    workingSet,
    zen.config.lambdaConcurrency
  )

  const failedTests: testResult[] = await Promise.all(
    groups.map(async (group: { tests: string[] }): Promise<testResult[]> => {
      try {
        const response = await Util.invoke('zen-workTests', {
          deflakeLimit: 3,
          lambdaCutoff: opts.lambdaCutoff,
          testNames: group.tests,
          sessionId: zen.config.sessionId,
        })
        return response.filter((r: testResult) => r.error || r.attempts > 1)
      } catch (e) {
        console.error(e)
        return group.tests.map((name: string) => {
          return { fullName: name, attempts: 0, error: 'zen failed to run this group', time: 0 }
        })
      }
    })
  )

  // combine the new failures into the collection of all failures
  const failedTestsMap = createResultMap(failedTests.flat())
  let failures = failedTestsMap
  if (previousFailures) {
    failures = { ...previousFailures }
    for (const testName in failedTestsMap) {
      const prevFailure = failures[testName]
      const curFailure = failedTestsMap[testName]

      if (!prevFailure || !curFailure) continue
      failures[testName] = {
        ...prevFailure,
        error: curFailure.error,
        time: prevFailure.time + curFailure.time,
        attempts: prevFailure.attempts + curFailure.attempts,
      }
    }
  }

  const testsToContinue = []
  for (const testName in failures) {
    const failure = failures[testName]
    if (!failure) continue
    if (failure.error && failure.attempts < opts.rerun) {
      testsToContinue.push(failure.fullName)
    }
  }

  // If there are still tests, then repeat with the failed tests creating the workingSet
  if (testsToContinue.length !== 0) {
    return await runTests(zen, opts, testsToContinue, failures, depth + 1)
  }

  return failures
}

async function run(zen: Zen, opts: CLIOptions) {
  let t0 = Date.now()
  if (zen.webpack) {
    console.log('Webpack building')
    let previousPercentage = 0
    zen.webpack.on(
      'status',
      (_status: string, stats: { message: string; percentage: number }) => {
        if (stats.percentage && stats.percentage > previousPercentage) {
          previousPercentage = stats.percentage
          console.log(`${stats.percentage}% ${stats.message}`)
        }
      }
    )
    await zen.webpack.build()
    console.log(`Took ${Date.now() - t0}ms`)
  }

  t0 = Date.now()
  console.log('Syncing to S3')
  zen.s3Sync.on(
    'status',
    (msg: string) => (opts.debug || process.env.DEBUG) && console.log(msg)
  )
  await zen.s3Sync.run(zen.indexHtml('worker', true))
  console.log(`Took ${Date.now() - t0}ms`)

  t0 = Date.now()
  console.log('Getting test names')
  const workingSet = await Util.invoke('zen-listTests', {
    sessionId: zen.config.sessionId,
  })

  const failedTests = await runTests(zen, opts, workingSet)
  const metrics = []
  let failCount = 0
  for (const testName in failedTests) {
    const test = failedTests[testName]
    if (!test) continue

    metrics.push({
      name: 'log.test_failed',
      fields: {
        value: test.attempts,
        testName: test.fullName,
        time: test.time,
        error: test.error,
      },
    })

    if (test.error) {
      failCount += 1
      console.log(
        `🔴 ${test.fullName} ${test.error} (tried ${test.attempts || 1} times)`
      )
    } else if (test.attempts > 1) {
      console.log(`⚠️ ${test.fullName} (flaked ${test.attempts - 1}x)`)
    }
  }

  if (opts.logging) Profiler.logBatch(metrics)
  console.log(`Took ${Date.now() - t0}ms`)
  console.log(
    `${failCount ? '😢' : '🎉'} ${failCount} failed test${failCount === 1 ? '' : 's'}`
  )
  process.exit(failCount ? 1 : 0)
}
