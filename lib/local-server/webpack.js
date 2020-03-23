const path = require('path')
const webpack = require('webpack')
const EventEmitter = require('events')

module.exports = class WebpackAdapter extends EventEmitter {
  constructor () {
    super()
    let wcfg = Zen.config.webpack
    wcfg.entry.bundle.push(path.join(__dirname, '../client', 'webpack-client.js'))
    wcfg.plugins.push(new webpack.HotModuleReplacementPlugin())
    wcfg.plugins.push(new webpack.ProgressPlugin((pct, message, addInfo) => {
      if (pct > 0 && pct < 1)
        this.onStats({status: 'compiling', percentage: Math.round(pct * 100), message})
    }))

    wcfg.plugins.push(new webpack.NamedModulesPlugin())
    this.compiler = webpack(Zen.config.webpack)

    this.compiler.hooks.invalid.tap('Zen', () => this.onStats({status: 'compiling', errors: []}))
    this.compiler.hooks.compile.tap('Zen', () => this.onStats({status: 'compiling', errors: []}))
    this.compiler.hooks.failed.tap('Zen', error => this.onStats({status: 'failed', errors: [error]}))
    this.compiler.hooks.done.tap('Zen', this.onStats.bind(this))
  }

  async build () {
    return await new Promise((v, j) => {
      this.compiler.run(function (error, stats) {
        if (error) return j(error)
        if (stats.errors.length > 0) return j(new Error(stats.errors[0]))
        v(stats)
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
    if (stats.compilation) {
      stats.files = Object.keys(stats.compilation.assets).map(name => {
        let source = stats.compilation.assets[name].source()
        return {path: `webpack/${name}`, body: source}
      })

      stats.entrypoints = stats.compilation.entrypoints.get('bundle').chunks.map(chunk => chunk.files[0])

      stats.errors = (stats.compilation.errors || []).map(e => {
        return e.module ? `${e.module.id}: ${e.message}` : e.message
      })
    }

    this.compile = stats
    this.status = stats.status || (stats.errors.length ? 'error' : 'done')
    this.emit('status', this.status, stats)
  }
}
