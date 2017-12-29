const path = require('path')
const webpack = require('webpack')
const WebpackDevServer = require('webpack-dev-server')
const stringHash = require('string-hash')

module.exports = function setupWebpack(config, onCompilation) {
  // config.webpack.entry.bundle.push('webpack-dev-server/client?http://0.0.0.0:3101')
  config.webpack.entry.bundle.push(path.join(__dirname, 'webpack-client.js'))
  config.webpack.plugins.push(new webpack.HotModuleReplacementPlugin())
  config.webpack.plugins.push(new webpack.NamedModulesPlugin())
  const compiler = webpack(config.webpack)

  compiler.plugin("invalid", () => onCompilation({status: 'compiling', errors: []}))
  compiler.plugin("compile", () => onCompilation({status: 'compiling', errors: []}))
  compiler.plugin("failed", (error) => onCompilation({status: 'failed', errors: [error]}))

  compiler.plugin("done", (stats) => {
    stats.files = stats.compilation.entrypoints.bundle.chunks.map(chunk => {
      let filename = chunk.files[0]
      let asset = stats.compilation.assets[filename]
      let source = asset.source()
      return {
        path: filename,
        hash: stringHash(source),
        contentType: 'application/javascript; charset=UTF-8',
        body: source
      }
    })

    stats.errors = (stats.compilation.errors || []).map(e => {
      let msg = e.message
      if (e.module)
        msg = `${e.module.id}: ${msg}`
      return msg
    })

    stats.status = stats.errors.length ? 'error' : 'done'
    onCompilation(stats)
  })

  new WebpackDevServer(compiler, {
    stats: { errorDetails: true },
    hot: true,
    inline: false,
    headers: {
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Origin': 'http://localhost:3100'
    }
  }).listen(3101, 'localhost', (err, result) => {
    if (err) console.error(err)
  })
}