require('./second')

window.expect = chai.expect

// Webpack HMR hook. This accepts all module changes, and tells the
// tests to re-run. We should move this elsewhere, maybe a plugin to
// inject it into the entry module?
let wasApply = false
module.hot && module.hot.accept((err) => {
  if (err)
    console.error('Failed to apply hot update', err)
})
module.hot && module.hot.addStatusHandler(status => {
  if (wasApply && status == 'idle')
    Zen.run()
  wasApply = status == 'apply'
})

describe('example', () => {
  // before callback that never resolves
  // before(() => { return new Promise((r) => {}) })

  it('can do math', () => {
    expect(1).to.equal(1)
  })

  it('doesnt timeout on breakpoints', () => {
    expect(1).to.equal(1)
    debugger
    expect(1).to.equal(1)
  })
})
