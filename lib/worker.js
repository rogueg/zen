(function() {
  let params = new URLSearchParams(location.search)
  let workerId = window.ZenTestWorkerId = params.get('id')
  let ws, opts, warmingUp, runId

  window.addEventListener('load', () => {
    ws = new WebSocket(`ws://${location.host}/worker/${workerId}`)
    ws.onmessage = (e) => run(JSON.parse(e.data))
  })

  async function run(mostRecent) {
    opts = mostRecent
    if (warmingUp) return

    // We need to wait for the current test to finish and update code.
    // It's possible that new opts will come in while waiting, and we always want the most recent one.
    warmingUp = true
    await Latte.abort()
    while (ZenWebpackClient.needsUpdate(opts.codeHash))
      await ZenWebpackClient.update(opts.codeHash)
    warmingUp = false

    if (!opts.grep)
      return

    let regex = new RegExp(opts.grep, 'i')
    let tests = Latte.flatten().filter(t => t.fullName.match(regex))

    // divide tests by the total number of workers, then take our portion
    let size = Math.ceil(tests.length / opts.workerCount)
    tests = tests.slice(size * opts.position, size * (opts.position + 1))

    // skip tests that have already
    tests = tests.filter(t => opts.completed.indexOf(t.fullName) == -1)

    runId = opts.runId
    Latte.run(tests)
  }

  Latte.setup('headless')

  Latte.onTest = function onTest(test, error) {
    if (error && typeof(error) == 'string')
      error = new Error(error) // in case the user throws a string
    error = error && {message: error.message, stack: error.stack} // errors aren't stringifyable
    ws.send(JSON.stringify({fullName: test.fullName, error, runId, workerId}))
  }
})()
