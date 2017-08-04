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

  before(() => { console.log('before example') })
  after(() => { console.log('after example') })
  beforeEach(() => console.log('beforeEach example'))
  afterEach(() => console.log('afterEach example'))

  helper('echoBot', {
    welcome: function() { return "Hello " + this.name }
  })

  it('can do math', () => {
    expect(1 + 1).to.equal(2)
  })

  describe('nested', () => {
    before(() => { console.log('before nested') })
    after(() => { console.log('after nested') })
    beforeEach(() => { console.log('beforeEach nested') })
    afterEach(() => { console.log('afterEach nested') })

    helper('bark', function() { return 'woof' })

    it('can echo', function() {
      this.name = 'Latte'
      expect(this.echoBot.welcome()).to.equal('Hello Latte')
    })

    it('can bark', function() {
      expect(this.bark()).to.equal('woof')
    })
  })
  // it('doesnt timeout on breakpoints', () => {
  //   expect(1).to.equal(1)
  //   debugger
  //   expect(1).to.equal(1)
  // })

  // it('has a promise that throws an error', function() {
  //   let prm = new Promise(resolve => {
  //     setTimeout(resolve, 10)
  //   })
  //   let ret = prm.then(() => { throw new Error('BANG') })
  //   return ret
  // })
})
