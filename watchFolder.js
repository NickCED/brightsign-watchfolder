const chokidar = require('chokidar');

const watcher = chokidar.watch(watchDirectory, {
  //ignore all files not related to video
  ignored:
    /(^|[\/\\])\..|!(.*\.(mp4|avi|mkv|mov|flv|wmv|mpg|mpeg|m4v|3gp|webm))$/,
  persistent: true,
});

const log = console.log.bind(console);

watcher
  .on('add', (path) => log(`File ${path} has been added`))
  .on('change', (path) => log(`File ${path} has been changed`))
  .on('unlink', (path) => log(`File ${path} has been removed`))
  .on('addDir', (path) => log(`Directory ${path} has been added`))
  .on('unlinkDir', (path) => log(`Directory ${path} has been removed`))
  .on('error', (error) => log(`Watcher error: ${error}`))
  .on('ready', () => log('Initial scan complete. Ready for changes'));
