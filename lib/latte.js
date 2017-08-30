// Latte supports Mocha syntax for now, but we'd like to evolve.
// It needs to support two different modes: headless and debug
// * headless runs in the background, and is optimized for speed.
// * debug is optimized for an engineer with devtools open.
(function() {
  window.Latte = {}

  // create the root describe block
  var current = Latte.root = {
    children: [], tests: [],
    before: [], beforeEach: [], after: [], afterEach: [], helpers: {}
  }

  // The context of the currently running test. In debug mode, this is left around
  // after the last test finishes.
  var currentContext = null

  // this handles un-recoverable errors like a callback failing to complete.
  var timeoutHandler = null

  var abort = false // stop tests mid-run. Usually when code changes

  window.describe = function(name, fn) {
    var previous = current
    current = {
      parent: previous, name: name, children: [], tests: [],
      fullName: [previous.fullName, name].filter(s => !!s).join(' '),
      before: [], beforeEach: [], after: [], afterEach: [], helpers: {}
    }

    // Replace ourselves in the heirarchy. This happens when a test file is hot-reloaded.
    // TODO: if the name changes, this breaks. Maybe use filename instead?
    let oldIndex = previous.children.findIndex(d => d.name == name)
    if (~oldIndex)
      previous.children[oldIndex] = current
    else
      previous.children.push(current)

    fn.call(current)
    current = previous
  }

  window.context = window.describe
  describe.skip = function(name) {}
  describe.only = function(name) {} // TODO
  window.timeout = function(val) {} // TODO
  window.beforeEach = function(fn) { current.beforeEach.push({fn, timeout: timeoutError()}) }
  window.afterEach = function(fn) { current.afterEach.push({fn, timeout: timeoutError()}) }
  window.before = function(fn) { current.before.push({fn, timeout: timeoutError()}) }
  window.after = function(fn) { current.after.push({fn, timeout: timeoutError()}) }

  // Helpers add methods to the current scope that aid writing clean tests.
  // For example, you might have a `login` or `goOffline` helper that you can call at the top of a
  // test to get things in the right state. Helpers are usually preferred over `beforeEach`, because
  // having setup code in the test makes it easier to understand.
  //
  // Helpers can be defined as a single function: `helper('login', function() {...})`
  // Or as a group: `helper('Factory', {user: function() {...}, hats: function() {...}})`
  // Groups are a great way to organize related helpers.
  window.helper = function(name, fnOrGroup) { current.helpers[name || 'default'] = fnOrGroup }

  window.it = function(name, fn) {
    fullName = current.fullName + ' ' + name
    current.tests.push({fn, name, fullName, suite: current, stack: timeoutError()})
  }
  it.skip = function() {}
  it.only = function() {}

  // generate the timeout error ahead of time. That way, the stack trace points
  // at the callback, rather than Latte code.
  function timeoutError() {
    return new Error().stack.split('\n')[3]
  }

  // Cancel any remaining tests and clean up.
  // TODO: this should let the current test finish, though that's tricky in debug mode (where uncaught exceptions are the norm)
  Latte.abort = async function latteClean() {
    abort = true

    if (currentContext) {
      await changeSuite(currentContext, null)
      currentContext = null
    }
  }

  // Get all tests (optionally of a specific suite) flattened into an array
  Latte.flatten = function latteFlatten(suite) {
    suite = suite || Latte.root

    var allTests = [], queue = [Latte.root]
    while (step = queue.pop()) {
      allTests = allTests.concat(step.tests)
      queue = queue.concat(step.children)
    }
    return allTests
  }

  Latte.run = async function latteRun({tests, mode, onTest, onTimeout}) {
    timeoutHandler = onTimeout

    for (test of tests) {
      if (!test.fn) continue
      console.log(`${test.fullName}`)

      // apply afterEach from the inside out
      if (currentContext)
        await applyCallbacks('afterEach', lineage(currentContext._suite), currentContext)

      // each test gets a context that inherits from the suite-level context.
      // This isolates each test but lets us do some setup at the suite-level for speed.
      previousSuiteContext = currentContext && Object.getPrototypeOf(currentContext)
      suiteContext = await changeSuite(previousSuiteContext, test.suite)
      currentContext = Object.create(suiteContext)

      // apply beforeEach from the outside in
      await applyCallbacks('beforeEach', lineage(test.suite).reverse(), currentContext)

      // In headless mode, we should catch all errors and continue on.
      // In debug mode, let the error bubble to the devtool's "break on exception"
      if (mode == 'debug') {
        await test.fn.call(currentContext)
      } else {
        try {
          await test.fn.apply(currentContext)
          onTest(test)
        }
        catch (e) { onTest(test, e || 'undefined error') }
      }

      if (abort) break
    }

    if (mode != 'debug') {
      await changeSuite(currentContext, null)
      currentContext = null
    }

    console.log('Done!')
  }

  // Change our context from one suite to another by running the minimal set of before/after callbacks.
  // Any common ancestors between the two suites don't need to run.
  async function changeSuite(context, nextSuite) {
    let currentSuite = context && context._suite

    // short circuit when the suite doesn't actually change
    if (context && context._suite === nextSuite)
      return context

    // figure out what the common ancestor is between both suites. If either suite is null
    // (happens at beginning and end of run) then commonAncestor will be undefined, and our
    // slice calls below will yield the full lineage.
    let currLineage = lineage(currentSuite)
    let nextLineage = lineage(nextSuite)
    let commonAncestor = currLineage.filter(x => nextLineage.indexOf(x) >= 0)[0]

    // walk the lineage up to (but not including) the common ancestor, running after callbacks
    let currTop = currLineage.indexOf(commonAncestor)
    currTop = currTop == -1 ? undefined : currTop
    let chain = currLineage.slice(0, currTop)
    for (suite of chain) {
      await applyCallbacks('after', [suite], context)
      context = Object.getPrototypeOf(context)
    }

    // now walk down the lineage from right below the common ancestor to the new suite, running before callbacks
    let nextTop = nextLineage.indexOf(commonAncestor)
    nextTop = nextTop == -1 ? undefined : nextTop
    chain = nextLineage.slice(0, nextTop).reverse()
    for (suite of chain) {
      context = Object.create(context)
      context._suite = suite
      attachHelpers(suite, context)
      await applyCallbacks('before', [suite], context)
    }

    return context
  }

  // run all the callbacks (before, after, beforeEach, or afterEach) for each suite.
  async function applyCallbacks(type, suites, context) {
    for (suite of suites) {
      for (cb of suite[type]) {
        currentTimeout = setTimeout(() => {
          timeoutHandler(cb.timeout, suite, type)
        }, 2000)
        await cb.fn.call(context)
        clearTimeout(currentTimeout)
      }
    }
  }

  // Get all the suites between the current one and the root.
  function lineage(suite) {
    if (!suite) return []

    let arr = []
    while (suite) {
      arr.push(suite)
      suite = suite.parent
    }
    return arr
  }

  function attachHelpers(suite, context) {
    for (name in suite.helpers) {
      let obj = suite.helpers[name]

      if (typeof(obj) == 'function') {
        context[name] = obj
        continue
      }

      let dest = name == 'default' ? context : (context[name] = {})
      for (prop of Object.keys(obj)) {
        let val = obj[prop]
        let isFunction = typeof(val) == 'function'
        Object.defineProperty(dest, prop, { get: () => isFunction ? val.bind(currentContext) : val})
      }
    }
  }

})()
