(function() {
  let params = new URLSearchParams(location.search)
  let ws, lastOpts, updating

  window.addEventListener('load', () => {
    ws = new WebSocket(`ws://${location.host}/worker/${params.get('id')}`)
    ws.onmessage = (e) => run(JSON.parse(e.data))
  })

  function run(opts) {
    lastOpts = opts

    if (ZenWebpackClient.needsUpdate(opts.codeHash))
      return updateCode(opts)

    let tests = Latte.flatten()

    if (opts.grep) {
      let regex = new RegExp(opts.grep, 'i')
      tests = tests.filter(t => t.fullName.match(regex))
    }

    // divide tests by the total number of workers, then take our portion
    let size = Math.ceil(tests.length / opts.workerCount)
    tests = tests.slice(size * opts.position, size * (opts.position + 1))
    Latte.run({mode: 'headless', onTest, onTimeout, tests})
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

  function onTest(test, error) {
    ws.send(JSON.stringify({fullName: test.fullName, error}))
  }

  function onTimeout(timeout) {
    // TODO
    // ws.send(JSON.stringify({}))
  }
})()
