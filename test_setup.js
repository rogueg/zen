import chai from 'chai'
window.expect = chai.expect

//window.$ = s => document.querySelector(s)
//window.$$ = s => Array.from(document.querySelectorAll(s))

let files = require.context('./test', true, /\.test\.js/)
files.keys().forEach(files)

module.hot.accept()
