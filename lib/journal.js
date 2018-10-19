const path = require('path')
const util = require('./util')

module.exports = class Journal {
  constructor (config) {
    this.path = path.join(config.tmpDir, 'journal.json')
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

  lazyFlush() {
    this.flushTimeout = this.flushTimeout || setTimeout(this.flush.bind(this), 5000)
  }

  flush() {
    clearTimeout(this.flushTimeout)
    this.flushTimeout = null
    util.writeFile(this.path, JSON.stringify(this.state))
  }
}
