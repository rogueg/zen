import {
  writable,
  derived,
} from 'svelte/store'

export const store = writable({
  results: [],
  focus: null,
  focusStatus: 'none',
  compile: { errors: [] },
  // passedFocus: null,
  icons: {},
})

export function mergeValue(hash) {
  return function(val) {
    return {...val, ...hash}
  }
}

export const failureGroups = derived(store, ({results, focus, passedFocus}) => {
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
})

export const groupForFocus = derived(failureGroups, (groups) => groups.find(g => g.containsFocus) || [])

// Figure out the set of sets that were run together when the focused test failed
export const batchForFocus = derived(store, ({results, focus}) => {
  let focusedResult = results.find(r => r.fullName === focus)
  if (!focusedResult) return [{fullName: focus}]
  return results
    .filter(r => r.batchId === focusedResult.batchId)
    .filter(r => r.testNumber >= focusedResult.testNumber)
    .sort((a, b) => parseInt(b.testNumber) - parseInt(a.testNumber))
})