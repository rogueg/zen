require('./second')

window.expect = chai.expect

module.hot.accept()

hangingPromise = () => new Promise(r => {})
throwsError = () => { throw new Error('oops') }

describe('example', () => {
  before(() => { console.log('before example'); /* return hangingPromise() */ })
  after(() => { console.log('after example') })
  beforeEach(() => { console.log('beforeEach example'); /* return hangingPromise() */ })
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
  //   let prm = new Promise((resolve, rej) => {
  //     setTimeout(resolve, 10)
  //   })
  //   let ret = prm.then(() => { throw new Error('BANG') })
  //   return ret
  // })
})
