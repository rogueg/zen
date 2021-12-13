// Latte supports Mocha syntax for now, but we'd like to evolve.
// It needs to support two different modes: headless and debug
// * headless runs in the background, and is optimized for speed.
// * debug is optimized for an engineer with devtools open.
export type TestFn = (
  this: TestContext,
  resolve?: (value: unknown) => void
) => void
type TestSetupFn = (test: TestFn, onDispose?: OnDispose) => void

type TestGroup = Record<string, TestFn | unknown>
export type FnOrGroup = TestFn | TestGroup
export type OnDispose = (cb: () => void) => void
type mode = 'debug' | 'headless'
type helpers = {
  resizeWindow: (dimensions: { width: number, height: number }) => void
}
type LatteOptions = { mode: mode; willHotReload: boolean; helpers?: helpers }
type TestContext = Partial<Record<string, FnOrGroup>> & {
  currentTest: Test
  _suite: TestSuite
}
type Test = {
  fn: TestFn
  name?: string
  fullName: string
  suite: TestSuite
  stack?: string
}
type TestSetupCb = { fn: TestFn; stack?: string }
type TestSuiteCallbacks = 'after' | 'afterEach' | 'before' | 'beforeEach'

type TestSuite = {
  parent?: TestSuite
  name?: string
  fullName?: string
  timeout?: () => void

  children: TestSuite[]
  tests: Test[]
  depth: number
  testCount: number
  before: TestSetupCb[]
  beforeEach: TestSetupCb[]
  after: TestSetupCb[]
  afterEach: TestSetupCb[]
  helpers: Partial<Record<string, FnOrGroup>>
}

export type Latte = {
  root: TestSuite
  setup: (opts: LatteOptions) => void
  waitForCurrentTest: () => void
  flatten: (suite: TestSuite) => void
  run: (tests: Test[]) => void
  currentTest?: Test
  currentContext?: {
    currentTest: Test
  }
  cleanup: () => void
  // The head and worker each define seperate onTest handlers
  onTest?: (test: Test, err: unknown, log: string[]) => void
}

type describe = {
  (name: string, fn: () => void): void
  skip: () => void
  only: () => void
}

declare global {
  interface Window {
    Latte: Latte
    describe: describe
    context: describe
    timeout: () => void
    beforeEach: TestSetupFn
    afterEach: TestSetupFn
    before: TestSetupFn
    after: TestSetupFn
    helper: (name: string, cb: FnOrGroup) => void
    it: {
      (name: string, cb?: TestFn): void
      skip: () => void
      only: () => void
    }
    setup: (opts: LatteOptions) => void
  }
}

// TODO refactor latte into a class, this will make the typing way easier

// Right now there is nothing to export, but TS requires this to do the editing of Window
;(function () {
  let mode: 'headless' | 'debug' // headless or debug
  let willHotReload = false
  let helpers: helpers | undefined = undefined
  let currentContext: null | TestContext = null // The context of the currently running test.
  let currentTimeout: number

  let whenCurrentTestFinished: Promise<void> | null = null // promise that's resolved when the currently running test finishes
  let currentTestResolve: null | (() => void) = null

  // Save some globals in case test code overrides it (ie sinon, bluebird, etc)
  const realSetTimeout = window.setTimeout
  const realClearTimeout = window.clearTimeout
  const RealPromise = window.Promise

  // polyfill promise.finally without changing the prototype
  const promiseFinally =
    RealPromise.prototype.finally ||
    function <T>(this: Promise<T>, fn: () => Promise<void>) {
      return this.then(
        (val: T) => Promise.resolve(fn()).then(() => val),
        (err: Error) =>
          Promise.resolve(fn()).then(() => {
            throw err
          })
      )
    }

  const Latte: Latte = {
    root: {
      children: [],
      tests: [],
      depth: 0,
      testCount: 0,
      before: [],
      beforeEach: [],
      after: [],
      afterEach: [],
      helpers: {},
    },
    setup: function latteSetup(opts) {
      mode = opts.mode
      willHotReload = opts.willHotReload
      helpers = opts.helpers
    },
    waitForCurrentTest: async function waitForCurrentTest() {
      whenCurrentTestFinished && (await whenCurrentTestFinished)
    },
    flatten: function latteFlatten(suite: TestSuite = window.Latte.root) {
      let allTests: Test[] = []
      let queue = [suite]

      let step = queue.pop()
      while (step) {
        allTests = allTests.concat(step.tests)
        queue = queue.concat(step.children)

        step = queue.pop()
      }
      return allTests
    },
    run: async function latteRun(tests) {
      // Store logs so they can be relayed back from remote
      const log: string[] = []
      const originalConsoleLog = console.log
      console.log = (...args) => {
        log.push(args.join(' '))
        originalConsoleLog.apply(console, args)
      }

      try {
        for (const test of tests) {
          if (!test.fn) continue
          console.log(`${test.fullName}`)
          Latte.currentTest = test
          whenCurrentTestFinished = new RealPromise(
            (res) => (currentTestResolve = res)
          )

          // apply afterEach from the inside out
          if (currentContext && mode == 'debug') {
            await applyCallbacks('afterEach', currentContext)
          }

          // each test gets a context that inherits from the suite-level context.
          // This isolates each test but lets us do some setup at the suite-level for speed.
          const previousSuiteContext =
            currentContext && Object.getPrototypeOf(currentContext)
          const suiteContext = await changeSuite(
            previousSuiteContext,
            test.suite
          )

          currentContext = Object.create(suiteContext)
          if (!currentContext) continue
          currentContext.currentTest = test
          Latte.currentContext = currentContext

          if (mode == 'headless') {
            let error
            try {
              await applyCallbacks('beforeEach', currentContext, {
                topDown: true,
              })
              await runWithTimeout(test, currentContext)
            } catch (e) {
              realClearTimeout(currentTimeout)
              error = e || 'undefined error'
            }

            // AfterEach generally does cleanup. If it fails, it's unsafe to run more tests.
            // By not catching exceptions here, we abort running and allow our chrome wrapper to reload.
            await applyCallbacks('afterEach', currentContext)
            Latte.onTest?.(test, error, log)
          }

          if (mode == 'debug') {
            await applyCallbacks('beforeEach', currentContext, {
              topDown: true,
            })
            await runWithTimeout(test, currentContext)
            Latte.onTest?.(test, undefined, log)
          }

          // signal that we've finished this test, in case we're aborting
          currentTestResolve?.()
          whenCurrentTestFinished = currentTestResolve = null
        }
      } finally {
        console.log = originalConsoleLog
      }
    },

    // Wait for the current test, then run any `after` blocks.
    // Cleanup only needs to be called if we're going to hot reload new code
    cleanup: async function () {
      if (currentContext) {
        await applyCallbacks('afterEach', currentContext)
        await changeSuite(currentContext)
        currentContext = null
      }
    },
  }
  window.Latte = Latte

  // create the root describe block
  let current = window.Latte.root

  function describe(name: string, fn: () => void): void {
    const previous = current
    current = {
      parent: previous,
      name: name,
      children: [],
      tests: [],
      depth: previous.depth + 1,
      testCount: 0,
      fullName: [previous.fullName, name].filter((s) => !!s).join(' '),
      before: [],
      beforeEach: [],
      after: [],
      afterEach: [],
      helpers: {},
      timeout: () => {
        /* */
      }, // TODO
    }

    // Replace ourselves in the heirarchy. This happens when a test file is hot-reloaded.
    // TODO: if the name changes, this breaks. Maybe use filename instead?
    const oldIndex = previous.children.findIndex((d) => d.name == name)
    if (~oldIndex) previous.children[oldIndex] = current
    else previous.children.push(current)

    fn.call(current)
    current = previous
  }

  window.describe = describe
  window.context = window.describe
  describe.skip = function () {
    /* */
  }
  describe.only = function () {
    /* */
  } // TODO
  window.timeout = function () {
    /* */
  } // TODO

  function beforeEach(fn: TestFn, od?: OnDispose) {
    registerBeforeAfter('beforeEach', fn, od)
  }
  window.beforeEach = beforeEach

  function afterEach(fn: TestFn, od?: OnDispose) {
    registerBeforeAfter('afterEach', fn, od)
  }
  window.afterEach = afterEach

  function before(fn: () => void, od?: OnDispose) {
    registerBeforeAfter('before', fn, od)
  }
  window.before = before

  function after(fn: () => void, od?: OnDispose) {
    registerBeforeAfter('after', fn, od)
  }
  window.after = after

  // Helpers add methods to the current scope that aid writing clean tests.
  // For example, you might have a `login` or `goOffline` helper that you can call at the top of a
  // test to get things in the right state. Helpers are usually preferred over `beforeEach`, because
  // having setup code in the test makes it easier to understand.
  //
  // Helpers can be defined as a single function: `helper('login', function() {...})`
  // Or as a group: `helper('Factory', {user: function() {...}, hats: function() {...}})`
  // Groups are a great way to organize related helpers.
  function helper(name: string, fnOrGroup: FnOrGroup) {
    current.helpers[name || 'default'] = fnOrGroup
  }
  window.helper = helper

  function it(name: string, fn?: TestFn) {
    if (!fn) return
    const fullName = current.fullName + ' ' + name
    current.tests.push({
      fn,
      name,
      fullName,
      suite: current,
      stack: getStack(1),
    })
    let step: TestSuite | undefined = current
    do {
      step.testCount++
      step = step.parent
    } while (step)
  }
  it.skip = function () {
    /* */
  }
  it.only = function () {
    /* */
  }
  window.it = it

  function getStack(toPop: number) {
    return new Error()?.stack?.split('\n')[2 + toPop].trim()
  }

  function registerBeforeAfter(
    type: TestSuiteCallbacks,
    fn: TestFn,
    onDispose?: OnDispose
  ) {
    const handle = { fn, stack: getStack(2) || '' }
    current[type].push(handle)

    if (current === window.Latte.root && willHotReload && !onDispose) {
      console.warn(
        'Top-level before/after callbacks must pass "module.hot.dispose" as the second argument'
      )
    }

    // onDispose allows hot reloading frameworks to tell us when a callback is being removed
    onDispose &&
      onDispose(() => {
        const idx = current[type].indexOf(handle)
        if (~idx) current[type].splice(idx, 1)
      })
  }

  // Change our context from one suite to another by running the minimal set of before/after callbacks.
  // Any common ancestors between the two suites don't need to run.
  async function changeSuite(context: TestContext, nextSuite?: TestSuite) {
    const currentSuite = context?._suite

    // short circuit when the suite doesn't actually change
    if (context && context._suite === nextSuite) return context

    // figure out what the common ancestor is between both suites. If either suite is null
    // (happens at beginning and end of run) then commonAncestor will be undefined, and our
    // slice calls below will yield the full lineage.
    const currLineage = lineage(currentSuite)
    const nextLineage = lineage(nextSuite)
    const commonAncestor = currLineage.filter(
      (x) => nextLineage.indexOf(x) >= 0
    )[0]

    // walk the lineage up to (but not including) the common ancestor, running after callbacks
    let currTop: number | undefined = currLineage.indexOf(commonAncestor)
    currTop = currTop == -1 ? undefined : currTop
    let chain = currLineage.slice(0, currTop)
    for (const suite of chain) {
      for (const cb of suite.after) await runWithTimeout(cb, context)
      context = Object.getPrototypeOf(context)
    }

    // now walk down the lineage from right below the common ancestor to the new suite, running before callbacks
    let nextTop: number | undefined = nextLineage.indexOf(commonAncestor)
    nextTop = nextTop == -1 ? undefined : nextTop
    chain = nextLineage.slice(0, nextTop).reverse()
    for (const suite of chain) {
      context = Object.create(context)
      context._suite = suite
      context.timeout = function () {
        /* */
      }
      attachHelpers(suite, context)
      for (const cb of suite.before) await runWithTimeout(cb, context)
    }

    return context
  }

  // Run user code with a timeout
  async function runWithTimeout(
    cbOrTest: Test | TestSetupCb,
    context: TestContext
  ) {
    let hasFinished = false
    let timeoutPromise: Promise<unknown> | undefined = undefined
    const setTimeoutPromise = (ms: number) => {
      timeoutPromise = new RealPromise((res, rej) => {
        currentTimeout = realSetTimeout(() => {
          if (hasFinished) return
          console.error('Timeout', cbOrTest.stack)
          if (mode == 'headless') {
            rej(
              `Timeout, the test took more than ${ms / 1000}s on remote: ${
                cbOrTest.stack
              }`
            )
          }
        }, ms)
      })
    }
    setTimeoutPromise(10000)

    context.zen = helpers || {}
    context.zen.extendRemoteTimeout = (ms: number) => {
      clearTimeout(currentTimeout)
      setTimeoutPromise(ms)
    }

    if (!cbOrTest.fn) {
      const currentStack = new Error().stack
      throw new Error(`CbOrTest with undefined fn:
        fn Stack: ${cbOrTest.stack}
        current Stack: ${currentStack} 
        cbOrTest: ${JSON.stringify(cbOrTest)}
      `)
    }

    let runPromise = null
    if (cbOrTest.fn.length > 0) {
      runPromise = new RealPromise((res) => cbOrTest.fn?.call(context, res))
    } else {
      runPromise = cbOrTest.fn.call(context)
    }

    const race = RealPromise.race([timeoutPromise, runPromise])
    return promiseFinally.call(race, () => {
      realClearTimeout(currentTimeout)
      hasFinished = true
    })
  }

  // run all the callbacks (before, after, beforeEach, or afterEach) for each suite.
  async function applyCallbacks(
    type: TestSuiteCallbacks,
    context: TestContext,
    { topDown } = { topDown: false }
  ) {
    let suites = lineage(context._suite)
    if (topDown) suites = suites.reverse()

    for (const suite of suites) {
      for (const cb of suite[type]) {
        await runWithTimeout(cb, context)
      }
    }
  }

  // Get all the suites between the current one and the root.
  function lineage(suite?: TestSuite) {
    if (!suite) return []

    let currentSuite: TestSuite | undefined = suite
    const arr: TestSuite[] = []
    while (currentSuite) {
      arr.push(currentSuite)
      currentSuite = currentSuite.parent
    }
    return arr
  }

  function attachHelpers(suite: TestSuite, context: TestContext) {
    for (const name in suite.helpers) {
      const obj = suite.helpers[name]
      if (!obj) continue

      if (typeof obj === 'function') {
        context[name] = obj
        continue
      }

      const dest = name === 'default' ? context : (context[name] = {})
      for (const prop of Object.keys(obj)) {
        const val = obj[prop]
        const isFunction = typeof val == 'function'
        Object.defineProperty(dest, prop, {
          get: () => (isFunction ? val.bind(currentContext) : val),
        })
      }
    }
  }
})()
