const {Command, flags} = require('@oclif/command')
const path = require('path')

class LocalCommand extends Command {
  async run() {
    const {flags} = this.parse(LocalCommand)
    const client = require('../../client/index')
    client({ configFile: path.join(process.cwd(), flags.config) })
    const Server = require('../../local-server')
    this.log(`Starting local server...`)

    new Server()
  }
}

LocalCommand.description = `Runs the Zen UI locally`

LocalCommand.flags = {
  config: flags.string({
    char: 'c',
    default: 'zen.config.js'
  })
}

module.exports = LocalCommand
