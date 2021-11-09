module.hot?.accept((err) => {
  // TODO I think this might be the source of refresh looping
  console.log("LOOPING")
  if (err) location.reload()
})

function needsUpdate(hash: string): boolean {
  return !!hash && hash.indexOf(__webpack_hash__) == -1
}

type ModuleId = string | number
async function update(): Promise<ModuleId[]> {
  if (module.hot) {
    let resolve: (value: ModuleId[]) => void
    let reject: (error: unknown) => void
    const promise = new Promise<ModuleId[]>((res, rej) => {
      resolve = res
      reject = rej
    })

    module.hot.check(true, (err, outdatedModules) => {
      if (!err) {
        location.reload()
        resolve(outdatedModules)
      } else {
        reject(err)
      }
    })
    return promise
  }

  return []
}

declare global {
  interface Window {
    // While webpack is building or in an error state this code may not run and set ZenWebpackClient
    ZenWebpackClient?: {
      needsUpdate: typeof needsUpdate
      update: typeof update
    }
  }
}

window.ZenWebpackClient = { needsUpdate, update }

export default {}
