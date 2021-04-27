const path = require('path')
const webpack = require('webpack')
const EventEmitter = require('events')

module.exports = class WebpackAdapter extends EventEmitter {
  constructor () {
    super()
    let wcfg = Zen.config.webpack
    wcfg.entry.bundle.push(path.join(__dirname, 'webpack-client.js'))
    wcfg.plugins.push(new webpack.HotModuleReplacementPlugin())
    wcfg.plugins.push(new webpack.ProgressPlugin((pct, message, addInfo) => {
      if (pct > 0 && pct < 1)
        this.onStats({status: 'compiling', percentage: Math.round(pct * 100), message})
    }))

    wcfg.optimization.moduleIds = 'named'
    this.files = {}
    this.compiler = webpack(Zen.config.webpack)

    this.compiler.hooks.beforeCompile.tap('Zen', () => this.compileDone = false )
    this.compiler.hooks.invalid.tap('Zen', () => this.onStats({status: 'compiling', errors: []}))
    this.compiler.hooks.compile.tap('Zen', () => this.onStats({status: 'compiling', errors: []}))
    this.compiler.hooks.failed.tap('Zen', error => this.onStats({status: 'failed', errors: [error]}))
    this.compiler.hooks.assetEmitted.tap('Zen', (name, { content }) =>
      this.files[name] = { path: `webpack/${name}`, body: content }
    )
    this.compiler.hooks.done.tap('Zen', (stats, callback) => {
      this.entrypoints = stats.compilation.entrypoints.get('bundle').chunks.map(chunk => chunk.files[0])
      this.onStats({ hash: stats.hash, files: Object.values(this.files), percentage: 100, status: 'done' })
      this.compileDone = true
    })
  }

  async build () {
    return await new Promise((resolve, reject) => {
      this.compiler.run(function (error, stats) {
        if (error) return reject(error)
        if (stats.errors.length > 0) return reject(new Error(stats.errors[0]))
        resolve(stats)
      })
    })
  }

  startDevServer (server) {
    const WebpackDevServer = require('webpack-dev-server')
    let devServer = new WebpackDevServer(this.compiler, {
      progress: true,
      stats: {errorDetails: true},
      hot: true, inline: false
    })

    server.use('/webpack', devServer.app)
  }

  onStats (stats) {
    if (this.compileDone) return
    this.compile = stats
    this.status = stats.status || (stats.errors && stats.errors.length ? 'error' : 'done')
    this.emit('status', this.status, stats)
  }
}
