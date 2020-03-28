// Latte supports Mocha syntax for now, but we'd like to evolve.
// It needs to support two different modes: headless and debug
// * headless runs in the background, and is optimized for speed.
// * debug is optimized for an engineer with devtools open.
(function() {
  window.Latte = {}

  // create the root describe block
  var current = Latte.root = {
    children: [], tests: [], depth: 0, testCount: 0,
    before: [], beforeEach: [], after: [], afterEach: [], helpers: {}
  }

  var mode // headless or debug
  var willHotReload = false
  var currentContext = null // The context of the currently running test.
  var currentTimeout = null

  var whenCurrentTestFinished = null // promise that's resolved when the currently running test finishes
  var currentTestResolve = null

  // Save some globals in case test code overrides it (ie sinon, bluebird, etc)
  var realSetTimeout = window.setTimeout
  var realClearTimeout = window.clearTimeout
  var RealPromise = window.Promise

  // polyfill promise.finally without changing the prototype
  var promiseFinally = RealPromise.prototype.finally || function (fn) {
    return this.then(
      val => Promise.resolve(fn()).then(() => val),
      err => Promise.resolve(fn()).then(() => {throw err})
    )
  }

  window.describe = function(name, fn) {
    var previous = current
    current = {
      parent: previous, name: name, children: [], tests: [],
      depth: previous.depth + 1, testCount: 0,
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
  window.beforeAll = function(fn, od) { registerBeforeAfter('before', fn, od) }
  window.beforeEach = function(fn, od) { registerBeforeAfter('beforeEach', fn, od) }
  window.afterEach = function(fn, od) {registerBeforeAfter('afterEach', fn, od)}
  window.afterAll = function(fn, od) { registerBeforeAfter('after', fn, od) }
  window.before = function(fn, od) {registerBeforeAfter('before', fn, od)}
  window.after = function(fn, od) {registerBeforeAfter('after', fn, od)}

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
    current.tests.push({fn, name, fullName, suite: current, stack: getStack(1)})
    let step = current
    do { step.testCount++ } while (step = step.parent)
  }
  it.skip = function() {}
  it.only = function() {}

  function getStack(toPop) {
    return new Error().stack.split('\n')[2 + toPop].trim()
  }

  function registerBeforeAfter(type, fn, onDispose) {
    let handle = {fn, stack: getStack(2)}
    current[type].push(handle)

    if (current === Latte.root && willHotReload && !onDispose) {
      console.warn('Top-level before/after callbacks must pass "module.hot.dispose" as the second argument')
    }

    // onDispose allows hot reloading frameworks to tell us when a callback is being removed
    onDispose && onDispose(() => {
      let idx = current[type].indexOf(handle)
      if (~idx)
        current[type].splice(idx, 1)
    })
  }

  Latte.setup = function latteSetup(opts) {
    mode = opts.mode
    willHotReload = opts.willHotReload
  }

  Latte.waitForCurrentTest = async function waitForCurrentTest() {
    whenCurrentTestFinished && await whenCurrentTestFinished
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
      Latte.currentTest = test
      whenCurrentTestFinished = new RealPromise((res) => {
        return currentTestResolve = res
      })

      // apply afterEach from the inside out
      if (currentContext && mode == 'debug')
        await applyCallbacks('afterEach', currentContext)

      // each test gets a context that inherits from the suite-level context.
      // This isolates each test but lets us do some setup at the suite-level for speed.
      previousSuiteContext = currentContext && Object.getPrototypeOf(currentContext)
      var suiteContext = await changeSuite(previousSuiteContext, test.suite)

      currentContext = Object.create(suiteContext)
      currentContext.currentTest = test
      Latte.currentContext = currentContext

      if (mode == 'headless') {
        let error
        try {
          await applyCallbacks('beforeEach', currentContext, {topDown: true})
          await runWithTimeout(test, currentContext)
        } catch (e) {
          realClearTimeout(currentTimeout)
          error = e || 'undefined error'
        }

        // AfterEach generally does cleanup. If it fails, it's unsafe to run more tests.
        // By not catching exceptions here, we abort running and allow our chrome wrapper to reload.
        await applyCallbacks('afterEach', currentContext)
        Latte.onTest(test, error)
      }

      if (mode == 'debug') {
        await applyCallbacks('beforeEach', currentContext, {topDown: true})
        await runWithTimeout(test, currentContext)
        Latte.onTest(test)
      }

      // signal that we've finished this test, in case we're aborting
      if (currentTestResolve) {
        currentTestResolve()
        whenCurrentTestFinished = currentTestResolve = null
      } else {
        console.log("Something weird is happening", tests)
      }
    }
  }

  // Wait for the current test, then run any `after` blocks.
  // Cleanup only needs to be called if we're going to hot reload new code
  Latte.cleanup = async function() {
    if (currentContext) {
      await applyCallbacks('afterEach', currentContext)
      await changeSuite(currentContext, null)
      currentContext = null
    }
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
    let hasFinished = false
    let timeoutPromise = new RealPromise((res, rej) => {
      currentTimeout = realSetTimeout(() => {
        if (hasFinished) return
        console.error('Timeout', cbOrTest.stack)
        if (mode == 'headless') {
          rej(`Timeout ${cbOrTest.stack}`)
        }
      }, 10000)
    })

    let runPromise = null
    if (cbOrTest.fn.length > 0) {
      runPromise = new RealPromise(res => cbOrTest.fn.call(context, res))
    } else {
      runPromise = cbOrTest.fn.call(context)
    }

    let race = RealPromise.race([timeoutPromise, runPromise])
    return promiseFinally.call(race, () => {
      realClearTimeout(currentTimeout)
      hasFinished = true
    })
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
