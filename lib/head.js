window.Zen = {}
let socket = null, store = null

window.addEventListener('keydown', keyDown, true)
window.addEventListener('keyup', keyUp, true)
window.onpopstate = () => run()

window.addEventListener('load', () => {
  Latte.setup('debug')
  Latte.onTest = (test, error) => store.set({focusFailure: !!error})
  Zen.store = store = new svelte.Store({results: [], totalCount: 0, focusStatus: 'none', compile: {errors: []}})
  store.compute('failureGroups', ['compile', 'results', 'focus'], failureGroups)
  store.compute('statusText', ['results', 'compile', 's3', 'totalCount', 'lambdaCount'], statusText)
  Object.assign(store, {run, closeCommand, focusNext})

  Zen.mini = new Zen.Mini({target: document.querySelector('body'), store})
  socket = new WebSocket(`ws://${location.host}/head`)
  socket.onopen = () => run()
  socket.onmessage = serverMessage
})

function serverMessage(msg) {
  let data = JSON.parse(msg.data)

  if (data.results && !data.runId) { // incremental update of results
    store.set({results: store.get('results').concat(data.results)})
  } else {
    // update our state from the server. If our code is out of date, update and re-run the focused test
    store.set(data)
    runIfCodeChanged()
  }
}

function run(opts={}) {
  let params = new URLSearchParams(location.search)
  let grep = opts.hasOwnProperty('grep') ? opts.grep : params.get('grep')
  let focus = opts.hasOwnProperty('focus') ? opts.focus : params.get('focus')
  store.set({grep, focus})

  // Update the url if we're changing grep or focus
  if (opts.hasOwnProperty('grep') || opts.hasOwnProperty('focus')) {
    let sp = new URLSearchParams(location.search)
    grep ? sp.set('grep', grep) : sp.delete('grep')
    focus ? sp.set('focus', focus) : sp.delete('focus')
    history.pushState({}, 'Zen', '?' + sp.toString())
  }

  let grepRegex = grep && new RegExp(grep, 'i')
  let tests = Latte.flatten().filter(t => (!grep || grepRegex.test(t.fullName)))

  if (!opts.focusOnly) {
    let testNames = tests.map(t => t.fullName)
    socket.send(JSON.stringify(Object.assign({grep, testNames}, opts)))
  }

  let focusRegex = focus && new RegExp(focus, 'i')
  let focused = tests.filter(t => focus && focusRegex.test(t.fullName))
  store.set({focusStatus: focused.length > 0 ? 'running' : 'none'})
  if (focused.length > 0) {
    Latte.run(focused).then(() => store.set({focusStatus: 'passed'}))
  }
}

function focusNext() {
  let test = store.get('failureGroups')[0][0]
  run({focus: test.fullName, focusOnly: true})
}

function keyDown(ev) {
  store.set({onlyAlt: ev.keyCode == 18 && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey})
  if (!ev.altKey) return
  if (ev.keyCode == 32) run({focusOnly: true})
  if (ev.keyCode == 39) focusNext()
  if (ev.keyCode == 13) run()
  if (ev.keyCode == 65) run({grep: null, focus: null, force: true})
  if (ev.keyCode == 70) run({filterFailed: true})
}

function keyUp(ev) {
  let altUp = ev.keyCode == 18 && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey
  if (altUp && store.get('onlyAlt')) {
    if (Zen.command) {
      closeCommand()
    } else {
      Zen.command = new Zen.Command({target: document.querySelector('body'), store})
    }
  }
  this.onlyAlt = false
}

function closeCommand() {
  Zen.command.destroy()
  Zen.command = null
}

function failureGroups(compile, results, focus) {
  if (compile.status != 'done')
    return []

  let groups = {}
  results.forEach(t => {
    if (!t.error) return
    if (!t.error.stack) t.error.stack = 'unknown \n unknown'
    let key = t.error.message + t.error.stack.split('\n')[1]
    groups[key] = groups[key] || []
    groups[key].key = key
    groups[key].push(t)
  })

  return Object.values(groups).map(g => {
    g.shade = Math.min(Math.floor(Math.sqrt(g.length)), 6)
    // g.active = !!g.find(r => focus && focus.test(r.fullName))
    return g
  })
}

function statusText(results, compile, s3, totalCount, lambdaCount) {
  if (compile.status == 'error')
    return 'Compile error'

  if (compile.status == 'compiling')
    return 'Compiling'

  if (lambdaCount && results.length == 0)
    return `Starting ${lambdaCount} workers`

  if (s3 && !s3.done && s3.changed)
    return `Uploading ${s3.uploaded}/${s3.changed}`

  if (results)
    return `${results.length}/${totalCount}`

  return ''
}

let hotReloading = false, compileHasFailed = false
async function runIfCodeChanged() {
  if (store.get('compile').status == 'compiling') return
  if (hotReloading) return

  // HMR can't recover from compile errors. Once the build is good again, we need to reload
  if (store.get('compile').status == 'error')
    return compileHasFailed = true

  if (compileHasFailed) // after recovering, we need to reload
    return window.location.reload()

  if (!ZenWebpackClient.needsUpdate(store.get('compile').hash)) return

  hotReloading = true
  await Latte.abort()
  while (window.ZenWebpackClient && ZenWebpackClient.needsUpdate(store.get('compile').hash))
    await ZenWebpackClient.update()
  hotReloading = false

  run()
}
