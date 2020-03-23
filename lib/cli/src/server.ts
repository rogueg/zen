import '../../client/index'

export function run() {
  const Server = require('../../local-server')
  return new Server()
}