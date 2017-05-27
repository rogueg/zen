window.expect = chai.expect

describe('example', () => {
  // before callback that never resolves
  // before(() => { return new Promise((r) => {}) })

  it('can do math', () => {
    expect(1).to.equal(1)
  })
})
