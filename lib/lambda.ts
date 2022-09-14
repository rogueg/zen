import type ChromeWrapper from './chrome_wrapper'
import type { TestResult } from './chrome_wrapper'
import { Context } from 'aws-lambda'
import AWS from 'aws-sdk'
// TODO test if this works
let wrapper: ChromeWrapper // store chrome wrapper globally. In theory we could reuse this between runs

type WorkTestOpts = {
  testNames: string[]
  deflakeLimit?: number
  runId: string
}
type WorkTestsResult = {
  results: Record<string, TestResult[]>,
  logStreamName: string
}
export const workTests = async (
  opts: WorkTestOpts,
  context: Context
): Promise<WorkTestsResult> => {
  const { testNames: tests } = opts
  const remainingTime = context.getRemainingTimeInMillis()
  const results = tests.reduce<Record<string, TestResult[]>>(
    (acc, testName) => {
      acc[testName] = []
      return acc
    },
    {}
  )
  // So we can log lambda errors with the test that caused them
  let activeTest
  const getRemainingTests = () =>
      tests.filter((test) => {
        const testResults = results[test]
        const lastRun = testResults[testResults.length - 1]
        return !lastRun || lastRun.error
      })

  try {
    const timeout = setTimeout(() => {
      throw new Error("Lambda Timeout")
    }, remainingTime - 5_000)
    const runTestSet = async (tests: string[]) => {
      for (const testName of tests) {
        activeTest = testName
        const testOpts = { runId: opts.runId, testName }
        let r = await tab.setTest(testOpts)
        if (!r) {
          r = {
            fullName: testName,
            time: 0,
            error: 'Test resolved without running!',
          }
        }

        results[testOpts.testName].push(r)
      }
    }
    
    const tab = await prepareChrome(opts)
    const deflakeLimit = opts.deflakeLimit || 3
    for (let attempt = 1; attempt <= deflakeLimit; attempt++) {
      const remainingTests = getRemainingTests()
      console.log("REMAINING TESTS", remainingTests)
      if (remainingTests.length === 0) break

      await runTestSet(remainingTests)
    }

    clearTimeout(timeout)
    return {
      results,
      logStreamName: context.logStreamName,
    }
  } catch (e) {
    if (e instanceof Error) {
      const message = e.message
      if (message === "Lambda Timeout" || message.includes("TimeoutError")) {
        const remainingTests = getRemainingTests()
        remainingTests.forEach(test => {
          results[test].push({
            error: message,
            fullName: test,
            time: 0
          })
        })
      } else if (activeTest) {
        results[activeTest].push({
          error: e.message,
          fullName: activeTest,
          time: 0 // TODO figure out a good way to get time
        })
      } else {
        console.log("UNKOWN ERROR")
        console.error(e)
      }
    }

    return {
      results,
      logStreamName: context.logStreamName,
    }
  }
}

export async function listTests(opts): Promise<string[]> {
  let tab = await prepareChrome(opts)
  let names = await tab.getTestNames()
  return names
}

export const sync = async (manifest) => {
  console.log('bucket', process.env.ASSET_BUCKET)
  let s3 = new AWS.S3({ params: { Bucket: process.env.ASSET_BUCKET } })

  // Write the updated session manifest to S3
  let manifestWrite = s3
    .putObject({
      Bucket: process.env.ASSET_BUCKET,
      Key: `session-${manifest.sessionId}.json`,
      Body: JSON.stringify(manifest),
    })
    .promise()

  // TODO: it might be faster to use listObjectsV2, especially if there are many files
  // to check, and S3 is pruned to have less than 2k files. Blame this comment for an example.
  let needed = []
  let toCheck = manifest.files.filter((f) => f.toCheck)
  console.log(`Checking ${toCheck.length} files`)
  await Promise.all(
    toCheck.map(async (f) => {
      try {
        let resp = await s3
          .headObject({
            Bucket: process.env.ASSET_BUCKET,
            Key: f.versionedPath,
          })
          .promise()
        console.log('Found', f.versionedPath, resp)
      } catch (e) {
        needed.push(f)
        if (e.code !== 'NotFound')
          console.log('Error heading', f.versionedPath, e)
      }
    })
  )

  await manifestWrite
  console.log('Manifest written')
  return { needed }
}

export const routeRequest = async (event) => {
  let [sessionId, ...rest] = event.path.split('/').slice(1)
  let manifest = await getManifest(sessionId)
  let path = decodeURIComponent(rest.join('/'))
  console.log('Routing', sessionId, path)

  if (!manifest) {
    return { statusCode: 404, headers: {}, body: 'manifest not found' }
  }

  if (path === 'index.html') {
    return {
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: manifest.index,
    }
  }

  let key = manifest.fileMap[path]
  if (!key) {
    return { statusCode: 404, headers: {}, body: 'path not found in manifest' }
  }

  return {
    statusCode: 301,
    headers: { Location: `${manifest.assetUrl}/${encodeURIComponent(key)}` },
  }
}

async function prepareChrome({ sessionId }: { sessionId: string }) {
  const manifest = await getManifest(sessionId)
  if (!manifest) throw new Error(`Missing manifest for ${sessionId}`)

  // Start chrome and fetch the manifest in parallel
  if (!wrapper) {
    console.log("Setting up Chrome")
    const ChromeWrapper = require('./chrome_wrapper').default
    wrapper = new ChromeWrapper()
    await wrapper.launchLambda()
  } else {
    console.log("Chrome is already setup!")
  }
  
  console.log('Opening tab')
  return await wrapper.openTab(
    process.env.GATEWAY_URL + '/index.html',
    sessionId,
    { logging: true },
    manifest
  )
}

async function getManifest(sessionId) {
  try {
    let s3 = new AWS.S3()
    let resp = await s3
      .getObject({
        Bucket: process.env.ASSET_BUCKET,
        Key: `session-${sessionId}.json`,
      })
      .promise()
    let manifest = JSON.parse(resp.Body.toString('utf-8'))
    manifest.fileMap = {}
    manifest.files.forEach(
      (f) => (manifest.fileMap[f.urlPath] = f.versionedPath)
    )
    console.log(manifest)
    manifest.assetUrl = `https://s3-${process.env.AWS_REGION}.amazonaws.com/${process.env.ASSET_BUCKET}`
    return manifest
  } catch (e) {
    console.log(e)
    return null
  }
}
