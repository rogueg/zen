const path = require('path');

module.exports = {
  appRoot: '..',

  testDependencies: [
    '/base/node_modules/chai/chai.js'
  ],

  webpack: {
    entry: './tests.js',
    output: {
      path: path.resolve(__dirname, 'build'),
      filename: 'bundle.js'
    },
    plugins: []
  }
}
