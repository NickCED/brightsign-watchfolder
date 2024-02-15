const chokidar = require('chokidar');
const SFTPClient = require('ssh2-sftp-client');
const fs = require('fs');
const path = require('path');

// Load configuration
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

const sftp = new SFTPClient();
let CONNECTED = false;
let CONNECTING = false;

let sftpTimeout = null;
console.log('Watching for file changes...');
function resetSFTPTimeout() {
  if (sftpTimeout) {
    clearTimeout(sftpTimeout);
  }
  sftpTimeout = setTimeout(disconnectSFTP, config.remote.timeout);
}
function pauseSFTPTimeout() {
  if (sftpTimeout) {
    clearTimeout(sftpTimeout);
  }
}

//logic for initiating sftp connection for file upload/delete/rename operations
// Connect to SFTP server and disconnect after all operations are done plus timeout

async function connectSFTP() {
  try {
    if (CONNECTING) {
      return;
    }
    CONNECTING = true;
    await sftp.connect({
      host: config.remote.host,
      port: config.remote.port,
      username: config.remote.username,
      password: config.remote.password,
    });
    // Start disconnect timeout
    CONNECTED = true;
    CONNECTING = false;
    console.log('Connected to SFTP server');
  } catch (error) {
    console.error('Failed to connect to SFTP server:', error);
  }
}

async function disconnectSFTP() {
  try {
    await sftp.end();
    console.log('Disconnected from SFTP server');
    sftpTimeout = null;
    CONNECTED = false;
  } catch (error) {
    console.error('Failed to disconnect from SFTP server:', error);
  }
}

async function uploadFile(filePath, remotePath) {
  remotePath = convertWindowsPathToUnix(remotePath);
  try {
    if (!CONNECTED) {
      console.log('Uploading file, not connected to sftp');
      await connectSFTP();
    }
    pauseSFTPTimeout();
    await sftp.put(filePath, remotePath);
    console.log(`Uploaded ${filePath} to ${remotePath}`);
    resetSFTPTimeout();
  } catch (error) {
    console.error(`Failed to upload ${filePath} to ${remotePath}:`, error);
    resetSFTPTimeout();
  }
}

async function removeFile(remotePath) {
  remotePath = convertWindowsPathToUnix(remotePath);
  try {
    if (!CONNECTED) {
      console.log('Removing file, not connected to sftp');
      await connectSFTP();
    }
    pauseSFTPTimeout();
    await sftp.delete(remotePath);
    console.log(`Deleted ${remotePath}`);
    resetSFTPTimeout();
  } catch (error) {
    console.error(`Failed to remove ${remotePath}:`, error);
    resetSFTPTimeout();
  }
}

async function renameFile(oldRemotePath, newRemotePath) {
  try {
    if (!CONNECTED) {
      console.log('Renaming file, not connected to sftp');
      await connectSFTP();
    }
    pauseSFTPTimeout();
    await sftp.rename(oldRemotePath, newRemotePath);
    resetSFTPTimeout();
  } catch (error) {
    console.error(
      `Failed to rename ${oldRemotePath} to ${newRemotePath}:`,
      error
    );
    resetSFTPTimeout();
  }
}

//Watch file setup
console.log(config.local.watchFolder);
const watcher = chokidar.watch(config.local.watchFolder, {
  //ignore all files not related to video
  ignored:
    /(^|[\/\\])\..|!(.*\.(mp4|avi|mkv|mov|flv|wmv|mpg|mpeg|m4v|3gp|webm))$/,
  persistent: true,
  ignoreInitial: true,
});
const dest = config.remote.destinationFolder;
watcher.on('add', (path, stats) => {
  fileEventRouter('add', path, stats);
});
// watcher.on('change', (path) => {
//   console.log('changed');
//   uploadFile(path, path.replace(config.local.watchFolder, dest));
// });
watcher.on('unlink', (path) => {
  fileEventRouter('unlink', path, null);
});

function convertWindowsPathToUnix(windowsPath) {
  if (config.local.os === 'windows') {
    windowsPath = windowsPath.replace(/\\/g, '/');
  }
  return windowsPath;
}

let recentlyMoved = {};

function fileEventRouter(event, path, stats) {
  console.log;
  recentlyMoved[path] = {
    path: path,
    time: new Date().getTime(),
    event: event,
  };
  stats
    ? (recentlyMoved[path].size = stats.size)
    : (recentlyMoved[path].size = 0);
  let remotePath = path.replace(config.local.watchFolder, dest);
  let probableRename = checkIfProbableRename(recentlyMoved[path]);
  if (probableRename.rename) {
    addTaskToQueue({
      event: 'rename',
      path: path,
      remotePath: remotePath,
      probableRenamePath: probableRename.path,
    });
    delete recentlyMoved[path];
    delete recentlyMoved[probableRename.path];
    return;
  }
  if (event === 'add') {
    addTaskToQueue({ event: 'add', path: path, remotePath: remotePath });
  } else if (event === 'unlink') {
    addTaskToQueue({ event: 'unlink', path: path, remotePath: remotePath });
  }
  if (recentlyMoved[path]) autoRemoveOldMovedFile(path);
}

function checkIfProbableRename(pathObj) {
  let rename = false;
  let timeout = config.local.renameTimeout;
  for (const obj in recentlyMoved) {
    if (obj.time < pathObj.time - timeout) {
      delete recentlyMoved[obj];
      continue;
    }
    if (obj.event === pathObj.event) continue;
    if (obj.size !== pathObj.size) continue;
    if (obj.path === pathObj.path) continue;

    return { path: obj.path, rename: true };
  }
  return { path: 'null', rename: false };
}

function autoRemoveOldMovedFile(path) {
  let timeout = config.local.oldFileTimeout;
  setTimeout(() => {
    if (recentlyMoved[path]) delete recentlyMoved[path];
  }, timeout);
}

// task queue

const taskQueue = [];

let taskRunning = false;

function addTaskToQueue(task) {
  taskQueue.push(task);
  if (!taskRunning) {
    processQueue();
  }
}

async function processQueue() {
  if (taskRunning) return;
  if (taskQueue.length === 0) return;
  taskRunning = true;
  while (taskQueue.length > 0) {
    let task = taskQueue.shift();
    await task();
  }
}
