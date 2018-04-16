(function() {
  let params = new URLSearchParams(location.search)
  window.ZenTestWorkerId = params.get('id')
  let runId
  window.Zen = {}

  Zen.upgrade = async function (hash) {
    await window.ZenWebpackClient.update(hash)
    console.log('Zen.hotReload')
  }

  Zen.run = async function(opts) {
    runId = opts.runId
    let tests = Latte.flatten().filter(t => t.fullName == opts.testName)

    if (tests.length == 0) {
      console.info('Zen.results ' + JSON.stringify({fullName: opts.testName, error: {message: 'test not found'}}))
      return
    }

    return Latte.run(tests)
  }

  Latte.setup('headless')

  Latte.onTest = function onTest(test, error) {
    if (error && typeof(error) == 'string')
      error = new Error(error) // in case the user throws a string
    error = error && {message: error.message, stack: error.stack} // errors aren't stringifyable
    console.info('Zen.results ' + JSON.stringify({fullName: test.fullName, error, runId}))
  }

  window.addEventListener('load', async () => {
    let params = new URLSearchParams(location.search)
    if (params.manual) {
      let tests = JSON.parse(params.manual), test
      while(name = tests.pop())
        await runTest(name)
    } else {
      console.info('Zen.idle')
    }
  })
})()
