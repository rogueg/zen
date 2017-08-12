const recast = require('recast')
const types = require('ast-types')
const namedTypes = types.namedTypes

class TestRegistry {
  constructor() {
    this.fileMap = {}
  }

  fileChange(file) {

  }

  visitCall(path) {
    let fnName = path.node.callee.name
    let args = path.node.arguments

    // We only operate on top-level describes, so nested ones are ignored here.
    if (fnName == 'describe')
      this.currentDescribe = this.currentDescribe || {name: args[0].value, tests: []}

    // dynamically constructed `it` calls aren't supported (yet)
    else if (fnName == 'it' && args[0].type != 'Literal')
      console.log('Complex it args', path)

    else if (fnName == 'it')
      this.currentDescribe.tests.push({name: args[0].value})

  }
}

module.exports = new TestRegistry()
