const {Command, flags} = require('@oclif/command')

class LocalCommand extends Command {
  async run() {
    require('../../client/index')
    const Server = require('../../local-server')
    this.log(`Starting local server...`)

    new Server()
  }
}

LocalCommand.description = `Runs the Zen UI locally`

LocalCommand.flags = {
}

module.exports = LocalCommand
