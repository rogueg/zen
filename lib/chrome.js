const { ChromeLauncher } = require("lighthouse/lighthouse-cli/chrome-launcher")
const CDP = require("chrome-remote-interface")
const path = require("path")

module.exports = class Chrome {
  constructor(opts) {
    this.opts = opts
    this.launcher = new ChromeLauncher({
      port: opts.port,
      autoSelectChrome: true, // False to manually select which Chrome install.
      additionalFlags: ["--window-size=412,732", "--disable-gpu", "--headless"]
    })

    this.browser = this.launcher.run().then(() => {
      return CDP({target: `ws://localhost:${opts.port}/devtools/browser`})
    })
  }

  async openTab(url, id) {
    let browser = await this.browser
    let {targetId} = await browser.Target.createTarget({url})
    let tab = await CDP({target: targetId})

    await Promise.all([tab.Console.enable(), tab.Page.enable(), tab.Runtime.enable()])
    
    tab.Console.messageAdded(({message}) => {
      console.log(`[${id}]`, message.text)
    })

    tab.Runtime.exceptionThrown(opts => {
      let ex = opts.exceptionDetails
      console.log(`[${id}]`, ex.text)
      if (ex.exception)
        console.log(ex.exception)
      ex.stackTrace.callFrames.forEach(f => console.log(`${f.functionName} ${f.url}:${f.lineNumber}`))
    })

    return tab
  }
}

function findTargetById(id) {
  return (targets) => {
    return targets.find((target) => target.id === id);
  };
}
