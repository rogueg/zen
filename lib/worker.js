(function() {
  let mostRecent, warmingUp

  window.ZenRunTestByName = async function(opts) {
    mostRecent = opts
    if (warmingUp) return

    // We need to wait for the current test to finish and update code.
    // It's possible that new opts will come in while waiting, and we always want the most recent one.
    warmingUp = true
    await Latte.abort()
    while (ZenWebpackClient.needsUpdate(mostRecent.codeHash))
      await ZenWebpackClient.update(mostRecent.codeHash)
    warmingUp = false

    let tests = Latte.flatten().filter(t => t.fullName == mostRecent.toRun)
    runId = mostRecent.runId
    Latte.run(tests)
  }

  Latte.setup('headless')

  Latte.onTest = function onTest(test, error) {
    if (error && typeof(error) == 'string')
      error = new Error(error) // in case the user throws a string
    error = error && {message: error.message, stack: error.stack} // errors aren't stringifyable
    console.info('zen results ' + JSON.stringify({fullName: test.fullName, error, runId}))
  }

  window.addEventListener('load', () => console.info('zen worker ready'))
})()
