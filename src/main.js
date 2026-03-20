const { app, BrowserWindow, ipcMain } = require('electron'); // Añadimos ipcMain
const path = require('path');
const fs = require('fs');
const sql = require('mssql'); // Motor de SQL

// --- 1. CONFIGURACIÓN PORTABLE ---
const isDev = !app.isPackaged;
const basePath = isDev ? path.join(__dirname, '..') : path.dirname(process.execPath);
const dataPath = path.join(basePath, 'data');

if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
}

app.setPath('userData', dataPath);

// --- 2. GESTIÓN DE ESTADOS (Volátil vs Persistente) ---

// A. VOLÁTIL: Esto vive en la RAM. Al cerrar la app, desaparece.
let sqlPool = null;

// B. PERSISTENTE: Esto vive en un archivo físico en la carpeta /data.
const settingsPath = path.join(dataPath, 'settings.json');

// Función para leer ajustes (si no existe, crea uno vacío por defecto)
function getSettings() {
    if (!fs.existsSync(settingsPath)) {
        const initial = { activeModules: [] };
        fs.writeFileSync(settingsPath, JSON.stringify(initial));
        return initial;
    }
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

// --- 3. COMUNICACIÓN CON EL FRONTEND (IPC Handlers) ---

// Manejador para conectar a SQL (Solo en RAM, no guarda nada)
ipcMain.handle('connect-sql', async (event, config) => {
    try {
        if (sqlPool) await sqlPool.close();
        sqlPool = await sql.connect(config);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Manejador para "Instalar/Desinstalar" módulos (Persistente)
ipcMain.handle('toggle-module', async (event, { fileName, install }) => {
    let settings = getSettings();
    if (install) {
        // Agregamos a la lista si no está
        if (!settings.activeModules.includes(fileName)) settings.activeModules.push(fileName);
    } else {
        // Quitamos de la lista
        settings.activeModules = settings.activeModules.filter(m => m !== fileName);
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return settings.activeModules;
});

// Manejador para ver qué archivos hay en la carpeta /modules
ipcMain.handle('list-files', async () => {
    const modulesPath = path.join(basePath, 'modules');
    if (!fs.existsSync(modulesPath)) return [];
    return fs.readdirSync(modulesPath).filter(f => f.endsWith('.txt') || f.endsWith('.js'));
});

// Obtener solo la lista de nombres que están en settings.json
ipcMain.handle('get-active-modules', async () => {
    const settings = getSettings();
    return settings.activeModules;
});

// Leer el contenido (ofuscado) de un archivo específico
ipcMain.handle('read-module', async (event, fileName) => {
    const filePath = path.join(basePath, 'modules', fileName);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
});

// Manejador para ejecutar consultas SQL
ipcMain.handle('execute-sql', async (event, query) => {
    if (!sqlPool) return { success: false, error: 'No hay conexión activa al motor SQL.' };
    try {
        const result = await sqlPool.request().query(query);
        // Devolvemos solo el recordset (las filas) para no sobrecargar el puente
        return { success: true, data: result.recordset };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// --- 4. CONFIGURACIÓN DE LA VENTANA ---
let mainWindow;
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: "Nexus Strategy CC",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));
    if (isDev) mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

