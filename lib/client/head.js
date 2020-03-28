import { get } from 'svelte/store'
import {
  store,
  mergeValue,
  failureGroups,
  batchForFocus,
  groupForFocus,
} from './store.js'
import * as actions from './actions.js'

const {
  focusTest,
  filterTests,
  closeCommand,
  focusGroup,
} = actions

window.addEventListener('keydown', keyDown, true)
window.addEventListener('keyup', keyUp, true)
window.onpopstate = () => onUrlChange()
Latte.setup({mode: 'debug', willHotReload: true})

// avoid polluting the global namespace
Zen.Fuzzysort = window.fuzzysort
delete window.fuzzysort
Zen.store = store
Zen.actions = actions
Zen.get = get
Zen.computed = {
  failureGroups,
  batchForFocus,
  groupForFocus,
}

window.addEventListener('load', () => {
  Latte.onTest = onTestFinished

  Zen.mini = new Zen.Mini({target: document.querySelector('body'), store})
  Zen.socket = new WebSocket(`ws://${location.host}/head`)
  Zen.socket.onopen = () => onUrlChange()
  Zen.socket.onmessage = serverMessage
  Zen.socket.onclose = () => store.update(mergeValue({socketDisconnected: true}))
  testsHaveChanged()
})

function serverMessage(msg) {
  let data = JSON.parse(msg.data)

  if (data.results && !data.runId) { // incremental update of results
    store.update(mergeValue({results: get(store).results.concat(data.results)}))
  } else {
    // update our state from the server. If our code is out of date, update and re-run the focused test
    store.update(mergeValue(data))
    runIfCodeChanged()
  }
}

function onUrlChange() {
  let params = new URLSearchParams(location.search)
  filterTests({grep: params.get('grep')})
  focusTest(params.get('focus') || '')
}

function testsHaveChanged() {
  // Zen.Command.prepareSearch()
}

function onTestFinished(test, error) {
  if (error) return // I don't think this can happen, as exceptions aren't caught for focused tests
  store.update(mergeValue({focusStatus: 'passed'}))
  Zen.socket.send(JSON.stringify({type: 'passedFocus', test: {fullName: test.fullName}}))
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

Zen.store.update((val) => {
  return {...val, icons: Zen.icons}
})

Zen.commands = [
  {
    type: 'command', title: 'Run the focused test', key: 'Alt Space', keyCode: 32,
    condition: () => get(store).focus,
    action: () => focusTest(),
    icon: Zen.icons.Redo
  }, {
    type: 'command', title: 'Focus the next problem', key: 'Alt →', keyCode: 39,
    condition: () => get(failureGroups).length > 0,
    action: () => focusGroup(+1),
    icon: Zen.icons.ArrowRight
  }, {
    type: 'command', title: 'Focus the previous problem', key: 'Alt ←', keyCode: 37,
    condition: () => get(failureGroups).length > 0,
    action: () => focusGroup(-1),
    icon: Zen.icons.ArrowLeft
  // }, {
  //   type: 'command', title: 'Filter to failed tests', key: 'Alt F', keyCode: 70,
  //   condition: () => get(failureGroups).length > 0,
  //   action: () => filterTests({failed: true}),
  //   icon:
  }, {
    type: 'command', title: 'Run filtered tests', key: 'Alt Enter', keyCode: 13,
    action: () => filterTests({run: true}),
    icon: Zen.icons.Redo
  }, {
    type: 'command', title: 'Run all tests', key: 'Alt A', keyCode: 65,
    action: () => filterTests({grep: null, run: true}),
    altText: 'Clear the filter to run every suite',
    icon: Zen.icons.Asterisk
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
    action: () => filterTests({reload: true, force: true}),
    icon: Zen.icons.Bug
  }
]

function openCloudWatch() {
  let focusedName = get(store).focus
  let focusedResult = get(store).results.find(r => r.fullName === focusedName)
  let aws = Zen.config.aws
  if (focusedResult) {
    window.open(`https://${aws.region}.console.aws.amazon.com/cloudwatch/home?region=${aws.region}#logEventViewer:group=/aws/lambda/serverless-zen-dev-workTests;stream=${focusedResult.logStream}`)
  }
}

function runBatchForFocus({s3}={}) {
  let batch = get(Zen.computed.batchForFocus)
  let jsonUrl = encodeURIComponent(JSON.stringify(batch.map(r => r.fullName)))
  let base = location.origin + '/worker?id=d&batch='
  if (s3) {
    base = Zen.config.proxyUrl + '/index.html?batch='
  }
  window.open(base + jsonUrl, '_blank')
}

let hotReloading = false, compileHasFailed = false
async function runIfCodeChanged() {
  let {compile} = get(store)
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
  while (window.ZenWebpackClient && ZenWebpackClient.needsUpdate(get(store).compile.hash))
    await ZenWebpackClient.update()
  hotReloading = false

  testsHaveChanged()
  focusTest()
}
