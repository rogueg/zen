#!/usr/bin/env node

import Server from './server'
import initZen, { Zen } from './index'
import yargs from 'yargs'
import { invoke } from './util.js'
import * as Profiler from './profiler'
import { workTests } from './util'

type testFailure = {
  fullName: string
  attempts: number
  error?: string
  time: number
}

export type CLIOptions = {
  logging: boolean
  maxAttempts: number
  debug: boolean
  configFile: string
}

yargs(process.argv.slice(2))
  .usage('$0 <cmd> [configFile]')
  .command(
    ['local [configFile]', 'server [configFile]'],
    'Run zen with a local server',
    (yargs) => {
      yargs.positional('file', {
        type: 'string',
        describe: 'Path to the config file',
      })
    },
    async (argv: CLIOptions) => {
      await initZen(argv.configFile)
      new Server()
    }
  )
  .command(
    'remote [configFile]',
    'Run zen in the console',
    (yargs) => {
      yargs.positional('file', {
        type: 'string',
        describe: 'Path to the config file',
      })
    },
    async (argv: CLIOptions) => {
      const zen = await initZen(argv.configFile)
      run(zen, argv)
    }
  )
  .options({
    logging: { type: 'boolean', default: false },
    maxAttempts: { type: 'number', default: 3 },
    debug: { type: 'boolean', default: false },
  }).argv

type TestResultsMap = Record<string, testFailure>

async function runTests(
  zen: Zen,
  opts: CLIOptions,
  tests: string[]
): Promise<TestResultsMap> {
  const groups = zen.journal.groupTests(tests, zen.config.lambdaConcurrency)

  const failedTests: testFailure[][] = await Promise.all(
    groups.map(async (group: { tests: string[] }): Promise<testFailure[]> => {
      try {
        const response = await workTests({
          deflakeLimit: opts.maxAttempts,
          testNames: group.tests,
          sessionId: zen.config.sessionId,
        })
        const logStreamName = response.logStreamName

        // Map back to the old representation and fill in any tests that may have not run
        const results = group.tests.map(test => {
          const results = response.results[test] || []
          const result = results.at(-1)

          if (!result) {
            console.log(test, response.results, results)
            return { fullName: test, attempts: 0, error: "Failed to run on remote!", logStream: logStreamName }
          } else {
            return {
              ...result,
              logStream: logStreamName,
              attempts: results.length
            }
          }
        })

        return results.filter((r: testFailure) => r.error || r.attempts > 1)
      } catch (e) {
        console.error(e)
        return group.tests.map((name: string) => {
          return {
            fullName: name,
            attempts: 0,
            error: 'zen failed to run this group',
            time: 0,
          }
        })
      }
    })
  )

  return failedTests
    .flat()
    .reduce((acc: Record<string, testFailure>, result: testFailure) => {
      acc[result.fullName] = result
      return acc
    }, {})
}

function combineFailures(
  currentFailures: TestResultsMap,
  previousFailures?: TestResultsMap
): TestResultsMap {
  if (!previousFailures) return currentFailures

  // Combine the current failures with the previous failures
  const failures = { ...previousFailures }
  // Reset the error state for all the previous tests, that way if they
  // succeed it will report only as a flake
  for (const testName in failures) {
    failures[testName].error = undefined
  }

  for (const testName in currentFailures) {
    const prevFailure = failures[testName]
    const curFailure = currentFailures[testName]

    if (!prevFailure) {
      failures[testName] = curFailure
    } else {
      failures[testName] = {
        ...prevFailure,
        error: curFailure.error,
        time: prevFailure.time + curFailure.time,
        attempts: prevFailure.attempts + curFailure.attempts,
      }
    }
  }

  return failures
}

async function run(zen: Zen, opts: CLIOptions) {
  try {
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
    let workingSet: string[] = await Util.invoke(zen.config.lambdaNames.listTests, {
      sessionId: zen.config.sessionId,
    })

    // In case there is an infinite loop, this should brick the test running
    let runsLeft = 5
    let failures: TestResultsMap | undefined
    console.log(`Running ${workingSet.length} tests`)
    while (runsLeft > 0 && workingSet.length > 0) {
      runsLeft--

      const currentFailures = await runTests(zen, opts, workingSet)
      failures = combineFailures(currentFailures, failures)

      const testsToContinue = []
      for (const testName in failures) {
        const failure = failures[testName]
        if (!failure) continue
        if (failure.error && failure.attempts < opts.maxAttempts) {
          testsToContinue.push(failure.fullName)
        }
      }
      workingSet = testsToContinue
      if (workingSet.length > 0)
        console.log(`Trying to rerun ${workingSet.length} tests`)
    }

    const metrics = []
    let failCount = 0
    for (const test of Object.values(failures || {})) {
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
          `🔴 ${test.fullName} ${test.error} (tried ${
            test.attempts || 1
          } times)`
        )
      } else if (test.attempts > 1) {
        console.log(`⚠️ ${test.fullName} (flaked ${test.attempts - 1}x)`)
      }
    }

    if (opts.logging) Profiler.logBatch(metrics)
    console.log(`Took ${Date.now() - t0}ms`)
    console.log(
      `${failCount ? '😢' : '🎉'} ${failCount} failed test${
        failCount === 1 ? '' : 's'
      }`
    )
    process.exit(failCount ? 1 : 0)
  } catch (e) {
    console.error(e)
    process.exit(1)
  }
}
