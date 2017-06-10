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
    if(!config.suite) return
    Latte.run(config.suite, config.test ? [config.test] : [], {mode: 'debug'})
  }

  configFromUrl()

  window.Zen = {run}

  window.addEventListener('load', () => run())

})()

