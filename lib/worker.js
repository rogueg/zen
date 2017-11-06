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

    if (!opts.toRun)
      return

    let tests = Latte.flatten().filter(t => t.fullName == opts.toRun)
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
