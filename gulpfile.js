// Include gulp
var gulp = require('gulp');

// Include Plugins
var shell = require('gulp-shell');
var ghPages = require('gulp-gh-pages');


gulp.task('mkdocs', shell.task('mkdocs build'));

// Deploy to gh-pages
gulp.task('deploy', ['mkdocs'], function () {
  return gulp.src('site/**/*')
    .pipe(ghPages({
      push: true
    }));
});
