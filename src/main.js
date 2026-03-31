const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sql = require('mssql');
const mysql = require('mysql2/promise');

// --- 1. CONFIGURACIÓN PORTABLE ---
const isDev = !app.isPackaged;
const exeDir = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
const basePath = isDev ? path.join(__dirname, '..') : exeDir;
const dataPath = path.join(basePath, 'data');

if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
}

app.setPath('userData', dataPath);

// --- 2. GESTIÓN DE ESTADOS (Volátil vs Persistente) ---

// A. VOLÁTIL: Esto vive en la RAM. Al cerrar la app, desaparece.
// NUEVO: Mapa de conexiones activas (Max 2: Slot A y Slot B)
const activePools = new Map();
let currentPoolId = null; // Enrutador: Puntero a la conexión activa

// B. PERSISTENTE: Esto vive en un archivo físico en la carpeta /data.
const settingsPath = path.join(dataPath, 'settings.json');

// Función para leer ajustes (si no existe, crea uno vacío por defecto)
function getSettings() {
    if (!fs.existsSync(settingsPath)) {
        const initial = { activeModules: [] };
        fs.writeFileSync(settingsPath, JSON.stringify(initial));
        return initial;
    }
    let rawData = fs.readFileSync(settingsPath, 'utf8');
    // Limpiar BOM (Byte Order Mark) invisible si existe
    if (rawData.charCodeAt(0) === 0xFEFF) {
        rawData = rawData.slice(1);
    }
    return JSON.parse(rawData);
}

// --- GESTIÓN DE PERFILES DE CONEXIÓN CIFRADOS ---
const connectionsPath = path.join(dataPath, 'connections.enc');

// Deriva una clave única por máquina usando el ID del hardware
function getMachineKey() {
    try {
        const { machineIdSync } = require('node-machine-id');
        const id = machineIdSync({ original: true });
        return crypto.createHash('sha256').update(id).digest();
    } catch {
        return crypto.createHash('sha256').update('nexus-fallback-key').digest();
    }
}

function encryptData(data) {
    const key = getMachineKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptData(text) {
    try {
        const key = getMachineKey();
        const [ivHex, encHex] = text.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const encrypted = Buffer.from(encHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return JSON.parse(decrypted.toString('utf8'));
    } catch {
        return [];
    }
}

function getConnections() {
    if (!fs.existsSync(connectionsPath)) return [];
    return decryptData(fs.readFileSync(connectionsPath, 'utf8'));
}

function saveConnections(connections) {
    fs.writeFileSync(connectionsPath, encryptData(connections), 'utf8');
}

// --- 3. COMUNICACIÓN CON EL FRONTEND (IPC Handlers) ---

// Manejador para listar perfiles guardados (sin exponer contraseñas)
ipcMain.handle('get-connections', async () => {
    const conns = getConnections();
    return conns.map(c => ({ id: c.id, name: c.name, engine: c.engine, server: c.server, database: c.database, user: c.user, port: c.port }));
});

// Manejador para guardar un perfil nuevo o actualizar
ipcMain.handle('save-connection', async (event, profile) => {
    try {
        const conns = getConnections();
        const existing = conns.findIndex(c => c.id === profile.id);
        if (existing >= 0) {
            // Si actualizamos y la clave viene vacía (porque estaba oculta), conservamos la original cifrada
            if (!profile.password || profile.password.trim() === '') {
                profile.password = conns[existing].password;
            }
            conns[existing] = profile;
        } else {
            profile.id = Date.now().toString();
            conns.push(profile);
        }
        saveConnections(conns);

        // --- NUEVO: Sincronizar el nombre visual en RAM ---
        if (typeof activePools !== 'undefined') {
            if (currentPoolId && currentPoolId.startsWith('manual_')) {
                const activeConn = activePools.get(currentPoolId);
                if (activeConn) {
                    activeConn.name = profile.name;
                    activeConn.id = profile.id;
                    activePools.set(profile.id, activeConn);
                    activePools.delete(currentPoolId);
                    currentPoolId = profile.id;
                }
            } else if (activePools.has(profile.id)) {
                activePools.get(profile.id).name = profile.name;
            }
        }

        return { success: true };
    } catch (err) {
        console.error("Error backend guardando perfil:", err);
        return { success: false, error: err.message };
    }
});

// Manejador para conectar desde un perfil guardado
ipcMain.handle('connect-from-profile', async (event, id) => {
    if (activePools.size >= 3 && !activePools.has(id)) {
        return { success: false, error: 'Límite de 3 conexiones simultáneas alcanzado.' };
    }
    const conns = getConnections();
    const profile = conns.find(c => c.id === id);
    if (!profile) return { success: false, error: 'Perfil no encontrado.' };

    try {
        let pool;
        if (profile.engine === 'mysql') {
            pool = await mysql.createPool({
                host: profile.server, port: profile.port || 3306,
                database: profile.database || undefined,
                user: profile.user, password: profile.password,
                waitForConnections: true
            });
            const conn = await pool.getConnection();
            conn.release();
        } else {
            const dbConfig = { server: profile.server, user: profile.user, password: profile.password, options: { encrypt: false, trustServerCertificate: true } };
            if (profile.database && profile.database.trim() !== '') dbConfig.database = profile.database.trim();
            pool = await new sql.ConnectionPool(dbConfig).connect();
        }

        if (activePools.has(id)) {
            const oldConn = activePools.get(id);
            if (oldConn.engine === 'mysql') await oldConn.pool.end();
            else await oldConn.pool.close();
        }

        activePools.set(id, { id, engine: profile.engine, pool, name: profile.name });
        if (!currentPoolId) currentPoolId = id;

        return { success: true, profile: { name: profile.name, engine: profile.engine, server: profile.server, database: profile.database } };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Manejador para eliminar un perfil — sin rastro
ipcMain.handle('delete-connection', async (event, id) => {
    let conns = getConnections();
    conns = conns.filter(c => c.id !== id);
    if (conns.length === 0) {
        // Sin perfiles: eliminar el archivo completamente
        if (fs.existsSync(connectionsPath)) fs.unlinkSync(connectionsPath);
    } else {
        saveConnections(conns);
    }
    return { success: true };
});

// Manejador para conectar a SQL (Solo en RAM, no guarda nada)
ipcMain.handle('connect-sql', async (event, config) => {
    if (activePools.size >= 3) {
        return { success: false, error: 'Límite de 3 conexiones simultáneas alcanzado.' };
    }
    const tempId = 'manual_' + Date.now();
    const name = config.name || config.server;

    try {
        let pool;
        if (config.engine === 'mysql') {
            pool = await mysql.createPool({
                host: config.server, port: config.port || 3306,
                database: config.database || undefined,
                user: config.user, password: config.password,
                waitForConnections: true
            });
            const conn = await pool.getConnection();
            conn.release();
        } else {
            const dbConfig = { server: config.server, user: config.user, password: config.password, options: { encrypt: false, trustServerCertificate: true } };
            if (config.database && config.database.trim() !== '') dbConfig.database = config.database.trim();
            pool = await new sql.ConnectionPool(dbConfig).connect();
        }

        activePools.set(tempId, { id: tempId, engine: config.engine, pool, name });
        if (!currentPoolId) currentPoolId = tempId;
        return { success: true, id: tempId };
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

// Manejador para ejecutar consultas SQL (ENRUTADOR INVISIBLE)
ipcMain.handle('execute-sql', async (event, query) => {
    if (!currentPoolId || !activePools.has(currentPoolId)) {
        return { success: false, error: 'No hay conexión activa al motor SQL.' };
    }
    const conn = activePools.get(currentPoolId);
    try {
        if (conn.engine === 'mysql') {
            const [rows] = await conn.pool.query(query);
            return { success: true, data: rows };
        } else {
            const result = await conn.pool.request().query(query);
            return { success: true, data: result.recordset };
        }
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
        icon: path.join(basePath, 'icon', 'NexusIcon.ico'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));
    if (isDev) mainWindow.webContents.openDevTools();
}

// --- NUEVOS HANDLERS PARA GESTIÓN MÚLTIPLE (ENRUTADOR) ---
ipcMain.handle('get-active-pools', () => {
    return {
        pools: Array.from(activePools.values()).map(p => ({ id: p.id, name: p.name, engine: p.engine })),
        currentId: currentPoolId
    };
});

ipcMain.handle('switch-pool', (event, id) => {
    if (activePools.has(id)) { currentPoolId = id; return true; }
    return false;
});

ipcMain.handle('disconnect-pool', async (event, id) => {
    const conn = activePools.get(id);
    if (conn) {
        try {
            if (conn.engine === 'mysql') await conn.pool.end();
            else await conn.pool.close();
        } catch (e) { }
        activePools.delete(id);

        if (currentPoolId === id) {
            const remaining = Array.from(activePools.keys());
            currentPoolId = remaining.length > 0 ? remaining[0] : null;
        }
    }
    return true;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
    // Cierre seguro de todas las conexiones vivas
    for (const conn of activePools.values()) {
        try {
            if (conn.engine === 'mysql') await conn.pool.end();
            else await conn.pool.close();
        } catch (e) { }
    }
    if (process.platform !== 'darwin') app.quit();
});