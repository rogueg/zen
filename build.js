const esbuild = require('esbuild')
const { nodeExternalsPlugin } = require('esbuild-node-externals')

// Build the CLI
esbuild
  .build({
    entryPoints: ['lib/cli.ts'],
    outfile: 'build/cli.js',
    bundle: true,
    platform: 'node',
    plugins: [nodeExternalsPlugin()],
  })
  .catch(() => process.exit(1))

function buildSimpleFile(file, outfile) {
  esbuild
    .build({
      entryPoints: [file],
      outfile: `build/${outfile}.js`,
      platform: 'node',
      plugins: [nodeExternalsPlugin()],
    })
    .catch(() => process.exit(1))
}

buildSimpleFile('lib/webpack-client.js', 'webpack-client')
buildSimpleFile('lib/latte.js', 'latte')
buildSimpleFile('lib/worker.js', 'worker')
buildSimpleFile('lib/head.js', 'head')
