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
    Latte.run(config.suite, {mode: 'debug'})
  }

  configFromUrl()
  // listen for HMR events
  // run()

  window.addEventListener('load', () => run())

})()

