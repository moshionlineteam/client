const axios = require('axios');
const {
    app,
    BrowserWindow,
    Menu,
    dialog,
    globalShortcut,
    session
} = require('electron');
const path = require('path');
const fs = require('fs');
const DiscordRPC = require('discord-rpc');

const url = 'https://moshionline.net';
const CLIENT_REPORT_ENDPOINT = `${url}/api?sendClientReport`;

const HAR_PAGE_ID = 'page_1';
const HAR_MAX_ENTRIES = 250;
const HAR_SEND_ENTRIES = 120;
const REQUIRED_REPORT_COOKIES = ['sessionId', 'username', 'id'];
const LS_KEYS = {
    zoom: 'mo_client_zoom_level',
    rpcEnabled: 'mo_client_discord_rpc_enabled'
};

let mainWindow = null;
let apiData = null;
let discordRpcEnabled = true;
let moveResizeTimeout;
let lastBounds;
let rpcClient = null;
let rpcInterval = null;
let rpcStartTimestamp = null;
let lastRpcIssue = '';
let networkMonitoringInitialized = false;
let active500Prompt = false;
const recent500PromptByUrl = new Map();
const pendingHarRequests = new Map();
const harEntries = [];

function getPluginName() {
    switch (process.platform) {
        case 'win32':
            if (process.arch === 'ia32' || process.arch === 'x32') {
                return 'flash/pepflashplayer32.dll';
            }
            return 'flash/pepflashplayer64.dll';
        case 'linux':
            return 'flash/libpepflashplayer.so';
        case 'darwin':
            return 'flash/PepperFlashPlayer.plugin';
        default:
            return null;
    }
}

function resolveFlashPluginPath(pluginRelativePath) {
    if (!pluginRelativePath) {
        return null;
    }

    const appPath = app.getAppPath ? app.getAppPath() : __dirname;
    const candidates = [
        path.join(__dirname, pluginRelativePath),
        path.join(__dirname, '..', pluginRelativePath),
        path.join(appPath, pluginRelativePath),
        path.join(appPath, '..', pluginRelativePath),
        path.join(process.cwd(), pluginRelativePath),
        path.join(process.resourcesPath || '', pluginRelativePath),
        path.join(process.resourcesPath || '', 'app.asar.unpacked', pluginRelativePath)
    ];

    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

function resolveWindowIconPath() {
    const platformCandidates = process.platform === 'darwin'
        ? ['icons.icns', 'icon.icns', 'icon.png']
        : process.platform === 'win32'
            ? ['icon.ico', 'icon.png']
            : ['icon.png', 'icon.ico'];

    for (const fileName of platformCandidates) {
        const candidate = path.join(__dirname, '..', fileName);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return undefined;
}

function clampZoomLevel(level) {
    return Math.max(-3, Math.min(level, 3));
}

function isMoshiUrl(targetUrl) {
    try {
        const parsed = new URL(targetUrl);
        return parsed.hostname === 'moshionline.net' || parsed.hostname.endsWith('.moshionline.net');
    } catch (_) {
        return false;
    }
}

function parseQueryString(targetUrl) {
    try {
        const parsed = new URL(targetUrl);
        const queryItems = [];
        for (const [name, value] of parsed.searchParams.entries()) {
            queryItems.push({ name, value });
        }
        return queryItems;
    } catch (_) {
        return [];
    }
}

function sanitizeHeaderValue(name, value) {
    const sensitive = ['cookie', 'set-cookie', 'authorization', 'proxy-authorization'];
    if (sensitive.includes(String(name || '').toLowerCase())) {
        return '[redacted]';
    }
    return value;
}

function headersObjectToHarArray(headersObj) {
    if (!headersObj || typeof headersObj !== 'object') {
        return [];
    }

    const headers = [];
    for (const [name, rawValue] of Object.entries(headersObj)) {
        const value = Array.isArray(rawValue) ? rawValue.join('; ') : String(rawValue);
        headers.push({
            name,
            value: sanitizeHeaderValue(name, value)
        });
    }
    return headers;
}

function recordHarEntry(entry) {
    harEntries.push(entry);
    if (harEntries.length > HAR_MAX_ENTRIES) {
        harEntries.shift();
    }
}

function cleanupPendingHarRequests() {
    const cutoff = Date.now() - 2 * 60 * 1000;
    for (const [requestId, snapshot] of pendingHarRequests.entries()) {
        if (snapshot.startMs < cutoff) {
            pendingHarRequests.delete(requestId);
        }
    }
}

function captureHarRequestStart(details) {
    if (!isMoshiUrl(details.url)) {
        return;
    }

    pendingHarRequests.set(details.id, {
        startMs: Date.now(),
        startedDateTime: new Date().toISOString(),
        method: details.method || 'GET',
        url: details.url,
        requestHeaders: null,
        responseHeaders: null,
        statusLine: ''
    });

    cleanupPendingHarRequests();
}

function captureHarRequestHeaders(details) {
    const snapshot = pendingHarRequests.get(details.id);
    if (!snapshot) {
        return;
    }

    snapshot.requestHeaders = details.requestHeaders || null;
}

function captureHarResponseHeaders(details) {
    const snapshot = pendingHarRequests.get(details.id);
    if (!snapshot) {
        return;
    }

    snapshot.responseHeaders = details.responseHeaders || null;
    snapshot.statusLine = details.statusLine || '';
}

function finalizeHarRequest(details, errorText = '') {
    if (!isMoshiUrl(details.url)) {
        return;
    }

    const snapshot = pendingHarRequests.get(details.id) || {
        startMs: Date.now(),
        startedDateTime: new Date().toISOString(),
        method: details.method || 'GET',
        url: details.url,
        requestHeaders: null,
        responseHeaders: null,
        statusLine: ''
    };
    pendingHarRequests.delete(details.id);

    const elapsedMs = Math.max(0, Date.now() - snapshot.startMs);
    const statusCode = typeof details.statusCode === 'number' ? details.statusCode : 0;
    const statusText = snapshot.statusLine || details.statusLine || errorText || '';
    const responseHeaders = snapshot.responseHeaders || details.responseHeaders || {};

    recordHarEntry({
        pageref: HAR_PAGE_ID,
        startedDateTime: snapshot.startedDateTime,
        time: elapsedMs,
        request: {
            method: snapshot.method || details.method || 'GET',
            url: snapshot.url || details.url,
            httpVersion: 'HTTP/1.1',
            headers: headersObjectToHarArray(snapshot.requestHeaders),
            queryString: parseQueryString(snapshot.url || details.url),
            cookies: [],
            headersSize: -1,
            bodySize: -1
        },
        response: {
            status: statusCode,
            statusText,
            httpVersion: 'HTTP/1.1',
            headers: headersObjectToHarArray(responseHeaders),
            cookies: [],
            content: {
                size: typeof details.encodedDataLength === 'number' ? details.encodedDataLength : 0,
                mimeType: ''
            },
            redirectURL: '',
            headersSize: -1,
            bodySize: typeof details.encodedDataLength === 'number' ? details.encodedDataLength : -1
        },
        cache: {},
        timings: {
            send: 0,
            wait: elapsedMs,
            receive: 0
        }
    });

    if (statusCode === 500) {
        handleMoshi500(details.url);
    }
}

function buildHarPayload(triggerUrl) {
    return {
        log: {
            version: '1.2',
            creator: {
                name: 'Moshi Online Client',
                version: app.getVersion()
            },
            pages: [{
                startedDateTime: new Date(Date.now() - 60 * 1000).toISOString(),
                id: HAR_PAGE_ID,
                title: 'Moshi Online Session',
                pageTimings: {}
            }],
            entries: harEntries.slice(-HAR_SEND_ENTRIES)
        },
        triggerUrl,
        generatedAt: new Date().toISOString()
    };
}

async function getReportCookieState() {
    const cookies = await session.defaultSession.cookies.get({ url });
    const cookieMap = new Map();

    for (const cookie of cookies) {
        cookieMap.set(cookie.name, cookie.value);
    }

    const hasRequiredCookies = REQUIRED_REPORT_COOKIES.every((cookieName) => {
        const value = cookieMap.get(cookieName);
        return typeof value === 'string' && value.trim().length > 0;
    });

    const cookieHeader = cookies
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; ');

    return { hasRequiredCookies, cookieHeader };
}

async function sendClientReport(failedUrl) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    let cookieState;
    try {
        cookieState = await getReportCookieState();
    } catch (_) {
        cookieState = { hasRequiredCookies: false, cookieHeader: '' };
    }

    if (!cookieState.hasRequiredCookies) {
        await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Client Report',
            message: 'You must be logged in before sending a client report.',
            buttons: ['OK']
        });
        return;
    }

    const confirmation = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: 'Send Client Report?',
        message: 'This sends your recent data to the moshi online developers to help trace issues!',
        buttons: ['OK', 'Cancel'],
        defaultId: 0,
        cancelId: 1
    });

    if (confirmation.response !== 0) {
        return;
    }

    const reportPayload = buildHarPayload(failedUrl);
    const clientUserAgent = mainWindow.webContents.getUserAgent();

    try {
        await axios.post(
            CLIENT_REPORT_ENDPOINT,
            {
                payload: reportPayload,
                client: clientUserAgent,
                url: failedUrl
            },
            {
                timeout: 15000,
                headers: {
                    'Content-Type': 'application/json',
                    Cookie: cookieState.cookieHeader
                }
            }
        );

        await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Client Report',
            message: 'Client report sent successfully.',
            buttons: ['OK']
        });
    } catch (error) {
        await dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: 'Client Report',
            message: 'Failed to send client report.',
            detail: error && error.message ? error.message : 'Unknown error',
            buttons: ['OK']
        });
    }
}

async function handleMoshi500(failedUrl) {
    if (!mainWindow || mainWindow.isDestroyed() || !failedUrl) {
        return;
    }

    const now = Date.now();
    const lastPromptTime = recent500PromptByUrl.get(failedUrl) || 0;
    if (now - lastPromptTime < 10000 || active500Prompt) {
        return;
    }

    recent500PromptByUrl.set(failedUrl, now);
    active500Prompt = true;

    try {
        const response = await dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: 'Moshi Online Error',
            message: `Error: '${failedUrl}'`,
            detail: 'Please screenshot this and contact a developer.',
            buttons: ['OK', 'Send Client Report'],
            defaultId: 0,
            cancelId: 0
        });

        if (response.response === 1) {
            await sendClientReport(failedUrl);
        }
    } finally {
        active500Prompt = false;
    }
}

function setupNetworkMonitoring(targetSession) {
    if (networkMonitoringInitialized || !targetSession) {
        return;
    }

    networkMonitoringInitialized = true;

    const filter = { urls: ['*://moshionline.net/*', '*://*.moshionline.net/*'] };

    targetSession.webRequest.onBeforeRequest(filter, (details, callback) => {
        captureHarRequestStart(details);
        callback({});
    });

    targetSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
        captureHarRequestHeaders(details);
        callback({ requestHeaders: details.requestHeaders });
    });

    targetSession.webRequest.onHeadersReceived(filter, (details, callback) => {
        captureHarResponseHeaders(details);
        callback({ responseHeaders: details.responseHeaders });
    });

    targetSession.webRequest.onCompleted(filter, (details) => {
        finalizeHarRequest(details);
    });

    targetSession.webRequest.onErrorOccurred(filter, (details) => {
        finalizeHarRequest(details, details.error || 'Request failed');
    });
}

function getClientUserAgent() {
    const version = apiData && typeof apiData.version === 'string' && apiData.version.trim()
        ? apiData.version.trim()
        : app.getVersion();

    return `Moshi Online Client v${version}`;
}

async function fetchClientInfo() {
    apiData = null;

    try {
        const response = await axios.get(`${url}/api?clientInfo`, {
            headers: { Accept: 'application/json' },
            timeout: 10000,
            responseType: 'text',
            transformResponse: [(data) => data]
        });

        if (response.status === 200 && typeof response.data === 'string' && response.data.trim()) {
            const normalizedRaw = response.data.replace(
                /("clientId"\s*:\s*)([0-9]{15,30})/,
                '$1"$2"'
            );
            const parsed = JSON.parse(normalizedRaw);
            if (parsed && typeof parsed === 'object') {
                apiData = parsed;
            }
        }
    } catch (_) {
        // Continue without client info.
    }
}

async function maybeShowUpdateAlert() {
    if (!mainWindow || mainWindow.isDestroyed() || !apiData || !apiData.updateAvailable || !apiData.downloadLink) {
        return;
    }

    const response = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Alert',
        message: 'An update is available!',
        buttons: ['Ignore', 'Link', "Don't show again"]
    });

    if (response.response === 1) {
        mainWindow.loadURL(`${apiData.downloadLink}&os=${process.platform}&arch=${process.arch}`);
    }
}

async function injectClientScriptIfAvailable() {
    if (!mainWindow || mainWindow.isDestroyed() || !apiData || !apiData.clientJS) {
        return;
    }

    try {
        await mainWindow.webContents.executeJavaScript(
            `(() => {
                const existing = document.querySelector('script[data-mo-client-js="true"]');
                if (existing) {
                    existing.remove();
                }
                const script = document.createElement('script');
                script.src = ${JSON.stringify(apiData.clientJS)};
                script.async = false;
                script.dataset.moClientJs = 'true';
                document.head.appendChild(script);
            })();`
        );
    } catch (_) {
        // ignore injection issues on non-standard pages
    }
}

async function getLocalStorageValue(key) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return null;
    }

    try {
        return await mainWindow.webContents.executeJavaScript(
            `(() => {
                try {
                    return window.localStorage.getItem(${JSON.stringify(key)});
                } catch (_) {
                    return null;
                }
            })();`,
            true
        );
    } catch (_) {
        return null;
    }
}

async function setLocalStorageValue(key, value) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    const serializedValue = value === null || value === undefined ? null : String(value);

    try {
        await mainWindow.webContents.executeJavaScript(
            `(() => {
                try {
                    const key = ${JSON.stringify(key)};
                    const value = ${JSON.stringify(serializedValue)};
                    if (value === null) {
                        window.localStorage.removeItem(key);
                    } else {
                        window.localStorage.setItem(key, value);
                    }
                } catch (_) {}
            })();`,
            true
        );
    } catch (_) {
        // ignore localStorage write failures
    }
}

async function setZoomLevelAndPersist(level) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    const clamped = clampZoomLevel(level);
    mainWindow.webContents.setZoomLevel(clamped);
    await setLocalStorageValue(LS_KEYS.zoom, clamped);
}

async function changeZoom(delta) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    const currentZoom = mainWindow.webContents.getZoomLevel();
    await setZoomLevelAndPersist(currentZoom + delta);
}

async function applyPreferencesFromLocalStorage() {
    const storedZoom = await getLocalStorageValue(LS_KEYS.zoom);
    if (storedZoom !== null) {
        const parsed = Number(storedZoom);
        if (Number.isFinite(parsed)) {
            mainWindow.webContents.setZoomLevel(clampZoomLevel(parsed));
        }
    } else {
        await setLocalStorageValue(LS_KEYS.zoom, mainWindow.webContents.getZoomLevel());
    }

    const storedRpcEnabled = await getLocalStorageValue(LS_KEYS.rpcEnabled);
    if (storedRpcEnabled === null) {
        await setLocalStorageValue(LS_KEYS.rpcEnabled, discordRpcEnabled ? 'true' : 'false');
    } else {
        discordRpcEnabled = storedRpcEnabled === 'true';
    }

    buildAppMenu();
    await syncDiscordRpcState();
}

function stopDiscordRpc() {
    if (rpcInterval) {
        clearInterval(rpcInterval);
        rpcInterval = null;
    }

    if (rpcClient) {
        try {
            rpcClient.clearActivity();
        } catch (_) {}

        try {
            rpcClient.destroy();
        } catch (_) {}

        rpcClient = null;
    }

    rpcStartTimestamp = null;
}

function getRpcConfig() {
    const source = apiData && typeof apiData.clientInfo === 'object'
        ? apiData.clientInfo
        : apiData;
    if (!source || typeof source !== 'object') {
        return null;
    }

    const serverEnabled = source.discordRPC === true;
    const clientId = source.clientId === undefined || source.clientId === null
        ? null
        : String(source.clientId).trim();
    const imageKey = typeof source.imgLogo === 'string' ? source.imgLogo.trim() : '';

    return {
        serverEnabled,
        clientId: clientId || null,
        imageKey
    };
}

function setRpcIssue(message) {
    if (!message) {
        lastRpcIssue = '';
        return;
    }

    if (lastRpcIssue !== message) {
        console.warn(message);
        lastRpcIssue = message;
    }
}

async function updateDiscordActivity() {
    if (!rpcClient) {
        return;
    }

    const rpcConfig = getRpcConfig();
    if (!rpcConfig) {
        return;
    }
    const { imageKey } = rpcConfig;

    let username = null;
    try {
        const cookies = await session.defaultSession.cookies.get({ url });
        for (const cookie of cookies) {
            if (cookie.name === 'lastUsername') {
                username = cookie.value;
                break;
            }
        }
    } catch (_) {}

    try {
        const activity = {
            details: 'Exploring Monstro city...',
            startTimestamp: rpcStartTimestamp,
            state: username ? `Logged in as: ${username}` : 'Not logged in',
            buttons: [{
                label: 'Play now!',
                url
            }]
        };

        if (imageKey) {
            activity.largeImageKey = imageKey;
        }

        rpcClient.setActivity(activity);
    } catch (error) {
        console.warn('Discord RPC activity update failed:', error && error.message ? error.message : error);
    }
}

async function startDiscordRpc() {
    if (!discordRpcEnabled || rpcClient) {
        return;
    }

    const rpcConfig = getRpcConfig();
    if (!rpcConfig) {
        setRpcIssue('Discord RPC disabled: missing clientInfo payload.');
        return;
    }

    const { serverEnabled, clientId } = rpcConfig;
    if (!serverEnabled) {
        setRpcIssue('Discord RPC disabled by clientInfo.discordRPC.');
        return;
    }
    if (!clientId) {
        setRpcIssue('Discord RPC disabled: clientInfo.clientId is missing.');
        return;
    }

    try {
        setRpcIssue('');
        DiscordRPC.register(clientId);
        rpcClient = new DiscordRPC.Client({ transport: 'ipc' });
        rpcStartTimestamp = new Date();

        rpcClient.on('ready', () => {
            updateDiscordActivity();
            rpcInterval = setInterval(updateDiscordActivity, 15000);
        });

        rpcClient.on('error', (error) => {
            console.warn('Discord RPC client error:', error && error.message ? error.message : error);
        });

        rpcClient.login({ clientId }).catch((error) => {
            console.warn('Discord RPC login failed:', error && error.message ? error.message : error);
            stopDiscordRpc();
        });
    } catch (error) {
        console.warn('Discord RPC start failed:', error && error.message ? error.message : error);
        stopDiscordRpc();
    }
}

async function syncDiscordRpcState() {
    const rpcConfig = getRpcConfig();
    if (!rpcConfig) {
        stopDiscordRpc();
        return;
    }

    if (discordRpcEnabled && rpcConfig.serverEnabled) {
        await startDiscordRpc();
        return;
    }

    stopDiscordRpc();
}

async function setDiscordRpcEnabled(enabled, showMessage = false) {
    discordRpcEnabled = !!enabled;
    await setLocalStorageValue(LS_KEYS.rpcEnabled, discordRpcEnabled ? 'true' : 'false');
    buildAppMenu();
    await syncDiscordRpcState();

    if (showMessage && mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Discord RPC',
            message: `Discord RPC is now ${discordRpcEnabled ? 'enabled' : 'disabled'}.`,
            buttons: ['OK']
        });
    }
}

function buildAppMenu() {
    const menuTemplate = [{
            label: 'View',
            submenu: [{
                    label: 'Zoom In',
                    accelerator: 'CmdOrCtrl+Plus',
                    click: () => {
                        if (mainWindow) {
                            changeZoom(0.5);
                        }
                    }
                },
                {
                    label: 'Zoom Out',
                    accelerator: 'CmdOrCtrl+-',
                    click: () => {
                        if (mainWindow) {
                            changeZoom(-0.5);
                        }
                    }
                },
                {
                    label: 'Reset Zoom',
                    accelerator: 'CmdOrCtrl+0',
                    click: () => {
                        if (mainWindow) {
                            setZoomLevelAndPersist(0);
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
                        if (mainWindow) {
                            mainWindow.webContents.setAudioMuted(true);
                        }
                    }
                },
                {
                    label: 'Unmute',
                    accelerator: 'CmdOrCtrl+Shift+M',
                    click: () => {
                        if (mainWindow) {
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
                    if (mainWindow) {
                        mainWindow.reload();
                    }
                }
            }]
        },
        {
            label: 'Settings',
            submenu: [{
                    label: 'Discord RPC Enabled',
                    type: 'checkbox',
                    checked: discordRpcEnabled,
                    click: (menuItem) => {
                        setDiscordRpcEnabled(menuItem.checked, true);
                    }
                },
                {
                    label: 'Update Alerts',
                    submenu: [{
                            label: 'on',
                            click: () => {
                                if (mainWindow) {
                                    dialog.showMessageBox(mainWindow, {
                                        type: 'info',
                                        title: 'Update Alerts',
                                        message: 'Update Alerts are now turned on. :)',
                                        buttons: ['OK', 'Undo']
                                    });
                                }
                            }
                        },
                        {
                            label: 'off',
                            click: () => {
                                if (mainWindow) {
                                    dialog.showMessageBox(mainWindow, {
                                        type: 'info',
                                        title: 'Update Alerts',
                                        message: 'Update Alerts are now turned off. :)',
                                        buttons: ['OK', 'Undo']
                                    });
                                }
                            }
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
                        if (mainWindow) {
                            mainWindow.webContents.session.clearCache().then(() => {
                                dialog.showMessageBox(mainWindow, {
                                    type: 'info',
                                    title: 'Cache Cleared',
                                    message: 'The cache has been cleared. Please reopen the app.',
                                    buttons: ['OK']
                                }).then((response) => {
                                    if (response.response === 0) {
                                        app.quit();
                                    }
                                });
                            });
                        }
                    }
                },
                {
                    label: 'Devtools',
                    accelerator: 'CmdOrCtrl+Shift+I',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.openDevTools();
                            dialog.showMessageBox(mainWindow, {
                                type: 'warning',
                                title: 'Warning!',
                                message: 'Developer Tools are to be used to troubleshoot and report bugs and such to the Moshi Online Team. Any attempts to exploit for beneficial gain either for yourself or others could lead to a permanent ban on your accounts.',
                                buttons: ['OK']
                            });
                        }
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);
}

async function createWindow() {
    mainWindow = new BrowserWindow({
        useContentSize: true,
        show: true,
        width: 1270,
        height: 800,
        autoHideMenuBar: true,
        title: 'Launching Moshi Online Client...',
        icon: resolveWindowIconPath(),
        webPreferences: {
            plugins: true,
            backgroundThrottling: true,
            sandbox: true,
            enableRemoteModule: true,
            webSecurity: true,
            contextIsolation: true,
            nodeIntegration: true,
            audioMuted: false
        }
    });

    buildAppMenu();

    mainWindow.webContents.on('context-menu', (e, props) => {
        const menu = Menu.getApplicationMenu();
        if (menu) {
            menu.popup({
                window: mainWindow,
                x: props.x,
                y: props.y
            });
        }
    });

    setupNetworkMonitoring(mainWindow.webContents.session);

    await fetchClientInfo();
    mainWindow.webContents.setUserAgent(getClientUserAgent());
    mainWindow.loadURL(url);
    await maybeShowUpdateAlert();

    mainWindow.webContents.on('did-finish-load', async () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
            return;
        }

        registerGlobalKeyBinds();
        await applyPreferencesFromLocalStorage();
        await injectClientScriptIfAvailable();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        globalShortcut.unregisterAll();
        stopDiscordRpc();
    });

    lastBounds = mainWindow.getBounds();

    const handleChange = () => {
        clearTimeout(moveResizeTimeout);
        moveResizeTimeout = setTimeout(() => {
            if (!mainWindow || mainWindow.isDestroyed()) {
                return;
            }

            const bounds = mainWindow.getContentBounds();
            if (
                bounds.x !== lastBounds.x ||
                bounds.y !== lastBounds.y ||
                bounds.width !== lastBounds.width ||
                bounds.height !== lastBounds.height
            ) {
                lastBounds = bounds;
            }
        }, 500);
    };

    mainWindow.on('resize', handleChange);
    mainWindow.on('move', handleChange);
    mainWindow.on('blur', () => globalShortcut.unregisterAll());
    mainWindow.on('focus', () => registerGlobalKeyBinds());
    mainWindow.on('will-activate', () => registerGlobalKeyBinds());
    mainWindow.on('will-become-inactive', () => globalShortcut.unregisterAll());
    mainWindow.on('minimize', () => globalShortcut.unregisterAll());
}

function registerGlobalKeyBinds() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    globalShortcut.register('CommandOrControl+=', () => {
        changeZoom(0.1);
    });

    globalShortcut.register('CommandOrControl+-', () => {
        changeZoom(-0.1);
    });

    globalShortcut.register('CommandOrControl+0', () => {
        setZoomLevelAndPersist(0);
    });

    globalShortcut.register('CommandOrControl+M', () => {
        mainWindow.webContents.setAudioMuted(true);
    });

    globalShortcut.register('CommandOrControl+Shift+M', () => {
        mainWindow.webContents.setAudioMuted(false);
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

try {
    if (require('electron-squirrel-startup')) {
        app.quit();
    }

    const pluginName = getPluginName();
    const flashPluginPath = resolveFlashPluginPath(pluginName);

    if (process.platform === 'linux') {
        app.commandLine.appendSwitch('no-sandbox');
    }

    if (flashPluginPath) {
        app.commandLine.appendSwitch('ppapi-flash-path', flashPluginPath);
        app.commandLine.appendSwitch('ppapi-flash-version', '32.0.0.465');
        app.commandLine.appendSwitch('enable-plugins');
    } else {
        console.warn('Flash plugin not found; checked multiple paths.');
    }

    app.commandLine.appendSwitch('ignore-certificate-errors');

    const gotTheLock = app.requestSingleInstanceLock();

    if (!gotTheLock) {
        app.quit();
    } else {
        app.whenReady().then(async () => {
            const appIconPath = resolveWindowIconPath();
            if (process.platform === 'darwin' && app.dock && typeof app.dock.setIcon === 'function' && appIconPath) {
                app.dock.setIcon(appIconPath);
            }
            await createWindow();
        });

        app.on('second-instance', () => {
            if (mainWindow) {
                if (mainWindow.isMinimized()) {
                    mainWindow.restore();
                }
                mainWindow.focus();
            }
        });

        app.on('will-quit', () => {
            globalShortcut.unregisterAll();
            stopDiscordRpc();
        });

        app.on('window-all-closed', () => {
            if (process.platform !== 'darwin') {
                app.quit();
            }
        });

        app.on('activate', async () => {
            if (mainWindow === null || BrowserWindow.getAllWindows().length === 0) {
                await createWindow();
            }
        });
    }
} catch (_) {
    app.quit();
}
