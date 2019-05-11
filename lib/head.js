let socket = null, store = null

window.addEventListener('keydown', keyDown, true)
window.addEventListener('keyup', keyUp, true)
window.onpopstate = () => run()
Latte.setup({mode: 'debug', willHotReload: true})

// avoid polluting the global namespace
Zen.Fuzzysort = window.fuzzysort
delete window.fuzzysort

window.addEventListener('load', () => {
  Latte.onTest = onTestFinished
  Zen.store = store = new svelte.Store({results: [], focus: null, focusStatus: 'none', compile: {errors: []}})
  store.compute('failureGroups', ['results', 'focus', 'passedFocus'], failureGroups)
  store.compute('groupForFocus', ['failureGroups'], (groups) => groups.find(g => g.containsFocus) || [])
  store.compute('batchForFocus', ['results', 'focus'], batchForFocus)
  Object.assign(store, {run, closeCommand, focusGroup})
  store.set({icons: Zen.icons})

  Zen.mini = new Zen.Mini({target: document.querySelector('body'), store})
  socket = new WebSocket(`ws://${location.host}/head`)
  socket.onopen = () => run()
  socket.onmessage = serverMessage
  socket.onclose = () => store.set({socketDisconnected: true})
  testsHaveChanged()
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

async function run(opts={}) {
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
  socket.send(JSON.stringify(Object.assign({type: 'run', grep, testNames}, opts)))

  if (focus) {
    tests = tests.filter(t => t.fullName === focus)
    store.set({focusStatus: 'running'})
    await Latte.run(tests)
  }
}

function testsHaveChanged() {
  Zen.Command.prepareSearch()
}

function onTestFinished(test, error) {
  if (error) return // I don't think this can happen, as exceptions aren't caught for focused tests
  store.set({focusStatus: 'passed'})
  socket.send(JSON.stringify({type: 'passedFocus', test: {fullName: test.fullName}}))
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
  if (!ev.altKey || ev.shiftKey || ev.metaKey || ev.ctrlKey) return // only consider keys with just alt
  onlyAlt = ev.keyCode == 18
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

function failureGroups(results, focus, passedFocus) {
  let groups = {}
  results.forEach(t => {
    if (!t.error) return
    if (!t.stack) t.stack = 'unknown \n unknown'
    let key = t.error + t.stack.split('\n')[1]
    groups[key] = groups[key] || []
    groups[key].key = key
    groups[key].error = t.error
    groups[key].passedFocus = groups[key].passedFocus || !!passedFocus.find(p => p.fullName === t.fullName)
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
    icon: Zen.icons.Redo
  }, {
    type: 'command', title: 'Focus the next problem', key: 'Alt →', keyCode: 39,
    condition: () => store.get().failureGroups.length > 0,
    action: () => focusGroup(+1),
    icon: Zen.icons.ArrowRight
  }, {
    type: 'command', title: 'Focus the previous problem', key: 'Alt ←', keyCode: 37,
    condition: () => store.get().failureGroups.length > 0,
    action: () => focusGroup(-1),
    icon: Zen.icons.ArrowLeft
  // }, {
  //   type: 'command', title: 'Filter to failed tests', key: 'Alt F', keyCode: 70,
  //   condition: () => store.get('failureGroups').length > 0,
  //   action: () => this.store.run({filterFailed: true}),
  //   icon:
  }, {
    type: 'command', title: 'Run filtered tests', key: 'Alt Enter', keyCode: 13,
    action: () => store.run({force: true}),
    icon: Zen.icons.Redo
  }, {
    type: 'command', title: 'Run all tests', key: 'Alt A', keyCode: 65,
    action: () => store.run({grep: null, force: true}),
    altText: 'Clear the filter to run every suite',
    icon: Zen.icons.Asterisk
  }, {
    type: 'command', title: 'Run current test until it fails', key: 'Alt F', keyCode: 70,
    condition: () => store.get().focus,
      action: async () => { while (true) { await store.run() } },
    icon: Zen.icons.Redo
  }, {
    type: 'command', title: 'Debug on S3',
    action: () => runBatchForFocus({s3: true}),
    icon: Zen.icons.Bug
  }, {
    type: 'command', title: 'Show logs in Amazon CloudWatch',
    action: () => openCloudWatch(),
    icon: Zen.icons.Bug
  }, {
    type: 'command', title: 'Dev: Reload headless chrome',
    action: () => store.run({reload: true, force: true}),
    icon: Zen.icons.Bug
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
    .filter(r => r.batchId === focusedResult.batchId)
    .filter(r => r.testNumber >= focusedResult.testNumber)
    .sort((a, b) => parseInt(b.testNumber) - parseInt(a.testNumber))
}

function runBatchForFocus({s3}={}) {
  let batch = store.get().batchForFocus
  let jsonUrl = encodeURIComponent(JSON.stringify(batch.map(r => r.fullName)))
  let base = location.origin + '/worker?id=d&batch='
  if (s3) {
    base = Zen.config.proxyUrl + '/index.html?batch='
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

  // If we loaded before the first compile, reload once the code is ready
  if (compile.hash && !window.ZenWebpackClient)
    return location.reload()

  if (!ZenWebpackClient.needsUpdate(compile.hash)) return

  // continue hot reloading until we're up to date. NB that store.compile might change during
  // the async hop, so we we re-`get` it.
  hotReloading = true
  console.clear()
  await Latte.cleanup() // Run all after(Each) in preparation for our new code
  while (window.ZenWebpackClient && ZenWebpackClient.needsUpdate(store.get().compile.hash))
    await ZenWebpackClient.update()
  hotReloading = false

  testsHaveChanged()
  run()
}
