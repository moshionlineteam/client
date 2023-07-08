const {
    app,
    BrowserWindow,
    Menu,
    dialog,
    globalShortcut,
    webFrame
} = require('electron');
const path = require('path');
const UserAgent = require('user-agents');
const userAgent = new UserAgent();
const DiscordRPC = require('discord-rpc');

if (require('electron-squirrel-startup')) {
    app.quit();
}

switch (process.platform) {
    case 'win32':
        switch (process.arch) {
            case 'ia32':
            case 'x32':
                pluginName = 'flash/pepflashplayer32.dll'
                break
            case 'x64':
                pluginName = 'flash/pepflashplayer64.dll'
                break
        }
        break
    case 'linux':
        switch (process.arch) {
            case 'ia32':
            case 'x32':
                pluginName = 'flash/libpepflashplayer.so'
                break
            case 'x64':
                pluginName = 'flash/libpepflashplayer.so'
                break
        }
        app.commandLine.appendSwitch('no-sandbox');
        break
    case 'darwin':
        pluginName = 'flash/PepperFlashPlayer.plugin'
        break
}

app.commandLine.appendSwitch('ppapi-flash-path', path.join(__dirname, pluginName));
app.commandLine.appendSwitch("disable-http-cache");

let mainWindow;

function clearCache() {
    mainWindow.webContents.session.clearCache();
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1270,
        height: 800,
        useContentSize: true,
        show: true,
        autoHideMenuBar: true,
        title: "Launching Moshi Online Client...",
        icon: __dirname + '/favicon.ico',
        webPreferences: {
            plugins: true,
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            backgroundThrottling: false
        }
    });

    // Create a custom menu
    const menuTemplate = [{
        label: 'View',
        submenu: [{
            label: 'Zoom In',
            accelerator: 'CmdOrCtrl+Plus',
            click: () => {
                mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() + 0.5);
            }
        }, {
            label: 'Zoom Out',
            accelerator: 'CmdOrCtrl+-',
            click: () => {
                mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() - 0.5);

            }
        }, {
            label: 'Reset Zoom',
            accelerator: 'CmdOrCtrl+0',
            click: () => {
                mainWindow.webContents.setZoomLevel(0);
            }
        }]
    }, {
        label: 'Audio',
        submenu: [{
            label: 'Mute',
            accelerator: 'CmdOrCtrl+M',
            click: () => {
                mainWindow.webContents.setAudioMuted(true);
            }
        }, {
            label: 'Unmute',
            accelerator: 'CmdOrCtrl+Shift+M',
            click: () => {
                mainWindow.webContents.setAudioMuted(false);
            }
        }]
    }, {
        label: 'Edit',
        submenu: [{
            label: 'Clear Cache',
            click: () => {
                mainWindow.webContents.session.clearCache().then(() => {
                    dialog.showMessageBox(mainWindow, {
                        type: 'info',
                        title: 'Cache Cleared',
                        message: 'The cache has been cleared. Please reopen the app.',
                        buttons: ['OK'],
                    }).then((response) => {
                        if (response.response === 0) {
                            app.quit();
                        }
                    });
                });
            },
        }, {
            label: 'Reload',
            accelerator: 'CmdOrCtrl+R',
            click: () => {
                mainWindow.reload();
            },
        }, ],
    }];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);

    mainWindow.webContents.on('context-menu', (e, props) => {
        menu.popup(mainWindow, props.x, props.y);
    });

    mainWindow.webContents.setUserAgent(userAgent.toString(), "; Moshi Online Client v1.5");

    mainWindow.setMenu(null);
    mainWindow.webContents.session.clearCache();

    mainWindow.loadURL(`https://moshionline.net`);

    // Timeout if the URL never loads.
    const timeoutId = setTimeout(() => {
        const response = dialog.showMessageBoxSync(mainWindow, {
            type: 'error',
            title: 'Timeout',
            message: 'The app took too long to load. Check your internet connection, then reopen the application',
            buttons: ['Close'],
        });

        if (response === 0) {
            app.quit();
        }
    }, 10000);

    mainWindow.webContents.on('did-finish-load', () => {
        clearTimeout(timeoutId);
        registerGlobalKeyBinds();
    });


    const clientId = '1111839940599349259';
    DiscordRPC.register(clientId);
    const rpc = new DiscordRPC.Client({
        transport: 'ipc'
    })

    const startTimestamp = new Date();

    rpc.on('ready', () => {
        rpc.setActivity({
            details: `Playing Moshi Online`,
            startTimestamp,
            state: `Exploring Monstro city...`,
            largeImageKey: `logo2`,
            buttons: [{
                "label": "Play now!",
                "url": "https://moshionline.net"
            }, {
                "label": "Join our Discord!",
                "url": "https://discord.moshionline.net"
            }]
        })
    });
    rpc.login({
        clientId
    }).catch(err => {
        console.log("Could not connect to Discord RPC.");
    });

    mainWindow.on('closed', function() {
        mainWindow = null;
        globalShortcut.unregisterAll();

    });

    mainWindow.on('blur', () => {
        globalShortcut.unregisterAll();
    });

    mainWindow.on('focus', () => {
        registerGlobalKeyBinds();
    });

    mainWindow.on('will-activate', () => {
        registerGlobalKeyBinds();
    });

    mainWindow.on('will-become-inactive', () => {
        globalShortcut.unregisterAll();
    });

}




const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
    app.quit()
} else {
    app.on('ready', createWindow);

    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.focus()
        }
    })

    app.on('will-quit', () => {
        globalShortcut.unregisterAll();
    });

    app.on('window-all-closed', function() {
        if (process.platform !== 'darwin') app.quit();
    });


    app.on('activate', function() {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();

            setInterval(clearCache, 1 * 60 * 60);
        }
    });
}


function registerGlobalKeyBinds() {
    globalShortcut.register('CommandOrControl+=', () => {
        const zoomFactor = Math.min(mainWindow.webContents.getZoomFactor() + 0.1, 2.0);
        mainWindow.webContents.setZoomFactor(zoomFactor)
    })
    globalShortcut.register('CommandOrControl+-', () => {
        const zoomFactor = Math.max(mainWindow.webContents.getZoomFactor() - 0.1, 0.1);
        mainWindow.webContents.setZoomFactor(zoomFactor)
    })
    globalShortcut.register('CommandOrControl+0', () => {
        mainWindow.webContents.setZoomLevel(0);
    })
    globalShortcut.register('CommandOrControl+M', () => {
        mainWindow.webContents.setAudioMuted(true);
    });
    globalShortcut.register('CommandOrControl+Shift+M', () => {
        mainWindow.webContents.setAudioMuted(false);
    });

    globalShortcut.register('CommandOrControl+R', () => {
        mainWindow.reload();
    });
}

function extractUsernameFromCookie(cookie) {
    const nameValuePairs = cookie.split(';');

    for (let i = 0; i < nameValuePairs.length; i++) {
        const [name, value] = nameValuePairs[i].trim().split('=');

        if (name === 'username') {
            return value;
        }
    }

    return null;
}
