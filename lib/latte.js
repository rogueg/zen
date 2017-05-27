// Latte supports Mocha syntax for now, but we'd like to evolve.
// It needs to support two different modes: headless and debug
// * headless runs in the background, and is optimized for speed.
// * debug is optimized for an engineer with devtools open.
(function() {
  window.Latte = {}
  var currentTimeout = null

  // create the root describe block
  var current = Latte.root = {
    _name: 'root', _children: [], _tests: [],
    _before: [], _beforeEach: [], _after: [], _afterEach: [],
    timeout: (val) => {}
  }

  window.describe = function(name, fn) {
    var previous = current
    current = Object.assign(Object.create(previous), {
      _name: name, _children: [], _tests: [],
      _before: [], _beforeEach: [], _after: [], _afterEach: []
    })

    previous._children.push(current)
    fn.call(current)
    current = previous
  }

  window.context = window.describe
  describe.skip = function(name) {}
  window.beforeEach = function(fn) { current._beforeEach.push(fn) }
  window.afterEach = function(fn) { current._afterEach.push(fn) }
  window.before = function(fn) { current._before.push(fn) }
  window.after = function(fn) { current._after.push(fn) }
  window.it = function(name, fn) { current._tests.push({fn, name, suite: current}) }
  window.helper = function(name, fn) { current[name] = fn }
  it.skip = function() {}
  it.only = function() {}

  Latte.run = async function latteRun(suiteName, {mode}) {
    var suite, queue = [current]
    while(step = queue.pop()) {
      queue.push.apply(queue, step._children)
      if (step._name == suiteName)
        suite = step
    }

    // Not exactly correct. Top-level befores should only run once for all suites
    var suiteRun = Object.create(suite)
    await applyTopDown(suiteRun, '_before')

    for (test of suite._tests) {
      var testRun = Object.create(suiteRun)
      await applyTopDown(testRun, '_beforeEach')
      await runTest(test, testRun, mode)
      await applyTopDown(testRun, '_afterEach')
    }

    await applyTopDown(suiteRun, '_after')
  }

  // In headless mode, we should catch all errors and continue on.
  // In debug mode, let the error bubble to the devtool's "break on exception"
  async function runTest(test, testRun, mode) {
    if (mode == 'debug') {
      await test.fn.call(testRun)
      console.log(`\u2713 ${test.name}`)
      return
    }

    try { await test.fn.apply(testRun) }
    catch(e) {
      console.error(e, e.stack)
    }
  }

  // Walk upwards through the prototype chain looking for callbacks,
  // then apply them from the top of the chain downwards.
  async function applyTopDown(context, name) {
    var step = context, toApply = []
    while(step != Object.prototype) {
      toApply.unshift.apply(toApply, step[name] || [])
      step = Object.getPrototypeOf(step)
    }

    for (callback of toApply) {
      trackTimeout(``, 200)
      await callback.call(context)
      clearTimeout(currentTimeout)
    }
  }

  function trackTimeout(msg, ms) {
    currentTimeout = setTimeout(() => {
      throw new Error('Timeout: ' + msg)
    }, ms)
  }
})()
