(function() {
  let config = {}

  function configFromUrl() {
    config = {}
    window.location.search.substr(1).split('&').forEach(t => {
      let pair = t.split('=').map(s => decodeURIComponent(s))
      config[pair[0]] = pair[1]
    })
  }

  function run() {
    selection = (root, tests) => tests
    Latte.run(selection, {mode: 'debug'})
  }

  configFromUrl()

  window.Zen = {run, config}

  window.addEventListener('load', () => run())

})()

