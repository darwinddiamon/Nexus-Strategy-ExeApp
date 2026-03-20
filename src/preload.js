const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexusAPI', {
    // 1. Módulos: Listar TODOS los archivos físicos en la carpeta /modules
    listFiles: () => ipcRenderer.invoke('list-files'),

    // 2. Módulos: Marcar como instalado/desinstalado en settings.json
    toggleModule: (fileName, install) => ipcRenderer.invoke('toggle-module', { fileName, install }),

    // 3. Módulos: Obtener la lista de nombres que están marcados como ACTIVOS
    getActiveModules: () => ipcRenderer.invoke('get-active-modules'),

    // 4. SQL: Intentar conexión (Solo vivirá en RAM)
    connectSQL: (config) => ipcRenderer.invoke('connect-sql', config),

    // 5. Utilidad: Leer el contenido (código ofuscado) de un archivo específico
    readModule: (fileName) => ipcRenderer.invoke('read-module', fileName),

    // 6. SQL: Ejecutar una consulta (Requiere haber conectado antes)
    executeSQL: (query) => ipcRenderer.invoke('execute-sql', query)
});