(function() {
  let ws

  function run() {
    let config = {}
    window.location.search.substr(1).split('&').forEach(t => {
      let pair = t.split('=').map(s => decodeURIComponent(s))
      config[pair[0]] = pair[1]
    })

    let grep = config.grep && new RegExp(config.grep, 'i')
    selection = (root, tests) => {
      if(!grep) return tests
      return tests.filter(t => grep.test(t.fullName))
    }
    Latte.run(selection, {mode: 'debug'})
  }

  window.Zen = {run}

  window.addEventListener('load', () => {
    ws = new WebSocket(`ws://${location.host}/head`)
    ws.onmessage = (msg) => {
      debugger
      1
    }
    run()
  })

})()

