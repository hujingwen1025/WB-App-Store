const { app, BrowserWindow, ipcMain } = require('electron');
const { Notification } = require('electron');
const { net } = require('electron');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const resourcesPath = __dirname.replace(/app\.asar$/, '');
const scriptPath = path.join(resourcesPath, 'extraResources', 'mas');
const https = require('https');
const os = require('os');
const { pipeline } = require('stream');
const { promisify } = require('util');
const pump = promisify(pipeline);
const { dialog } = require('electron');

var installedApps = []
var currentlyInstallingApp = ''
var currentlyUninstallingApp = ''
var isUpdating = false
var updateDialogOpen = false
var rejectedUpdateVersion = null
var isCancelingUpdate = false
let progressWindow = null

let mainWindow;

function createProgressWindow() {
  progressWindow = new BrowserWindow({
    width: 400,
    height: 200,
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'progressPreload.js')
    }
  });

  progressWindow.loadFile(path.join(__dirname, 'progress.html'));
}

function updateProgress(status, progress, cancellable = false) {
    console.log(status)
    if (progressWindow && !progressWindow.isDestroyed()) {
        progressWindow.webContents.send('update-progress', [ status, progress, cancellable ]);
    }
}

function closeProgressWindow() {
  if (progressWindow && !progressWindow.isDestroyed()) {
    progressWindow.close();
    progressWindow = null;
  }
}

function showNotification(title, body) {
  const myNotification = new Notification({
    title: title,
    body: body
  });
  myNotification.show();
}

async function runCommandAndWait(command) {
  try {
    const { stdout, stderr } = await exec(command);
    return { stdout, stderr, success: true };
  } catch (error) {
    return { 
      stdout: error.stdout || '', 
      stderr: error.stderr || error.message, 
      success: false,
      error: error
    };
  }
}

async function checkAppVersion() {
  try {
    // Don't check for updates if one is already running or dialog is open
    if (isUpdating || updateDialogOpen) {
      console.log("Update already in progress or dialog open, skipping check");
      return 0;
    }

    console.log("Checking for updates...    ")
    // Get current and remote versions
    const currentVersion = app.getVersion();
    const remoteVersion = await getRemoteVersion();
    
    if (remoteVersion === currentVersion) {
      return 0;
    }

    // Don't prompt if user already rejected this version
    if (rejectedUpdateVersion === remoteVersion) {
      console.log("User previously rejected update to version " + remoteVersion);
      return 0;
    }

    // Mark dialog as open
    updateDialogOpen = true;

    // User confirmation
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Update', 'Cancel'],
      message: 'Update Available',
      detail: `New version ${remoteVersion} is available. Would you like to install it now?`
    });

    // Mark dialog as closed
    updateDialogOpen = false;

    if (response !== 0) {
      // User rejected the update - store the version to avoid asking again this session
      rejectedUpdateVersion = remoteVersion;
      console.log("User rejected update to version " + remoteVersion);
      return 0;
    }

    // Mark update as in progress
    isUpdating = true;
    isCancelingUpdate = false;

    // Create and show progress window
    createProgressWindow();
    
    // Wait for window to be ready before sending updates
    await new Promise(resolve => setTimeout(resolve, 500));
    updateProgress('Downloading update...', 10, true);

    console.log(os.tmpdir())
    // Download and install update
    const downloadUrl = `https://github.com/hujingwen1025/WB-App-Store/releases/download/v${remoteVersion}/WB.App.Store.v${remoteVersion}.zip`;
    const zipPath = path.join(os.tmpdir(), `WB.App.Store.v${remoteVersion}.zip`);
    const extractPath = path.join(os.tmpdir(), `WB-App-Store-${remoteVersion}`);
    const appName = 'WB App Store.app';
    // Prefer installing to the location where the running app bundle is located.
    // `app.getPath('exe')` typically returns something like
    // '/Applications/WB App Store.app/Contents/MacOS/WB App Store'.
    // Climb up to the .app bundle and use that as the destination. If that
    // doesn't point at a .app bundle (e.g. running in dev), fall back to
    // the user's Applications folder in their home directory.
    let destPath;
    try {
      const exePath = app.getPath('exe');
      const possibleBundle = path.resolve(exePath, '../../..');
      if (possibleBundle && possibleBundle.endsWith('.app')) {
        destPath = possibleBundle;
      } else {
        destPath = path.join(os.homedir(), 'Applications', appName);
      }
    } catch (e) {
      destPath = path.join(os.homedir(), 'Applications', appName);
    }

    // Check for cancellation before proceeding
    if (isCancelingUpdate) {
      closeProgressWindow();
      isUpdating = false;
      return 0;
    }

    try {
      await downloadFile(downloadUrl, zipPath);
    } catch (downloadErr) {
      console.error('Download failed:', downloadErr);
      closeProgressWindow();
      isUpdating = false;
      isCancelingUpdate = false;
      updateDialogOpen = false;
      await dialog.showMessageBox({
        type: 'error',
        title: 'Update Failed',
        message: 'Download failed',
        detail: downloadErr.message
      });
      return 0;
    }
    
    // Check for cancellation after download
    if (isCancelingUpdate) {
      closeProgressWindow();
      isUpdating = false;
      return 0;
    }

    updateProgress('Extracting files...', 50, false);
    // Check for cancellation before extraction
    if (isCancelingUpdate) {
      closeProgressWindow();
      isUpdating = false;
      return 0;
    }
    try {
      await extractZip(zipPath, extractPath);
    } catch (extractErr) {
      console.error('Extraction failed:', extractErr);
      closeProgressWindow();
      isUpdating = false;
      isCancelingUpdate = false;
      updateDialogOpen = false;
      await dialog.showMessageBox({
        type: 'error',
        title: 'Update Failed',
        message: 'Extraction failed',
        detail: extractErr.message
      });
      return 0;
    }
    // Check for cancellation after extraction
    if (isCancelingUpdate) {
      closeProgressWindow();
      isUpdating = false;
      return 0;
    }
    updateProgress('Installing update...', 75, false);
    try {
      await moveApp(extractPath, destPath, appName);
    } catch (moveErr) {
      console.error('Move app failed:', moveErr);
      closeProgressWindow();
      isUpdating = false;
      isCancelingUpdate = false;
      updateDialogOpen = false;
      await dialog.showMessageBox({
        type: 'error',
        title: 'Update Failed',
        message: 'Installation failed',
        detail: moveErr.message
      });
      return 0;
    }
    updateProgress('Finalizing...', 90, false);

    try {
      await runCommandAndWait(`xattr -cr ${destPath}`);
      await cleanUpdateFiles(zipPath, extractPath);
    } catch (finalErr) {
      console.error('Finalization failed:', finalErr);
      closeProgressWindow();
      isUpdating = false;
      isCancelingUpdate = false;
      updateDialogOpen = false;
      await dialog.showMessageBox({
        type: 'error',
        title: 'Update Failed',
        message: 'Finalization failed',
        detail: finalErr.message
      });
      return 0;
    }

    updateProgress('Update complete!', 100);
    setTimeout(() => closeProgressWindow(), 1500);

    // Mark update as complete
    isUpdating = false;

    // Auto-restart the app
    setTimeout(() => {
      app.relaunch();
      app.quit();
    }, 2000);

    return 0;
  } catch (error) {
    console.error('Update check failed:', error);
    closeProgressWindow();
    isUpdating = false;
    isCancelingUpdate = false;
    updateDialogOpen = false;
    await dialog.showMessageBox({
      type: 'error',
      title: 'Update Failed',
      message: 'An unexpected error occurred during update',
      detail: error.message
    });
    return 0;
  }
}

// Helper functions
async function getRemoteVersion() {
  const response = await fetch('https://raw.githubusercontent.com/hujingwen1025/WB-App-Store/refs/heads/main/version');
  return (await response.text()).trim();
}

async function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      
      const file = fs.createWriteStream(outputPath);
      
      // Handle cancellation
      const cancelHandler = () => {
        file.destroy();
        request.abort();
        reject(new Error('Download canceled by user'));
      };
      
      // Check for cancellation periodically
      const cancelCheck = setInterval(() => {
        if (isCancelingUpdate) {
          clearInterval(cancelCheck);
          cancelHandler();
        }
      }, 100);
      
      pump(response, file)
        .then(() => {
          clearInterval(cancelCheck);
          resolve();
        })
        .catch((err) => {
          clearInterval(cancelCheck);
          reject(err);
        });
    });
    request.on('error', reject);
    request.end();
  });
}

async function extractZip(zipPath, extractPath) {
    console.log(zipPath, extractPath)
  try {
    // Remove extraction path if it exists to avoid conflicts
    await runCommandAndWait(`rm -rf "${extractPath}"`);
  } catch (err) {
    // Log but ignore errors if path does not exist
    console.warn('Warning: could not remove extraction path:', err);
  }
  await fsPromises.mkdir(extractPath, { recursive: true });
  try {
    await runCommandAndWait(`cd ${extractPath}; unzip ${zipPath}`);
  } catch (err) {
    console.error('extract-zip error:', err);
    throw err;
  }
}

async function moveApp(sourceDir, destPath, appName) {
  const sourcePath = path.join(sourceDir, appName);
  
  // Create destination directory if needed
  await fsPromises.mkdir(path.dirname(destPath), { recursive: true });
  
  // Remove existing app if present - use force remove to ensure complete deletion
  console.log(destPath)
  try {
    await runCommandAndWait(`rm -rf "${destPath}"`);
  } catch (err) {
    console.warn('Warning: could not remove existing app:', err);
  }
  
  // Give the filesystem time to release the directory
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Move new app into place using cp and rm (more reliable than rename on macOS)
  try {
    await runCommandAndWait(`cp -r "${sourcePath}" "${destPath}"`);
    await runCommandAndWait(`rm -rf "${sourcePath}"`);
  } catch (err) {
    // If copy-based approach fails, try rename as fallback
    try {
      await fsPromises.rename(sourcePath, destPath);
    } catch (renameErr) {
      throw new Error(`Failed to move app: ${err.message || renameErr.message}`);
    }
  }
}

async function cleanUpdateFiles(zipPath, extractPath) {
  await fsPromises.rm(zipPath, { recursive: true, force: true });
  await fsPromises.rm(extractPath, { recursive: true, force: true });
}

async function sendInstalledApps() {
    if (!mainWindow) return;
    var rawAppList = await runCommandAndWait(`'${scriptPath}' list`)
    var appList = rawAppList.stdout
    var formattedAppList = appList
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => {
            const match = line.match(/^\d+/);
            return match ? match[0] : null;
        })
        .filter(appId => appId !== null)
    installedApps = formattedAppList
    mainWindow.webContents.send('installedList',  formattedAppList)
}

function extractAppId(url) {
    const parts = url.split('/id');
    return parts[1]?.split('?')[0] || null;
}

function removeAppIds(input) {
    var updateText = input.split('\n')
        .map(line => line.replace(/^\d+\s/, ''))
        .join('\n-\n');
    if (updateText == '' || updateText == '\n' || updateText == undefined) {
        return ''
    }
    return updateText
}

function notifyAppInstalling() {
    if (!mainWindow) return;
    mainWindow.webContents.send('main-message', 'app-installing');
}

function notifyAppUninstalling() {
    if (!mainWindow) return;
    mainWindow.webContents.send('main-message', 'app-uninstalling');
}

async function installMacApp(appId) {
    currentlyInstallingApp = appId
    notifyAppInstalling()
    await runCommandAndWait(`'${scriptPath}' purchase ${appId}`);
    currentlyInstallingApp = ''
    mainWindow.webContents.send('main-message', 'app-installed');
}

async function uninstallMacApp(appId) {
    currentlyUninstallingApp = appId
    notifyAppUninstalling()
    var command = `sudo '${scriptPath}' uninstall ${appId}`
    await runCommandAndWait(`osascript -e "do shell script \\"${command}\\" with administrator privileges"`);
    currentlyUninstallingApp = ''
    mainWindow.webContents.send('main-message', 'app-uninstalled');
}

async function upgradeAllApps() {
    await runCommandAndWait(`'${scriptPath}' upgrade`)
    sendUpgradeComplete()
}

async function sendOutdatedApps() {
    if (!mainWindow) return;
    var rawAppList = await runCommandAndWait(`'${scriptPath}' outdated`)
    var appList = rawAppList.stdout
    var formattedAppList = removeAppIds(appList)
    if (formattedAppList == '') {
        formattedAppList = 'No updates available'
    }
    mainWindow.webContents.send('outdated-app',  formattedAppList)
}

async function sendUpgradeComplete() {
    if (!mainWindow) return;
    mainWindow.webContents.send('main-message', 'upgrade-complete');
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 950,
        preload: path.join(__dirname, 'preload.js'),
        frame: false,
        titleBarStyle: 'hidden',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: true,
            enableRemoteModule: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    //determine is app is installed by app-id
    function isAppInstalled(appId) {
        return installedApps.includes(appId);
    }

      // 1. Prevent navigation away from the initial page
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (navigationUrl.startsWith('macappstore')) {
        if (isAppInstalled(extractAppId(navigationUrl))) {
            uninstallMacApp(extractAppId(navigationUrl));
            event.preventDefault();
        } else {
            installMacApp(extractAppId(navigationUrl));
            event.preventDefault();
        }
    }
  });

    // Load a website (you can change this URL)
    mainWindow.loadURL('https://apps.apple.com/mac/');
    
    // Inject JavaScript after page loads
    mainWindow.webContents.on('did-finish-load', async () => {
        setInterval(async () => {await injectJavaScriptFromFile();}, 750)
    });

    mainWindow.on('closed', () => {
        app.quit()
    })

    // Open DevTools for debugging (optional)
    // mainWindow.webContents.openDevTools();
}

// Read and inject JavaScript from external file
async function injectJavaScriptFromFile() {
    try {
        // Read the injection code from the external file
        const injectionCode = await fsPromises.readFile(
            path.join(__dirname, 'injection.js'), 
            'utf8'
        );
        
        // Execute the JavaScript in the page context
        const result = await mainWindow.webContents.executeJavaScript(injectionCode);
    } catch (error) {
    }
}

function sendCurrentlyModifyingApp() {
    if (!mainWindow) return;
    mainWindow.webContents.send('currently-modifying-app', [currentlyInstallingApp, currentlyUninstallingApp])
}

async function sendInstalledAppsText() {
    if (!mainWindow) return;
    var rawAppList = await runCommandAndWait(`'${scriptPath}' list`)
    var appList = rawAppList.stdout
    var formattedAppList = removeAppIds(appList)
    if (formattedAppList == '') {
        formattedAppList = 'No apps installed'
    }
    mainWindow.webContents.send('installedDisplay', formattedAppList);
}

app.whenReady().then(async () => {
    createWindow()

    setTimeout(() => {checkAppVersion()}, 10000)
    setInterval(() => {
        checkAppVersion()
    }, 60000)

    ipcMain.on('message-to-main', (event, message) => {
      switch (message) {
        case 'get-outdated':
          sendOutdatedApps()
          break;
        case 'upgrade-outdated':
          upgradeAllApps()
          break;
        case 'getInstalledAppsText':
          sendInstalledAppsText()
          break;
        case 'cancel-update':
          isCancelingUpdate = true;
          console.log("Update cancellation requested by user");
          break;
      }
    });
});

app.on('window-all-closed', () => {
  // Always quit the app when all windows are closed, including on macOS (Command+Q)
  app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        // Reset rejected update on new launch
        rejectedUpdateVersion = null;
        createWindow();
        app.clearCache();
        mainWindow.webContents.send('main-message', 'first-launch');
        localStorage.clear()
        const win = BrowserWindow.getAllWindows()[0];
        const ses = win.webContents.session;
        ses.clearCache(() => {
          alert("Cache cleared!");
        });
        setTimeout(() => {
            mainWindow.webContents.send('main-message', 'first-launch');
        }, 5000)
    }
});

setInterval(() => {
    sendInstalledApps();
    sendCurrentlyModifyingApp();
}, 1000);