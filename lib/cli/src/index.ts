export function run() {
  // Normalize whether the cli is run directly or via node
  if (!process.argv[0].match(/zen$/)) {
    process.argv.shift()
  }

  const cmd = process.argv[1] || 'run'
  if (cmd == 'server') {
    require("./server").run()
  }

  if (cmd == 'run') {
    require("./run").run()
  }

  if (cmd == 'deploy') {
    // TODO serverless deploy
  }

}