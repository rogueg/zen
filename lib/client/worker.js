(function() {
  let params = new URLSearchParams(location.search)
  let  workerId = params.get('id')
  let runId
  let batchId = workerId + '-' + Date.now()
  let testNumber = 0

  Latte.setup({mode: 'headless', willHotReload: true})

  Zen.upgrade = async function (hash) {
    await Latte.waitForCurrentTest()
    await Latte.cleanup() // we shouldn't upgrade until the `after` blocks have run
    await window.ZenWebpackClient.update(hash)
    batchId = workerId + Date.now()
    console.log('Zen.hotReload - ' + hash)
  }

  Zen.run = async function(opts) {
    runId = opts.runId
    let tests = Latte.flatten().filter(t => t.fullName == opts.testName)

    if (opts.batch) {
      let allTests = Latte.flatten()
      tests = opts.batch.map(name => {
        let test = allTests.find(t => t.fullName === name)
        if (!test) throw new Error(`Couldn't find test named ${name}`)
        return test
      })
    }

    else if (tests.length == 0) {
      console.info('Zen.results ' + JSON.stringify({runId, fullName: opts.testName, error: 'test not found'}))
      return
    }

    else if (tests.length > 1) {
      console.info('Zen.results ' + JSON.stringify({runId, fullName: opts.testName, error: 'multiple tests match'}))
      return
    }

    await Latte.run(tests)
  }

  Latte.onTest = function onTest(test, err) {
    if (err && typeof(err) == 'string')
      err = new Error(err) // in case the user throws a string

    // errors aren't stringifyable, so just send the message and stack
    let error = err && err.message
    let stack = err && err.stack
    console.info('Zen.results ' + JSON.stringify({fullName: test.fullName, error, stack, batchId, testNumber}))
    testNumber++
  }

  window.addEventListener('load', async () => {
    console.info('Zen.idle')
    let params = new URLSearchParams(location.search)

    if (params.get('batch')) {
      let names = JSON.parse(params.get('batch'))
      await Zen.run({batch: names})
    }
  })
})()
