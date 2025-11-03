const axios = require("axios");
const {
    app,
    BrowserWindow,
    Menu,
    dialog,
    globalShortcut,
    session
} = require('electron');
const fs = require("fs");
const path = require('path');
const DiscordRPC = require('discord-rpc');
let moveResizeTimeout;
let lastBounds;
const oxson = require('./oxson');
const url = `https://moshionline.net`;
let apiData = null;
const settingFile = "../settings.json";

let settings = oxson.readJSON(settingFile);

try {
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
    //app.commandLine.appendSwitch("disable-http-cache");
    app.commandLine.appendSwitch("ignore-certificate-errors");

    let mainWindow;

    async function createWindow() {
        mainWindow = new BrowserWindow({
            useContentSize: true,
            show: true,
            width: settings?.window?.width ?? 1270,
            height: settings?.window?.height ?? 800,
            x: settings?.window?.x ?? 0,
            y: settings?.window?.y ?? 0,
            autoHideMenuBar: true,
            title: "Launching Moshi Online Client...",
            icon: __dirname + '/favicon.ico',
            webPreferences: {
                plugins: true,
                backgroundThrottling: true,
                sandbox: true,
                enableRemoteModule: true,
                webSecurity: true,
                contextIsolation: true,
                nodeIntegration: true,
                audioMuted: settings.muted ?? false
            }

        });


        mainWindow.loadURL(url);

        const menuTemplate = [{
                label: 'View',
                submenu: [{
                        label: 'Zoom In',
                        accelerator: 'CmdOrCtrl+Plus',
                        click: () => {
                            if (mainWindow !== null) {
                                let zoomFactor = mainWindow.webContents.getZoomLevel() + 0.5;
                                updateSettings(zoomFactor, "zoom");
                                mainWindow.webContents.setZoomLevel(zoomFactor);
                            }
                        }
                    },
                    {
                        label: 'Zoom Out',
                        accelerator: 'CmdOrCtrl+-',
                        click: () => {
                            if (mainWindow !== null) {
                                let zoomFactor = mainWindow.webContents.getZoomLevel() - 0.5;
                                updateSettings(zoomFactor, "zoom");
                                mainWindow.webContents.setZoomLevel(zoomFactor);
                            }
                        }
                    },
                    {
                        label: 'Reset Zoom',
                        accelerator: 'CmdOrCtrl+0',
                        click: () => {
                            if (mainWindow !== null) {
                                updateSettings(0, "zoom");
                                mainWindow.webContents.setZoomLevel(0);
                            }
                        }
                    }
                ]
            },
            {
                label: 'Audio',
                submenu: [{
                        label: 'Mute',
                        accelerator: 'CmdOrCtrl+M',
                        click: () => {
                            if (mainWindow !== null) {
                                updateSettings(true, "muted");
                                mainWindow.webContents.setAudioMuted(true);
                            }
                        }
                    },
                    {
                        label: 'Unmute',
                        accelerator: 'CmdOrCtrl+Shift+M',
                        click: () => {
                            if (mainWindow !== null) {
                                updateSettings(false, "muted");
                                mainWindow.webContents.setAudioMuted(false);
                            }
                        }
                    }
                ]
            },
            {
                label: 'Edit',
                submenu: [{
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        if (mainWindow !== null) {
                            mainWindow.reload();
                        }
                    },
                }, ],
            },

            {
                label: 'Settings',
                submenu: [{
                        label: 'Error Reporting',
                        submenu: [{
                                "label": "on",
                                click: () => {
                                    if (mainWindow !== null) {
                                        updateSettings(true, "error_reporting");
                                    }
                                }

                            },
                            {
                                "label": "off",
                                click: () => {
                                    if (mainWindow !== null) {
                                        updateSettings(false, "error_reporting");
                                    }
                                }

                            }
                        ]
                    },
                    {
                        label: 'Discord RPC',
                        submenu: [{
                                "label": "on",
                                click: () => {
                                    if (mainWindow !== null) {
                                        updateSettings(true, "rpc");
                                        dialog.showMessageBox(mainWindow, {
                                            type: 'info',
                                            title: 'Discord RPC',
                                            message: 'Discord RPC has been turned on, reloading. :)',
                                            buttons: ['OK'],
                                        }).then((response) => {
                                            if (response.response === 0) {
                                                app.reload();

                                            }
                                        });

                                    }
                                }

                            },
                            {
                                "label": "off",
                                click: () => {
                                    if (mainWindow !== null) {
                                        updateSettings(false, "rpc");
                                        dialog.showMessageBox(mainWindow, {
                                            type: 'info',
                                            title: 'Discord RPC',
                                            message: 'Discord RPC has been turned off, reloading. :)',
                                            buttons: ['OK'],
                                        }).then((response) => {
                                            if (response.response === 0) {
                                                app.reload();

                                            }
                                        });
                                    }
                                },


                            }
                        ]
                    },
                    {
                        label: 'Update Alerts',
                        submenu: [{
                                "label": "on",
                                click: () => {
                                    if (mainWindow !== null) {
                                        updateSettings(false, "ignore_updates");
                                        dialog.showMessageBox(mainWindow, {
                                            type: 'info',
                                            title: 'Update Alerts',
                                            message: 'Update Alerts are now turned on. :)',
                                            buttons: ['OK', "Undo"],
                                        }).then((response) => {
                                            if (response.response === 1) {
                                                updateSettings(true, "ignore_updates");
                                            }
                                        });

                                    }
                                }

                            },
                            {
                                "label": "off",
                                click: () => {
                                    if (mainWindow !== null) {
                                        updateSettings(true, "ignore_updates");
                                        dialog.showMessageBox(mainWindow, {
                                            type: 'info',
                                            title: 'Update Alerts',
                                            message: 'Update Alerts are now turned off. :)',
                                            buttons: ['OK', "Undo"],
                                        }).then((response) => {
                                            if (response.response === 1) {
                                                updateSettings(false, "ignore_updates");
                                            }
                                        });
                                    }
                                },


                            }
                        ]
                    }
                ]
            },
            {
                label: 'Debug',
                submenu: [{
                        label: 'Clear Cache',
                        click: () => {
                            if (mainWindow !== null) {
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
                            }
                        },
                    },
                    {
                        label: 'Devtools',
                        accelerator: 'CmdOrCtrl+Shift+I',
                        click: () => {
                            if (mainWindow !== null) {
                                mainWindow.webContents.openDevTools();
                                dialog.showMessageBox(mainWindow, {
                                    type: 'warning',
                                    title: 'Warning!',
                                    message: 'Developer Tools are to be used to troubleshoot and report bugs and such to the Moshi Online Team. Any attempts to exploit for benefiticial gain either for yourself or others could lead to a permanent ban on your accounts.',
                                    buttons: ['OK']
                                });
                            }
                        },
                    }
                ]
            }
        ];

        const menu = Menu.buildFromTemplate(menuTemplate);
        Menu.setApplicationMenu(menu);

        mainWindow.webContents.on('context-menu', (e, props) => {
            menu.popup(mainWindow, props.x, props.y);
        });


        try {

            const response = await axios.get(url + "/api?clientInfo", {
                headers: {
                    'Accept': 'application/json'
                },
                timeout: 10000
            });

            if (response.status === 200) {
                apiData = response.data;

            } else {
                dialog.showMessageBox({
                    type: 'error',
                    title: 'Connection Error',
                    detail: 'Could not connect to server :(',
                    message: `Please check your connection.`,
                    buttons: ['OK'],
                });
            }

        } catch (err) {
            dialog.showMessageBox({
                type: 'error',
                title: 'Connection Error',
                detail: 'Could not connect to server :(',
                message: `Please check your connection.`,
                buttons: ['OK'],
            });
        }

        if (apiData.updateAvailable && !settingFile.ignore_updates) {
            dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Update Alert',
                message: 'An update is available!',
                buttons: ['Ignore', "Link", "Don't show again"],
            }).then((response) => {
                if (response.response === 2) {
                    updateSettings(true, "ignore_updates");
                }
                if (response.response === 1) {
                    mainWindow.loadURL(apiData.downloadLink + "&os=" + process.platform + "&arch=" + process.arch);
                }
            });
        }




        mainWindow.webContents.setUserAgent(`Moshi Online Client v${apiData.version}`);
        mainWindow.webContents.setZoomFactor(settings.zoom);
        mainWindow.webContents.executeJavaScript(fs.readFileSync(apiData.clientJS, 'utf8'));

        mainWindow.webContents.on('did-finish-load', (apiData) => {


            if (mainWindow !== null) {
                registerGlobalKeyBinds();
                mainWindow.webContents.executeJavaScript(`
                const script = document.createElement('script');
                script.src = '${apiData.clientJS}';
                script.async = false;
                document.head.appendChild(script);
            `);
            }
        });

        // discord RPC
        if (apiData.discordRPC && settings.rpc) {

            DiscordRPC.register(apiData.clientId);
            const rpc = new DiscordRPC.Client({
                transport: 'ipc'
            });

            const mySession = session.defaultSession;

            async function userStatus() {
                let l = false;
                mySession.cookies.get({
                        url: url
                    })
                    .then((cookies) => {
                        for (let element of cookies) {
                            if (element.name === 'lastUsername') {
                                l = true;
                                username = element.value;
                                break;
                            }
                        }

                        rpc.setActivity({
                            details: `Exploring Monstro city...`,
                            startTimestamp,
                            state: l ? `Logged in as: ${username}` : 'Not logged in',
                            largeImageKey: apiData.imgLogo,
                            buttons: [{
                                "label": "Play now!",
                                "url": url
                            }]
                        })
                    })
            }

            const startTimestamp = new Date();
            rpc.on('ready', async () => {
                userStatus();
                setInterval(() => {
                    userStatus();
                }, 15000);
            });
            rpc.login(apiData.clientId);




        }
        // mainWindow.webContents.session.webRequest.onCompleted({ urls: ['*://moshionline.net/*'] }, (details) => {
        //   if (details.statusCode === 500) {
        //     const { url } = details;
        //     dialog.showMessageBox({
        //       type: 'error',
        //       title: 'Moshi Online Error',
        //       detail: 'Please screenshot this and contact a developer.',
        //       message: `Error: '${url}'`,
        //       buttons: ['OK'],
        //     });
        //   }
        // });

        mainWindow.on('closed', function() {
            mainWindow = null;
            globalShortcut.unregisterAll();

        });

        lastBounds = mainWindow.getBounds();

        const handleChange = () => {

            clearTimeout(moveResizeTimeout);
            moveResizeTimeout = setTimeout(() => {
                const bounds = mainWindow.getContentBounds();
                if (
                    bounds.x !== lastBounds.x ||
                    bounds.y !== lastBounds.y ||
                    bounds.width !== lastBounds.width ||
                    bounds.height !== lastBounds.height
                ) {
                    console.log(bounds);
                    updateSettings(bounds, "window");
                }
            }, 500);
        };
        mainWindow.on('resize', handleChange);
        mainWindow.on('move', handleChange);


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

        mainWindow.on('minimize', () => {
            globalShortcut.unregisterAll();
        });

    }

    const gotTheLock = app.requestSingleInstanceLock()

    if (!gotTheLock) {
        app.quit()
    } else {
        app.whenReady().then(async () => {
            await createWindow();
        })


        app.on('second-instance', () => {
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

        app.on('activate', async function() {
            if (mainWindow === null || BrowserWindow.getAllWindows().length === 0) {
                await createWindow();
            }
        });
    }

    function registerGlobalKeyBinds() {
        globalShortcut.register('CommandOrControl+=', () => {
            const zoomFactor = Math.min(mainWindow.webContents.getZoomFactor() + 0.1, 2.0);
            mainWindow.webContents.setZoomFactor(zoomFactor)
            updateSettings(zoomFactor, "zoom");
        })
        globalShortcut.register('CommandOrControl+-', () => {
            const zoomFactor = Math.max(mainWindow.webContents.getZoomFactor() - 0.1, 0.1);
            updateSettings(zoomFactor, "zoom");
            mainWindow.webContents.setZoomFactor(zoomFactor)
        })
        globalShortcut.register('CommandOrControl+0', () => {
            mainWindow.webContents.setZoomLevel(0);
            updateSettings(0, "zoom")
        })
        globalShortcut.register('CommandOrControl+M', () => {
            mainWindow.webContents.setAudioMuted(true);
            updateSettings(true, "muted");
        });
        globalShortcut.register('CommandOrControl+Shift+M', () => {
            mainWindow.webContents.setAudioMuted(false);
            updateSettings(false, "muted");
        });
        globalShortcut.register('CommandOrControl+Shift+I', () => {
            mainWindow.webContents.openDevTools();
        });
        globalShortcut.register('CommandOrControl+R', () => {
            mainWindow.reload();
        });
        globalShortcut.register('F11', () => {
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
        });
    }
} catch (Exception) {
    app.quit();
    exit();

}

function updateSettings(value, setting) {

    let editFile = oxson.editJSONValue(settingFile, setting, value);

    if (!editFile) {
        dialog.showMessageBox({
            type: 'error',
            title: 'Client Error',
            detail: `Updating user settings`,
            message: `Error updating ${setting} with the value of ${value}`,
            buttons: ['OK'],
        });
    }

    return;

}
