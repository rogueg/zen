import {
  mergeValue,
} from './store.js'

// Run one test in this tab so you can debug it
export function focusTest(name) {
  name = name === undefined ? Zen.get(Zen.store).focus : name
  Zen.store.update(mergeValue({focus: name}))
  let test = Latte.flatten().find(t => t.fullName === name)

  // Update the url if needed
  let sp = new URLSearchParams(location.search)
  if (name !== sp.get('focus')) {
    name ? sp.set('focus', name) : sp.delete('focus')
    history.pushState({}, 'Zen', '?' + sp.toString())
  }

  if (!name || !test) return

  Zen.store.update(mergeValue({focusStatus: 'running'}))
  Latte.run([test])
}

export function filterTests(opts={}) {
  let grep = (opts.hasOwnProperty('grep') ? opts.grep : Zen.get(Zen.store).grep) || ''
  Zen.store.update(mergeValue({grep}))

  // Update the url if we're changing grep or focus
  let sp = new URLSearchParams(location.search)
  if (grep !== (sp.get('grep') || '')) {
    grep ? sp.set('grep', grep) : sp.delete('grep')
    history.pushState({}, 'Zen', '?' + sp.toString())
  }

  let grepRegex = grep && new RegExp(grep, 'i')
  let tests = Latte.flatten().filter(t => (!grep || grepRegex.test(t.fullName)))

  let testNames = tests.map(t => t.fullName)
  Zen.socket.send(JSON.stringify(Object.assign({type: 'filterTests', grep, testNames}, opts)))
}

export function closeCommand() {
  if (Zen.command) {
    Zen.command.$destroy()
    Zen.command = null
  }
}

export function focusGroup(group) {
  if (typeof group === 'number') {
    let failureGroups = Zen.get(Zen.computed.failureGroups)
    let index = failureGroups.findIndex(g => g.containsFocus)
    group = failureGroups[index + group] || failureGroups[0]
  }

  if (group && group[0]) {
    focusTest(group[0].fullName)
  }
}