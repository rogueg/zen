(function() {
  let params = new URLSearchParams(location.search)
  let ws = null

  window.addEventListener('load', () => {
    ws = new WebSocket(`ws://${location.host}/worker/${params.get('id')}`)
    ws.onmessage = (e) => run(JSON.parse(e.data))
  })

  function run(opts) {
    let tests = Latte.flatten()

    if (opts.grep) {
      let regex = new RegExp(opts.grep, 'i')
      tests = tests.filter(t => t.fullName.match(regex))
    }

    let size = Math.ceil(tests.length / opts.count)
    tests = tests.slice(size * opts.position, size * (opts.position + 1))
    Latte.run({mode: 'headless', onTest, onTimeout, tests})
  }

  function onTest(test, error) {
    ws.send(JSON.stringify({fullName: test.fullName, error}))
  }

  function onTimeout(timeout) {
    // TODO
    // ws.send(JSON.stringify({}))
  }
})()
