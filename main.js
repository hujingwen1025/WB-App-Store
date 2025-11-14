const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const resourcesPath = __dirname.replace(/app\.asar$/, '');
const scriptPath = path.join(resourcesPath, 'extraResources', 'mas');

var installedApps = []

let mainWindow;

async function runCommandAndWait(command) {
  try {
    const { stdout, stderr } = await exec(command);
    return { stdout, stderr, success: true };
  } catch (error) {
    console.error('Error executing command:', error);
    return { 
      stdout: error.stdout || '', 
      stderr: error.stderr || error.message, 
      success: false,
      error: error
    };
  }
}

async function sendInstalledApps() {
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

function notifyAppInstalling() {
    mainWindow.webContents.send('main-message', 'app-installing');
}

function notifyAppUninstalling() {
    mainWindow.webContents.send('main-message', 'app-uninstalling');
}

async function installMacApp(appId) {
    notifyAppInstalling()
    await runCommandAndWait(`'${scriptPath}' purchase ${appId}`);
    mainWindow.webContents.send('main-message', 'app-installed');
}

async function uninstallMacApp(appId) {
    notifyAppUninstalling()
    var command = `sudo '${scriptPath}' uninstall ${appId}`

    await runCommandAndWait(`osascript -e "do shell script \\"${command}\\" with administrator privileges"`);
    mainWindow.webContents.send('main-message', 'app-uninstalled');
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        preload: path.join(__dirname, 'preload.js'),
        frame: false,
        titleBarStyle: 'hiddenInset',
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
        await injectJavaScriptFromFile();
    });

    // Open DevTools for debugging (optional)
    // mainWindow.webContents.openDevTools();
}

// Read and inject JavaScript from external file
async function injectJavaScriptFromFile() {
    try {
        // Read the injection code from the external file
        const injectionCode = await fs.readFile(
            path.join(__dirname, 'injection.js'), 
            'utf8'
        );
        
        // Execute the JavaScript in the page context
        const result = await mainWindow.webContents.executeJavaScript(injectionCode);
        console.log('✅ Injection completed successfully');
    } catch (error) {
        console.error('❌ Injection failed:', error);
    }
}

app.whenReady().then(() => {
    createWindow()
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
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
    sendInstalledApps()
}, 1000);