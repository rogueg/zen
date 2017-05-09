class Pass {
  constructor(suites) {
    this.remaining = suites
  }

  popSuite() {
    return this.remaining.pop()
  }
}
