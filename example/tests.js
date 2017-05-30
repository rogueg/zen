require('./second')

window.expect = chai.expect

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
