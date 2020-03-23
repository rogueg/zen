Zen is an absurdly fast test runner. How fast? At Superhuman, running all 2.8k tests locally took about 30 minutes. With Zen, it takes 10 seconds. There are 3 main parts:

**Lambda workers** - when running all tests, Zen uploads your code to an S3 bucket and then spins up 600 Chrome instances in AWS Lambda to run all your tests. 

**Headless workers** - when you're running fewer tests (say, just one describe block) Zen will run your tests on a pool of local headless Chrome instances.

**Zen UI** - Let's you see which tests failed, and run them in the current tab to debug. When running in a tab, Zen shows you all the rendered DOM, making it a decent replacement for Storybook.

## Setup
This is a bit rough. Sorry! Hopefully soon I'll automate all this 😀

#### Deploy S3 bucket
We're going to put some build artifacts in this bucket before deploying the full stack.
```
aws cloudformation deploy --stack-name zen --template-file node_modules/@rogueg/zen/lib/aws/aws-bucket-only.template --capabilities CAPABILITY_NAMED_IAM
```

#### Making Chrome Layer
You need a Lambda Layer that has a chromium binary. I've been using the excellent https://github.com/alixaxel/chrome-aws-lambda, but it requires a bit of work.

1. Download release for the version of Chrome you'd like
1. Use brotli to decompress bin/chromium.br
1. Create a zip file with just the decompressed chromium
1. Upload to the bucket
1. Use AWS's Lambda UI to create a layer from that zip
1. Get the ARN for the layer, and put it in `node_modules/@rogueg/zen/lib/aws/aws.template` (I told you this was rough)

#### Make lambda code
You'll also need a zip of `lib/local-server/chrome.js`, `lib/aws/lambda.js`, and `chrome-remote-interface`. Upload it to the bucket as `lambda-code.zip`

#### Deploy stack
This will deploy all the rest of the formation.
```
aws cloudformation deploy --stack-name zen --template-file node_modules/@rogueg/zen/lib/aws/aws.template --capabilities CAPABILITY_NAMED_IAM
```

#### Config
Finally, create test/zen.config.js. Mine usually looks like this:
```
const webpackConfig = require('../webpack.config.js')

process.env.NODE_ENV = 'test'
webpackConfig.mode = 'development'
webpackConfig.entry = {bundle: ['./test/setup.tsx']}
webpackConfig.output.publicPath = 'webpack/'
webpackConfig.devtool = 'eval'

module.exports = {
  aws: {
    region: 'us-west-2',
    accessKeyId: 'XXX',
    secretAccessKey: 'XXX',
    assetBucket: 'XXX',
  },
  webpack: webpackConfig,
}
```

## Developing

```
npm run build:ts
npm run build
npm run test:ui run zen.config.js
npm run test:ui server zen.config.js
```