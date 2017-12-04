const path = require('path')
const webpack = require('webpack')
const WebpackDevServer = require('webpack-dev-server')
const stringHash = require('string-hash')

module.exports = function setupWebpack(config, onCompilation) {
  // config.webpack.entry.push('webpack-dev-server/client?http://0.0.0.0:3101')
  config.webpack.entry.bundle.push(path.join(__dirname, 'webpack-client.js'))
  config.webpack.plugins.push(new webpack.HotModuleReplacementPlugin())
  config.webpack.plugins.push(new webpack.NamedModulesPlugin())
  const compiler = webpack(config.webpack)

  compiler.plugin("done", (stats) => {
    if (stats.errors && stats.errors.length > 0) return

    debugger
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