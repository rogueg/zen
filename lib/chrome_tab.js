const { ChromeLauncher } = require("lighthouse/lighthouse-cli/chrome-launcher")
const chrome = require("chrome-remote-interface")
const path = require("path")

module.exports = class Chrome {
  async constructor() {
    this.launcher = new ChromeLauncher({
      port: port,
      autoSelectChrome: true, // False to manually select which Chrome install.
      additionalFlags: [
        "--window-size=412,732",
        "--disable-gpu",
        headless ? "--headless" : ""
      ]
    });

    await this.launcher.run()
  }
}

class ChromeTab {

}
