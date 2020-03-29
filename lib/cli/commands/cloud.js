const {Command, flags} = require('@oclif/command')



class CloudCommand extends Command {
  loadConfig() {
    require('../../client/index')
    let awsConfig = Zen.config.aws
    if (
      !awsConfig ||
      !awsConfig.region ||
      !awsConfig.accessKeyId ||
      !awsConfig.secretAccessKey ||
      !awsConfig.assetBucket
    ) {
      throw new Error('AWS config is empty. Please make sure that environment variables are set if you are using them.')
    }
  }

  async run() {
    // TODO: accept a config file
    // const {flags} = this.parse(CloudCommand)
    // flags.config

    this.loadConfig()

    if (Zen.webpack) {
      await this.buildWebpack()
    }

    await this.s3Sync()
    await this.getTestNames()
    const failed = await this.runTestsInParallel()
    process.exit(failed === 0 ? 0 : 1)
  }

  async buildWebpack() {
    let t0 = new Date()

    this.log('Webpack building')
    let previousPercentage = 0
    Zen.webpack.on('status', (status, stats) => {
      if (stats.percentage && stats.percentage > previousPercentage) {
        previousPercentage = stats.percentage
        this.log(`${stats.percentage}% ${stats.message}`)
      }
    })
    await Zen.webpack.build()
    this.log(`Took ${new Date() - t0}ms`)
  }

  async s3Sync() {
    let t0 = new Date()
    this.log('Syncing to S3')
    Zen.s3Sync.on('status', msg => process.env.DEBUG && this.log(msg))
    await Zen.s3Sync.run(Zen.indexHtml('worker', true))
    this.log(`Took ${new Date() - t0}ms`)
  }

  async getTestNames() {
    let t0 = new Date()
    this.log('Getting test names')
    this.workingSet = await Util.invoke('zen-listTests', {sessionId: Zen.config.sessionId})
    this.groups = Zen.journal.groupTests(this.workingSet, Zen.config.lambdaConcurrency)
    this.log(`Took ${new Date() - t0}ms`)
  }

  async runTestsInParallel() {
    let failed = 0
    let t0 = new Date()
    this.log(`Running ${this.workingSet.length} tests on ${this.groups.length} workers`)
    await Promise.all(this.groups.map(async group => {
      try {
        let response = await Util.invoke('zen-workTests', {
          deflakeLimit: 3,
          testNames: group.tests,
          sessionId: Zen.config.sessionId
        })
        response.forEach(r => {
          if (r.attempts > 1 && !r.error)
            this.log(`⚠️ ${r.fullName} (flaked ${r.attempts-1}x)`)
          if (r.error) {
            failed++
            this.log(`🔴 ${r.fullName} ${r.error} (tried ${r.attempts || 1} times)`)
          }
        })
      } catch (e) {
        this.error(e)
        failed += group.tests.length
      }
    }))
    this.log(`Took ${new Date() - t0}ms`)
    this.log(`${failed === 0 ? '🎉' : '😢'} ${failed} failed test${failed == 1 ? '' : 's'}`)

    return failed
  }
}

CloudCommand.description = `Runs all your tests in the cloud`

CloudCommand.flags = {
}

module.exports = CloudCommand
