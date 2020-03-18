process.env.NODE_ENV = 'test'

const webpackConfig = {
  mode: "development",
  entry: {
    bundle: ['./test_setup.js']
  },
  output: {
    publicPath: "webpack/",
  },
  devtool: "eval",
  plugins: [],
}

module.exports = {
  aws: {
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    assetBucket: process.env.ZEN_ASSET_BUCKET
  },
  webpack: webpackConfig
}
