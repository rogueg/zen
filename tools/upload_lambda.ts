const AWS = require('aws-sdk')
const AdmZip = require('adm-zip')
const path = require('path')
const esbuild = require('esbuild')

// Create a the zip file
const zip = new AdmZip()
const files = ['lambda.js', 'chrome_wrapper.ts']
files.forEach((file) => {
  const [basename, filetype] = file.split('.')
  // TODO make this use partial esbuild config
  let bundleConfig: any = {
    bundle: false,
  }
  if (file !== 'lambda') {
    bundleConfig = {
      bundle: true,
      // These are in the lambda layer we use and do not need to be bundled
      external: ['chrome-aws-lambda', 'puppeteer-core', 'aws-sdk'],
    }
  }
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, `../lib/${basename}.${filetype}`)],
    platform: 'node',
    outfile: path.join(__dirname, '../build/lambda_code', basename + '.js'),
    ...bundleConfig,
  })
  zip.addLocalFile(path.join(__dirname, `../build/lambda_code/${basename}.js`))
})

zip.writeZip(path.join(__dirname, '../build/lambda_code/lambda-code.zip'))

const assetBucket = process.env.ASSET_BUCKET
const secretAccessKey = process.env.SECRET_ACCESS_KEY
const accessKeyId = process.env.ACCESS_KEY_ID
if (!assetBucket || !secretAccessKey || !accessKeyId) {
  console.log('You need to set AWS premissions to do the upload')
  process.exit(1)
}

// Setup AWS
AWS.config.update({
  secretAccessKey,
  accessKeyId,
  region: 'us-west-1',
})
const s3 = new AWS.S3({ params: { Bucket: assetBucket } })

// Send the zip up to S3
// TODO revert name to lambda-code
const key = 'lambda-code-puppeteer.zip'
const body = zip.toBuffer()
const contentType = 'application/zip, application/octet-stream'
s3.upload({ Key: key, Body: body, ContentType: contentType } as any)
  .promise()
  .then(() => {
    console.log('Upload finished!')
  })
  .catch((e: unknown) => {
    console.error(e)
    process.exit(1)
  })
