<script>
  const store = Zen.store
  const focusGroup = Zen.actions.focusGroup
  const focusTest = Zen.actions.focusTest
  let expandedGroup
  let failureGroups = Zen.computed.failureGroups
  let groupForFocus = Zen.computed.groupForFocus

  function groupClasses (g) {
    let s = 'failureGroup'
    if (g.containsFocus) s = s + ' containsFocus'
    if (g.passedFocus && g.length === 1) s = s + ' passedFocus'
    else s = s + ` shade-${g.shade}`
    return s
  }
</script>

<div class='mini'>
  <div class='runDetails'>
    {#if $store.socketDisconnected}
      Disconnected (check server and reload)
    {:else if $store.workingSetLength || $store.grep}
      <span class='grep' title='{ $store.grep ? "Running only tests that match" : "Running all tests"}'>
        {@html $store.grep ? $store.icons.Filter : $store.icons.Asterisk}
        {$store.grep || 'All tests'}
      </span>
    {:else}
      Press alt to get started :)
    {/if}

    {#if $store.workingSetLength}
      <span class='progress' title='{$store.isLambda ? `Running on ${$store.workerCount} lambda workers` : "Running locally on headless Chrome"}'>
        {$store.results.length}/{$store.workingSetLength}
        {@html $store.isLambda ? $store.icons.Lambda : $store.icons.Desktop}
      </span>
    {/if}
  </div>

  <div class='failureGroups'>
    {#if $store.results.length > 0}
      {#each $failureGroups.slice(0, 17) as group}
        <span class='{groupClasses(group)}' on:click='{() => focusGroup(group)}'
          title={group.key}></span>
      {/each}
    {:else if $store.s3 && $store.s3 !== 'done'}
      {$store.s3}
    {:else if $store.workerCount}
      Starting {$store.workerCount} {$store.isLambda ? 'Lambda' : 'local'} workers
    {/if}
  </div>

  <div class='groupDetails'>
    {($groupForFocus.error || '')}
    {#if $groupForFocus == expandedGroup}
      {#each $groupForFocus as result}
        <a href='javascript:void(0)' on:click='{() => focusTest(result.fullName)}' class='fail'>{result.fullName}</a>
      {/each}
    {:else if $groupForFocus.length > 1}
      <a href='javascript:void(0)' on:click='{() => expandedGroup = $groupForFocus}'>{$groupForFocus.length - 1} other tests failed with the same error</a>
    {/if}
  </div>

  <div class='focusDetails'>
    {#if $store.compile.status == 'error'}
      Compile error {$store.compile.errors.join(' ')}
    {:else if $store.compile.status == 'compiling'}
      Compiling {$store.compile.percentage || 0}% - {$store.compile.message}
    {:else if $store.focus}
      <button class='focusStatus {$store.focusStatus}' on:click='{() => focusTest($store.focus)}' title='Run the focused test [alt-space]'></button>
      <span>{$store.focus || ''}</span>
    {/if}
  </div>
</div>

<style>
  .mini {
    all: initial;
    position: fixed;
    bottom: 0; width: 400px; left: 50%;
    margin-left: -200px;
    padding: 8px 5px 4px 5px;
    border: 1px solid #ddd;
    background: #fff;
    font-size: 12px;
    font-family: 'Lucida Sans', 'Lucida Sans Regular', 'Lucida Grande', 'Lucida Sans Unicode', Geneva, Verdana, sans-serif;
    z-index: 9999;
    overflow: hidden;
  }

  .mini > div { min-height: 16px; padding-bottom: 4px; }
  /* .mini > div:last-child { padding-top: 0; } */
  .mini :global(svg) {
    width: 14px; height: 14px;
    position: relative;
    top: 2px;
  }
  .mini :global(svg path) { fill: #434353; }

  .runDetails { display: flex; justify-content: space-between; }
  .runDetails .grep { flex: 1; }
  .runDetails .grep :global(svg) {
    margin-right: 2px;
    fill: #777;
  }

  .failureGroup {
    display: inline-block;
    width: 11px; height: 11px;
    border-radius: 50%;
    margin-right: 3px;
    cursor: pointer;
    position: relative; /* for :after */
  }
  .failureGroup.shade-1 { background-color: rgba(128, 0, 0, 0.3); }
  .failureGroup.shade-2 { background-color: rgba(128, 0, 0, 0.5); }
  .failureGroup.shade-3 { background-color: rgba(128, 0, 0, 0.7); }
  .failureGroup.shade-4 { background-color: rgba(128, 0, 0, 0.9); }
  .failureGroup.shade-5 { background-color: rgba(128, 0, 0, 1.0); }
  .failureGroup.passedFocus { background-color: green; }

  .failureGroup.containsFocus:after {
    content: '';
    width: 11px; height: 0;
    border-top: 1px solid #8a6a6a;
    display: block;
    position: relative;
    bottom: -13px;
  }

  .focusDetails {
    display: flex;
    border-top: 1px solid #eee;
    margin-top: 4px;
    padding-top: 8px;
    padding-left: 2px; /* line up icons */
  }

  .focusStatus {
    flex: 0;
    height: 10px; width: 10px;
    border-radius: 50%;
    border: 1px solid #ddd;
    margin-right: 5px;
  }
  .focusStatus.none { display: none; }
  .focusStatus.passed { background-color: green; }

  .groupDetails {}
  .groupDetails a {
    display: block;
    margin-top: 5px;
    color: maroon;
    font-size: 10px;
  }
</style>