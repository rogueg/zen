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

  var mode // headless or debug
  var currentContext = null // The context of the currently running test.
  var abort = false // stop tests mid-run. Usually when code changes
  var currentTimeout = null
  var otherError = null // stores any other error that occurred during the test run

  var whenCurrentTestFinished = null // promise that's resolved when the currently running test finishes
  var currentTestResolve = null

  // Save some globals in case test code overrides it (ie sinon, bluebird, etc)
  var realSetTimeout = window.setTimeout
  var realClearTimeout = window.clearTimeout
  var RealPromise = window.Promise
  var realReload = window.location.reload.bind(window.location)

  window.describe = function(name, fn) {
    var previous = current
    current = {
      parent: previous, name: name, children: [], tests: [],
      fullName: [previous.fullName, name].filter(s => !!s).join(' '),
      before: [], beforeEach: [], after: [], afterEach: [], helpers: {},
      timeout: (val) => {} // TODO
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
  window.beforeEach = function(fn) { current.beforeEach.push({fn, stack: getStack()}) }
  window.afterEach = function(fn) { current.afterEach.push({fn, stack: getStack()}) }
  window.before = function(fn) { current.before.push({fn, stack: getStack()}) }
  window.after = function(fn) { current.after.push({fn, stack: getStack()}) }

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
    if (!fn) return
    fullName = current.fullName + ' ' + name
    current.tests.push({fn, name, fullName, suite: current, stack: getStack()})
  }
  it.skip = function() {}
  it.only = function() {}

  function getStack() {
    return new Error().stack.split('\n')[3].trim()
  }

  Latte.setup = function latteSetup(md) {
    mode = md

    let oldWarn = console.warn, oldError = console.error
    // console.warn = function() { otherError = arguments; oldWarn.apply(console, arguments) }
    // console.error = function() { otherError = arguments; oldError.apply(console, arguments) }

    // These seem to break Chrome's "pause on uncaught exception", so don't do it in debug
    if (mode == 'headless') {
      window.onunhandledrejection = e => { otherError = e }
      window.onerror = e => { otherError = e }
    }
  }

  // Cancel any remaining tests and clean up.
  // TODO: this should let the current test finish, though that's tricky in debug mode (where uncaught exceptions are the norm)
  Latte.abort = async function latteClean() {
    abort = true

    whenCurrentTestFinished && await whenCurrentTestFinished

    if (currentContext) {
      await applyCallbacks('afterEach', currentContext)
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

  Latte.run = async function latteRun(tests) {
    abort = false

    for (test of tests) {
      if (!test.fn) continue
      console.log(`${test.fullName}`)
      otherError = null
      whenCurrentTestFinished = new RealPromise(res => currentTestResolve = res)

      // apply afterEach from the inside out
      if (currentContext && mode == 'debug')
        await applyCallbacks('afterEach', currentContext)

      // each test gets a context that inherits from the suite-level context.
      // This isolates each test but lets us do some setup at the suite-level for speed.
      previousSuiteContext = currentContext && Object.getPrototypeOf(currentContext)
      var suiteContext

      if (mode == 'headless') {
        try { suiteContext = await changeSuite(previousSuiteContext, test.suite) }
        catch(e) { fatalError(e) }
      }

      if (mode == 'debug') {
        suiteContext = await changeSuite(previousSuiteContext, test.suite)
      }

      currentContext = Object.create(suiteContext)

      if (mode == 'headless') {
        try {
          await applyCallbacks('beforeEach', currentContext, {topDown: true})
          await runWithTimeout(test, currentContext)
          Latte.onTest(test, otherError)
        }
        catch (e) {
          realClearTimeout(currentTimeout)
          Latte.onTest(test, e || 'undefined error')
        }

        try { await applyCallbacks('afterEach', currentContext) }
        catch (e) { fatalError(e) }
      }

      if (mode == 'debug') {
        await applyCallbacks('beforeEach', currentContext, {topDown: true})
        await runWithTimeout(test, currentContext)
      }

      // signal that we've finished this test, in case we're aborting
      currentTestResolve()
      whenCurrentTestFinished = currentTestResolve = null
      if (abort) break
    }

    console.log('Done!')
  }

  function fatalError(e) {
    console.error('Fatal', e)
    realReload()
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
      for (cb of suite.after)
        await runWithTimeout(cb, context)
      context = Object.getPrototypeOf(context)
    }

    // now walk down the lineage from right below the common ancestor to the new suite, running before callbacks
    let nextTop = nextLineage.indexOf(commonAncestor)
    nextTop = nextTop == -1 ? undefined : nextTop
    chain = nextLineage.slice(0, nextTop).reverse()
    for (suite of chain) {
      context = Object.create(context)
      context._suite = suite
      context.timeout = function() {}
      attachHelpers(suite, context)
      for (cb of suite.before)
        await runWithTimeout(cb, context)
    }

    return context
  }

  // Run user code with a timeout
  async function runWithTimeout(cbOrTest, context) {
    let timeoutPromise = new RealPromise((res, rej) => {
      currentTimeout = realSetTimeout(() => {
        if (mode == 'debug') {
          abort = true
          console.error('Timeout', cbOrTest.stack)
        }
        else {
          console.error('Timeout', cbOrTest.stack)
          rej(`Timeout ${cbOrTest.stack}`)
        }
      }, 10000)
    })

    return RealPromise.race([timeoutPromise, cbOrTest.fn.call(context)])
      .then(() => realClearTimeout(currentTimeout))
  }

  // run all the callbacks (before, after, beforeEach, or afterEach) for each suite.
  async function applyCallbacks(type, context, {topDown}={}) {
    let suites = lineage(context._suite)
    if (topDown) suites = suites.reverse()

    for (suite of suites)
      for (cb of suite[type])
        await runWithTimeout(cb, context)
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
