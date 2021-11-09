const esbuild = require('esbuild')
const yargs = require('yargs')
const { nodeExternalsPlugin } = require('esbuild-node-externals')

const argv = yargs(process.argv)
  .alias('w', 'watch')
  .describe('w', 'toggle watch mode').argv

let watch
if (argv.watch) {
  watch = {
    onRebuild(error, result) {
      if (error) console.error('watch build failed:', error)
      else console.log('watch build succeeded:', result)
    },
  }
}

// // Build the CLI
esbuild
  .build({
    entryPoints: ['lib/cli.ts'],
    outfile: 'build/cli.js',
    bundle: true,
    platform: 'node',
    plugins: [nodeExternalsPlugin()],
    watch,
  })
  .catch(() => process.exit(1))

function buildSimpleFile(file, outfile, platform = 'browser') {
  esbuild
    .build({
      entryPoints: [file],
      outfile: `build/${outfile}.js`,
      platform,
      bundle: true,
      plugins: [nodeExternalsPlugin()],
      watch,
    })
    .catch(() => process.exit(1))
}

buildSimpleFile('lib/webpack/webpack-client.ts', 'webpack-client', 'node')
buildSimpleFile('lib/latte.ts', 'latte')
buildSimpleFile('lib/worker.js', 'worker')
buildSimpleFile('lib/head.js', 'head')
