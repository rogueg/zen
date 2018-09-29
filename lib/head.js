let socket = null, store = null

window.addEventListener('keydown', keyDown, true)
window.addEventListener('keyup', keyUp, true)
window.onpopstate = () => run()

window.addEventListener('load', () => {
  Latte.setup('debug')
  Latte.onTest = (test, error) => store.set({focusFailure: !!error})
  Zen.store = store = new svelte.Store({results: [], totalCount: 0, focus: null, focusStatus: 'none', compile: {errors: []}})
  store.compute('failureGroups', ['results', 'focus'], failureGroups)
  store.compute('groupForFocus', ['failureGroups'], (groups) => groups.find(g => g.containsFocus))
  store.compute('batchForFocus', ['results', 'focus'], batchForFocus)
  Object.assign(store, {run, closeCommand, focusGroup})

  Zen.mini = new Zen.Mini({target: document.querySelector('body'), store})
  socket = new WebSocket(`ws://${location.host}/head`)
  socket.onopen = () => run()
  socket.onmessage = serverMessage
  socket.onclose = () => store.set({socketDisconnected: true})
})

function serverMessage(msg) {
  let data = JSON.parse(msg.data)

  if (data.results && !data.runId) { // incremental update of results
    store.set({results: store.get().results.concat(data.results)})
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

  let testNames = tests.map(t => t.fullName)
  socket.send(JSON.stringify(Object.assign({grep, testNames}, opts)))

  if (focus) {
    tests = tests.filter(t => t.fullName === focus)
    store.set({focusStatus: 'running'})
    Latte.run(tests).then(() => store.set({focusStatus: 'passed'}))
  }
}

function focusGroup(group) {
  if (typeof group === 'number') {
    let {failureGroups} = store.get()
    let index = failureGroups.findIndex(g => g.containsFocus)
    group = failureGroups[index + group] || failureGroups[0]
  }
  run({focus: group[0].fullName})
}

let onlyAlt = false
function keyDown(ev) {
  onlyAlt = ev.keyCode == 18 && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey
  if (!ev.altKey) return
  let command = Zen.commands.find(c => c.keyCode === ev.keyCode)
  if (command && (!command.condition || command.condition())) {
    ev.preventDefault()
    if (Zen.command) closeCommand()
    command.action()
    onlyAlt = false
  }
}

function keyUp(ev) {
  let altUp = ev.keyCode == 18 && !ev.shiftKey && !ev.metaKey && !ev.ctrlKey
  if (altUp && onlyAlt) {
    if (Zen.command) {
      closeCommand()
    } else {
      Zen.command = new Zen.Command({target: document.querySelector('body'), store})
    }
  }
  onlyAlt = false
}

function closeCommand() {
  Zen.command.destroy()
  Zen.command = null
}

function failureGroups(results, focus) {
  let groups = {}
  results.forEach(t => {
    if (!t.error) return
    if (!t.stack) t.stack = 'unknown \n unknown'
    let key = t.error + t.stack.split('\n')[1]
    groups[key] = groups[key] || []
    groups[key].key = key
    groups[key].push(t)
  })

  return Object.values(groups).map(g => {
    g.shade = Math.min(Math.floor(Math.sqrt(g.length)), 5)
    g.containsFocus = !!g.find(r => focus === r.fullName)
    return g
  }).sort((a, b) => b.length - a.length)
}

Zen.commands = [
  {
    type: 'command', title: 'Run the focused test', key: 'Alt Space', keyCode: 32,
    condition: () => store.get().focus,
    action: () => store.run(),
    icon: `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M4 18c0-7.73 6.27-14 14-14s14 6.27 14 14c0-5.523-4.477-10-10-10s-10 4.477-10 10v2h4l-8 8-8-8h4v-2z"></path></svg>`
  }, {
    type: 'command', title: 'Focus the next failing group', key: 'Alt →', keyCode: 39,
    condition: () => store.get().failureGroups.length > 0,
    action: () => focusGroup(+1),
    icon: `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M31 16l-15-15v9h-16v12h16v9z"></path></svg>`
  }, {
    type: 'command', title: 'Focus the previous failing group', key: 'Alt ←', keyCode: 37,
    condition: () => store.get().failureGroups.length > 0,
    action: () => focusGroup(-1),
    icon: `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M31 16l-15-15v9h-16v12h16v9z"></path></svg>`
  // }, {
  //   type: 'command', title: 'Filter to failed tests', key: 'Alt F', keyCode: 70,
  //   condition: () => store.get('failureGroups').length > 0,
  //   action: () => this.store.run({filterFailed: true}),
  //   icon: `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M31 16l-15-15v9h-16v12h16v9z"></path></svg>`
  }, {
    type: 'command', title: 'Run filtered tests', key: 'Alt Enter', keyCode: 13,
    action: () => store.run({force: true}),
    icon: `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M4 18c0-7.73 6.27-14 14-14s14 6.27 14 14c0-5.523-4.477-10-10-10s-10 4.477-10 10v2h4l-8 8-8-8h4v-2z"></path></svg>`
  }, {
    type: 'command', title: 'Run all tests', key: 'Alt A', keyCode: 65,
    action: () => store.run({focus: null, grep: null, force: true}),
    altText: 'Clear the filter to run every suite',
    icon: `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 26 26"><path d="M23.156 16.406c0.953 0.547 1.281 1.781 0.734 2.734l-1 1.719c-0.547 0.953-1.781 1.281-2.734 0.734l-4.156-2.391v4.797c0 1.094-0.906 2-2 2h-2c-1.094 0-2-0.906-2-2v-4.797l-4.156 2.391c-0.953 0.547-2.187 0.219-2.734-0.734l-1-1.719c-0.547-0.953-0.219-2.188 0.734-2.734l4.156-2.406-4.156-2.406c-0.953-0.547-1.281-1.781-0.734-2.734l1-1.719c0.547-0.953 1.781-1.281 2.734-0.734l4.156 2.391v-4.797c0-1.094 0.906-2 2-2h2c1.094 0 2 0.906 2 2v4.797l4.156-2.391c0.953-0.547 2.188-0.219 2.734 0.734l1 1.719c0.547 0.953 0.219 2.188-0.734 2.734l-4.156 2.406z"></path></svg>`
  }, {
    type: 'command', title: 'Debug on S3',
    action: () => runBatchForFocus({s3: true}),
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><path d="M31 28h-1.59l-.55-.55c1.96-2.27 3.14-5.22 3.14-8.45 0-7.18-5.82-13-13-13s-13 5.82-13 13 5.82 13 13 13c3.23 0 6.18-1.18 8.45-3.13l.55.55v1.58l10 9.98 2.98-2.98-9.98-10zm-12 0c-4.97 0-9-4.03-9-9s4.03-9 9-9 9 4.03 9 9-4.03 9-9 9z"/><path d="M0 0h48v48h-48z" fill="none"/></svg>`
  }, {
    type: 'command', title: 'Show logs in Amazon CloudWatch',
    action: () => openCloudWatch(),
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><path d="M31 28h-1.59l-.55-.55c1.96-2.27 3.14-5.22 3.14-8.45 0-7.18-5.82-13-13-13s-13 5.82-13 13 5.82 13 13 13c3.23 0 6.18-1.18 8.45-3.13l.55.55v1.58l10 9.98 2.98-2.98-9.98-10zm-12 0c-4.97 0-9-4.03-9-9s4.03-9 9-9 9 4.03 9 9-4.03 9-9 9z"/><path d="M0 0h48v48h-48z" fill="none"/></svg>`
  }, {
    type: 'command', title: 'Dev: Reload headless chrome',
    action: () => store.run({reload: true}),
    icon: `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M31 16l-15-15v9h-16v12h16v9z"></path></svg>`
  }
]

function openCloudWatch() {
  let focusedName = store.get().focus
  let focusedResult = store.get().results.find(r => r.fullName === focusedName)
  let aws = Zen.config.aws
  if (focusedResult) {
    window.open(`https://${aws.region}.console.aws.amazon.com/cloudwatch/home?region=${aws.region}#logEventViewer:group=/aws/lambda/serverless-zen-dev-workTests;stream=${focusedResult.logStream}`)
  }
}

// Figure out the set of sets that were run together when the focused test failed
function batchForFocus(results, focus) {
  let focusedResult = results.find(r => r.fullName === focus)
  if (!focusedResult) return [{fullName: focus}]
  return results
    .filter(r => r.sessionId === focusedResult.sessionId)
    .filter(r => r.testNumber >= focusedResult.testNumber)
    .sort((a, b) => parseInt(b.testNumber) - parseInt(a.testNumber))
}

function runBatchForFocus({s3}={}) {
  let batch = store.get().batchForFocus
  let jsonUrl = encodeURIComponent(JSON.stringify(batch.map(r => r.fullName)))
  let base = location.origin + '/worker?id=d&batch='
  if (s3) {
    base = Zen.config.s3Url + '?batch='
  }
  window.open(base + jsonUrl, '_blank')
}

let hotReloading = false, compileHasFailed = false
async function runIfCodeChanged() {
  let {compile} = store.get()
  if (compile.status == 'compiling') return
  if (hotReloading) return

  // HMR can't recover from compile errors. Once the build is good again, we need to reload
  if (compile.status == 'error')
    return compileHasFailed = true

  if (compileHasFailed) // after recovering, we need to reload
    return window.location.reload()

  if (!ZenWebpackClient.needsUpdate(compile.hash)) return

  // continue hot reloading until we're up to date. NB that store.compile might change during
  // the async hop, so we we re-`get` it.
  hotReloading = true
  while (window.ZenWebpackClient && ZenWebpackClient.needsUpdate(store.get().compile.hash))
    await ZenWebpackClient.update()
  hotReloading = false

  run()
}
