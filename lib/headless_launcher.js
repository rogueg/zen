const { ChromeLauncher } = require('lighthouse/lighthouse-cli/chrome-launcher')
const chrome = require('chrome-remote-interface')
const path = require('path')

/**
 * Launches a debugging instance of Chrome on port 9222.
 * @param {boolean=} headless True (default) to launch Chrome in headless mode.
 *     Set to false to launch Chrome normally.
 * @return {Promise<ChromeLauncher>}
 */
const port = 9222
function launchChrome(headless = true) {
  const launcher = new ChromeLauncher({
    port: port,
    autoSelectChrome: true, // False to manually select which Chrome install.
    additionalFlags: [
      '--window-size=412,732',
      '--disable-gpu',
      headless ? '--headless' : '',
    ],
  })

  return launcher
    .run()
    .then(() => launcher)
    .catch((err) => {
      console.log('my error')
      return launcher.kill().then(() => {
        // Kill Chrome if there's an error.
        throw err
      }, console.error)
    })
}

function onPageLoad(Page) {
  return Page.getAppManifest().then((response) => {
    if (!response.url) {
      console.log('Site has no app manifest')
      return
    }
    console.log('Manifest: ' + response.url)
    console.log(response.data)
  })
}

function findTargetById(id) {
  return (targets) => {
    return targets.find((target) => target.id === id)
  }
}

launchChrome()
  .then((launcher) => {
    chrome({ target: `ws://localhost:${port}/devtools/browser` }).then(
      (browser) => {
        const { Target } = browser
        const builds = [
          'file://' + path.resolve(__dirname, 'headless_test_tab1.html'),
          'file://' + path.resolve(__dirname, 'headless_test_tab2.html'),
        ].map((url) => {
          return new Promise((resolve, reject) => {
            Target.createTarget({
              url,
            }).then(({ targetId }) => {
              chrome({ target: findTargetById(targetId) }).then((client) => {
                const { Page, Console } = client

                Promise.all([Console.enable(), Page.enable()])
                  .then(() => {
                    Console.messageAdded(({ message }) => {
                      console.log('Url:', url, 'Message:', message.text)
                    })
                  })
                  .catch((err) => {
                    console.log('err', err)
                    reject(err)
                  })
              })
            })
          })
        })

        Promise.all(builds)
          .then((values) => {
            console.log('resolved', values)
          })
          .catch((reason) => {
            console.log('all catch', reason)
          })
      }
    )
  })
  .catch((err) => {
    console.log('final error', err)
    launcher.kill()
  })
