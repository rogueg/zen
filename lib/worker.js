(function() {
  let params = new URLSearchParams(location.search)
  let workerId = window.ZenTestWorkerId = params.get('id')
  let ws, lastOpts, updating, runId

  window.addEventListener('load', () => {
    ws = new WebSocket(`ws://${location.host}/worker/${workerId}`)
    ws.onmessage = (e) => run(JSON.parse(e.data))
  })

  function run(opts) {
    lastOpts = opts

    if (ZenWebpackClient.needsUpdate(opts.codeHash))
      return updateCode(opts)

    if (!opts.grep)
      return

    let regex = new RegExp(opts.grep, 'i')
    let tests = Latte.flatten().filter(t => {
      return t.fullName.match(regex) && opts.completed.indexOf(t.fullName) == -1
    })

    // divide tests by the total number of workers, then take our portion
    let size = Math.ceil(tests.length / opts.workerCount)
    tests = tests.slice(size * opts.position, size * (opts.position + 1))
    runId = opts.runId
    Latte.run(tests)
  }

  // On code change, we need to stop any running tests, then update, and then `run`.
  // Code might change again in the middle of this process. We should only call `run` with the latest options.
  async function updateCode() {
    if (updating) return
    updating = true

    await Latte.abort()
    while (ZenWebpackClient.needsUpdate(lastOpts.codeHash))
      await ZenWebpackClient.update(lastOpts.codeHash)

    run(lastOpts)
  }

  Latte.mode = 'headless'

  Latte.onTest = function onTest(test, error) {
    error = error && {message: error.message, stack: error.stack} // errors aren't stringifyable
    ws.send(JSON.stringify({fullName: test.fullName, error, runId}))
  }
})()
