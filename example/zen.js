const path = require('path');

module.exports = {
  appRoot: '..',

  testDependencies: [
    '/base/node_modules/chai/chai.js'
  ],

  webpack: {
    entry: ['./tests.js'],
    output: {
      path: path.resolve(__dirname, 'build'),
      filename: 'bundle.js',
      publicPath: 'http://localhost:3101/'
    },
    plugins: [],
    // devtool: 'eval' // eval is recommended, because the source updates in chrome devtools
  }
}
