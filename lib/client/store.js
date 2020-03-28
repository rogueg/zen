export const store = new svelte.Store({ results: [], focus: null, focusStatus: 'none', compile: { errors: [] } })
store.compute('failureGroups', ['results', 'focus', 'passedFocus'], failureGroups)
store.compute('groupForFocus', ['failureGroups'], (groups) => groups.find(g => g.containsFocus) || [])
store.compute('batchForFocus', ['results', 'focus'], batchForFocus)
Object.assign(store, { focusTest, filterTests, closeCommand, focusGroup })
store.set({ icons: Zen.icons })

export function failureGroups(results, focus, passedFocus) {
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

// Figure out the set of sets that were run together when the focused test failed
export function batchForFocus(results, focus) {
  let focusedResult = results.find(r => r.fullName === focus)
  if (!focusedResult) return [{fullName: focus}]
  return results
    .filter(r => r.batchId === focusedResult.batchId)
    .filter(r => r.testNumber >= focusedResult.testNumber)
    .sort((a, b) => parseInt(b.testNumber) - parseInt(a.testNumber))
}

// Run one test in this tab so you can debug it
export function focusTest(name) {
  name = name === undefined ? store.get().focus : name
  store.set({focus: name})
  let test = Latte.flatten().find(t => t.fullName === name)

  // Update the url if needed
  let sp = new URLSearchParams(location.search)
  if (name !== sp.get('focus')) {
    name ? sp.set('focus', name) : sp.delete('focus')
    history.pushState({}, 'Zen', '?' + sp.toString())
  }

  if (!name || !test) return
  store.set({focusStatus: 'running'})
  Latte.run([test])
}

export function filterTests(opts={}) {
  let grep = (opts.hasOwnProperty('grep') ? opts.grep : store.get().grep) || ''
  store.set({grep})

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
  Zen.command.destroy()
  Zen.command = null
}

export function focusGroup(group) {
  if (typeof group === 'number') {
    let {failureGroups} = store.get()
    let index = failureGroups.findIndex(g => g.containsFocus)
    group = failureGroups[index + group] || failureGroups[0]
  }
  focusTest(group[0].fullName)
}