const gulp = require('gulp')
const gutil = require('gulp-util')
const through = require('through2')
const sourcemaps = require('gulp-sourcemaps')
const cjsx = require('gulp-cjsx')

const recast = require('recast')
const types = require('ast-types')
const namedTypes = types.namedTypes

var analyzeRequire = through.obj(function(file, encoding, cb) {
  let code = file.contents.toString(encoding)
  let output = process(code)
  file.contents = new Buffer(output)
  cb(null, file)
})

function process(code) {
  let ast = recast.parse(code)
  types.visit(ast, {
    visitCallExpression: function(path) {
      let quirk = null

      if (path.node.callee.name != 'require')
        return this.traverse(path)

      let args = path.node.arguments
      if (args.length != 1 || args[0].type != 'Literal')
        quirk = 'Complex arguments'

      else if (['app/constants', 'app/errors'].includes(path.node.arguments[0].value))
        // simple mapping
        1

      else if (!['AssignmentExpression', 'ExpressionStatement'].includes(path.parent.node.type))
        quirk = 'Not simple'

      let curr = path.parent
      while (!namedTypes.Statement.check(curr.node)) {
      //   if (!"MemberExpression VariableDeclarator AssignmentExpression".split(' ').includes(curr.node.type)) {
      //     quirk = `Unexpected step in chain ${curr.node.type}`
      //   }
        curr = curr.parent
      }

      if (quirk) {
        console.log(quirk, recast.print(curr.node).code)
      }

      this.traverse(path)
    }
  })

  return recast.print(ast).code
}

  gulp.src('/Users/grant/co/superhuman/app/**/*.cjsx')
    .pipe(require('gulp-debug')({ title: 'start:' }))
    .pipe(cjsx())
    .pipe(analyzeRequire)
    .pipe(gulp.dest('build'))


// process([
//   'require("style")',
//   'var FOCUS = require("constants").BLAH.BAR',
//   'var Bar = require("foo/bar")',
// ].join('\n'))

// let file = "/Users/grant/co/superhuman/app/components/compose_form_controller.cjsx"
// require('fs').readFile(file, (err, data) => {
//   if (err) console.error(err)
//   process(data)
// })

