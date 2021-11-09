let socket = null,
  store = null

window.addEventListener('keydown', keyDown, true)
window.addEventListener('keyup', keyUp, true)
window.onpopstate = () => onUrlChange()
Latte.setup({ mode: 'debug', willHotReload: true })

// avoid polluting the global namespace
Zen.Fuzzysort = window.fuzzysort
delete window.fuzzysort

window.addEventListener('load', () => {
  Latte.onTest = onTestFinished
  Zen.store = store = new svelte.Store({
    results: [],
    focus: null,
    focusStatus: 'none',
    compile: { errors: [] },
  })
  store.compute(
    'failureGroups',
    ['results', 'focus', 'passedFocus'],
    failureGroups
  )
  store.compute(
    'groupForFocus',
    ['failureGroups'],
    (groups) => groups.find((g) => g.containsFocus) || []
  )
  store.compute('batchForFocus', ['results', 'focus'], batchForFocus)
  Object.assign(store, { focusTest, filterTests, closeCommand, focusGroup })
  store.set({ icons: Zen.icons })

  Zen.mini = new Zen.Mini({ target: document.querySelector('body'), store })
  socket = new WebSocket(`ws://${location.host}/head`)
  socket.onopen = () => onUrlChange()
  socket.onmessage = serverMessage
  socket.onclose = () => store.set({ socketDisconnected: true })
  testsHaveChanged()
})

function serverMessage(msg) {
  let data = JSON.parse(msg.data)

  if (data.results && !data.runId) {
    // incremental update of results
    data.results.forEach((result) => {
      if (!result.log) return

      console.log('REMOTE LOGS:')
      result.log.split('\n').forEach((s) => console.log(s))
    })

    store.set({ results: store.get().results.concat(data.results) })
  } else {
    // update our state from the server. If our code is out of date, update and re-run the focused test
    store.set(data)
    runIfCodeChanged()
  }
}

function onUrlChange() {
  let params = new URLSearchParams(location.search)
  filterTests({ grep: params.get('grep') })
  focusTest(params.get('focus') || '')
}

function updateUrlForTest(name) {
  // Update the url if needed
  const sp = new URLSearchParams(location.search)
  if (name !== sp.get('focus')) {
    name ? sp.set('focus', name) : sp.delete('focus')
    history.pushState({}, 'Zen', '?' + sp.toString())
  }
}

// Run one test in this tab so you can debug it
function focusTest(name) {
  name = name === undefined ? store.get().focus : name
  store.set({ focus: name })
  let test = Latte.flatten().find((t) => t.fullName === name)

  // Update the url if needed
  let sp = new URLSearchParams(location.search)
  if (name !== sp.get('focus')) {
    name ? sp.set('focus', name) : sp.delete('focus')
    history.pushState({}, 'Zen', '?' + sp.toString())
  }

  if (!name || !test) return
  store.set({ focusStatus: 'running' })
  Latte.run([test])
}

function runSingleTestOnRemote(name = store.get().focus) {
  const test = Latte.flatten().find((t) => t.fullName === name)
  updateUrlForTest(name)
  socket.send(
    JSON.stringify({
      type: 'filterTests',
      testNames: [test.fullName],
      run: true,
      logs: { console: true },
    })
  )
}

function filterTests(opts = {}) {
  let grep = (opts.hasOwnProperty('grep') ? opts.grep : store.get().grep) || ''
  store.set({ grep })

  // Update the url if we're changing grep or focus
  let sp = new URLSearchParams(location.search)
  if (grep !== (sp.get('grep') || '')) {
    grep ? sp.set('grep', grep) : sp.delete('grep')
    history.pushState({}, 'Zen', '?' + sp.toString())
  }

  let grepRegex = grep && new RegExp(grep, 'i')
  let tests = Latte.flatten().filter((t) => !grep || grepRegex.test(t.fullName))

  let testNames = tests.map((t) => t.fullName)
  socket.send(
    JSON.stringify(
      Object.assign({ type: 'filterTests', grep, testNames }, opts)
    )
  )
}

function testsHaveChanged() {
  Zen.Command.prepareSearch()
}

function onTestFinished(test, error) {
  if (error) return // I don't think this can happen, as exceptions aren't caught for focused tests
  store.set({ focusStatus: 'passed' })
  socket.send(
    JSON.stringify({ type: 'passedFocus', test: { fullName: test.fullName } })
  )
}

function focusGroup(group) {
  if (typeof group === 'number') {
    let { failureGroups } = store.get()
    let index = failureGroups.findIndex((g) => g.containsFocus)
    group = failureGroups[index + group] || failureGroups[0]
  }
  focusTest(group[0].fullName)
}

let onlyAlt = false
function keyDown(ev) {
  if (!ev.altKey || ev.shiftKey || ev.metaKey || ev.ctrlKey) return // only consider keys with just alt
  onlyAlt = ev.keyCode == 18
  let command = Zen.commands.find((c) => c.keyCode === ev.keyCode)
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
      Zen.command = new Zen.Command({
        target: document.querySelector('body'),
        store,
      })
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
  results.forEach((t) => {
    if (!t.error) return
    if (!t.stack) t.stack = 'unknown \n unknown'
    let key = t.error + t.stack.split('\n')[1]
    groups[key] = groups[key] || []
    groups[key].key = key
    groups[key].error = t.error
    groups[key].passedFocus =
      groups[key].passedFocus ||
      !!passedFocus.find((p) => p.fullName === t.fullName)
    groups[key].push(t)
  })

  return Object.values(groups)
    .map((g) => {
      g.shade = Math.min(Math.floor(Math.sqrt(g.length)), 5)
      g.containsFocus = !!g.find((r) => focus === r.fullName)
      return g
    })
    .sort((a, b) => b.length - a.length)
}

Zen.commands = [
  {
    type: 'command',
    title: 'Run the focused test',
    key: 'Alt Space',
    keyCode: 32,
    condition: () => store.get().focus,
    action: () => focusTest(),
    icon: Zen.icons.Redo,
  },
  {
    type: 'command',
    title: 'Run the focused test on remote',
    key: 'Alt Shift Space',
    keyCode: 32,
    condition: () => store.get().focus,
    action: () => runSingleTestOnRemote(),
    icon: Zen.icons.Redo,
  },
  {
    type: 'command',
    title: 'Focus the next problem',
    key: 'Alt →',
    keyCode: 39,
    condition: () => store.get().failureGroups.length > 0,
    action: () => focusGroup(+1),
    icon: Zen.icons.ArrowRight,
  },
  {
    type: 'command',
    title: 'Focus the previous problem',
    key: 'Alt ←',
    keyCode: 37,
    condition: () => store.get().failureGroups.length > 0,
    action: () => focusGroup(-1),
    icon: Zen.icons.ArrowLeft,
    // }, {
    //   type: 'command', title: 'Filter to failed tests', key: 'Alt F', keyCode: 70,
    //   condition: () => store.get('failureGroups').length > 0,
    //   action: () => filterTests({failed: true}),
    //   icon:
  },
  {
    type: 'command',
    title: 'Run filtered tests',
    key: 'Alt Enter',
    keyCode: 13,
    action: () => filterTests({ run: true }),
    icon: Zen.icons.Redo,
  },
  {
    type: 'command',
    title: 'Run all tests',
    key: 'Alt A',
    keyCode: 65,
    action: () => filterTests({ grep: null, run: true }),
    altText: 'Clear the filter to run every suite',
    icon: Zen.icons.Asterisk,
  },
  {
    type: 'command',
    title: 'Debug on S3',
    action: () => runBatchForFocus({ s3: true }),
    icon: Zen.icons.Bug,
  },
  {
    type: 'command',
    title: 'Show logs in Amazon CloudWatch',
    action: () => openCloudWatch(),
    icon: Zen.icons.Bug,
  },
  {
    type: 'command',
    title: 'Dev: Reload headless chrome',
    action: () => filterTests({ reload: true, force: true }),
    icon: Zen.icons.Bug,
  },
]

function openCloudWatch() {
  let focusedName = store.get().focus
  let focusedResult = store
    .get()
    .results.find((r) => r.fullName === focusedName)
  let aws = Zen.config.aws
  if (focusedResult) {
    window.open(
      `https://${aws.region}.console.aws.amazon.com/cloudwatch/home?region=${aws.region}#logEventViewer:group=/aws/lambda/zen-workTests;stream=${focusedResult.logStream}`
    )
  }
}

// Figure out the set of sets that were run together when the focused test failed
function batchForFocus(results, focus) {
  let focusedResult = results.find((r) => r.fullName === focus)
  if (!focusedResult) return [{ fullName: focus }]
  return results
    .filter((r) => r.batchId === focusedResult.batchId)
    .filter((r) => r.testNumber >= focusedResult.testNumber)
    .sort((a, b) => parseInt(b.testNumber) - parseInt(a.testNumber))
}

function runBatchForFocus({ s3 } = {}) {
  let batch = store.get().batchForFocus
  let jsonUrl = encodeURIComponent(JSON.stringify(batch.map((r) => r.fullName)))
  let base = location.origin + '/worker?id=d&batch='
  if (s3) {
    base = Zen.config.proxyUrl + '/index.html?batch='
  }
  window.open(base + jsonUrl, '_blank')
}

let hotReloading = false,
  compileHasFailed = false
async function runIfCodeChanged() {
  let { compile } = store.get()
  if (compile.status == 'compiling') return
  if (hotReloading) return

  // HMR can't recover from compile errors. Once the build is good again, we need to reload
  if (compile.status == 'error') return (compileHasFailed = true)

  if (compileHasFailed)
    // after recovering, we need to reload
    return window.location.reload()

  // If we loaded before the first compile, reload once the code is ready
  // ZenWebpackClient can be undefined while errored or still bundling
  if (compile.hash && !window.ZenWebpackClient) return location.reload()

  if (!ZenWebpackClient.needsUpdate(compile.hash)) return

  // continue hot reloading until we're up to date. NB that store.compile might change during
  // the async hop, so we we re-`get` it.
  hotReloading = true
  console.clear()
  await Latte.cleanup() // Run all after(Each) in preparation for our new code
  while (ZenWebpackClient.needsUpdate(store.get().compile.hash)) {
    await ZenWebpackClient.update()
  }
  hotReloading = false

  testsHaveChanged()
  focusTest()
}
