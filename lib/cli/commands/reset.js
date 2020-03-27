const {Command, flags} = require('@oclif/command')

class ResetCommand extends Command {
  async run() {
    const del = require('del');
    const deletedPaths = await del(['.zen/']);

    this.log('Deleted files and directories:\n', deletedPaths.join('\n'));
  }
}

ResetCommand.description = `Resets the .zen directory`

ResetCommand.flags = {
}

module.exports = ResetCommand
