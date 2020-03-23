const path = require('path')
const util = require('../util')

module.exports = class Journal {
  constructor () {
    this.path = path.join(Zen.config.tmpDir, 'journal.json')
    this.state = JSON.parse(util.readFile(this.path) || '{}')
  }

  record(test) {
    let entry = this.state[test.fullName] = (this.state[test.fullName]  || {})
    entry.error = !!test.error
    if (test.error) entry.tFail = test.time
    else entry.tPass = test.time
    if (test.time > 2000) console.log(`{${test.time}} - ${test.fullName}`)
    this.lazyFlush()
  }

  guessRuntime(fullName) {
    let entry = this.state[fullName] || {}
    if (entry.error)
      return Math.max(entry.tPass || 0, entry.tFail || 0)
    else
      return entry.tPass || 200
  }

  groupTests(tests, concurrency) {
    let runGroups = []
    tests.sortBy(name => -this.guessRuntime(name)).forEach(fullName => {
      let min = runGroups[0]
      let time = this.guessRuntime(fullName)
      let newTime = min ? min.time + time : time

      // Assign tests to whichever group has the lowest total time. Groups can grow to about 500ms
      // before we create a new one, and never create more than the concurrency limit.
      if ((!min || newTime > 500) && runGroups.length < concurrency)
        min = {tests: [], time: 0}
      else
        runGroups.shift()

      min.tests.push(fullName)
      min.time += time

      // sorted insert into runGroups
      let pos = runGroups.findIndex(g => g.time > min.time)
      pos == -1 ? runGroups.push(min) : runGroups.splice(pos, 0, min)
    })
    return runGroups
  }

  lazyFlush() {
    this.flushTimeout = this.flushTimeout || setTimeout(this.flush.bind(this), 5000)
  }

  flush() {
    clearTimeout(this.flushTimeout)
    this.flushTimeout = null
    util.writeFile(this.path, JSON.stringify(this.state))
  }
}
