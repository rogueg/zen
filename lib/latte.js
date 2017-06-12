// Latte supports Mocha syntax for now, but we'd like to evolve.
// It needs to support two different modes: headless and debug
// * headless runs in the background, and is optimized for speed.
// * debug is optimized for an engineer with devtools open.
(function() {
  window.Latte = {}
  var abort = false // when a callback times out

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

    // TODO: if the name changes, this breaks. Maybe use filename instead?
    let oldIndex = previous._children.findIndex(d => d._name == name)
    if (~oldIndex)
      previous._children[oldIndex] = current
    else
      previous._children.push(current)

    fn.call(current)
    current = previous
  }

  window.context = window.describe
  describe.skip = function(name) {}
  window.beforeEach = function(fn) { current._beforeEach.push({fn, timeout: timeoutError()}) }
  window.afterEach = function(fn) { current._afterEach.push({fn, timeout: timeoutError()}) }
  window.before = function(fn) { current._before.push({fn, timeout: timeoutError()}) }
  window.after = function(fn) { current._after.push({fn, timeout: timeoutError()}) }
  window.helper = function(name, fn) { current[name] = fn }
  window.it = function(name, fn) {
    current._tests.push({fn, name, suite: current, stack: timeoutError()})
  }
  it.skip = function() {}
  it.only = function() {}

  // generate the timeout error ahead of time. That way, the stack trace points
  // at the callback, rather than Latte code.
  function timeoutError() { return new Error() }

  Latte.run = async function latteRun(suiteName, testNames, {mode}) {
    abort = false

    // walk through all suites looking for the given name
    var suite, queue = [current]
    while(step = queue.pop()) {
      queue.push.apply(queue, step._children)
      if (step._name == suiteName)
        suite = step
    }

    // figure out which tests to run in the suite
    let tests = suite._tests.filter(t => {
      if (testNames.length == 0) return true // no names? run everything
      return testNames.some(tn => t.name.indexOf(tn) >= 0)
    })

    // Not exactly correct. Top-level befores should only run once for all suites
    var suiteRun = Object.create(suite)
    await applyTopDown(suiteRun, '_before')
    if (abort) return

    for (test of tests) {
      var testRun = Object.create(suiteRun)
      await applyTopDown(testRun, '_beforeEach')
      if (abort) return
      await runTest(test, testRun, mode)
      if (abort) return
      await applyTopDown(testRun, '_afterEach')
      if (abort) return
    }

    await applyTopDown(suiteRun, '_after')
    console.log('Done!')
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
    var step = context, toApply = [], currentTimeout
    while(step != Object.prototype) {
      if (step.hasOwnProperty(name))
        toApply.unshift.apply(toApply, step[name] || [])
      step = Object.getPrototypeOf(step)
    }

    for (callback of toApply) {
      if (abort) return
      currentTimeout = setTimeout(() => {
        console.log(callback.timeout)
        abort = true
      }, 2000)
      await callback.fn.call(context)
      clearTimeout(currentTimeout)
    }
  }
})()
