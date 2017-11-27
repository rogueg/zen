module.hot && module.hot.accept((err) => {
  if (err)
    location.reload()
})

function needsUpdate(hash) {
  return hash && hash.indexOf(__webpack_hash__) == -1
}

async function update() {
  let updated = await module.hot.check(true)

  if (!updated)
    location.reload()
}

module.exports = window.ZenWebpackClient = {needsUpdate, update}
