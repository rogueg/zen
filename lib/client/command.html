<div class='ZenCommand'>
  <input bind:value='{input}' bind:this='{prompt}' on:blur='{() => Zen.actions.closeCommand()}' on:keydown='{(event) => onKeyDown(event)}' on:input='{() => setSelected(0)}' />
  <div bind:this='{list}' class='suggestions'>
    {#each suggestions as suggestion, index}
      <div class="{index == selectedIndex ? 'selected' : ''}" title='{altText(suggestion)}' on:click='{() => takeAction(index)}'>
        {@html icon(suggestion)}
        <span class='title'>{suggestion.title}</span>
        {#if suggestion.key}
          <div class='keys'>
            {#each suggestion.key.split(' ') as k}
              <span>{k}</span>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  /* avoid any css rules from  */
  :global(.ZenCommand *:not(path)) { all: unset; }

  .ZenCommand {
    line-height: 1.5em;

    width: 80%;
    max-width: 500px;
    position: absolute;
    top: 200px;
    left: 50%;
    margin-right: -50%;
    transform: translate(-50%, 0);

    background: #212121;
    color: #ddd;
    font-size: 12px;
    font-family: 'Lucida Sans', 'Lucida Sans Regular', 'Lucida Grande', 'Lucida Sans Unicode', Geneva, Verdana, sans-serif;
  }

  input {
    display: inline-block;
    box-sizing: border-box;
    width: 100%;
    border: none;
    background: none;
    padding: 14px 30px 10px 60px;
    border-bottom: 1px solid #313131;
    color: inherit;
    font-size: inherit;
  }

  .suggestions {
    display: block;
    height: 400px;
    overflow: scroll;
  }

  .suggestions > div {
    display: flex;
    align-items: center;
    padding: 5px 14px;
  }

  .ZenCommand :global(svg) {
    fill: #aaa;
    border: 1px solid #ddd;
    border-radius: 50%;
    padding: 5px;
    height: 20px;
    flex: 0 0 20px;
    margin-right: 14px;
  }

  .title { flex: 1; }

  .selected {
    background: #313131;
  }

  .keys {
    flex: 0 0;
    white-space: nowrap;
  }
  .keys > span {
    font-size: 10px;
    display: inline-block;
    padding: 1px 5px;
    border: 1px solid #aaa;
    border-radius: 1px;
    margin-left: 5px;
  }
</style>

<script>
  // TODO: make this import work in our rollup config
  // import { onMount } from 'svelte'

  let input = ''
  let prompt
  export let list
  let selectedIndex = 0
  export let suggestions
  $: suggestions = suggestionsForInput(input)

  let searchNodes
  $: searchNodes = prepareSearch()

  /*
  onMount(() => {
    prompt.focus()
  })
  */

  // The set of tests or commands has changed. Do as much work up front to make opening command and typing fast.
  export function prepareSearch() {
    let queue = [Latte.root], step
    let nodes = Array.from(Zen.commands)
    while (step = queue.pop()) {
      if (step.fullName)
        nodes.push({type: 'describe', title: step.fullName, depth: step.depth})
      step.tests.forEach(t => nodes.push({type: 'test', title: t.fullName, describe: step.fullName}))
      queue = queue.concat(step.children)
    }

    nodes.forEach(n => { n.prep = Zen.Fuzzysort.prepare(n.title) })
    return nodes
  }

  export function onKeyDown(event) {
    event.stopPropagation()
    if (_isUpKey(event))
      setSelected(selectedIndex - 1)
    else if (_isDownKey(event))
      setSelected(selectedIndex + 1)
    else if (_isEscapeKey(event))
      Zen.actions.closeCommand()
    else if (event.keyCode == 13) // enter
      takeAction(selectedIndex)
    else return
    event.preventDefault()
  }

  export function _isUpKey ({keyCode, key, metaKey, altKey, ctrlKey} = {}) {
    return keyCode == 38 || (!metaKey && !altKey && ctrlKey && ['p', 'k'].includes(key))
  }

  export function _isDownKey ({keyCode, key, metaKey, altKey, ctrlKey} = {}) {
    return keyCode == 40 || (!metaKey && !altKey && ctrlKey && ['n', 'j'].includes(key))
  }

  export function _isEscapeKey ({keyCode, key, metaKey, altKey, ctrlKey} = {}) {
    return keyCode == 27 || (!metaKey && !altKey && ctrlKey && key == '[')
  }

  export function takeAction(idx) {
    let sugg = suggestions[idx]
    if (sugg.action) sugg.action()
    else if (sugg.type == 'describe') Zen.actions.filterTests({grep: sugg.title, run: true})
    else if (sugg.type == 'test') Zen.actions.focusTest(sugg.title)
    Zen.actions.closeCommand()
  }

  export function setSelected(idx) {
    idx = Math.max(0, idx)
    idx = Math.min(suggestions.length - 1, idx)
    selectedIndex = idx

    let el = list.children[idx]
    // TODO scroll into view
  }

  function icon(node) {
    if (node.icon) return node.icon
    if (node.type == 'describe') return Zen.icons.Filter
    if (node.type == 'test') return Zen.icons.TestTube
  }

  function altText(node) {
    if (node.altText) return node.altText
    if (node.type == 'describe') return 'Only run tests in this suite'
    if (node.type == 'test') return 'Run this test in this tab'
  }

  function suggestionsForInput(input='') {
    let priorityMap = {command: 0, describe: 1, test: 2}

    let sorted = Zen.Fuzzysort.go(input, searchNodes, {limit: 50, keys: ['prep'], allowTypo: true})
    // TODO: we might want to give a boost to commands, and a slightly smaller one to describe blocks
    // * It might also be helpful to promote recently focused/grepped things

    if (input) {
      return sorted.slice(0, 50).map(tuple => tuple.obj)
    } else {
      return searchNodes.slice(0, 50)
    }
  }
</script>
