window.NexusModuleMeta = {
  icon: 'terminal',
  color: 'bg-slate-600',
  title: 'Nexus Query Builder'
};
window.NexusActiveModule = ({
  React,
  useState,
  useEffect,
  ui,
  utils,
  db,
  goHome
}) => {
  const {
    Icon,
    Toast
  } = ui;
  const {
    addToast
  } = utils;

  // --- UTILIDAD UNIVERSAL: Rescatador y Formateador de Base de Datos ---
  const formatTable = (input, defaultDb = '') => {
    if (!input) return '';
    const parts = input.trim().split(/\s+/);
    const alias = parts.length > 1 ? ` ${parts.pop()}` : '';
    const tablePath = parts.join('');
    if (tablePath.includes('..')) {
      const formattedPath = tablePath.split('.').map(part => part.trim() ? `[${part.trim().replace(/\[|\]/g, '')}]` : '').join('.');
      return formattedPath + alias;
    }
    const safeTable = `[${tablePath.replace(/\[|\]/g, '')}]`;
    if (defaultDb) {
      const safeDb = `[${defaultDb.replace(/\[|\]/g, '')}]`;
      return `${safeDb}..${safeTable}${alias}`;
    }
    return safeTable + alias;
  };

  // --- UTILIDAD: Mes de carga actual en formato MARZO_26 ---
  const getNexusDate = () => {
    const d = new Date();
    const months = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
    return `${months[d.getMonth()]}_${d.getFullYear().toString().substr(-2)}`;
  };

  // --- UTILIDAD: Exportar a Excel XLSX (binario limpio, sin falsos vacíos) ---
  // Misma técnica que Procesos Vetec: elimina columnas vacías, recorta trailing rows
  // y omite celdas sin valor para que no pesen en el XML interno del archivo.
  const crearSheetLimpio = dataArray => {
    if (!dataArray || dataArray.length === 0) return {
      ws: null,
      headers: [],
      cleanData: []
    };
    const allCols = Object.keys(dataArray[0]).filter(k => !k.startsWith('__EMPTY'));

    // Detectar última fila con algún valor real
    let lastRow = -1;
    for (let i = dataArray.length - 1; i >= 0; i--) {
      if (Object.values(dataArray[i]).some(v => v !== '' && v !== null && v !== undefined)) {
        lastRow = i;
        break;
      }
    }
    if (lastRow === -1) return {
      ws: null,
      headers: [],
      cleanData: []
    };
    const trimmedRows = dataArray.slice(0, lastRow + 1);

    // Eliminar columnas que estén completamente vacías en todo el dataset
    const headers = allCols.filter(col => trimmedRows.some(r => r[col] !== '' && r[col] !== null && r[col] !== undefined));

    // Construir filas sin propiedades vacías (celda inexistente = cero bytes en XML)
    const cleanData = trimmedRows.map(r => {
      const n = {};
      headers.forEach(h => {
        if (r[h] !== '' && r[h] !== null && r[h] !== undefined) n[h] = r[h];
      });
      return n;
    });
    const ws = window.XLSX.utils.json_to_sheet(cleanData, {
      header: headers
    });

    // Fijar rango explícito para que Excel no lea más allá de los datos
    if (cleanData.length > 0) {
      const endCol = window.XLSX.utils.encode_col(headers.length - 1);
      ws['!ref'] = `A1:${endCol}${cleanData.length + 1}`;
    }
    return {
      ws,
      headers,
      cleanData
    };
  };
  const exportToXLSX = async (data, filename) => {
    if (!data || !data.length) return;
    try {
      if (!window.XLSX) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const {
        ws,
        cleanData
      } = crearSheetLimpio(data);
      if (!ws) {
        addToast('Sin datos para exportar.', 'info');
        return;
      }
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, 'Datos');
      window.XLSX.writeFile(wb, `${filename.replace(/[^a-z0-9]/gi, '_').toUpperCase()}.xlsx`);
    } catch (e) {
      addToast('Error exportando XLSX: ' + e.message, 'error');
    }
  };

  // --- UTILIDAD: Log de estrategias por campaña ---
  // Usa db (API de Nexus) si está disponible, fallback a localStorage
  const STRATEGY_LOG_KEY = 'nexus_strategy_log';
  const getStrategyLog = () => {
    try {
      // db.getAll es async — para uso síncrono en render usamos localStorage como caché local
      return JSON.parse(localStorage.getItem(STRATEGY_LOG_KEY) || '{}');
    } catch {
      return {};
    }
  };
  const saveStrategyLog = async (campaign, params) => {
    if (!campaign) return;
    const log = getStrategyLog();
    const entry = {
      ...params,
      _camps: undefined,
      _campsLoading: undefined,
      savedAt: new Date().toISOString()
    };
    log[campaign] = entry;
    localStorage.setItem(STRATEGY_LOG_KEY, JSON.stringify(log));
    // Si Nexus expone db.set, persistir también ahí
    if (db && typeof db.set === 'function') {
      try {
        await db.set(STRATEGY_LOG_KEY, log);
      } catch (e) {/* silencioso, ya está en localStorage */}
    }
  };
  const deleteStrategyLog = campaign => {
    const log = getStrategyLog();
    delete log[campaign];
    localStorage.setItem(STRATEGY_LOG_KEY, JSON.stringify(log));
    if (db && typeof db.set === 'function') {
      try {
        db.set(STRATEGY_LOG_KEY, log);
      } catch (e) {}
    }
  };

  // --- COMPONENTE UNIVERSAL: Asistente de Entorno Corporativo (Vocalcom) ---
  const CampaignAutoFiller = ({
    update,
    onColumnsMapped
  }) => {
    const [campaigns, setCampaigns] = useState([]);
    const [loading, setLoading] = useState(false);
    const [isConnected, setIsConnected] = useState(!!window.nexusAPI);
    const loadCampaigns = () => {
      const checkConn = !!window.nexusAPI;
      setIsConnected(checkConn);
      if (!checkConn) return;
      setLoading(true);
      const query = `
                SELECT 
                    CampaignId AS CampaignName,
                    customerId AS CustomerID,
                    Base AS CustomerDB,
                    Name AS CallFileName
                FROM HN_Admin..ListCallFiles
                WHERE CampaignId IS NOT NULL AND CampaignId <> ''
                ORDER BY CampaignId ASC
            `;
      window.nexusAPI.executeSQL(query).then(r => {
        if (r.success && r.data) setCampaigns(r.data);
      }).catch(e => console.error("Error cargando campañas:", e)).finally(() => setLoading(false));
    };
    useEffect(() => {
      if (isConnected && campaigns.length === 0) loadCampaigns();
    }, []);
    const handleSelect = async e => {
      const val = e.target.value;
      if (!val) return;
      const camp = campaigns.find(c => c.CampaignName === val);
      if (!camp) return;
      const clientTable = `CLIENTE_${camp.CampaignName}`;
      const mgmtTable = `C${camp.CustomerID}_${camp.CallFileName}`;
      update({
        campaign: camp.CampaignName,
        customerId: camp.CustomerID ? camp.CustomerID.toString() : '1',
        customerDb: camp.CustomerDB || '',
        clientTable,
        mgmtTable
      });

      // Mapeo silencioso de columnas: dos queries independientes, una por tabla
      if (window.nexusAPI && onColumnsMapped) {
        try {
          const dbPfx = camp.CustomerDB ? `[${camp.CustomerDB}]..` : '';
          // SELECT TOP 1 para forzar que SQL Server devuelva metadata de columnas en r.data[0]
          const [rA, rB] = await Promise.all([window.nexusAPI.executeSQL(`SELECT TOP 1 * FROM ${dbPfx}[${clientTable}]`).catch(() => null), window.nexusAPI.executeSQL(`SELECT TOP 1 * FROM ${dbPfx}[${mgmtTable}]`).catch(() => null)]);
          const colsA = rA && rA.success && rA.data && rA.data.length > 0 ? Object.keys(rA.data[0]) : [];
          const colsB = rB && rB.success && rB.data && rB.data.length > 0 ? Object.keys(rB.data[0]) : [];
          // Unión deduplicada para el buscador general, preservando orden A luego B
          const allCols = [...colsA, ...colsB.filter(c => !colsA.includes(c))];
          onColumnsMapped(allCols, camp.CampaignName, colsA, colsB, clientTable, mgmtTable, camp.CustomerDB || '');
        } catch (e) {/* silencioso */}
      }
    };
    if (!isConnected) {
      return /*#__PURE__*/React.createElement("div", {
        style: {
          background: '#FEF2F2',
          padding: '0.8rem 1rem',
          borderRadius: '8px',
          border: '1px dashed #FCA5A5',
          marginBottom: '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '0.75rem',
          color: '#EF4444',
          fontWeight: 'bold'
        }
      }, "\u26A0\uFE0F Sin conexi\xF3n. Con\xE9ctese a SQL y presione Actualizar."), /*#__PURE__*/React.createElement("button", {
        style: {
          padding: '4px 12px',
          background: '#EF4444',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          fontSize: '0.75rem',
          fontWeight: 'bold',
          cursor: 'pointer'
        },
        onClick: loadCampaigns,
        disabled: loading
      }, loading ? '⏳' : '🔄', " Actualizar"));
    }
    return /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#F8FAFC',
        padding: '1rem',
        borderRadius: '8px',
        border: '1px solid #CBD5E1',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
        marginBottom: '1.5rem',
        boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.8rem',
        fontWeight: 'bold',
        color: '#334155',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        textTransform: 'uppercase',
        letterSpacing: '0.05em'
      }
    }, /*#__PURE__*/React.createElement(ui.Icon, {
      name: "layers",
      size: 16
    }), " Asistente de Entorno"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("select", {
      className: "input",
      onChange: handleSelect,
      value: "",
      style: {
        flex: 1,
        borderColor: '#94A3B8',
        background: 'white',
        fontWeight: 'bold',
        color: '#0F172A',
        cursor: 'pointer'
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "-- Seleccione una Campa\xF1a para auto-completar par\xE1metros --"), loading && /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "\u23F3 Consultando bases del sistema..."), campaigns.map((c, i) => /*#__PURE__*/React.createElement("option", {
      key: i,
      value: c.CampaignName
    }, c.CampaignName))), /*#__PURE__*/React.createElement("button", {
      style: {
        padding: '0.7rem',
        background: '#E2E8F0',
        color: '#334155',
        border: '1px solid #CBD5E1',
        borderRadius: '6px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '42px',
        flexShrink: 0
      },
      onClick: loadCampaigns,
      disabled: loading,
      title: "Actualizar lista de campa\xF1as"
    }, loading ? '⏳' : '🔄')));
  };

  // --- COMPONENTE ESTABLE: Selector de columna con fallback a escritura libre ---
  // CRÍTICO: definido fuera de renderForm para que React no lo remonte en cada render
  // (si se define dentro, cada tecla causa desmount+mount = pérdida de foco).
  // Recibe colsForSource como prop en lugar de leer del closure.
  const ColumnFieldComponent = ({
    value,
    colsForSource,
    onChange,
    placeholder
  }) => {
    const cols = colsForSource || [];
    const [manualMode, setManualMode] = React.useState(false);
    const isCustom = value && !cols.includes(value);
    if (cols.length > 0 && !manualMode && !isCustom) {
      return /*#__PURE__*/React.createElement("div", {
        style: {
          position: 'relative'
        }
      }, /*#__PURE__*/React.createElement("select", {
        className: "input input-code",
        style: {
          fontSize: '0.8rem',
          padding: '0.4rem',
          color: value ? '#0F172A' : '#94A3B8'
        },
        value: value || '',
        onChange: e => {
          if (e.target.value === '__manual__') {
            setManualMode(true);
            return;
          }
          onChange(e.target.value);
        }
      }, /*#__PURE__*/React.createElement("option", {
        value: "",
        style: {
          color: '#94A3B8'
        }
      }, "-- ", placeholder || 'Seleccionar campo', " --"), cols.map((c, ci) => /*#__PURE__*/React.createElement("option", {
        key: ci,
        value: c
      }, c)), /*#__PURE__*/React.createElement("option", {
        value: "__manual__"
      }, "\u270F\uFE0F Escribir campo manualmente...")));
    }
    // Modo edición libre: ya sea por elección, o porque el valor actual no está en la lista
    return /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'relative',
        display: 'flex',
        gap: '0.3rem'
      }
    }, /*#__PURE__*/React.createElement("input", {
      className: "input input-code",
      style: {
        fontSize: '0.8rem',
        padding: '0.4rem',
        flex: 1,
        borderColor: isCustom || manualMode ? '#F59E0B' : undefined,
        background: isCustom || manualMode ? '#FFFBEB' : undefined
      },
      placeholder: placeholder || 'Campo',
      value: value,
      onChange: e => onChange(e.target.value),
      autoFocus: manualMode
    }), cols.length > 0 && /*#__PURE__*/React.createElement("button", {
      className: "btn",
      style: {
        padding: '0 0.4rem',
        fontSize: '0.7rem',
        background: '#E2E8F0',
        color: '#475569',
        border: '1px solid #CBD5E1',
        flexShrink: 0
      },
      onClick: () => {
        setManualMode(false);
        onChange('');
      },
      title: "Volver al selector"
    }, "\u21A9"));
  };

  // =================================================================================================
  // [BLOQUE 1] LIBRERÍA MAESTRA DE QUERYS
  // =================================================================================================
  const QUERY_LIBRARY = {
    // --- MÓDULO 1: HISTÓRICO VOCALCOM ---
    'vocalcom_hist': {
      meta: {
        icon: 'phone-call',
        label: 'Histórico Vocalcom',
        desc: 'Genera extracciones uniendo ODCalls (Vivo) + Backups Anuales según estrategia.'
      },
      defaultParams: {
        fechaInicio: new Date().toISOString().split('T')[0],
        fechaFin: new Date().toISOString().split('T')[0],
        customerId: '1',
        campaign: '',
        customerDb: '',
        clientTable: 'CLIENTE_',
        backupMode: 'auto',
        customCols: 'RUT,\nMONTO,\nTEL_1',
        selectedCols: [],
        // columnas elegidas desde el panel mapeado
        mappedColsHist: [],
        // columnas disponibles de la tabla Cliente
        sortOrder: 'DESC',
        dedup: 'none',
        filterStatus: '',
        filterAgent: ''
      },
      generateSQL: params => {
        const currentYear = new Date().getFullYear();
        const startYear = parseInt(params.fechaInicio.split('-')[0]);
        const endYear = parseInt(params.fechaFin.split('-')[0]);
        let targetYears = new Set();
        if (params.backupMode === 'auto') {
          for (let y = startYear; y <= endYear; y++) targetYears.add(y);
        } else if (params.backupMode === 'current') {
          targetYears.add(currentYear);
        } else if (params.backupMode === 'current_prev') {
          targetYears.add(currentYear);
          targetYears.add(currentYear - 1);
        }
        let unionParts = [];
        unionParts.push(`\n  -- Datos recientes (Vivos)\n  SELECT a.* FROM hn_ondata..ODCalls a\n  WHERE a.FirstCampaign = @Campaign\n    AND a.CallLocalTime >= @FechaInicio\n    AND a.CallLocalTime <  DATEADD(day, 1, @FechaFin)\n    AND a.CallStatusNum IS NOT NULL AND a.CallStatusNum <> 0`);
        Array.from(targetYears).sort((a, b) => b - a).forEach(year => {
          unionParts.push(`\n  -- Respaldo Año ${year}\n  SELECT a.* FROM BackupOnData..ODCalls_${year} a\n  WHERE a.FirstCampaign = @Campaign\n    AND a.CallLocalTime >= @FechaInicio\n    AND a.CallLocalTime <  DATEADD(day, 1, @FechaFin)\n    AND a.CallStatusNum IS NOT NULL AND a.CallStatusNum <> 0`);
        });
        const statusList = (params.filterStatus || '').split(',').map(s => s.trim()).filter(s => s && !isNaN(s));
        const agentList = (params.filterAgent || '').split(',').map(s => s.trim()).filter(s => s && !isNaN(s));
        const statusFilter = statusList.length > 0 ? `\n    AND a.CallStatusNum IN (${statusList.join(', ')})` : '';
        const agentFilter = agentList.length > 0 ? `\n    AND a.FirstAgent IN (${agentList.join(', ')})` : '';
        unionParts = unionParts.map(part => part + statusFilter + agentFilter);
        // Usar columnas del panel mapeado si existen, si no el textarea legacy
        const colSource = params.selectedCols && params.selectedCols.length > 0 ? params.selectedCols : params.customCols.split(/[\n,]+/).map(c => c.trim()).filter(c => c);
        const cols = colSource.map(c => `\tb.${c}`).join(',\n');
        const needsDedup = params.dedup === 'first' || params.dedup === 'last';
        const dedupOrder = params.dedup === 'last' ? 'DESC' : 'ASC';
        const dedupCTE = needsDedup ? `\nDeduped AS (\n  SELECT *,\n    ROW_NUMBER() OVER (PARTITION BY indice ORDER BY CallLocalTime ${dedupOrder}) AS _rn\n  FROM Calls\n),` : '';
        const fromClause = needsDedup ? 'Deduped' : 'Calls';
        const dedupWhere = needsDedup ? '\nAND a._rn = 1' : '';
        const commentStatus = statusList.length > 0 ? `\n-- Filtro estados: ${statusList.join(', ')}` : '';
        const commentAgent = agentList.length > 0 ? `\n-- Filtro agentes: ${agentList.join(', ')}` : '';
        const commentDedup = needsDedup ? `\n-- Deduplicación: ${params.dedup === 'last' ? 'Última llamada por índice' : 'Primera llamada por índice'}` : '';
        return `\n-- [NEXUS BUILDER: HISTÓRICO VOCALCOM]\n-- Estrategia Backup: ${params.backupMode.toUpperCase()}\n-- Tablas incluidas: hn_ondata + ${Array.from(targetYears).map(y => `ODCalls_${y}`).join(', ')}${commentStatus}${commentAgent}${commentDedup}\n-- Ordenamiento: CallLocalTime ${params.sortOrder}\n\nDECLARE @FechaInicio date    = '${params.fechaInicio}';\nDECLARE @FechaFin    date    = '${params.fechaFin}';\nDECLARE @CustomerID  int     = ${params.customerId};\nDECLARE @Campaign    sysname = N'${params.campaign}';\n\nDECLARE @sql nvarchar(max);\nDECLARE @params nvarchar(max) = N'@FechaInicio date, @FechaFin date, @CustomerID int, @Campaign sysname';\n\nSET @sql = N'\nWITH Calls AS (\n${unionParts.join('\n  UNION ALL')}\n),${dedupCTE}\n-- Diccionarios de estados: Nivel Padre\nLS_EXACT AS (\n  SELECT StatusGroup, StatusCode, CAST(MAX(StatusText) AS VARCHAR(255)) AS Txt\n  FROM HN_Admin..ListCallStatus\n  WHERE CustomerID = @CustomerID AND StatusDetail = 0\n  GROUP BY StatusGroup, StatusCode\n),\n-- Fallback genérico: Nivel Padre\nLS_GEN AS (\n  SELECT StatusGroup, StatusCode, CAST(MAX(StatusText) AS VARCHAR(255)) AS Txt\n  FROM HN_Admin..ListCallStatus\n  WHERE StatusDetail = 0\n  GROUP BY StatusGroup, StatusCode\n),\n-- Detalle exacto: Nivel Hijo\nLD_EXACT AS (\n  SELECT StatusGroup, StatusCode, StatusDetail, CAST(MAX(StatusText) AS VARCHAR(255)) AS Txt\n  FROM HN_Admin..ListCallStatus\n  WHERE CustomerID = @CustomerID AND StatusDetail > 0\n  GROUP BY StatusGroup, StatusCode, StatusDetail\n),\n-- Detalle fallback genérico: Nivel Hijo\nLD_GEN AS (\n  SELECT StatusGroup, StatusCode, StatusDetail, CAST(MAX(StatusText) AS VARCHAR(255)) AS Txt\n  FROM HN_Admin..ListCallStatus\n  WHERE StatusDetail > 0\n  GROUP BY StatusGroup, StatusCode, StatusDetail\n),\nAG AS (\n  SELECT ident, RTRIM(FirstName) + '' '' + RTRIM(LastName) AS NombreAgente\n  FROM HN_Admin..ListAgents\n)\nSELECT\n  -- [Datos Cliente]\n${cols.replace(/'/g, "''")},\n\n  -- [Datos Llamada]\n  a.OutTel, \n  CONVERT(varchar(19), a.CallLocalTime, 120) AS CallLocalTime, \n  a.FirstCampaign,\n  a.CallStatusNum, \n  a.CallStatusDetail, \n  a.CallStatusGroup,\n  a.FirstAgent,\n  ag.NombreAgente,\n  a.CallDuration,\n  a.Duration,\n  a.EndByAgent,\n\n  -- [Tipificación Calculada]\n  CAST(CASE \n    WHEN a.CallStatusGroup = 0 AND a.CallStatusNum = 89  THEN ''Call Abandoned''\n    WHEN a.CallStatusGroup = 0 AND a.CallStatusNum = 90  THEN ''busy''\n    WHEN a.CallStatusGroup = 0 AND a.CallStatusNum = 91  THEN ''wrong Number''\n    WHEN a.CallStatusGroup = 0 AND a.CallStatusNum = 92  THEN ''No answer''\n    WHEN a.CallStatusGroup = 0 AND a.CallStatusNum = 93  THEN ''Answering machine''\n    WHEN a.CallStatusGroup = 0 AND a.CallStatusNum = 96  THEN ''unavailable''\n    WHEN a.CallStatusGroup = 0 AND a.CallStatusNum = 97  THEN ''transfer''\n    WHEN a.CallStatusGroup = 0 AND a.CallStatusNum = 100 THEN ''do not call''\n    WHEN a.CallStatusGroup = 0 AND a.CallStatusNum = 101 THEN ''Not Qualified''\n    ELSE COALESCE(ls_e.Txt, ls_g.Txt, ''Unknown'')\n  END AS VARCHAR(255)) AS CallLibStatus,\n\n  CAST(CASE \n    WHEN a.CallStatusDetail = 0 THEN ''''\n    WHEN a.CallStatusGroup = 0 AND a.CallStatusNum IN (89, 90, 91, 92, 93, 96, 97, 100, 101) THEN ''''\n    ELSE COALESCE(ld_e.Txt, ld_g.Txt, '''')\n  END AS VARCHAR(255)) AS CallLibDetail\n\nFROM ${fromClause} a\nJOIN ${formatTable(params.clientTable, params.customerDb)} b ON a.indice = b.indice\n-- Cruce Padre (StatusGroup + StatusCode)\nLEFT JOIN LS_EXACT ls_e ON ls_e.StatusGroup = a.CallStatusGroup AND ls_e.StatusCode = a.CallStatusNum\n-- Fallback genérico Padre\nLEFT JOIN LS_GEN ls_g ON ls_g.StatusGroup = a.CallStatusGroup AND ls_g.StatusCode = a.CallStatusNum AND ls_e.Txt IS NULL\n-- Cruce Hijo (StatusGroup + StatusCode + StatusDetail)\nLEFT JOIN LD_EXACT ld_e ON ld_e.StatusGroup = a.CallStatusGroup AND ld_e.StatusCode = a.CallStatusNum AND ld_e.StatusDetail = a.CallStatusDetail\n-- Detalle fallback Hijo\nLEFT JOIN LD_GEN ld_g ON ld_g.StatusGroup = a.CallStatusGroup AND ld_g.StatusCode = a.CallStatusNum AND ld_g.StatusDetail = a.CallStatusDetail AND ld_e.Txt IS NULL\nLEFT JOIN AG ag ON ag.ident = a.FirstAgent\nWHERE 1=1${dedupWhere}\nORDER BY a.CallLocalTime ${params.sortOrder};\n';\n\nEXEC sp_executesql @sql, @params, @FechaInicio, @FechaFin, @CustomerID, @Campaign;\n`;
      },
      renderForm: (params, update) => {
        const AUTO_DETECT_PRIORITY = ['RUT', 'RUT_CLIENTE', 'ROW_ID', 'ROWID', 'NOMBRE', 'NOMBRES', 'PATERNO', 'AP_PATERNO', 'MATERNO', 'AP_MATERNO', 'APELLIDOS', 'APE_PATERNO', 'APELLIDO_PATERNO', 'APELLIDO_MATERNO', 'TEL_1', 'TEL_2', 'TEL_3', 'TEL_4', 'MONTO', 'OFERTA', 'DEUDA', 'PRODUCTO', 'BASE', 'MES_CARGA', 'MESCARGA'];
        const mappedCols = params.mappedColsHist || [];
        const selectedCols = params.selectedCols || [];
        const runAutoDetect = cols => {
          const upper = cols.map(c => c.toUpperCase());
          return AUTO_DETECT_PRIORITY.filter(p => upper.includes(p)).map(p => cols[upper.indexOf(p)]);
        };
        const toggleCol = col => {
          const next = selectedCols.includes(col) ? selectedCols.filter(c => c !== col) : [...selectedCols, col];
          update('selectedCols', next);
        };
        const moveCol = (idx, dir) => {
          const next = [...selectedCols];
          const target = idx + dir;
          if (target < 0 || target >= next.length) return;
          [next[idx], next[target]] = [next[target], next[idx]];
          update('selectedCols', next);
        };
        return /*#__PURE__*/React.createElement("div", {
          className: "fade-in"
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            background: '#F1F5F9',
            padding: '1rem',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            border: '1px solid #E2E8F0'
          }
        }, /*#__PURE__*/React.createElement("h4", {
          style: {
            marginTop: 0,
            fontSize: '0.8rem',
            color: '#64748B',
            textTransform: 'uppercase'
          }
        }, "Estrategia de Datos"), /*#__PURE__*/React.createElement("div", {
          className: "form-grid",
          style: {
            gridTemplateColumns: '1fr 1fr'
          }
        }, /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Rango Fechas"), /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'flex',
            gap: '0.5rem'
          }
        }, /*#__PURE__*/React.createElement("input", {
          type: "date",
          className: "input",
          value: params.fechaInicio,
          onChange: e => update('fechaInicio', e.target.value)
        }), /*#__PURE__*/React.createElement("input", {
          type: "date",
          className: "input",
          value: params.fechaFin,
          onChange: e => update('fechaFin', e.target.value)
        }))), /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Fuente Hist\xF3rica (Backups)"), /*#__PURE__*/React.createElement("select", {
          className: "input",
          value: params.backupMode,
          onChange: e => update('backupMode', e.target.value),
          style: {
            fontWeight: 'bold',
            color: '#0F172A'
          }
        }, /*#__PURE__*/React.createElement("option", {
          value: "auto"
        }, "\u2728 Autom\xE1tico (Seg\xFAn Fechas)"), /*#__PURE__*/React.createElement("option", {
          value: "current"
        }, "\uD83D\uDCC5 Solo A\xF1o en Curso (", new Date().getFullYear(), ")"), /*#__PURE__*/React.createElement("option", {
          value: "current_prev"
        }, "\u23EA A\xF1o Curso + Anterior"), /*#__PURE__*/React.createElement("option", {
          value: "none"
        }, "\uD83D\uDEAB Sin Backups (Solo Vivo)"))))), /*#__PURE__*/React.createElement(CampaignAutoFiller, {
          update: obj => update(obj),
          onColumnsMapped: (allCols, campName, colsA) => {
            const cols = colsA && colsA.length > 0 ? colsA : allCols;
            const hits = runAutoDetect(cols);
            update({
              mappedColsHist: cols,
              selectedCols: hits
            });
            if (hits.length > 0) {
              addToast(`✅ ${hits.length} columnas auto-detectadas para "${campName}".`, 'success');
            } else {
              addToast(`📋 ${cols.length} columnas mapeadas. Selecciona las que necesitas.`, 'info');
            }
          }
        }), /*#__PURE__*/React.createElement("div", {
          style: {
            background: '#F1F5F9',
            padding: '1rem',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            border: '1px solid #E2E8F0'
          }
        }, /*#__PURE__*/React.createElement("h4", {
          style: {
            marginTop: 0,
            fontSize: '0.75rem',
            color: '#64748B',
            textTransform: 'uppercase'
          }
        }, "Verificaci\xF3n de Entorno (Ajuste Manual)"), /*#__PURE__*/React.createElement("div", {
          className: "form-grid",
          style: {
            marginBottom: '1rem',
            gridTemplateColumns: '2fr 1fr 2fr'
          }
        }, /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Campa\xF1a"), /*#__PURE__*/React.createElement("input", {
          className: "input",
          value: params.campaign,
          onChange: e => update('campaign', e.target.value)
        })), /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Customer ID"), /*#__PURE__*/React.createElement("input", {
          className: "input",
          type: "number",
          value: params.customerId,
          onChange: e => update('customerId', e.target.value)
        })), /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "BBDD Exacta"), /*#__PURE__*/React.createElement("input", {
          className: "input",
          value: params.customerDb || '',
          onChange: e => update('customerDb', e.target.value)
        }))), /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Tabla Cliente"), /*#__PURE__*/React.createElement("input", {
          className: "input input-code",
          value: params.clientTable,
          onChange: e => update('clientTable', e.target.value)
        }))), /*#__PURE__*/React.createElement("div", {
          className: "form-group",
          style: {
            marginBottom: '1.5rem'
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.4rem'
          }
        }, /*#__PURE__*/React.createElement("label", {
          className: "label",
          style: {
            margin: 0
          }
        }, "Columnas Cliente", selectedCols.length > 0 && /*#__PURE__*/React.createElement("span", {
          style: {
            marginLeft: '0.5rem',
            background: '#3B82F6',
            color: 'white',
            borderRadius: '10px',
            padding: '1px 7px',
            fontSize: '0.68rem',
            fontWeight: 'bold'
          }
        }, selectedCols.length)), /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'flex',
            gap: '0.4rem'
          }
        }, mappedCols.length > 0 && /*#__PURE__*/React.createElement("button", {
          className: "btn",
          style: {
            padding: '0.15rem 0.6rem',
            fontSize: '0.7rem',
            background: '#DBEAFE',
            color: '#1D4ED8',
            border: '1px solid #93C5FD'
          },
          onClick: () => update('selectedCols', runAutoDetect(mappedCols))
        }, "\u26A1 Auto-detectar"), selectedCols.length > 0 && /*#__PURE__*/React.createElement("button", {
          className: "btn",
          style: {
            padding: '0.15rem 0.6rem',
            fontSize: '0.7rem',
            background: '#FEF2F2',
            color: '#EF4444',
            border: '1px solid #FCA5A5'
          },
          onClick: () => update('selectedCols', [])
        }, "\u2715 Limpiar"))), mappedCols.length === 0 ?
        /*#__PURE__*/
        /* Sin mapeo: textarea legacy */
        React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: '0.72rem',
            color: '#F59E0B',
            marginBottom: '0.4rem'
          }
        }, "\u26A0\uFE0F Seleccione una campa\xF1a para activar el selector. Puede ingresar columnas manualmente mientras tanto."), /*#__PURE__*/React.createElement("textarea", {
          className: "input input-code",
          style: {
            minHeight: '80px',
            resize: 'vertical',
            fontSize: '0.85rem'
          },
          value: params.customCols,
          onChange: e => update('customCols', e.target.value),
          placeholder: "Ej: RUT, MONTO, TEL_1 (separados por coma o enter)"
        }), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: '0.72rem',
            color: '#94A3B8',
            marginTop: '3px'
          }
        }, "* El sistema aplicar\xE1 el alias ", /*#__PURE__*/React.createElement("code", null, "b."), " autom\xE1ticamente.")) :
        /*#__PURE__*/
        /* Con mapeo: chips + dropdown */
        React.createElement("div", {
          style: {
            border: '1px solid #CBD5E1',
            borderRadius: '6px',
            background: 'white',
            padding: '0.5rem'
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.3rem',
            minHeight: '32px',
            marginBottom: selectedCols.length > 0 ? '0.5rem' : 0
          }
        }, selectedCols.length === 0 && /*#__PURE__*/React.createElement("span", {
          style: {
            fontSize: '0.73rem',
            color: '#94A3B8',
            fontStyle: 'italic',
            padding: '4px 2px'
          }
        }, "Sin columnas seleccionadas \u2014 usa el desplegable o \u26A1 Auto-detectar."), selectedCols.map((col, i) => /*#__PURE__*/React.createElement("span", {
          key: i,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
            background: '#EFF6FF',
            border: '1px solid #BFDBFE',
            borderRadius: '4px',
            padding: '2px 4px 2px 7px',
            fontSize: '0.73rem',
            fontFamily: 'monospace',
            color: '#1D4ED8',
            fontWeight: 'bold'
          }
        }, col, /*#__PURE__*/React.createElement("button", {
          onClick: () => moveCol(i, -1),
          disabled: i === 0,
          style: {
            background: 'none',
            border: 'none',
            cursor: i === 0 ? 'default' : 'pointer',
            color: i === 0 ? '#CBD5E1' : '#93C5FD',
            fontSize: '0.6rem',
            padding: '0 1px',
            lineHeight: 1
          }
        }, "\u25C0"), /*#__PURE__*/React.createElement("button", {
          onClick: () => moveCol(i, 1),
          disabled: i === selectedCols.length - 1,
          style: {
            background: 'none',
            border: 'none',
            cursor: i === selectedCols.length - 1 ? 'default' : 'pointer',
            color: i === selectedCols.length - 1 ? '#CBD5E1' : '#93C5FD',
            fontSize: '0.6rem',
            padding: '0 1px',
            lineHeight: 1
          }
        }, "\u25B6"), /*#__PURE__*/React.createElement("button", {
          onClick: () => toggleCol(col),
          style: {
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#94A3B8',
            fontSize: '0.72rem',
            padding: '0 2px',
            lineHeight: 1,
            marginLeft: '1px'
          }
        }, "\u2715")))), /*#__PURE__*/React.createElement("select", {
          className: "input input-code",
          style: {
            fontSize: '0.8rem',
            background: '#F8FAFC',
            color: '#475569'
          },
          value: "",
          onChange: e => {
            if (e.target.value) toggleCol(e.target.value);
          }
        }, /*#__PURE__*/React.createElement("option", {
          value: ""
        }, "+ Agregar columna desde lista mapeada (", mappedCols.filter(c => !selectedCols.includes(c)).length, " disponibles)..."), mappedCols.filter(c => !selectedCols.includes(c)).map((col, i) => /*#__PURE__*/React.createElement("option", {
          key: i,
          value: col
        }, col))))), /*#__PURE__*/React.createElement("div", {
          style: {
            background: '#F1F5F9',
            padding: '1rem',
            borderRadius: '8px',
            marginTop: '0.5rem',
            border: '1px solid #E2E8F0'
          }
        }, /*#__PURE__*/React.createElement("h4", {
          style: {
            marginTop: 0,
            fontSize: '0.8rem',
            color: '#64748B',
            textTransform: 'uppercase'
          }
        }, "Opciones de Resultado"), /*#__PURE__*/React.createElement("div", {
          className: "form-grid",
          style: {
            gridTemplateColumns: '1fr 1fr',
            marginBottom: '1rem'
          }
        }, /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Ordenamiento"), /*#__PURE__*/React.createElement("select", {
          className: "input",
          value: params.sortOrder,
          onChange: e => update('sortOrder', e.target.value)
        }, /*#__PURE__*/React.createElement("option", {
          value: "DESC"
        }, "\u2193 M\xE1s reciente primero"), /*#__PURE__*/React.createElement("option", {
          value: "ASC"
        }, "\u2191 M\xE1s antiguo primero"))), /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Deduplicaci\xF3n por \xCDndice"), /*#__PURE__*/React.createElement("select", {
          className: "input",
          value: params.dedup,
          onChange: e => update('dedup', e.target.value)
        }, /*#__PURE__*/React.createElement("option", {
          value: "none"
        }, "Sin deduplicar (todos los registros)"), /*#__PURE__*/React.createElement("option", {
          value: "last"
        }, "Solo \xFAltima llamada por \xEDndice"), /*#__PURE__*/React.createElement("option", {
          value: "first"
        }, "Solo primera llamada por \xEDndice")))), /*#__PURE__*/React.createElement("div", {
          className: "form-grid",
          style: {
            gridTemplateColumns: '1fr 1fr'
          }
        }, /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Filtrar Estados (CallStatusNum)"), /*#__PURE__*/React.createElement("input", {
          type: "text",
          className: "input input-code",
          value: params.filterStatus,
          onChange: e => update('filterStatus', e.target.value),
          placeholder: "Ej: 1, 2, 94  (vac\xEDo = todos)"
        })), /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Filtrar Agentes (FirstAgent)"), /*#__PURE__*/React.createElement("input", {
          type: "text",
          className: "input input-code",
          value: params.filterAgent,
          onChange: e => update('filterAgent', e.target.value),
          placeholder: "Ej: 1000, 1930  (vac\xEDo = todos)"
        })))));
      }
    },
    // --- MÓDULO 1b: HISTÓRICO VICIDIAL ---
    'vicidial_hist': {
      meta: {
        icon: 'phone',
        label: 'Histórico Vicidial',
        desc: 'Extracciones detalladas desde Vicidial con listas múltiples y estados personalizados.'
      },
      defaultParams: {
        fechaInicio: new Date().toISOString().split('T')[0],
        fechaFin: new Date().toISOString().split('T')[0],
        campaniaId: '',
        campaniaNombre: '',
        listas: '',
        dedup: 'all',
        soloListasActivas: true,
        // El catálogo de campañas vive en params para sobrevivir re-renders
        _camps: [],
        _campsLoading: false
      },
      generateSQL: params => {
        const campania = (params.campaniaId || '').replace(/'/g, "''");
        const inicio = params.fechaInicio;
        const fin = params.fechaFin;
        const dedupType = params.dedup; // 'all' | 'first' | 'last'

        // Obtener lista de IDs — si está vacío usamos placeholder para que el usuario lo complete
        const listIds = (params.listas || '').split(',').map(l => l.trim()).filter(l => l !== '');

        // Si no hay listas definidas, generamos un bloque único sin filtro de lista ni custom_
        const usarListas = listIds.length > 0;
        const listasBloques = usarListas ? listIds : ['__SIN_LISTA__'];

        // Filtro de intentos: ROW_NUMBER si aplica dedup
        const dedupSelect = dedupType !== 'all' ? `,\n        ROW_NUMBER() OVER (PARTITION BY vlog.lead_id ORDER BY vlog.call_date ${dedupType === 'last' ? 'DESC' : 'ASC'}) AS _rn` : '';
        const dedupWhere = dedupType !== 'all' ? '\nWHERE _rn = 1' : '';
        const dedupLabel = dedupType === 'first' ? 'Solo primer intento por lead' : dedupType === 'last' ? 'Solo último intento por lead' : 'Todos los intentos';

        // Construir un bloque SELECT por cada lista
        const bloques = listasBloques.map((listaId, idx) => {
          const esSinLista = listaId === '__SIN_LISTA__';
          const filtroLista = esSinLista ? `        -- Sin filtro de lista específica` : `        AND vlog.list_id = ${listaId}`;
          const joinCustom = esSinLista ? `-- Sin tabla custom (no se indicaron listas)` : `LEFT JOIN custom_${listaId} cust ON base.lead_id = cust.lead_id`;
          return `    -- ── LISTA ${esSinLista ? '(todas)' : listaId} ──────────────────────────────────────
    SELECT
        base.lead_id             AS 'Lead_ID',
        base.list_id             AS 'Lista_ID',
        base.call_date           AS 'Fecha_Hora',
        base.phone_marcado       AS 'Telefono_Marcado',
        base.full_name           AS 'Nombre_Agente',
        base.estado_nombre       AS 'Estado_Nombre',
        base.length_in_sec       AS 'Duracion_Seg',
        base.vendor_lead_code    AS 'Rut',
        base.postal_code         AS 'Id_Cliente',
        base.address1            AS 'Nombre_Completo',
        base.phone_principal     AS 'Telefono_1',
        base.alt_phone           AS 'Telefono_2',
        base.address3            AS 'Telefono_3',
        base.email               AS 'Telefono_4',
        cust.*
    FROM (
        SELECT
            vlog.lead_id, vlog.list_id, vlog.call_date,
            vlog.phone_number     AS phone_marcado,
            vlist.phone_number    AS phone_principal,
            vlog.length_in_sec,
            vuser.full_name,
            COALESCE(vcs.status_name, vs.status_name, vlog.status) AS estado_nombre,
            vlist.vendor_lead_code, vlist.postal_code, vlist.address1,
            vlist.alt_phone, vlist.address3, vlist.email${dedupSelect}
        FROM vicidial_log vlog
        INNER JOIN vicidial_list vlist ON vlog.lead_id = vlist.lead_id
        LEFT JOIN vicidial_users vuser ON vlog.user = vuser.user
        LEFT JOIN vicidial_statuses vs ON vlog.status = vs.status
        LEFT JOIN vicidial_campaign_statuses vcs
               ON vlog.status = vcs.status AND vlog.campaign_id = vcs.campaign_id
        WHERE
            vlog.campaign_id = '${campania}'
${filtroLista}
            AND CAST(vlog.call_date AS DATE) BETWEEN '${inicio}' AND '${fin}'
    ) base${dedupWhere}
    ${joinCustom}`;
        });
        const unionSQL = bloques.join('\n\n    UNION ALL\n\n');
        return `-- ============================================================
-- [NEXUS BUILDER: HISTÓRICO VICIDIAL]
-- Campaña  : ${params.campaniaNombre || campania}
-- Período  : ${inicio} → ${fin}
-- Listas   : ${usarListas ? listIds.join(', ') : 'todas'}
-- Intentos : ${dedupLabel}
-- ============================================================

${unionSQL}

ORDER BY Fecha_Hora DESC;
`;
      },
      renderForm: (params, update) => {
        // Estado del catálogo guardado en params para sobrevivir re-renders del padre
        const camps = params._camps || [];
        const loading = params._campsLoading || false;
        const loadCamps = () => {
          if (!window.nexusAPI) {
            addToast('Sin conexión SQL activa.', 'error');
            return;
          }
          update('_campsLoading', true);
          const soloActivas = params.soloListasActivas;
          const q = `SELECT vc.campaign_id AS ID, vc.campaign_name AS Nombre FROM vicidial_campaigns vc INNER JOIN vicidial_lists vl ON vc.campaign_id = vl.campaign_id WHERE vc.active = 'Y'${soloActivas ? " AND vl.active = 'Y'" : ''} GROUP BY vc.campaign_id, vc.campaign_name ORDER BY vc.campaign_name ASC`;
          window.nexusAPI.executeSQL(q).then(r => {
            if (r.success && r.data) update('_camps', r.data);
          }).catch(e => addToast('Error cargando campañas: ' + e.message, 'error')).finally(() => update('_campsLoading', false));
        };
        return /*#__PURE__*/React.createElement("div", {
          className: "fade-in"
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            background: '#F8FAFC',
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid #CBD5E1',
            marginBottom: '1.5rem'
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.75rem'
          }
        }, /*#__PURE__*/React.createElement("span", {
          style: {
            fontSize: '0.8rem',
            fontWeight: 'bold',
            color: '#334155',
            textTransform: 'uppercase'
          }
        }, "\uD83D\uDD0C Campa\xF1as Vicidial"), /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem'
          }
        }, /*#__PURE__*/React.createElement("label", {
          style: {
            fontSize: '0.78rem',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            cursor: 'pointer',
            color: '#475569'
          }
        }, /*#__PURE__*/React.createElement("input", {
          type: "checkbox",
          checked: params.soloListasActivas,
          onChange: e => update('soloListasActivas', e.target.checked)
        }), "Solo listas activas"), /*#__PURE__*/React.createElement("button", {
          onClick: loadCamps,
          disabled: loading,
          style: {
            padding: '4px 12px',
            background: '#334155',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            fontSize: '0.75rem',
            fontWeight: 'bold',
            cursor: 'pointer'
          }
        }, loading ? '⏳' : '🔄', " Actualizar"))), /*#__PURE__*/React.createElement("select", {
          className: "input",
          value: params.campaniaId,
          onChange: e => {
            const camp = camps.find(c => c.ID === e.target.value);
            update({
              campaniaId: e.target.value,
              campaniaNombre: camp ? camp.Nombre : ''
            });
          },
          style: {
            fontWeight: 'bold',
            color: '#0F172A'
          }
        }, /*#__PURE__*/React.createElement("option", {
          value: ""
        }, "-- Seleccione una Campa\xF1a --"), camps.map((c, i) => /*#__PURE__*/React.createElement("option", {
          key: i,
          value: c.ID
        }, c.Nombre))), !window.nexusAPI && /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: '0.73rem',
            color: '#EF4444',
            marginTop: '6px'
          }
        }, "\u26A0\uFE0F Conecte SQL y presione Actualizar para cargar campa\xF1as.")), /*#__PURE__*/React.createElement("div", {
          style: {
            background: '#F1F5F9',
            padding: '1rem',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            border: '1px solid #E2E8F0'
          }
        }, /*#__PURE__*/React.createElement("h4", {
          style: {
            marginTop: 0,
            fontSize: '0.8rem',
            color: '#64748B',
            textTransform: 'uppercase'
          }
        }, "Par\xE1metros de Extracci\xF3n"), /*#__PURE__*/React.createElement("div", {
          className: "form-grid",
          style: {
            gridTemplateColumns: '1fr 1fr',
            marginBottom: '1rem'
          }
        }, /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Fecha Desde"), /*#__PURE__*/React.createElement("input", {
          type: "date",
          className: "input",
          value: params.fechaInicio,
          onChange: e => update('fechaInicio', e.target.value)
        })), /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Fecha Hasta"), /*#__PURE__*/React.createElement("input", {
          type: "date",
          className: "input",
          value: params.fechaFin,
          onChange: e => update('fechaFin', e.target.value)
        }))), /*#__PURE__*/React.createElement("div", {
          className: "form-group",
          style: {
            marginBottom: '1rem'
          }
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "ID Campa\xF1a (manual)"), /*#__PURE__*/React.createElement("input", {
          className: "input input-code",
          value: params.campaniaId,
          onChange: e => update('campaniaId', e.target.value),
          placeholder: "Ej: COBRANZA_2026"
        })), /*#__PURE__*/React.createElement("div", {
          className: "form-group",
          style: {
            marginBottom: '1rem'
          }
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "IDs de Listas (separados por coma, sin espacios)"), /*#__PURE__*/React.createElement("input", {
          className: "input input-code",
          value: params.listas,
          onChange: e => update('listas', e.target.value),
          placeholder: "Ej: 1106,1107,1108"
        }), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: '0.73rem',
            color: '#94A3B8',
            marginTop: '4px'
          }
        }, "Dejar vac\xEDo para incluir todas las listas de la campa\xF1a.")), /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Tipo de Intentos"), /*#__PURE__*/React.createElement("select", {
          className: "input",
          value: params.dedup,
          onChange: e => update('dedup', e.target.value),
          style: {
            fontWeight: 'bold'
          }
        }, /*#__PURE__*/React.createElement("option", {
          value: "all"
        }, "Todos los intentos"), /*#__PURE__*/React.createElement("option", {
          value: "first"
        }, "Solo primer intento por lead"), /*#__PURE__*/React.createElement("option", {
          value: "last"
        }, "Solo \xFAltimo intento por lead")))), /*#__PURE__*/React.createElement("div", {
          style: {
            background: '#EFF6FF',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            border: '1px solid #BFDBFE',
            fontSize: '0.8rem',
            color: '#1E40AF'
          }
        }, "\u2139\uFE0F Se generar\xE1 un bloque ", /*#__PURE__*/React.createElement("strong", null, "UNION ALL por cada lista"), " indicada, uniendo los campos personalizados de la tabla ", /*#__PURE__*/React.createElement("code", null, "custom_XXXX"), " correspondiente. El bot\xF3n ", /*#__PURE__*/React.createElement("strong", null, "\"Ejecutar y Exportar Excel\""), " lanza la query y descarga el archivo directamente."));
      }
    },
    // --- MÓDULO 2: ORQUESTADOR DE ESTRATEGIAS (V13 - UPGRADE COMPLETO) ---
    'campaign_strategy': {
      meta: {
        icon: 'layers',
        label: 'Orquestador de Estrategias',
        desc: 'Segmentación con capas excluyentes, log por campaña y marcaje automático.'
      },
      defaultParams: {
        campaign: '',
        customerId: '1',
        customerDb: '',
        clientTable: 'CLIENTE_',
        mgmtTable: 'C1_',
        strategyCol: 'MCA_ESTRATEGIA',
        strategyColDetected: false,
        mesCarga: getNexusDate(),
        mesCargaCol: 'MES_CARGA',
        mesCargaColDetected: false,
        resetCanvas: true,
        mappedColumns: [],
        columnsA: [],
        columnsB: [],
        agenda: {
          active: true,
          targetVal: '94',
          filters: [{
            source: 'b',
            col: 'STATUS',
            op: '=',
            vals: [{
              id: 1,
              text: '94'
            }],
            isStr: false
          }]
        },
        layers: [{
          id: 1,
          value: '1',
          label: '',
          filters: []
        }]
      },
      generateSQL: params => {
        const mesCargaFilter = alias => `  ${alias}.${params.mesCargaCol} = '${params.mesCarga}'`;
        const buildWhere = filters => {
          const mesCargaClause = `WHERE ${mesCargaFilter('a')}`;
          const validFilters = filters.filter(f => f.col.trim() !== '' || f.op === 'RAW');
          if (validFilters.length === 0) return mesCargaClause;
          const clauses = validFilters.map(f => {
            if (f.op === 'RAW') return `  AND (${f.vals[0]?.text || ''})`;
            const prefix = f.source === 'a' ? 'a.' : 'b.';
            const colFinal = `${prefix}${f.col.trim()}`;
            const quote = val => f.isStr ? `'${val}'` : val;
            if (f.op === 'IS NULL') return `  AND ${colFinal} IS NULL`;
            if (f.op === 'IS NOT NULL') return `  AND ${colFinal} IS NOT NULL`;
            if (f.op === 'CONTIENE') {
              const items = f.vals.filter(v => v.checked !== false);
              if (items.length === 0) return `  AND 1=1 -- CONTIENE sin valores seleccionados`;
              return `  AND ${colFinal} IN (${items.map(v => `'${v.text}'`).join(', ')})`;
            }
            if (['IN', 'NOT IN'].includes(f.op)) {
              // Recopilar todos los valores de todos los val-rows
              const allItems = f.vals.flatMap(vObj => vObj.text.split(/[,;\n]+/).map(v => v.trim()).filter(Boolean));
              const list = allItems.map(v => quote(v)).join(', ');
              return `  AND ${colFinal} ${f.op} (${list})`;
            }
            // Operador = (y >, >=, <, <=, <>)
            // Recoger todos los valores individuales de todos los val-rows
            const allVals = f.vals.flatMap(vObj => {
              const raw = vObj.text.trim();
              // Si un valor = contiene comas, el usuario quiso escribir múltiples valores
              // → convertir automáticamente a IN
              if (f.op === '=' && raw.includes(',')) {
                return raw.split(/[,;\n]+/).map(v => v.trim()).filter(Boolean);
              }
              return raw ? [raw] : [];
            });
            if (allVals.length === 0) return `  AND 1=1 -- valor vacío en filtro "${f.col}"`;
            // Si tras expandir hay más de un valor con =, convertir a IN
            if (f.op === '=' && allVals.length > 1) {
              return `  AND ${colFinal} IN (${allVals.map(v => quote(v)).join(', ')})`;
            }
            if (allVals.length > 1) {
              // OR group para >, <, etc.
              return `  AND (${allVals.map(v => `${colFinal} ${f.op} ${quote(v)}`).join(' OR ')})`;
            }
            return `  AND ${colFinal} ${f.op} ${quote(allVals[0])}`;
          });
          return mesCargaClause + '\n' + clauses.join('\n');
        };
        let sql = `-- [NEXUS ORCHESTRATOR V13]\n-- Campaña: ${params.campaign}\n-- Customer: ${params.customerId} | DB: ${params.customerDb || 'default'}\n-- Mes de Carga: ${params.mesCarga} (Columna: ${params.mesCargaCol})\n-- Col. Estrategia: ${params.strategyCol}\n-- Tabla Cliente: ${params.clientTable}\n-- Tabla Gestión: ${params.mgmtTable}\n\n`;
        if (params.resetCanvas) {
          sql += `-- ============================================================\n-- [1] LIMPIEZA DE LIENZO (Customer: ${params.customerId})\n-- ============================================================\nUPDATE ${formatTable(params.clientTable, params.customerDb)}\nSET ${params.strategyCol} = 0\nWHERE ${params.mesCargaCol} = '${params.mesCarga}';\nDECLARE @cnt_reset INT = @@ROWCOUNT;\nPRINT '-- Marca Borrada: ' + CAST(@cnt_reset AS VARCHAR) + ' Registros.';\n\n`;
        }

        // Análisis de solapamiento entre capas para incluir en el SQL generado
        const analyzeOverlaps = () => {
          if (params.layers.length < 2) return [];
          const msgs = [];
          const getLayerCols = l => (l.filters || []).filter(f => f.col && f.col.trim() && f.op !== 'RAW' && f.op !== 'IS NULL' && f.op !== 'IS NOT NULL').map(f => ({
            col: f.col.trim().toUpperCase(),
            src: f.source,
            op: f.op,
            filter: f
          }));
          const getVals = filt => {
            const expand = text => text.split(/[,;\n]+/).map(v => v.trim().toUpperCase()).filter(Boolean);
            if (filt.op === 'CONTIENE') return filt.vals.filter(v => v.checked !== false).map(v => v.text.trim().toUpperCase());
            if (filt.op === 'IN' || filt.op === 'NOT IN') return filt.vals.flatMap(vObj => expand(vObj.text));
            if (filt.op === '=') return filt.vals.flatMap(vObj => expand(vObj.text));
            return [];
          };
          params.layers.forEach((layer, idx) => {
            if (!layer.value) return;
            const thisCols = getLayerCols(layer);
            if (thisCols.length === 0) return;
            params.layers.forEach((other, otherIdx) => {
              if (otherIdx <= idx) return;
              if (!other.value) return;
              const otherCols = getLayerCols(other);
              const otherColNames = otherCols.map(c => c.col + '|' + c.src);
              thisCols.forEach(({
                col,
                src,
                filter: f
              }) => {
                const otherMatch = otherCols.find(c => c.col === col && c.src === src);

                // Columna ausente en capa posterior → solapamiento probable
                if (!otherMatch) {
                  msgs.push(`CAPA ${idx + 1} → CAPA ${otherIdx + 1}: CAPA ${otherIdx + 1} no restringe "${col}" — puede sobreescribir registros de CAPA ${idx + 1}.`);
                  return;
                }

                // Columna presente en ambas: verificar si los sets son disjuntos
                const of = otherMatch.filter;
                const fVals = getVals(f);
                const ofVals = getVals(of);
                if (fVals.length > 0 && ofVals.length > 0) {
                  if (of.op === 'NOT IN') {
                    const notCovered = fVals.filter(v => !ofVals.includes(v));
                    if (notCovered.length > 0) {
                      msgs.push(`CAPA ${idx + 1} → CAPA ${otherIdx + 1}: CAPA ${otherIdx + 1} usa NOT IN en "${col}" pero no excluye todos los valores de CAPA ${idx + 1} [${notCovered.slice(0, 4).join(', ')}${notCovered.length > 4 ? '...' : ''}].`);
                    }
                    return; // Si excluye todos → excluyentes ✅
                  }
                  const shared = fVals.filter(v => ofVals.includes(v));
                  if (shared.length > 0) {
                    msgs.push(`CAPA ${idx + 1} → CAPA ${otherIdx + 1}: comparten "${col}" IN [${shared.slice(0, 5).join(', ')}${shared.length > 5 ? '...' : ''}] — registros solapados, la CAPA ${otherIdx + 1} prevalece.`);
                  }
                  // Sets completamente disjuntos → sin aviso ✅
                }
              });
            });
          });
          return msgs;
        };
        const overlapWarnings = analyzeOverlaps();
        params.layers.forEach((layer, idx) => {
          if (!layer.value) return;
          const markField = layer.markCol !== undefined && layer.markCol.trim() ? layer.markCol.trim() : params.strategyCol;
          const layerDesc = layer.label ? ` — ${layer.label}` : '';
          const whereBlock = buildWhere(layer.filters);
          sql += `-- ============================================================\n-- [2.${idx + 1}] CAPA ${idx + 1}${layerDesc}\n-- ============================================================\nUPDATE a\nSET a.${markField} = ${layer.value}\nFROM ${formatTable(params.clientTable, params.customerDb)} a\nJOIN ${formatTable(params.mgmtTable, params.customerDb)} b ON a.INDICE = b.INDICE\n${whereBlock};\nDECLARE @cnt_layer${idx + 1} INT = @@ROWCOUNT;\nPRINT '-- CAPA${idx + 1}: ${markField} = ${layer.value}: ' + CAST(@cnt_layer${idx + 1} AS VARCHAR) + ' Registros.';\n\n`;
        });
        if (params.agenda.active) {
          const agendaFilters = [...(params.agenda.filters || [])];
          const whereBlock = buildWhere(agendaFilters);
          sql += `-- ============================================================\n-- [3] PROTECCIÓN AGENDAS (Marca ${params.agenda.targetVal})\n-- ============================================================\nUPDATE a\nSET a.${params.strategyCol} = ${params.agenda.targetVal}\nFROM ${formatTable(params.clientTable, params.customerDb)} a\nJOIN ${formatTable(params.mgmtTable, params.customerDb)} b ON a.INDICE = b.INDICE\n${whereBlock};\nDECLARE @cnt_agenda INT = @@ROWCOUNT;\nPRINT '-- AGENDAS PROTEGIDAS: ' + CAST(@cnt_agenda AS VARCHAR) + ' Registros.';\n`;
        }
        sql += `\n-- ============================================================\n-- RESUMEN DE ESTRATEGIA\n-- ============================================================\n`;
        if (params.resetCanvas) sql += `-- Marca Borrada.\n`;
        params.layers.forEach((layer, idx) => {
          if (!layer.value) return;
          const markField = layer.markCol !== undefined && layer.markCol.trim() ? layer.markCol.trim() : params.strategyCol;
          sql += `-- CAPA${idx + 1}: ${markField} = ${layer.value}${layer.label ? ` (${layer.label})` : ''}.\n`;
        });
        if (params.agenda.active) sql += `-- AGENDAS PROTEGIDAS — Marca ${params.agenda.targetVal}.\n`;
        if (overlapWarnings.length > 0) {
          sql += `\n-- ⚠️  ADVERTENCIAS DE SOLAPAMIENTO ENTRE CAPAS:\n`;
          sql += `-- (Los UPDATEs son secuenciales: una capa posterior sobreescribe a la anterior\n`;
          sql += `--  si un registro cumple ambas condiciones. Revise los filtros.)\n`;
          overlapWarnings.forEach(w => {
            sql += `-- ⚠️  ${w}\n`;
          });
        }
        sql += `\n-- ============================================================\n-- RECORDATORIO: Incluir desde la interfaz en Vocalcom la columna\n-- ${params.strategyCol} a priorizar y reciclar la capa de ser necesario.\n-- También recuerde excluir ${params.strategyCol}=0 y las demás\n-- marcas de estrategia que no se priorizarán, dejando priorizados\n-- solo los registros requeridos.\n-- ============================================================\n`;
        return sql;
      },
      renderForm: (params, update) => {
        const updateLayers = newL => update('layers', newL);
        const updateAgenda = newA => update('agenda', newA);

        // Columnas separadas por tabla para los selects
        const allMappedCols = params.mappedColumns || [];
        const colsA = params.columnsA && params.columnsA.length > 0 ? params.columnsA : allMappedCols;
        const colsB = params.columnsB && params.columnsB.length > 0 ? params.columnsB : allMappedCols;
        const getColsForSource = src => src === 'a' ? colsA : colsB;
        const modifyFilterHead = (source, indices, field, val) => {
          if (source === 'layer') {
            const [lIdx, fIdx] = indices;
            const next = [...params.layers];
            next[lIdx].filters[fIdx] = {
              ...next[lIdx].filters[fIdx],
              [field]: val
            };
            updateLayers(next);
          } else {
            const next = {
              ...params.agenda,
              filters: [...params.agenda.filters]
            };
            next.filters[indices] = {
              ...next.filters[indices],
              [field]: val
            };
            updateAgenda(next);
          }
        };
        const modifyValue = (source, indices, valIdx, text) => {
          if (source === 'layer') {
            const [lIdx, fIdx] = indices;
            const next = [...params.layers];
            const newVals = [...next[lIdx].filters[fIdx].vals];
            newVals[valIdx] = {
              ...newVals[valIdx],
              text
            };
            next[lIdx].filters[fIdx].vals = newVals;
            updateLayers(next);
          } else {
            const next = {
              ...params.agenda,
              filters: [...params.agenda.filters]
            };
            const newVals = [...next.filters[indices].vals];
            newVals[valIdx] = {
              ...newVals[valIdx],
              text
            };
            next.filters[indices].vals = newVals;
            updateAgenda(next);
          }
        };
        const toggleCheckVal = (source, indices, valIdx) => {
          if (source === 'layer') {
            const [lIdx, fIdx] = indices;
            const next = [...params.layers];
            const newVals = [...next[lIdx].filters[fIdx].vals];
            newVals[valIdx] = {
              ...newVals[valIdx],
              checked: !newVals[valIdx].checked
            };
            next[lIdx].filters[fIdx].vals = newVals;
            updateLayers(next);
          } else {
            const next = {
              ...params.agenda,
              filters: [...params.agenda.filters]
            };
            const newVals = [...next.filters[indices].vals];
            newVals[valIdx] = {
              ...newVals[valIdx],
              checked: !newVals[valIdx].checked
            };
            next.filters[indices].vals = newVals;
            updateAgenda(next);
          }
        };
        const addValue = (source, indices) => {
          const newVal = {
            id: Date.now(),
            text: '',
            checked: true
          };
          if (source === 'layer') {
            const [lIdx, fIdx] = indices;
            const next = [...params.layers];
            next[lIdx].filters[fIdx].vals.push(newVal);
            updateLayers(next);
          } else {
            const next = {
              ...params.agenda,
              filters: [...params.agenda.filters]
            };
            next.filters[indices].vals.push(newVal);
            updateAgenda(next);
          }
        };
        const removeValue = (source, indices, valIdx) => {
          if (source === 'layer') {
            const [lIdx, fIdx] = indices;
            const next = [...params.layers];
            next[lIdx].filters[fIdx].vals = next[lIdx].filters[fIdx].vals.filter((_, i) => i !== valIdx);
            updateLayers(next);
          } else {
            const next = {
              ...params.agenda,
              filters: [...params.agenda.filters]
            };
            next.filters[indices].vals = next.filters[indices].vals.filter((_, i) => i !== valIdx);
            updateAgenda(next);
          }
        };
        const toggleStringMode = (source, indices) => {
          if (source === 'layer') {
            const [lIdx, fIdx] = indices;
            const next = [...params.layers];
            next[lIdx].filters[fIdx].isStr = !next[lIdx].filters[fIdx].isStr;
            updateLayers(next);
          } else {
            const next = {
              ...params.agenda,
              filters: [...params.agenda.filters]
            };
            next.filters[indices].isStr = !next.filters[indices].isStr;
            updateAgenda(next);
          }
        };
        const addFilter = (source, idx) => {
          // isStr: false por defecto — el usuario activa comillas solo para texto
          const newFilter = {
            source: 'a',
            col: '',
            op: '=',
            vals: [{
              id: Date.now(),
              text: '',
              checked: true
            }],
            isStr: false
          };
          if (source === 'layer') {
            const next = [...params.layers];
            next[idx].filters.push(newFilter);
            updateLayers(next);
          } else {
            const next = {
              ...params.agenda,
              filters: [...(params.agenda.filters || [])]
            };
            newFilter.source = 'b';
            next.filters.push(newFilter);
            updateAgenda(next);
          }
        };
        const removeFilter = (source, indices) => {
          if (source === 'layer') {
            const [lIdx, fIdx] = indices;
            const next = [...params.layers];
            next[lIdx].filters = next[lIdx].filters.filter((_, i) => i !== fIdx);
            updateLayers(next);
          } else {
            const next = {
              ...params.agenda,
              filters: params.agenda.filters.filter((_, i) => i !== indices)
            };
            updateAgenda(next);
          }
        };

        // Cargar valores CONTIENE desde SQL
        const loadContainsValues = async (source, indices) => {
          const lIdx = source === 'layer' ? indices[0] : null;
          const fIdx = source === 'layer' ? indices[1] : indices;
          const filter = source === 'layer' ? params.layers[lIdx].filters[fIdx] : params.agenda.filters[fIdx];
          if (!filter.col || !window.nexusAPI) {
            addToast('Seleccione un campo y verifique la conexión SQL.', 'error');
            return;
          }
          const dbPrefix = params.customerDb ? `[${params.customerDb}]..` : '';
          const tbl = filter.source === 'a' ? params.clientTable : params.mgmtTable;
          try {
            addToast(`Cargando valores de [${filter.col}]...`, 'info');
            const mesCargaWhere = params.mesCargaCol && params.mesCarga ? ` WHERE [${params.mesCargaCol}] = '${params.mesCarga}'` : '';
            const r = await window.nexusAPI.executeSQL(`SELECT DISTINCT [${filter.col}] FROM ${dbPrefix}[${tbl}]${mesCargaWhere} ORDER BY [${filter.col}]`);
            if (r.success && r.data) {
              const vals = r.data.map((row, i) => ({
                id: Date.now() + i,
                text: String(Object.values(row)[0] ?? ''),
                checked: true
              }));
              if (source === 'layer') {
                const next = [...params.layers];
                next[lIdx].filters[fIdx].vals = vals;
                updateLayers(next);
              } else {
                const next = {
                  ...params.agenda,
                  filters: [...params.agenda.filters]
                };
                next.filters[fIdx].vals = vals;
                updateAgenda(next);
              }
              addToast(`${vals.length} valores cargados para [${filter.col}].`, 'success');
            }
          } catch (e) {
            addToast('Error cargando valores: ' + e.message, 'error');
          }
        };

        // Verificar exclusividad entre capas
        // Lógica de solapamiento en UPDATEs secuenciales:
        //   - Una capa POSTERIOR sin filtro sobre columna X sobreescribe a capas ANTERIORES que sí filtran X
        //   - Dos capas con filtro sobre la misma columna que comparten valores (sets no disjuntos)
        //   - Dos capas con mismo operador de rango sobre la misma columna
        // Las agendas no aplican — se sobrepondrán intencionalmente a todo.
        const checkLayerExclusivity = layerIdx => {
          if (params.layers.length < 2) return [];
          const layer = params.layers[layerIdx];
          const warnings = [];
          const getLayerCols = l => (l.filters || []).filter(f => f.col && f.col.trim() && f.op !== 'RAW' && f.op !== 'IS NULL' && f.op !== 'IS NOT NULL').map(f => ({
            col: f.col.trim().toUpperCase(),
            src: f.source,
            op: f.op,
            filter: f
          }));

          // Normalizar valores igual que buildWhere — expandir comas en =
          const getVals = filt => {
            const expand = text => text.split(/[,;\n]+/).map(v => v.trim().toUpperCase()).filter(Boolean);
            if (filt.op === 'CONTIENE') return filt.vals.filter(v => v.checked !== false).map(v => v.text.trim().toUpperCase());
            if (filt.op === 'IN' || filt.op === 'NOT IN') return filt.vals.flatMap(vObj => expand(vObj.text));
            if (filt.op === '=') {
              // Si algún val tiene comas, se expande igual que buildWhere hace auto-IN
              return filt.vals.flatMap(vObj => expand(vObj.text));
            }
            return [];
          };
          const thisCols = getLayerCols(layer);
          if (thisCols.length === 0) return [];
          params.layers.forEach((other, otherIdx) => {
            if (otherIdx === layerIdx) return;
            const otherCols = getLayerCols(other);
            const otherColNames = otherCols.map(c => c.col + '|' + c.src);

            // CASO 1: Capa POSTERIOR no filtra una columna que esta sí filtra
            // Solo avisar si la otra capa no tiene NINGÚN filtro sobre esa columna
            // (si la cubre con otro operador, sí está siendo restringida)
            if (otherIdx > layerIdx) {
              thisCols.forEach(({
                col,
                src
              }) => {
                if (!otherColNames.includes(col + '|' + src)) {
                  warnings.push(`⚠️ CAPA ${otherIdx + 1} (posterior) no restringe "${col}" — ` + `puede sobreescribir registros de esta capa. ` + `Considera agregar condición excluyente sobre "${col}" en CAPA ${otherIdx + 1}.`);
                }
              });
            }

            // CASO 2: Ambas filtran misma columna — verificar si los sets son disjuntos
            thisCols.forEach(({
              col,
              src,
              op,
              filter: f
            }) => {
              const otherMatch = otherCols.find(c => c.col === col && c.src === src);
              if (!otherMatch) return;
              const of = otherMatch.filter;
              const fVals = getVals(f);
              const ofVals = getVals(of);
              if (fVals.length > 0 && ofVals.length > 0) {
                // NOT IN en la otra: verificar si excluye todos los valores de esta
                if (of.op === 'NOT IN') {
                  const notCovered = fVals.filter(v => !ofVals.includes(v));
                  if (notCovered.length > 0) {
                    warnings.push(`⚠️ Posible solapamiento en "${col}" con CAPA ${otherIdx + 1}: ` + `CAPA ${otherIdx + 1} usa NOT IN pero no excluye [${notCovered.slice(0, 4).join(', ')}${notCovered.length > 4 ? '...' : ''}].`);
                  }
                  // Si excluye todos → son excluyentes, sin aviso ✅
                  return;
                }
                // Ambas con valores enumerables: detectar intersección
                const shared = fVals.filter(v => ofVals.includes(v));
                if (shared.length > 0) {
                  warnings.push(`⚠️ Solapamiento en "${col}" con CAPA ${otherIdx + 1}: ` + `comparten [${shared.slice(0, 5).join(', ')}${shared.length > 5 ? '...' : ''}] — ` + `la capa posterior sobreescribirá esos registros.`);
                }
                // Sets completamente disjuntos → sin aviso ✅
              }

              // Rangos con mismo operador direccional
              if (['>', '>=', '<', '<='].includes(f.op) && f.op === of.op) {
                warnings.push(`⚠️ Ambas capas usan "${col} ${f.op}" — los rangos pueden solaparse. ` + `Verifica que los umbrales sean mutuamente excluyentes entre CAPA ${layerIdx + 1} y CAPA ${otherIdx + 1}.`);
              }
            });
          });
          return warnings;
        };

        // Componente de campo: select dropdown si hay columnas mapeadas, input si no
        // ColumnField ahora es estable: se pasan colsForSource como prop para evitar
        // que React desmonte/remonte el input al redefinir el componente en cada render.
        // Ver definición global: ColumnFieldComponent (justo antes de QUERY_LIBRARY).

        const renderFilterRow = (f, i, source, parentIdx) => {
          const indices = source === 'layer' ? [parentIdx, i] : i;
          const isContiene = f.op === 'CONTIENE';
          return /*#__PURE__*/React.createElement("div", {
            key: i,
            style: {
              marginBottom: '0.5rem',
              background: '#F8FAFC',
              padding: '0.5rem',
              borderRadius: '6px',
              border: '1px solid #E2E8F0'
            }
          }, /*#__PURE__*/React.createElement("div", {
            style: {
              display: 'grid',
              gridTemplateColumns: '50px 1fr 100px 30px 30px',
              gap: '0.4rem',
              alignItems: 'center',
              marginBottom: isContiene ? '0.4rem' : f.op === 'RAW' ? '0' : '0.4rem'
            }
          }, f.op !== 'RAW' ? /*#__PURE__*/React.createElement("select", {
            className: "input",
            style: {
              padding: '0.4rem',
              fontWeight: 'bold',
              color: f.source === 'a' ? 'var(--silver-main)' : '#C2410C'
            },
            value: f.source,
            onChange: e => modifyFilterHead(source, indices, 'source', e.target.value),
            title: "A (Cliente) / B (Gesti\xF3n)"
          }, /*#__PURE__*/React.createElement("option", {
            value: "a"
          }, "A"), /*#__PURE__*/React.createElement("option", {
            value: "b"
          }, "B")) : /*#__PURE__*/React.createElement("div", null), f.op === 'RAW' ? /*#__PURE__*/React.createElement("input", {
            className: "input input-code",
            style: {
              gridColumn: 'span 4',
              color: '#0F172A',
              fontWeight: 'bold'
            },
            placeholder: "SQL RAW: (a.X=1 OR b.Y=2)",
            value: f.vals[0]?.text || '',
            onChange: e => modifyValue(source, indices, 0, e.target.value)
          }) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(ColumnFieldComponent, {
            value: f.col,
            colsForSource: getColsForSource(f.source),
            onChange: val => modifyFilterHead(source, indices, 'col', val),
            placeholder: "Seleccionar campo"
          }), /*#__PURE__*/React.createElement("select", {
            className: "input",
            style: {
              fontSize: '0.8rem',
              padding: '0.4rem'
            },
            value: f.op,
            onChange: e => modifyFilterHead(source, indices, 'op', e.target.value)
          }, /*#__PURE__*/React.createElement("option", {
            value: "="
          }, "="), /*#__PURE__*/React.createElement("option", {
            value: "<>"
          }, "\u2260"), /*#__PURE__*/React.createElement("option", {
            value: ">"
          }, ">"), /*#__PURE__*/React.createElement("option", {
            value: ">="
          }, ">="), /*#__PURE__*/React.createElement("option", {
            value: "<"
          }, "<"), /*#__PURE__*/React.createElement("option", {
            value: "<="
          }, "<="), /*#__PURE__*/React.createElement("option", {
            value: "IN"
          }, "IN"), /*#__PURE__*/React.createElement("option", {
            value: "NOT IN"
          }, "!IN"), /*#__PURE__*/React.createElement("option", {
            value: "LIKE"
          }, "LIKE"), /*#__PURE__*/React.createElement("option", {
            value: "CONTIENE"
          }, "CONTIENE"), /*#__PURE__*/React.createElement("option", {
            value: "IS NULL"
          }, "NULL"), /*#__PURE__*/React.createElement("option", {
            value: "IS NOT NULL"
          }, "!NULL"), /*#__PURE__*/React.createElement("option", {
            value: "RAW"
          }, "RAW")), /*#__PURE__*/React.createElement("button", {
            className: "btn",
            style: {
              padding: 0,
              color: f.isStr ? '#2563EB' : '#94A3B8',
              border: f.isStr ? '1px solid #2563EB' : '1px solid #E2E8F0',
              background: f.isStr ? '#EFF6FF' : 'white',
              fontWeight: 'bold',
              minWidth: '26px'
            },
            onClick: () => toggleStringMode(source, indices),
            title: f.isStr ? "Modo TEXTO — valor entre comillas 'x'. Click para quitar comillas (modo numérico)" : "Modo NUMÉRICO — valor sin comillas. Click para activar comillas (modo texto)"
          }, "\""), /*#__PURE__*/React.createElement("button", {
            className: "btn",
            style: {
              padding: 0,
              color: '#EF4444',
              background: 'transparent'
            },
            onClick: () => removeFilter(source, indices)
          }, "\u2715"))), isContiene && /*#__PURE__*/React.createElement("div", {
            style: {
              paddingLeft: '55px'
            }
          }, /*#__PURE__*/React.createElement("button", {
            className: "btn",
            style: {
              padding: '0.2rem 0.6rem',
              fontSize: '0.7rem',
              background: '#EFF6FF',
              color: '#1D4ED8',
              border: '1px solid #BFDBFE',
              marginBottom: '0.4rem'
            },
            onClick: () => loadContainsValues(source, indices)
          }, "\uD83D\uDD0D Cargar valores del campo"), f.vals.length > 0 && /*#__PURE__*/React.createElement("div", {
            style: {
              marginBottom: '0.3rem'
            }
          }, /*#__PURE__*/React.createElement("div", {
            style: {
              display: 'flex',
              gap: '0.4rem',
              marginBottom: '0.3rem'
            }
          }, /*#__PURE__*/React.createElement("button", {
            className: "btn",
            style: {
              padding: '1px 6px',
              fontSize: '0.65rem',
              background: '#DBEAFE',
              color: '#1D4ED8',
              border: '1px solid #93C5FD'
            },
            onClick: () => {
              const allChecked = f.vals.every(v => v.checked !== false);
              const newVals = f.vals.map(v => ({
                ...v,
                checked: !allChecked
              }));
              if (source === 'layer') {
                const [lIdx, fIdx] = indices;
                const next = [...params.layers];
                next[lIdx].filters[fIdx].vals = newVals;
                updateLayers(next);
              } else {
                const next = {
                  ...params.agenda,
                  filters: [...params.agenda.filters]
                };
                next.filters[typeof indices === 'number' ? indices : indices[1]].vals = newVals;
                updateAgenda(next);
              }
            }
          }, f.vals.every(v => v.checked !== false) ? '☐ Desmarcar todo' : '☑ Marcar todo'), /*#__PURE__*/React.createElement("span", {
            style: {
              fontSize: '0.65rem',
              color: '#64748B'
            }
          }, "(", f.vals.filter(v => v.checked !== false).length, "/", f.vals.length, " seleccionados)")), /*#__PURE__*/React.createElement("div", {
            style: {
              maxHeight: '140px',
              overflowY: 'auto',
              background: '#F1F5F9',
              borderRadius: '4px',
              padding: '0.4rem',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.3rem'
            }
          }, f.vals.map((v, vIdx) => /*#__PURE__*/React.createElement("label", {
            key: v.id,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.75rem',
              cursor: 'pointer',
              background: v.checked !== false ? '#DBEAFE' : 'white',
              padding: '2px 6px',
              borderRadius: '4px',
              border: `1px solid ${v.checked !== false ? '#93C5FD' : '#CBD5E1'}`
            }
          }, /*#__PURE__*/React.createElement("input", {
            type: "checkbox",
            checked: v.checked !== false,
            onChange: () => toggleCheckVal(source, indices, vIdx)
          }), v.text || '(vacío)'))))), f.op !== 'RAW' && !f.op.includes('NULL') && !isContiene && /*#__PURE__*/React.createElement("div", {
            style: {
              paddingLeft: '55px'
            }
          }, f.vals.map((valObj, vIdx) => /*#__PURE__*/React.createElement("div", {
            key: valObj.id,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '0.3rem'
            }
          }, vIdx > 0 && /*#__PURE__*/React.createElement("span", {
            style: {
              fontSize: '0.7rem',
              fontWeight: 'bold',
              color: '#F59E0B',
              width: '20px'
            }
          }, "OR"), /*#__PURE__*/React.createElement("input", {
            className: "input",
            style: {
              fontSize: '0.8rem',
              padding: '0.4rem',
              flex: 1
            },
            placeholder: "Valor",
            value: valObj.text,
            onChange: e => modifyValue(source, indices, vIdx, e.target.value)
          }), vIdx === 0 ? /*#__PURE__*/React.createElement("button", {
            className: "btn",
            style: {
              padding: '0.2rem 0.5rem',
              fontSize: '0.7rem',
              background: '#ECFDF5',
              color: '#059669',
              border: '1px solid #A7F3D0'
            },
            onClick: () => addValue(source, indices),
            title: "Agregar condici\xF3n OR"
          }, "+ OR") : /*#__PURE__*/React.createElement("button", {
            className: "btn",
            style: {
              padding: 0,
              color: '#EF4444',
              background: 'transparent'
            },
            onClick: () => removeValue(source, indices, vIdx)
          }, "\u2715")))));
        };

        // Panel de últimas estrategias guardadas
        const StrategyLogPanel = () => {
          const [log, setLog] = React.useState(getStrategyLog());
          const [expanded, setExpanded] = React.useState(false);
          const entries = Object.entries(log);
          if (entries.length === 0) return null;
          return /*#__PURE__*/React.createElement("div", {
            style: {
              background: '#F0FDF4',
              border: '1px solid #BBF7D0',
              borderRadius: '8px',
              marginBottom: '1.5rem',
              overflow: 'hidden'
            }
          }, /*#__PURE__*/React.createElement("div", {
            style: {
              padding: '0.75rem 1rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
              background: '#DCFCE7'
            },
            onClick: () => setExpanded(!expanded)
          }, /*#__PURE__*/React.createElement("span", {
            style: {
              fontWeight: 'bold',
              fontSize: '0.8rem',
              color: '#166534'
            }
          }, "\uD83D\uDCCB \xDAltimas Estrategias Guardadas (", entries.length, ")"), /*#__PURE__*/React.createElement("span", {
            style: {
              color: '#166534'
            }
          }, expanded ? '▲' : '▼')), expanded && /*#__PURE__*/React.createElement("div", {
            style: {
              maxHeight: '250px',
              overflowY: 'auto'
            }
          }, entries.map(([camp, data]) => /*#__PURE__*/React.createElement("div", {
            key: camp,
            style: {
              padding: '0.75rem 1rem',
              borderTop: '1px solid #BBF7D0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }
          }, /*#__PURE__*/React.createElement("div", {
            style: {
              flex: 1
            }
          }, /*#__PURE__*/React.createElement("strong", {
            style: {
              fontSize: '0.85rem',
              color: '#166534'
            }
          }, camp), /*#__PURE__*/React.createElement("span", {
            style: {
              fontSize: '0.72rem',
              color: '#4ADE80',
              marginLeft: '0.5rem'
            }
          }, data.savedAt ? new Date(data.savedAt).toLocaleString() : ''), /*#__PURE__*/React.createElement("div", {
            style: {
              fontSize: '0.72rem',
              color: '#475569'
            }
          }, data.layers?.length || 0, " capa(s) \u2014 Estrategia: ", data.strategyCol || '?', " \u2014 Mes Guardado: ", data.mesCarga || '?')), /*#__PURE__*/React.createElement("div", {
            style: {
              display: 'flex',
              gap: '0.5rem',
              flexShrink: 0
            }
          }, /*#__PURE__*/React.createElement("button", {
            className: "btn",
            style: {
              padding: '0.3rem 0.7rem',
              fontSize: '0.75rem',
              background: '#166534',
              color: 'white'
            },
            onClick: () => {
              // Cargar log pero actualizar mes de carga al actual
              const freshData = {
                ...data,
                mesCarga: getNexusDate(),
                savedAt: undefined
              };
              update(freshData);
              addToast(`Estrategia de ${camp} precargada. Mes de carga actualizado a ${getNexusDate()}.`, 'success');
            }
          }, "\u2B06\uFE0F Cargar"), /*#__PURE__*/React.createElement("button", {
            className: "btn",
            style: {
              padding: '0.3rem 0.7rem',
              fontSize: '0.75rem',
              background: '#EF4444',
              color: 'white'
            },
            onClick: () => {
              deleteStrategyLog(camp);
              setLog(getStrategyLog());
              addToast(`Log de ${camp} eliminado.`, 'info');
            }
          }, "\uD83D\uDDD1\uFE0F"))))));
        };

        // Indicador de columnas mapeadas
        const MappedColumnsInfo = () => {
          if (allMappedCols.length === 0) return /*#__PURE__*/React.createElement("div", {
            style: {
              background: '#FEF2F2',
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px dashed #FCA5A5',
              marginBottom: '1rem',
              fontSize: '0.75rem',
              color: '#EF4444'
            }
          }, "\u26A0\uFE0F Seleccione una campa\xF1a del Asistente de Entorno para mapear columnas autom\xE1ticamente. Los campos de filtro ser\xE1n de escritura libre hasta que se mapeen.");
          return /*#__PURE__*/React.createElement("div", {
            style: {
              background: '#F0F9FF',
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #BAE6FD',
              marginBottom: '1rem',
              fontSize: '0.73rem',
              color: '#0369A1',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }
          }, /*#__PURE__*/React.createElement("span", null, "\u2705 ", allMappedCols.length, " columnas mapeadas \u2014 Los campos de filtro est\xE1n disponibles como lista desplegable."), /*#__PURE__*/React.createElement("button", {
            className: "btn",
            style: {
              padding: '2px 8px',
              fontSize: '0.68rem',
              background: '#E0F2FE',
              color: '#0369A1',
              border: '1px solid #7DD3FC'
            },
            onClick: () => addToast(`Columnas: ${allMappedCols.join(', ')}`, 'info')
          }, "Ver columnas"));
        };
        return /*#__PURE__*/React.createElement("div", {
          className: "fade-in"
        }, /*#__PURE__*/React.createElement(CampaignAutoFiller, {
          update: obj => update(obj),
          onColumnsMapped: (allCols, campName, colsA, colsB, clientTable, mgmtTable, customerDb) => {
            // colsA = columnas tabla Cliente, colsB = columnas tabla Gestión
            // allCols = unión deduplicada (ya resuelta por el caller con datos frescos)
            const updateObj = {
              mappedColumns: allCols,
              columnsA: colsA || [],
              columnsB: colsB || []
            };

            // Detectar columna mes carga (buscar primero en A, luego en B)
            const mesCargaCol = allCols.find(c => /^MES_?CARGA$/i.test(c));
            if (mesCargaCol) {
              updateObj.mesCargaCol = mesCargaCol;
              updateObj.mesCargaColDetected = true;
              addToast(`✅ Columna mes carga detectada: ${mesCargaCol}`, 'success');
            } else {
              updateObj.mesCargaColDetected = false;
              addToast(`⚠️ No se detectó MES_CARGA ni MESCARGA en "${campName}". Verifique manualmente.`, 'error');
            }

            // Detectar columna estrategia
            const stratCol = allCols.find(c => /^MCA_?ESTRATEGIA$/i.test(c));
            if (stratCol) {
              updateObj.strategyCol = stratCol;
              updateObj.strategyColDetected = true;
              addToast(`✅ Columna estrategia detectada: ${stratCol}`, 'success');
            } else {
              updateObj.strategyColDetected = false;
              addToast(`⚠️ No se detectó MCA_ESTRATEGIA ni MCAESTRATEGIA en "${campName}". Ingrese el campo manualmente.`, 'error');
            }

            // Advertir si el mapeo quedó vacío (tabla inaccesible)
            if (allCols.length === 0) {
              addToast(`⚠️ No se pudieron mapear columnas de "${campName}". Verifique permisos o nombre de tablas.`, 'error');
            } else {
              addToast(`📋 ${allCols.length} columnas mapeadas (A:${colsA.length} + B:${colsB.length})`, 'info');
            }

            // Precargar último log guardado para esta campaña
            const log = getStrategyLog();
            if (log[campName]) {
              const saved = log[campName];
              updateObj.layers = saved.layers || updateObj.layers;
              updateObj.agenda = saved.agenda || updateObj.agenda;
              updateObj.resetCanvas = saved.resetCanvas !== undefined ? saved.resetCanvas : true;
              addToast(`📋 Última estrategia de "${campName}" precargada.`, 'info');
            }
            update(updateObj);
          }
        }), /*#__PURE__*/React.createElement(StrategyLogPanel, {
          key: params._logVersion || 0
        }), /*#__PURE__*/React.createElement(MappedColumnsInfo, null), /*#__PURE__*/React.createElement("div", {
          style: {
            background: '#F8FAFC',
            padding: '1rem',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            border: '1px solid #E2E8F0'
          }
        }, /*#__PURE__*/React.createElement("h4", {
          style: {
            marginTop: 0,
            fontSize: '0.75rem',
            color: '#64748B',
            textTransform: 'uppercase'
          }
        }, "Verificaci\xF3n de Entorno"), /*#__PURE__*/React.createElement("div", {
          className: "form-grid",
          style: {
            marginBottom: '1rem',
            gridTemplateColumns: '2fr 1fr 2fr'
          }
        }, /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Campa\xF1a"), /*#__PURE__*/React.createElement("input", {
          className: "input",
          value: params.campaign,
          onChange: e => update('campaign', e.target.value)
        })), /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Customer ID"), /*#__PURE__*/React.createElement("input", {
          className: "input",
          type: "number",
          value: params.customerId,
          onChange: e => update('customerId', e.target.value)
        })), /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "BBDD Exacta"), /*#__PURE__*/React.createElement("input", {
          className: "input",
          value: params.customerDb || '',
          onChange: e => update('customerDb', e.target.value)
        }))), /*#__PURE__*/React.createElement("div", {
          className: "form-grid",
          style: {
            marginBottom: '1rem',
            gridTemplateColumns: '1fr 1fr 1fr'
          }
        }, /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Tabla A (Cliente)"), /*#__PURE__*/React.createElement("input", {
          className: "input input-code",
          value: params.clientTable,
          onChange: e => update('clientTable', e.target.value)
        })), /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Tabla B (Gesti\xF3n)"), /*#__PURE__*/React.createElement("input", {
          className: "input input-code",
          value: params.mgmtTable,
          onChange: e => update('mgmtTable', e.target.value)
        })), /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Col. Estrategia ", params.strategyColDetected ? '✅' : ''), /*#__PURE__*/React.createElement("input", {
          className: "input input-code",
          value: params.strategyCol,
          onChange: e => update('strategyCol', e.target.value),
          style: {
            borderColor: params.strategyCol ? params.strategyColDetected ? '#86EFAC' : '#FDE68A' : '#FCA5A5',
            background: params.strategyCol ? params.strategyColDetected ? '#F0FDF4' : '#FFFBEB' : '#FEF2F2'
          }
        }), !params.strategyCol && /*#__PURE__*/React.createElement("span", {
          style: {
            fontSize: '0.7rem',
            color: '#EF4444'
          }
        }, "\u26A0\uFE0F Requerido"), params.strategyCol && !params.strategyColDetected && /*#__PURE__*/React.createElement("span", {
          style: {
            fontSize: '0.7rem',
            color: '#D97706'
          }
        }, "\u26A0\uFE0F No detectado \u2014 verificar manualmente"))), /*#__PURE__*/React.createElement("div", {
          className: "form-grid",
          style: {
            gridTemplateColumns: '1fr 1fr'
          }
        }, /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Mes de Carga (universo base)"), /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'flex',
            gap: '0.4rem'
          }
        }, /*#__PURE__*/React.createElement("input", {
          className: "input input-code",
          value: params.mesCarga,
          onChange: e => update('mesCarga', e.target.value),
          style: {
            fontWeight: 'bold',
            color: '#1D4ED8'
          },
          placeholder: "Ej: MARZO_26"
        }), /*#__PURE__*/React.createElement("button", {
          className: "btn",
          style: {
            padding: '0 0.6rem',
            background: '#EFF6FF',
            color: '#1D4ED8',
            border: '1px solid #BFDBFE',
            fontSize: '0.85rem'
          },
          onClick: () => update('mesCarga', getNexusDate()),
          title: "Mes actual"
        }, "\uD83D\uDCC5"))), /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Columna Mes Carga ", params.mesCargaColDetected ? '✅' : ''), /*#__PURE__*/React.createElement("input", {
          className: "input input-code",
          value: params.mesCargaCol,
          onChange: e => update('mesCargaCol', e.target.value),
          placeholder: "MES_CARGA o MESCARGA",
          style: {
            borderColor: params.mesCargaColDetected ? '#86EFAC' : '#FDE68A',
            background: params.mesCargaColDetected ? '#F0FDF4' : '#FFFBEB'
          }
        }), !params.mesCargaColDetected && /*#__PURE__*/React.createElement("span", {
          style: {
            fontSize: '0.7rem',
            color: '#D97706'
          }
        }, "\u26A0\uFE0F No detectada \u2014 verificar"))), /*#__PURE__*/React.createElement("div", {
          style: {
            marginTop: '0.75rem'
          }
        }, /*#__PURE__*/React.createElement("label", {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.85rem',
            cursor: 'pointer',
            fontWeight: 'bold',
            color: '#64748B'
          }
        }, /*#__PURE__*/React.createElement("input", {
          type: "checkbox",
          checked: params.resetCanvas,
          onChange: e => update('resetCanvas', e.target.checked)
        }), "\uD83E\uDDF9 Limpiar todo a 0 (UPDATE ", params.clientTable, " SET ", params.strategyCol, "=0 WHERE ", params.mesCargaCol, "='", params.mesCarga, "')"))), /*#__PURE__*/React.createElement("div", {
          style: {
            marginBottom: '2rem'
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.5rem'
          }
        }, /*#__PURE__*/React.createElement("span", {
          className: "label"
        }, "Capas de Estrategia"), /*#__PURE__*/React.createElement("button", {
          className: "btn btn-primary",
          style: {
            padding: '0.3rem 0.8rem',
            fontSize: '0.8rem'
          },
          onClick: () => updateLayers([...params.layers, {
            id: Date.now(),
            value: String(params.layers.length + 1),
            label: '',
            filters: []
          }])
        }, "+ Nueva Capa")), params.layers.map((layer, lIdx) => {
          const warnings = checkLayerExclusivity(lIdx);
          return /*#__PURE__*/React.createElement("div", {
            key: layer.id,
            style: {
              background: 'white',
              border: `2px solid ${warnings.length > 0 ? '#FDE68A' : '#E2E8F0'}`,
              borderRadius: '8px',
              marginBottom: '1rem',
              padding: '1rem',
              boxShadow: warnings.length > 0 ? '0 0 8px rgba(253,230,138,0.4)' : '0 2px 4px rgba(0,0,0,0.02)'
            }
          }, /*#__PURE__*/React.createElement("div", {
            style: {
              display: 'flex',
              gap: '0.6rem',
              alignItems: 'flex-end',
              marginBottom: '1rem',
              paddingBottom: '0.75rem',
              borderBottom: '1px dashed #E2E8F0',
              flexWrap: 'wrap'
            }
          }, /*#__PURE__*/React.createElement("div", {
            style: {
              background: '#F1F5F9',
              color: '#64748B',
              fontWeight: 'bold',
              padding: '0.4rem 0.6rem',
              borderRadius: '4px',
              fontSize: '0.8rem',
              flexShrink: 0,
              marginBottom: '1px'
            }
          }, "#", lIdx + 1), /*#__PURE__*/React.createElement("div", {
            style: {
              flex: 2,
              minWidth: '140px'
            }
          }, /*#__PURE__*/React.createElement("div", {
            style: {
              fontSize: '0.68rem',
              color: '#64748B',
              marginBottom: '3px',
              fontWeight: 'bold'
            }
          }, "\uD83C\uDFAF Campo a marcar"), /*#__PURE__*/React.createElement(ColumnFieldComponent, {
            value: layer.markCol !== undefined ? layer.markCol : params.strategyCol || '',
            colsForSource: allMappedCols,
            onChange: val => {
              const n = [...params.layers];
              n[lIdx].markCol = val;
              updateLayers(n);
            },
            placeholder: "Col. estrategia"
          })), /*#__PURE__*/React.createElement("div", {
            style: {
              fontWeight: 'bold',
              color: '#475569',
              fontSize: '1.1rem',
              flexShrink: 0,
              paddingBottom: '6px'
            }
          }, "="), /*#__PURE__*/React.createElement("div", {
            style: {
              width: '72px',
              flexShrink: 0
            }
          }, /*#__PURE__*/React.createElement("div", {
            style: {
              fontSize: '0.68rem',
              color: '#64748B',
              marginBottom: '3px',
              fontWeight: 'bold'
            }
          }, "Valor"), /*#__PURE__*/React.createElement("input", {
            className: "input",
            placeholder: "1",
            value: layer.value,
            onChange: e => {
              const n = [...params.layers];
              n[lIdx].value = e.target.value;
              updateLayers(n);
            },
            style: {
              background: '#F0FDF4',
              borderColor: '#86EFAC',
              fontWeight: 'bold',
              color: '#166534',
              textAlign: 'center'
            }
          })), /*#__PURE__*/React.createElement("div", {
            style: {
              flex: 2,
              minWidth: '110px'
            }
          }, /*#__PURE__*/React.createElement("div", {
            style: {
              fontSize: '0.68rem',
              color: '#94A3B8',
              marginBottom: '3px'
            }
          }, "Descripci\xF3n (opcional)"), /*#__PURE__*/React.createElement("input", {
            className: "input",
            placeholder: "Ej: Tramo 1, VIP...",
            value: layer.label,
            onChange: e => {
              const n = [...params.layers];
              n[lIdx].label = e.target.value;
              updateLayers(n);
            },
            style: {
              fontSize: '0.8rem',
              color: '#64748B'
            }
          })), /*#__PURE__*/React.createElement("button", {
            className: "btn",
            style: {
              padding: '0.4rem',
              color: '#EF4444',
              background: 'transparent',
              flexShrink: 0,
              marginBottom: '1px'
            },
            onClick: () => updateLayers(params.layers.filter((_, i) => i !== lIdx))
          }, "\u2715")), warnings.length > 0 && /*#__PURE__*/React.createElement("div", {
            style: {
              background: '#FFFBEB',
              border: '1px solid #FDE68A',
              borderRadius: '6px',
              padding: '0.5rem 0.75rem',
              marginBottom: '0.75rem'
            }
          }, warnings.map((w, wi) => /*#__PURE__*/React.createElement("div", {
            key: wi,
            style: {
              fontSize: '0.75rem',
              color: '#92400E'
            }
          }, w))), /*#__PURE__*/React.createElement("div", {
            style: {
              background: '#F8FAFC',
              padding: '0.5rem',
              borderRadius: '6px'
            }
          }, /*#__PURE__*/React.createElement("div", {
            style: {
              fontSize: '0.72rem',
              color: '#94A3B8',
              marginBottom: '0.4rem',
              fontStyle: 'italic'
            }
          }, "\uD83D\uDCCC Universo base: ", params.mesCargaCol, " = '", params.mesCarga, "' (aplicado autom\xE1ticamente)"), (layer.filters || []).map((f, i) => renderFilterRow(f, i, 'layer', lIdx)), /*#__PURE__*/React.createElement("button", {
            className: "btn",
            style: {
              fontSize: '0.7rem',
              padding: '0.2rem 0.5rem',
              background: 'white',
              border: '1px solid #CBD5E1',
              color: '#475569'
            },
            onClick: () => addFilter('layer', lIdx)
          }, "+ Filtro AND")));
        })), /*#__PURE__*/React.createElement("div", {
          style: {
            background: '#FFF7ED',
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid #FED7AA',
            marginBottom: '1.5rem'
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: params.agenda.active ? '1rem' : 0
          }
        }, /*#__PURE__*/React.createElement("label", {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.9rem',
            fontWeight: 'bold',
            color: '#9A3412',
            cursor: 'pointer'
          }
        }, /*#__PURE__*/React.createElement("input", {
          type: "checkbox",
          checked: params.agenda.active,
          onChange: e => update('agenda', {
            ...params.agenda,
            active: e.target.checked
          })
        }), "\uD83D\uDEE1\uFE0F Protecci\xF3n Agendas"), params.agenda.active && /*#__PURE__*/React.createElement("input", {
          className: "input",
          style: {
            width: '80px',
            textAlign: 'center',
            fontWeight: 'bold'
          },
          value: params.agenda.targetVal,
          onChange: e => update('agenda', {
            ...params.agenda,
            targetVal: e.target.value
          }),
          placeholder: "94"
        })), params.agenda.active && /*#__PURE__*/React.createElement("div", {
          style: {
            background: 'white',
            padding: '0.5rem',
            borderRadius: '6px',
            border: '1px solid #FFEDD5'
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: '0.72rem',
            color: '#94A3B8',
            marginBottom: '0.4rem',
            fontStyle: 'italic'
          }
        }, "\uD83D\uDCCC Universo base: ", params.mesCargaCol, " = '", params.mesCarga, "' (aplicado autom\xE1ticamente)"), (params.agenda.filters || []).map((f, i) => renderFilterRow(f, i, 'agenda', null)), /*#__PURE__*/React.createElement("button", {
          className: "btn",
          style: {
            fontSize: '0.7rem',
            padding: '0.2rem 0.5rem',
            background: '#FFF7ED',
            border: '1px solid #FED7AA',
            color: '#9A3412'
          },
          onClick: () => addFilter('agenda')
        }, "+ Condici\xF3n"))), params.campaign && /*#__PURE__*/React.createElement("div", {
          style: {
            background: '#F0F9FF',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            border: '1px solid #BAE6FD',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem'
          }
        }, /*#__PURE__*/React.createElement("span", {
          style: {
            fontSize: '0.8rem',
            color: '#0369A1'
          }
        }, "\uD83D\uDCBE Guardar esta estrategia para la campa\xF1a ", /*#__PURE__*/React.createElement("strong", null, params.campaign)), /*#__PURE__*/React.createElement("button", {
          className: "btn",
          style: {
            padding: '0.3rem 0.8rem',
            fontSize: '0.75rem',
            background: '#0369A1',
            color: 'white'
          },
          onClick: () => {
            saveStrategyLog(params.campaign, params).then(() => {
              addToast(`Estrategia guardada para ${params.campaign}. Se sobreescribió el log anterior.`, 'success');
              // Forzar re-render del panel de logs incrementando la key
              update('_logVersion', (params._logVersion || 0) + 1);
            });
          }
        }, "\uD83D\uDCBE Guardar Log")), /*#__PURE__*/React.createElement("div", {
          style: {
            background: '#FFFBEB',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            border: '1px solid #FDE68A',
            fontSize: '0.8rem',
            color: '#92400E',
            lineHeight: '1.5'
          }
        }, "\uD83D\uDCE2 ", /*#__PURE__*/React.createElement("strong", null, "Recordatorio:"), " Incluir desde la interfaz en Vocalcom la columna ", /*#__PURE__*/React.createElement("strong", null, params.strategyCol), " a priorizar y reciclar la capa de ser necesario. Tambi\xE9n recuerde excluir ", /*#__PURE__*/React.createElement("strong", null, params.strategyCol, "=0"), " y las dem\xE1s marcas de estrategia que no se priorizar\xE1n, dejando priorizados solo los registros requeridos."));
      }
    },
    // --- MÓDULO 3: ESTADOS DE CONEXIÓN DE AGENTES ---
    'agent_connection_states': {
      meta: {
        icon: 'users',
        label: 'Estados de Conexión',
        desc: 'Historial de logueo, estados y tiempos por Agente. Soporta vivo y backups.'
      },
      defaultParams: {
        customerId: '1',
        agentIds: '1205',
        dateMode: 'range',
        fechaInicio: new Date().toISOString().split('T')[0],
        fechaFin: new Date().toISOString().split('T')[0],
        fechasPuntuales: '2026-02-01\n2026-02-03\n2026-02-05',
        selectedStates: []
      },
      generateSQL: params => {
        let targetYears = new Set();
        let dateCondition = '';
        let headerVars = '';
        if (params.dateMode === 'range') {
          const startY = parseInt(params.fechaInicio.split('-')[0]);
          const endY = parseInt(params.fechaFin.split('-')[0]);
          for (let y = startY; y <= endY; y++) targetYears.add(y);
          headerVars = `DECLARE @StartDate DATETIME = '${params.fechaInicio} 00:00:00';\nDECLARE @EndDate DATETIME = DATEADD(dd, 1, '${params.fechaFin} 00:00:00');\n\n`;
          dateCondition = `ActionLocalTime >= @StartDate AND ActionLocalTime < @EndDate`;
        } else {
          const dates = params.fechasPuntuales.split(/[\n,]+/).map(d => d.trim()).filter(d => d);
          dates.forEach(d => {
            const parts = d.split('-');
            if (parts.length > 0) targetYears.add(parseInt(parts[0]));
          });
          const dateList = dates.map(d => `'${d}'`).join(', ');
          dateCondition = `CAST(ActionLocalTime AS DATE) IN (${dateList})`;
        }
        const agentsClean = params.agentIds.split(/[\n,]+/).map(a => a.trim()).filter(a => a).join(', ');
        const agentCondition = agentsClean.includes(',') ? `AgentID IN (${agentsClean})` : `AgentID = ${agentsClean}`;
        let stateCondition = '';
        if (params.selectedStates && params.selectedStates.length > 0) {
          const statePairs = params.selectedStates.map(sv => {
            const [s, d] = sv.split('|');
            return `(State = ${s} AND StateDetail = ${d})`;
          });
          stateCondition = `\n    AND (${statePairs.join(' OR ')})`;
        }
        const currentYear = new Date().getFullYear();
        const allYears = Array.from(targetYears).sort((a, b) => b - a);
        const unionParts = allYears.map(year => {
          const tableName = year === currentYear ? `HN_Ondata..ODActions` : `BackupOnData..ODActions_${year}`;
          return `    SELECT AgentID, ActionLocalTime, State, StateDetail FROM ${tableName} WHERE ${agentCondition} AND ${dateCondition}${stateCondition}`;
        });
        if (unionParts.length === 0) unionParts.push(`    SELECT AgentID, ActionLocalTime, State, StateDetail FROM HN_Ondata..ODActions WHERE ${agentCondition} AND ${dateCondition}${stateCondition}`);
        return `-- [NEXUS BUILDER: ESTADOS DE CONEXIÓN]\n\n${headerVars}SELECT \n    a.AgentID,\n    ag.FirstName + ' ' + ag.LastName AS NombreAgente,\n    CONVERT(varchar(10), a.ActionLocalTime, 105) + ' ' + CONVERT(varchar(8), a.ActionLocalTime, 108) AS FechaHora,\n    CONVERT(varchar(10), a.ActionLocalTime, 105) AS Fecha,\n    CONVERT(varchar(5), a.ActionLocalTime, 108) AS Hora,\n    a.State,\n    a.StateDetail,\n    ISNULL(st.Description, \n        CASE \n            WHEN a.State = 0 AND a.StateDetail = -1 THEN 'LogOut' \n            ELSE 'Desconocido' \n        END\n    ) AS EstadoDescripcion\nFROM (\n${unionParts.join('\n    UNION ALL\n')}\n) a\nLEFT JOIN HN_Admin..ListAgents ag ON ag.ident = a.AgentID\nLEFT JOIN HN_Ondata..States st ON a.State = st.State AND a.StateDetail = st.Detail\nORDER BY a.AgentID, a.ActionLocalTime;\n`;
      },
      renderForm: (params, update) => {
        const KNOWN_STATES = [{
          s: 0,
          d: 0,
          label: 'Login'
        }, {
          s: 0,
          d: -1,
          label: 'LogOut'
        }, {
          s: 1,
          d: 0,
          label: 'Waiting'
        }, {
          s: 2,
          d: 0,
          label: 'Working'
        }, {
          s: 3,
          d: -1,
          label: 'Pause'
        }, {
          s: 7,
          d: 0,
          label: 'Wrapup'
        }, {
          s: 9,
          d: 0,
          label: 'Preview'
        }, {
          s: 96,
          d: 0,
          label: 'Search mode'
        }, {
          s: 100,
          d: 0,
          label: 'Online'
        }, {
          s: 1001,
          d: 0,
          label: 'Dialing for a consultation call'
        }, {
          s: 1002,
          d: 0,
          label: 'Online for a consultation call (talking with the first contact)'
        }, {
          s: 1003,
          d: 0,
          label: 'Online with client on hold'
        }, {
          s: 1004,
          d: 0,
          label: 'Online for a conference call'
        }, {
          s: 1005,
          d: 0,
          label: 'Online for a consultation call (talking with the second contact)'
        }, {
          s: 1006,
          d: 0,
          label: 'Online, called by another agent for a consultation'
        }];
        const toggleState = val => {
          const cur = params.selectedStates || [];
          update('selectedStates', cur.includes(val) ? cur.filter(s => s !== val) : [...cur, val]);
        };
        return /*#__PURE__*/React.createElement("div", {
          className: "fade-in"
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            background: '#F8FAFC',
            padding: '1rem',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            border: '1px solid #E2E8F0'
          }
        }, /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Agent ID(s) (Separados por coma o enter)"), /*#__PURE__*/React.createElement("textarea", {
          className: "input input-code",
          style: {
            minHeight: '60px',
            resize: 'vertical',
            fontSize: '1rem',
            fontWeight: 'bold',
            color: '#1D4ED8'
          },
          value: params.agentIds,
          onChange: e => update('agentIds', e.target.value),
          placeholder: "Ej: 1205, 1206, 1207"
        }), /*#__PURE__*/React.createElement("div", {
          style: {
            fontSize: '0.75rem',
            color: '#64748B',
            marginTop: '4px'
          }
        }, "\uD83D\uDCA1 Los estados de conexi\xF3n son globales por agente, no dependen de una campa\xF1a o base de datos."))), /*#__PURE__*/React.createElement("div", {
          style: {
            background: '#FFF7ED',
            padding: '1rem',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            border: '1px solid #FED7AA'
          }
        }, /*#__PURE__*/React.createElement("h4", {
          style: {
            marginTop: 0,
            fontSize: '0.8rem',
            color: '#9A3412',
            textTransform: 'uppercase',
            display: 'flex',
            justifyContent: 'space-between'
          }
        }, /*#__PURE__*/React.createElement("span", null, "Filtro de Fechas"), /*#__PURE__*/React.createElement("select", {
          className: "input",
          style: {
            width: 'auto',
            padding: '0.2rem',
            fontSize: '0.75rem'
          },
          value: params.dateMode,
          onChange: e => update('dateMode', e.target.value)
        }, /*#__PURE__*/React.createElement("option", {
          value: "range"
        }, "\uD83D\uDCC5 Rango Continuo"), /*#__PURE__*/React.createElement("option", {
          value: "specific"
        }, "\uD83D\uDCCC Fechas Puntuales"))), params.dateMode === 'range' ? /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'flex',
            gap: '1rem'
          }
        }, /*#__PURE__*/React.createElement("div", {
          className: "form-group",
          style: {
            flex: 1
          }
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Desde"), /*#__PURE__*/React.createElement("input", {
          type: "date",
          className: "input",
          value: params.fechaInicio,
          onChange: e => update('fechaInicio', e.target.value)
        })), /*#__PURE__*/React.createElement("div", {
          className: "form-group",
          style: {
            flex: 1
          }
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Hasta"), /*#__PURE__*/React.createElement("input", {
          type: "date",
          className: "input",
          value: params.fechaFin,
          onChange: e => update('fechaFin', e.target.value)
        }))) : /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Lista de Fechas (AAAA-MM-DD)"), /*#__PURE__*/React.createElement("textarea", {
          className: "input input-code",
          style: {
            minHeight: '80px',
            resize: 'vertical'
          },
          value: params.fechasPuntuales,
          onChange: e => update('fechasPuntuales', e.target.value),
          placeholder: "Ej:\\n2026-02-01\\n2026-02-05"
        }))), /*#__PURE__*/React.createElement("div", {
          style: {
            background: 'white',
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid #E2E8F0'
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.8rem'
          }
        }, /*#__PURE__*/React.createElement("label", {
          className: "label",
          style: {
            margin: 0
          }
        }, "Filtro de Estados (Opcional)"), /*#__PURE__*/React.createElement("span", {
          style: {
            fontSize: '0.7rem',
            color: '#64748B'
          }
        }, "*Si no seleccionas ninguno, se extraen todos")), /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '0.5rem',
            maxHeight: '200px',
            overflowY: 'auto',
            padding: '0.5rem',
            background: '#F1F5F9',
            borderRadius: '6px',
            border: '1px inset #E2E8F0'
          }
        }, KNOWN_STATES.map((st, i) => {
          const val = `${st.s}|${st.d}`;
          const isChecked = (params.selectedStates || []).includes(val);
          return /*#__PURE__*/React.createElement("label", {
            key: i,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.8rem',
              cursor: 'pointer',
              background: isChecked ? '#DBEAFE' : 'white',
              padding: '0.3rem 0.5rem',
              borderRadius: '4px',
              border: isChecked ? '1px solid #93C5FD' : '1px solid transparent'
            }
          }, /*#__PURE__*/React.createElement("input", {
            type: "checkbox",
            checked: isChecked,
            onChange: () => toggleState(val)
          }), /*#__PURE__*/React.createElement("strong", null, st.s, ",", st.d), " - ", /*#__PURE__*/React.createElement("span", {
            style: {
              color: '#475569'
            }
          }, st.label));
        }))));
      }
    },
    // --- MÓDULO 4: ORDENAMIENTO MIXUP MULTINIVEL ---
    'mixup_sorter': {
      meta: {
        icon: 'filter',
        label: 'Ordenamiento Mixup',
        desc: 'Reordena la base con factores dinámicos, restaura a INDICE o usa carga manual.'
      },
      defaultParams: {
        campaign: '',
        customerId: '1',
        clientTable: 'CLIENTE_',
        mgmtTable: 'C1_',
        mode: 'sort',
        whereFilters: [{
          id: Date.now(),
          source: 'a',
          col: 'MES_CARGA',
          op: '=',
          val: getNexusDate(),
          isStr: true
        }],
        levels: [{
          id: Date.now(),
          source: 'a',
          col: 'MONTO',
          type: 'number',
          dir: 'DESC',
          customList: ''
        }],
        manualData: '',
        manualColIndice: '',
        manualColMixup: ''
      },
      generateSQL: params => {
        let sql = `-- [NEXUS BUILDER: REORDENAMIENTO MIXUP]\n-- Campaña: ${params.campaign}\n\nSET LANGUAGE Spanish;\n\n`;
        const buildWhere = () => {
          const valid = params.whereFilters.filter(f => f.col.trim() !== '');
          if (valid.length === 0) return '';
          const clauses = valid.map((f, i) => {
            const prefix = f.source === 'a' ? 'a.' : 'b.';
            const quote = f.isStr ? `'${f.val}'` : f.val;
            return `${i === 0 ? 'WHERE ' : '  AND '}${prefix}${f.col} ${f.op} ${quote}`;
          });
          return clauses.join('\n');
        };
        const whereStr = buildWhere();
        const needsJoin = params.whereFilters.some(f => f.source === 'b') || params.levels.some(l => l.source === 'b');
        const joinStr = needsJoin ? `\n    JOIN ${formatTable(params.mgmtTable, params.customerDb)} b ON a.INDICE = b.INDICE` : '';
        if (params.mode === 'restore') {
          sql += `-- MODO: RESTAURAR A INDICE\nUPDATE b\nSET b.MIXUP = b.INDICE\nFROM ${formatTable(params.mgmtTable, params.customerDb)} b\nJOIN ${formatTable(params.clientTable, params.customerDb)} a ON a.INDICE = b.INDICE\n${whereStr};\n`;
          return sql;
        }
        if (params.mode === 'manual') {
          const rows = params.manualData.split('\n').map(r => r.trim()).filter(r => r);
          if (rows.length < 2) return '-- ERROR: SE REQUIEREN DATOS Y ENCABEZADOS';
          const firstRow = rows[0];
          const sep = firstRow.includes('\t') ? '\t' : firstRow.includes(';') ? ';' : ',';
          const headers = firstRow.split(sep).map(h => h.trim());
          const idxPos = headers.indexOf(params.manualColIndice);
          const mixPos = headers.indexOf(params.manualColMixup);
          if (idxPos === -1 || mixPos === -1) return '-- ERROR: SELECCIONA LAS COLUMNAS DE INDICE Y ORDEN EN LA INTERFAZ';
          const updateLines = [];
          for (let i = 1; i < rows.length; i++) {
            const parts = rows[i].split(sep);
            if (parts.length > Math.max(idxPos, mixPos)) {
              const idx = parts[idxPos].trim();
              const mix = parts[mixPos].trim();
              if (idx && mix && !isNaN(idx) && !isNaN(mix)) updateLines.push(`    UPDATE ${formatTable(params.mgmtTable, params.customerDb)} SET MIXUP = ${mix} WHERE INDICE = ${idx};`);
            }
          }
          if (updateLines.length === 0) return '-- ERROR: NO SE EXTRAJERON DATOS VALIDOS';
          sql += `-- MODO: CARGA MANUAL DIRECTA\nBEGIN TRAN;\n\n${updateLines.join('\n')}\n\nCOMMIT TRAN;\n`;
          return sql;
        }
        const orderClauses = params.levels.filter(l => l.col.trim() !== '').map(l => {
          const col = `${l.source}.${l.col.trim()}`;
          if (l.type === 'number') return `TRY_CAST(REPLACE(REPLACE(${col}, '.', ''), ',', '.') AS FLOAT) ${l.dir}`;else if (l.type === 'date') return `CAST(${col} AS DATE) ${l.dir}`;else if (l.type === 'custom') {
            const items = l.customList.split(/[,;\n]+/).map(x => x.trim()).filter(x => x);
            let caseStr = `CASE ${col}\n`;
            items.forEach((item, i) => {
              caseStr += `                    WHEN '${item}' THEN ${i + 1}\n`;
            });
            caseStr += `                    ELSE 999\n                END ASC`;
            return caseStr;
          } else return `${col} ${l.dir}`;
        });
        const orderBy = orderClauses.length > 0 ? orderClauses.join(',\n                ') : 'a.INDICE ASC';
        sql += `-- MODO: ORDENAMIENTO MULTINIVEL (1 a N)\nWITH CTE_Ordenada AS (\n    SELECT \n        a.INDICE,\n        ROW_NUMBER() OVER (\n            ORDER BY \n                ${orderBy}\n        ) AS NuevoMixup\n    FROM ${formatTable(params.clientTable, params.customerDb)} a${joinStr}\n    ${whereStr.replace(/\n/g, '\n    ')}\n)\nUPDATE b\nSET b.MIXUP = o.NuevoMixup\nFROM ${formatTable(params.mgmtTable, params.customerDb)} b\nJOIN CTE_Ordenada o ON b.INDICE = o.INDICE;\n`;
        return sql;
      },
      renderForm: (params, update) => {
        const getNexusDateLocal = () => getNexusDate();
        const updateArray = (arrName, id, field, value) => {
          update(arrName, params[arrName].map(item => item.id === id ? {
            ...item,
            [field]: value
          } : item));
        };
        const removeFromArray = (arrName, id) => {
          update(arrName, params[arrName].filter(item => item.id !== id));
        };
        const processManualText = text => {
          const updates = {
            manualData: text
          };
          const rows = text.split('\n').map(r => r.trim()).filter(r => r);
          if (rows.length > 0) {
            const sep = rows[0].includes('\t') ? '\t' : rows[0].includes(';') ? ';' : ',';
            const headers = rows[0].split(sep).map(h => h.trim());
            updates.manualColIndice = headers.find(h => h.toUpperCase().includes('INDICE')) || headers[0] || '';
            updates.manualColMixup = headers.find(h => h.toUpperCase().includes('MIXUP') || h.toUpperCase().includes('ORDEN')) || (headers.length > 1 ? headers[1] : '');
          }
          update(updates);
        };
        const handleFileUpload = e => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = evt => processManualText(evt.target.result);
          reader.readAsText(file);
        };
        return /*#__PURE__*/React.createElement("div", {
          className: "fade-in"
        }, /*#__PURE__*/React.createElement(CampaignAutoFiller, {
          update: obj => update(obj),
          onColumnsMapped: allCols => {
            const mesCargaCol = allCols.find(c => /^MES_?CARGA$/i.test(c));
            if (mesCargaCol) {
              const newFilters = [...params.whereFilters];
              if (newFilters.length > 0 && /^MES_?CARGA$/i.test(newFilters[0].col)) {
                newFilters[0].col = mesCargaCol;
                if (!newFilters[0].val) newFilters[0].val = getNexusDateLocal();
                update('whereFilters', newFilters);
              }
              addToast(`✅ Columna mes carga detectada: ${mesCargaCol}`, 'success');
            }
          }
        }), /*#__PURE__*/React.createElement("div", {
          style: {
            background: '#F8FAFC',
            padding: '1rem',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            border: '1px solid #E2E8F0'
          }
        }, /*#__PURE__*/React.createElement("h4", {
          style: {
            marginTop: 0,
            fontSize: '0.75rem',
            color: '#64748B',
            textTransform: 'uppercase'
          }
        }, "Verificaci\xF3n de Entorno"), /*#__PURE__*/React.createElement("div", {
          className: "form-grid",
          style: {
            marginBottom: '1rem',
            gridTemplateColumns: '2fr 1fr 2fr'
          }
        }, /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Campa\xF1a"), /*#__PURE__*/React.createElement("input", {
          className: "input",
          value: params.campaign,
          onChange: e => update('campaign', e.target.value)
        })), /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Customer ID"), /*#__PURE__*/React.createElement("input", {
          className: "input",
          type: "number",
          value: params.customerId,
          onChange: e => update('customerId', e.target.value)
        })), /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "BBDD Exacta"), /*#__PURE__*/React.createElement("input", {
          className: "input",
          value: params.customerDb || '',
          onChange: e => update('customerDb', e.target.value)
        }))), /*#__PURE__*/React.createElement("div", {
          className: "form-grid",
          style: {
            gridTemplateColumns: '1fr 1fr'
          }
        }, /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Tabla Cliente (a)"), /*#__PURE__*/React.createElement("input", {
          className: "input input-code",
          value: params.clientTable,
          onChange: e => update('clientTable', e.target.value)
        })), /*#__PURE__*/React.createElement("div", {
          className: "form-group"
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Tabla Gesti\xF3n (b)"), /*#__PURE__*/React.createElement("input", {
          className: "input input-code",
          value: params.mgmtTable,
          onChange: e => update('mgmtTable', e.target.value)
        })))), /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'flex',
            gap: '1rem',
            marginBottom: '1.5rem',
            background: '#F1F5F9',
            padding: '0.8rem',
            borderRadius: '8px',
            border: '1px solid #E2E8F0',
            flexWrap: 'wrap'
          }
        }, /*#__PURE__*/React.createElement("label", {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            cursor: 'pointer',
            fontWeight: 'bold',
            color: params.mode === 'sort' ? '#0F172A' : '#64748B'
          }
        }, /*#__PURE__*/React.createElement("input", {
          type: "radio",
          checked: params.mode === 'sort',
          onChange: () => update('mode', 'sort')
        }), " \uD83D\uDD22 Factores"), /*#__PURE__*/React.createElement("label", {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            cursor: 'pointer',
            fontWeight: 'bold',
            color: params.mode === 'manual' ? '#0F172A' : '#64748B'
          }
        }, /*#__PURE__*/React.createElement("input", {
          type: "radio",
          checked: params.mode === 'manual',
          onChange: () => update('mode', 'manual')
        }), " \uD83D\uDCDD Manual"), /*#__PURE__*/React.createElement("label", {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            cursor: 'pointer',
            fontWeight: 'bold',
            color: params.mode === 'restore' ? '#0F172A' : '#64748B'
          }
        }, /*#__PURE__*/React.createElement("input", {
          type: "radio",
          checked: params.mode === 'restore',
          onChange: () => update('mode', 'restore')
        }), " \u23EA Restaurar INDICE")), params.mode === 'manual' && /*#__PURE__*/React.createElement("div", {
          className: "fade-in",
          style: {
            background: 'white',
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid #E2E8F0',
            marginBottom: '1.5rem'
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.8rem'
          }
        }, /*#__PURE__*/React.createElement("label", {
          className: "label",
          style: {
            margin: 0
          }
        }, "Cargar Datos (CSV/TXT o Pegar)"), /*#__PURE__*/React.createElement("input", {
          type: "file",
          accept: ".csv, .txt",
          onChange: handleFileUpload,
          style: {
            fontSize: '0.8rem',
            maxWidth: '200px'
          }
        })), /*#__PURE__*/React.createElement("textarea", {
          className: "input input-code",
          style: {
            minHeight: '100px',
            resize: 'vertical'
          },
          placeholder: "Pega aqu\xED los datos con encabezados...",
          value: params.manualData,
          onChange: e => processManualText(e.target.value)
        }), params.manualData && /*#__PURE__*/React.createElement("div", {
          style: {
            marginTop: '1rem',
            background: '#F8FAFC',
            padding: '0.8rem',
            borderRadius: '6px',
            border: '1px solid #E2E8F0'
          }
        }, /*#__PURE__*/React.createElement("h5", {
          style: {
            margin: '0 0 0.5rem 0',
            fontSize: '0.8rem',
            color: '#475569'
          }
        }, "Mapeo de Columnas"), /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'flex',
            gap: '1rem'
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            flex: 1
          }
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Columna INDICE"), /*#__PURE__*/React.createElement("select", {
          className: "input",
          style: {
            fontWeight: 'bold'
          },
          value: params.manualColIndice,
          onChange: e => update('manualColIndice', e.target.value)
        }, /*#__PURE__*/React.createElement("option", {
          value: ""
        }, "-- Seleccionar --"), (() => {
          const rows = params.manualData.split('\n').filter(r => r.trim());
          if (!rows.length) return null;
          const sep = rows[0].includes('\t') ? '\t' : rows[0].includes(';') ? ';' : ',';
          return rows[0].split(sep).map((h, i) => /*#__PURE__*/React.createElement("option", {
            key: i,
            value: h.trim()
          }, h.trim()));
        })())), /*#__PURE__*/React.createElement("div", {
          style: {
            flex: 1
          }
        }, /*#__PURE__*/React.createElement("label", {
          className: "label"
        }, "Columna ORDEN"), /*#__PURE__*/React.createElement("select", {
          className: "input",
          style: {
            fontWeight: 'bold'
          },
          value: params.manualColMixup,
          onChange: e => update('manualColMixup', e.target.value)
        }, /*#__PURE__*/React.createElement("option", {
          value: ""
        }, "-- Seleccionar --"), (() => {
          const rows = params.manualData.split('\n').filter(r => r.trim());
          if (!rows.length) return null;
          const sep = rows[0].includes('\t') ? '\t' : rows[0].includes(';') ? ';' : ',';
          return rows[0].split(sep).map((h, i) => /*#__PURE__*/React.createElement("option", {
            key: i,
            value: h.trim()
          }, h.trim()));
        })()))))), params.mode === 'sort' && /*#__PURE__*/React.createElement("div", {
          className: "fade-in",
          style: {
            background: 'white',
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid #E2E8F0',
            marginBottom: '1.5rem'
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem'
          }
        }, /*#__PURE__*/React.createElement("span", {
          className: "label",
          style: {
            margin: 0
          }
        }, "Niveles de Ordenamiento"), /*#__PURE__*/React.createElement("button", {
          className: "btn btn-primary",
          style: {
            padding: '0.3rem 0.8rem',
            fontSize: '0.8rem'
          },
          onClick: () => update('levels', [...params.levels, {
            id: Date.now(),
            source: 'a',
            col: '',
            type: 'text',
            dir: 'ASC',
            customList: ''
          }])
        }, "+ Agregar Nivel")), params.levels.map(l => /*#__PURE__*/React.createElement("div", {
          key: l.id,
          style: {
            background: '#F8FAFC',
            padding: '0.8rem',
            borderRadius: '6px',
            marginBottom: '0.8rem',
            border: '1px solid #E2E8F0',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem'
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'grid',
            gridTemplateColumns: '60px 2fr 1fr 1fr 40px',
            gap: '0.5rem',
            alignItems: 'center'
          }
        }, /*#__PURE__*/React.createElement("select", {
          className: "input",
          style: {
            fontWeight: 'bold',
            color: l.source === 'a' ? 'var(--silver-main)' : '#C2410C'
          },
          value: l.source,
          onChange: e => updateArray('levels', l.id, 'source', e.target.value)
        }, /*#__PURE__*/React.createElement("option", {
          value: "a"
        }, "A"), /*#__PURE__*/React.createElement("option", {
          value: "b"
        }, "B")), /*#__PURE__*/React.createElement("input", {
          className: "input input-code",
          placeholder: "Columna (Ej: MONTO)",
          value: l.col,
          onChange: e => updateArray('levels', l.id, 'col', e.target.value)
        }), /*#__PURE__*/React.createElement("select", {
          className: "input",
          value: l.type,
          onChange: e => updateArray('levels', l.id, 'type', e.target.value)
        }, /*#__PURE__*/React.createElement("option", {
          value: "number"
        }, "N\xFAmero"), /*#__PURE__*/React.createElement("option", {
          value: "text"
        }, "Texto (A-Z)"), /*#__PURE__*/React.createElement("option", {
          value: "date"
        }, "Fecha"), /*#__PURE__*/React.createElement("option", {
          value: "custom"
        }, "Lista")), l.type !== 'custom' ? /*#__PURE__*/React.createElement("select", {
          className: "input",
          value: l.dir,
          onChange: e => updateArray('levels', l.id, 'dir', e.target.value)
        }, /*#__PURE__*/React.createElement("option", {
          value: "DESC"
        }, l.type === 'number' ? 'Mayor a Menor' : l.type === 'date' ? 'Más reciente' : 'Z a A'), /*#__PURE__*/React.createElement("option", {
          value: "ASC"
        }, l.type === 'number' ? 'Menor a Mayor' : l.type === 'date' ? 'Más antigua' : 'A a Z')) : /*#__PURE__*/React.createElement("div", null), /*#__PURE__*/React.createElement("button", {
          className: "btn",
          style: {
            padding: 0,
            color: '#EF4444',
            background: 'transparent',
            height: '100%'
          },
          onClick: () => removeFromArray('levels', l.id)
        }, "\u2715")), l.type === 'custom' && /*#__PURE__*/React.createElement("input", {
          className: "input",
          placeholder: "Lista en orden de prioridad (Ej: R, V, A, N1)",
          value: l.customList,
          onChange: e => updateArray('levels', l.id, 'customList', e.target.value),
          style: {
            borderColor: '#93C5FD',
            background: '#EFF6FF'
          }
        })))), params.mode !== 'manual' && /*#__PURE__*/React.createElement("div", {
          className: "fade-in",
          style: {
            background: '#FFF7ED',
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid #FED7AA'
          }
        }, /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.8rem'
          }
        }, /*#__PURE__*/React.createElement("span", {
          className: "label",
          style: {
            margin: 0,
            color: '#9A3412'
          }
        }, "Filtros Previos (WHERE)"), /*#__PURE__*/React.createElement("button", {
          className: "btn",
          style: {
            padding: '0.2rem 0.6rem',
            fontSize: '0.75rem',
            background: 'white',
            border: '1px solid #FDBA74'
          },
          onClick: () => update('whereFilters', [...params.whereFilters, {
            id: Date.now(),
            source: 'a',
            col: '',
            op: '=',
            val: '',
            isStr: true
          }])
        }, "+ Filtro")), params.whereFilters.map(f => /*#__PURE__*/React.createElement("div", {
          key: f.id,
          style: {
            display: 'grid',
            gridTemplateColumns: '60px 2fr 60px 2fr 40px 40px',
            gap: '0.5rem',
            alignItems: 'center',
            marginBottom: '0.5rem'
          }
        }, /*#__PURE__*/React.createElement("select", {
          className: "input",
          style: {
            padding: '0.4rem',
            fontWeight: 'bold',
            color: f.source === 'a' ? 'var(--silver-main)' : '#C2410C'
          },
          value: f.source,
          onChange: e => updateArray('whereFilters', f.id, 'source', e.target.value)
        }, /*#__PURE__*/React.createElement("option", {
          value: "a"
        }, "A"), /*#__PURE__*/React.createElement("option", {
          value: "b"
        }, "B")), /*#__PURE__*/React.createElement("input", {
          className: "input input-code",
          style: {
            padding: '0.4rem',
            fontSize: '0.85rem'
          },
          placeholder: "Campo",
          value: f.col,
          onChange: e => updateArray('whereFilters', f.id, 'col', e.target.value)
        }), /*#__PURE__*/React.createElement("select", {
          className: "input",
          style: {
            padding: '0.4rem'
          },
          value: f.op,
          onChange: e => updateArray('whereFilters', f.id, 'op', e.target.value)
        }, /*#__PURE__*/React.createElement("option", {
          value: "="
        }, "="), /*#__PURE__*/React.createElement("option", {
          value: "<>"
        }, "\u2260"), /*#__PURE__*/React.createElement("option", {
          value: ">"
        }, ">"), /*#__PURE__*/React.createElement("option", {
          value: ">="
        }, ">="), /*#__PURE__*/React.createElement("option", {
          value: "<"
        }, "<"), /*#__PURE__*/React.createElement("option", {
          value: "<="
        }, "<=")), /*#__PURE__*/React.createElement("div", {
          style: {
            position: 'relative'
          }
        }, /*#__PURE__*/React.createElement("input", {
          className: "input",
          style: {
            padding: '0.4rem',
            fontSize: '0.85rem',
            width: '100%',
            paddingRight: '25px'
          },
          placeholder: "Valor",
          value: f.val,
          onChange: e => updateArray('whereFilters', f.id, 'val', e.target.value)
        }), f.col.toUpperCase().replace('_', '') === 'MESCARGA' || f.col.toUpperCase() === 'MES_CARGA' ? /*#__PURE__*/React.createElement("button", {
          style: {
            position: 'absolute',
            right: '2px',
            top: '3px',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer'
          },
          onClick: () => updateArray('whereFilters', f.id, 'val', getNexusDateLocal()),
          title: "Mes Actual"
        }, "\uD83D\uDCC5") : null), /*#__PURE__*/React.createElement("button", {
          className: "btn",
          style: {
            padding: 0,
            color: f.isStr ? '#2563EB' : '#94A3B8',
            border: f.isStr ? '1px solid #2563EB' : '1px solid #E2E8F0',
            background: 'white'
          },
          onClick: () => updateArray('whereFilters', f.id, 'isStr', !f.isStr),
          title: "Usar Comillas"
        }, "\""), /*#__PURE__*/React.createElement("button", {
          className: "btn",
          style: {
            padding: 0,
            color: '#EF4444',
            background: 'transparent'
          },
          onClick: () => removeFromArray('whereFilters', f.id)
        }, "\u2715")))));
      }
    }
  };

  // =================================================================================================
  // CSS STYLES
  // =================================================================================================
  const cssStyles = `
        :root { --silver-main: #475569; --silver-light: #f8fafc; --silver-border: #cbd5e1; --text-dark: #1e293b; }
        .app-container { font-family: 'Inter', sans-serif; color: var(--text-dark); width: 100%; max-width: 1400px; margin: 0 auto; display: flex; flex-direction: column; min-height: 80vh; }
        .header { background: linear-gradient(135deg, #334155, #475569); color: white; padding: 1.5rem; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; flex-shrink: 0; width: 100%; box-sizing: border-box; }
        .builder-layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 1.5rem; flex: 1; align-items: start; width: 100%; }
        .sidebar { background: white; border-radius: 12px; border: 1px solid #e2e8f0; display: flex; flex-direction: column; overflow: hidden; height: 100%; max-height: 600px; min-width: 280px; }
        .query-btn { padding: 1rem; border: none; background: transparent; text-align: left; cursor: pointer; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; gap: 0.8rem; color: #64748b; font-weight: 500; transition: 0.2s; width: 100%; box-sizing: border-box; overflow: hidden; }
        .query-btn:hover { background: #f8fafc; color: #334155; }
        .query-btn.active { background: #f1f5f9; color: #0f172a; border-left: 4px solid var(--silver-main); font-weight: 700; }
        .main-panel { background: white; border-radius: 12px; border: 1px solid #e2e8f0; padding: 2rem; display: flex; flex-direction: column; min-width: 0; }
        .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
        .form-group { display: flex; flex-direction: column; gap: 0.4rem; }
        .label { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; }
        .input { padding: 0.7rem; border: 1px solid var(--silver-border); border-radius: 6px; font-size: 0.9rem; width: 100%; box-sizing: border-box; }
        .input:focus { border-color: var(--silver-main); outline: none; box-shadow: 0 0 0 3px rgba(71, 85, 105, 0.1); }
        .input-code { font-family: monospace; background: #f8fafc; color: #334155; }
        .code-box { background: #1e293b; color: #e2e8f0; padding: 1.5rem; border-radius: 8px; font-family: 'Consolas', monospace; font-size: 0.85rem; line-height: 1.5; overflow-x: auto; overflow-y: auto; white-space: pre; position: relative; border: 1px solid #0f172a; box-sizing: border-box; width: 100%; }
        .btn { padding: 0.8rem 1.5rem; border-radius: 8px; border: none; font-weight: 600; cursor: pointer; transition: 0.2s; display: flex; align-items: center; gap: 0.5rem; }
        .btn-primary { background: var(--silver-main); color: white; }
        .btn-primary:hover { background: #334155; transform: translateY(-1px); }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
        .fade-in { animation: fadeIn 0.2s ease; }
    `;

  // =================================================================================================
  // TIPO_EJEMPLOS
  // =================================================================================================
  const TIPO_EJEMPLOS = {
    SELECT: {
      titulo: 'SELECT — Consulta de datos',
      notas: ['No modifica datos.', 'Soporta JOIN, WHERE, GROUP BY, ORDER BY, TOP.', 'WITH crea CTEs reutilizables.', 'EXISTS para subqueries eficientes.'],
      ejemplo: ''
    },
    INSERT: {
      titulo: 'INSERT — Insertar registros',
      notas: ['No soporta JOIN directo.', 'Puede usar SELECT como fuente.', 'WITH sí funciona como CTE previo.', 'Sin WHERE — aplica a todos los valores indicados.'],
      ejemplo: ''
    },
    UPDATE: {
      titulo: 'UPDATE — Actualizar registros',
      notas: ['Siempre usar WHERE para no afectar toda la tabla.', 'Soporta JOIN para cruzar tablas.', 'WITH puede usarse como CTE.', 'Sin WHERE actualiza TODOS los registros — peligroso.'],
      ejemplo: ''
    },
    DELETE: {
      titulo: '⚠️ DELETE — Eliminar registros',
      notas: ['DESTRUCTIVO — no se puede deshacer.', 'SIEMPRE usar WHERE.', 'Soporta JOIN para filtrar.', 'Sin WHERE elimina TODA la tabla.'],
      ejemplo: ''
    }
  };

  // =================================================================================================
  // QUERY BUILDER PRO
  // =================================================================================================
  const QueryBuilderPro = ({
    onSave,
    onClose,
    editQuery = null
  }) => {
    const [activeTab, setActiveTab] = useState(editQuery?.isRaw ? 'sql' : 'visual');
    const [rawSql, setRawSql] = useState(editQuery?.isRaw ? editQuery.query : 'SELECT TOP 100 *\nFROM tu_tabla\nWHERE condicion = 1;');
    const [tipo, setTipo] = useState(editQuery?.visualData?.tipo || 'SELECT');
    const [nombre, setNombre] = useState(editQuery?.nombre || '');
    const [withClauses, setWithClauses] = useState(editQuery?.visualData?.withClauses || []);
    const [tablaFrom, setTablaFrom] = useState(editQuery?.visualData?.tablaFrom || '');
    const [columnas, setColumnas] = useState(editQuery?.visualData?.columnas || [{
      id: 1,
      valor: '*'
    }]);
    const [joins, setJoins] = useState(editQuery?.visualData?.joins || []);
    const [wheres, setWheres] = useState(editQuery?.visualData?.wheres || []);
    const [sets, setSets] = useState(editQuery?.visualData?.sets || [{
      id: 1,
      campo: '',
      valor: ''
    }]);
    const [insertCols, setInsertCols] = useState(editQuery?.visualData?.insertCols || [{
      id: 1,
      col: '',
      val: ''
    }]);
    const [orderBy, setOrderBy] = useState(editQuery?.visualData?.orderBy || '');
    const [groupBy, setGroupBy] = useState(editQuery?.visualData?.groupBy || '');
    const [topN, setTopN] = useState(editQuery?.visualData?.topN || '');
    const [queryPreview, setQueryPreview] = useState('');
    const uid = () => Date.now() + Math.random();
    const addItem = setter => setter(p => [...p, {
      id: uid(),
      valor: '',
      campo: '',
      val: '',
      col: '',
      tabla: '',
      tipo: 'INNER',
      on: '',
      logico: 'AND'
    }]);
    const removeItem = (setter, id) => setter(p => p.filter(x => x.id !== id));
    const updateItem = (setter, id, key, val) => setter(p => p.map(x => x.id === id ? {
      ...x,
      [key]: val
    } : x));
    const buildQuery = () => {
      if (activeTab === 'sql') return rawSql;
      let q = '';
      if (withClauses.length > 0) q += 'WITH ' + withClauses.map(w => `${w.nombre} AS (\n  ${w.cuerpo}\n)`).join(',\n') + '\n';
      if (tipo === 'SELECT') {
        const cols = columnas.map(c => c.valor?.trim()).filter(Boolean).join(',\n    ') || '*';
        q += `SELECT${topN ? ` TOP ${topN}` : ''}\n    ${cols}\nFROM ${formatTable(tablaFrom)}`;
        joins.forEach(j => {
          q += `\n${j.tipo} JOIN ${formatTable(j.tabla)} ON ${j.on}`;
        });
        if (wheres.length > 0) q += '\nWHERE ' + wheres.map((w, i) => `${i > 0 ? w.logico + ' ' : ''}${w.valor}`).join('\n  ');
        if (groupBy) q += `\nGROUP BY ${groupBy}`;
        if (orderBy) q += `\nORDER BY ${orderBy}`;
      } else if (tipo === 'INSERT') {
        const cols = insertCols.map(c => c.col).filter(Boolean).join(', ');
        const vals = insertCols.map(c => c.val).filter(Boolean).join(', ');
        q += `INSERT INTO ${formatTable(tablaFrom)} (${cols})\nVALUES (${vals})`;
      } else if (tipo === 'UPDATE') {
        q += `UPDATE ${formatTable(tablaFrom)}`;
        joins.forEach(j => {
          q += `\n${j.tipo} JOIN ${formatTable(j.tabla)} ON ${j.on}`;
        });
        if (sets.length > 0) q += '\nSET ' + sets.map(s => `${s.campo} = ${s.valor}`).filter(s => s !== ' = ').join(',\n    ');
        if (wheres.length > 0) q += '\nWHERE ' + wheres.map((w, i) => `${i > 0 ? w.logico + ' ' : ''}${w.valor}`).join('\n  ');
      } else if (tipo === 'DELETE') {
        q += `DELETE ${formatTable(tablaFrom)}`;
        joins.forEach(j => {
          q += `\n${j.tipo} JOIN ${formatTable(j.tabla)} ON ${j.on}`;
        });
        if (wheres.length > 0) q += '\nWHERE ' + wheres.map((w, i) => `${i > 0 ? w.logico + ' ' : ''}${w.valor}`).join('\n  ');
      }
      return q;
    };
    useEffect(() => {
      setQueryPreview(buildQuery());
    }, [activeTab, rawSql, tipo, withClauses, tablaFrom, columnas, joins, wheres, sets, insertCols, orderBy, groupBy, topN]);
    const ejInfo = TIPO_EJEMPLOS[tipo] || TIPO_EJEMPLOS['SELECT'];
    const inputStyle = {
      width: '100%',
      padding: '6px 8px',
      border: '1px solid #cbd5e1',
      borderRadius: '6px',
      fontSize: '0.82rem',
      fontFamily: 'monospace',
      boxSizing: 'border-box',
      background: 'white'
    };
    const btnSmStyle = color => ({
      padding: '3px 10px',
      borderRadius: '5px',
      border: 'none',
      cursor: 'pointer',
      fontWeight: 'bold',
      fontSize: '0.75rem',
      background: color,
      color: 'white'
    });
    return /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: 'white',
        borderRadius: '14px',
        width: '100%',
        maxWidth: '1100px',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#1e293b',
        color: 'white',
        padding: '1rem 1.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 'bold',
        fontSize: '1rem'
      }
    }, "\uD83D\uDD28 ", editQuery ? 'Editar Query' : 'Nueva Query'), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.75rem',
        opacity: 0.7
      }
    }, "Visual SQL Builder & Custom Query")), /*#__PURE__*/React.createElement("button", {
      onClick: onClose,
      style: {
        background: 'rgba(255,255,255,0.1)',
        border: 'none',
        color: 'white',
        borderRadius: '6px',
        padding: '6px 12px',
        cursor: 'pointer',
        fontWeight: 'bold'
      }
    }, "\u2715 Cerrar")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        background: '#f1f5f9',
        borderBottom: '1px solid #e2e8f0',
        padding: '0 1.5rem'
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setActiveTab('visual'),
      style: {
        padding: '1rem',
        border: 'none',
        background: 'transparent',
        fontWeight: 'bold',
        cursor: 'pointer',
        color: activeTab === 'visual' ? '#0f172a' : '#64748b',
        borderBottom: activeTab === 'visual' ? '3px solid #3b82f6' : '3px solid transparent'
      }
    }, "\uD83C\uDFD7\uFE0F Constructor Visual"), /*#__PURE__*/React.createElement("button", {
      onClick: () => setActiveTab('sql'),
      style: {
        padding: '1rem',
        border: 'none',
        background: 'transparent',
        fontWeight: 'bold',
        cursor: 'pointer',
        color: activeTab === 'sql' ? '#0f172a' : '#64748b',
        borderBottom: activeTab === 'sql' ? '3px solid #3b82f6' : '3px solid transparent'
      }
    }, "\u26A1 Query Personalizada (Libre)")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 320px',
        flex: 1,
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '1.2rem',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: activeTab === 'visual' ? '1fr auto' : '1fr',
        gap: '1rem',
        alignItems: 'end'
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: '0.75rem',
        fontWeight: 'bold',
        color: '#64748b',
        display: 'block',
        marginBottom: '4px'
      }
    }, "NOMBRE DE LA QUERY"), /*#__PURE__*/React.createElement("input", {
      style: inputStyle,
      placeholder: "Ej: Extraer referidos...",
      value: nombre,
      onChange: e => setNombre(e.target.value)
    })), activeTab === 'visual' && /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '6px'
      }
    }, ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].map(t => /*#__PURE__*/React.createElement("button", {
      key: t,
      onClick: () => setTipo(t),
      style: {
        padding: '8px 14px',
        borderRadius: '6px',
        border: '2px solid',
        fontWeight: 'bold',
        fontSize: '0.8rem',
        cursor: 'pointer',
        borderColor: t === 'DELETE' ? '#ef4444' : '#475569',
        background: tipo === t ? t === 'DELETE' ? '#ef4444' : '#475569' : 'white',
        color: tipo === t ? 'white' : t === 'DELETE' ? '#ef4444' : '#475569'
      }
    }, t)))), activeTab === 'sql' ? /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: '0.75rem',
        fontWeight: 'bold',
        color: '#64748b',
        display: 'block',
        marginBottom: '4px'
      }
    }, "C\xD3DIGO SQL"), /*#__PURE__*/React.createElement("textarea", {
      style: {
        ...inputStyle,
        flex: 1,
        minHeight: '300px',
        resize: 'vertical',
        background: '#0f172a',
        color: '#38bdf8',
        padding: '1rem'
      },
      value: rawSql,
      onChange: e => setRawSql(e.target.value),
      placeholder: "Escribe tu consulta SQL aqu\xED..."
    })) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      style: {
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#f8fafc',
        padding: '8px 12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.78rem',
        fontWeight: 'bold',
        color: '#475569'
      }
    }, "WITH / CTEs (Opcional)"), /*#__PURE__*/React.createElement("button", {
      style: btnSmStyle('#6366f1'),
      onClick: () => setWithClauses(p => [...p, {
        id: uid(),
        nombre: '',
        cuerpo: ''
      }])
    }, "+ CTE")), withClauses.map(w => /*#__PURE__*/React.createElement("div", {
      key: w.id,
      style: {
        padding: '8px 12px',
        borderTop: '1px solid #f1f5f9',
        display: 'flex',
        gap: '8px',
        alignItems: 'flex-start'
      }
    }, /*#__PURE__*/React.createElement("input", {
      style: {
        ...inputStyle,
        width: '140px',
        flexShrink: 0
      },
      placeholder: "nombre_cte",
      value: w.nombre,
      onChange: e => updateItem(setWithClauses, w.id, 'nombre', e.target.value)
    }), /*#__PURE__*/React.createElement("textarea", {
      style: {
        ...inputStyle,
        minHeight: '60px',
        resize: 'vertical',
        flex: 1
      },
      placeholder: "SELECT ... FROM ...",
      value: w.cuerpo,
      onChange: e => updateItem(setWithClauses, w.id, 'cuerpo', e.target.value)
    }), /*#__PURE__*/React.createElement("button", {
      style: btnSmStyle('#ef4444'),
      onClick: () => removeItem(setWithClauses, w.id)
    }, "\u2715")))), tipo === 'SELECT' && /*#__PURE__*/React.createElement("div", {
      style: {
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#f8fafc',
        padding: '8px 12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.78rem',
        fontWeight: 'bold',
        color: '#475569'
      }
    }, "SELECT \u2014 Columnas"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '6px'
      }
    }, /*#__PURE__*/React.createElement("input", {
      style: {
        ...inputStyle,
        width: '80px'
      },
      placeholder: "TOP N",
      value: topN,
      onChange: e => setTopN(e.target.value)
    }), /*#__PURE__*/React.createElement("button", {
      style: btnSmStyle('#475569'),
      onClick: () => addItem(setColumnas)
    }, "+ Col"))), columnas.map(c => /*#__PURE__*/React.createElement("div", {
      key: c.id,
      style: {
        padding: '6px 12px',
        borderTop: '1px solid #f1f5f9',
        display: 'flex',
        gap: '8px'
      }
    }, /*#__PURE__*/React.createElement("input", {
      style: {
        ...inputStyle,
        flex: 1
      },
      placeholder: "tabla.columna o expresi\xF3n",
      value: c.valor,
      onChange: e => updateItem(setColumnas, c.id, 'valor', e.target.value)
    }), /*#__PURE__*/React.createElement("button", {
      style: btnSmStyle('#ef4444'),
      onClick: () => removeItem(setColumnas, c.id)
    }, "\u2715")))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: '0.75rem',
        fontWeight: 'bold',
        color: '#64748b',
        display: 'block',
        marginBottom: '4px'
      }
    }, tipo === 'SELECT' ? 'FROM' : tipo === 'INSERT' ? 'INTO' : 'TABLA'), /*#__PURE__*/React.createElement("input", {
      style: inputStyle,
      placeholder: "esquema..TABLA alias",
      value: tablaFrom,
      onChange: e => setTablaFrom(e.target.value)
    })), tipo === 'INSERT' && /*#__PURE__*/React.createElement("div", {
      style: {
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#f8fafc',
        padding: '8px 12px',
        display: 'flex',
        justifyContent: 'space-between'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.78rem',
        fontWeight: 'bold',
        color: '#475569'
      }
    }, "Columnas \u2192 Valores"), /*#__PURE__*/React.createElement("button", {
      style: btnSmStyle('#475569'),
      onClick: () => addItem(setInsertCols)
    }, "+ Fila")), insertCols.map(c => /*#__PURE__*/React.createElement("div", {
      key: c.id,
      style: {
        padding: '6px 12px',
        borderTop: '1px solid #f1f5f9',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 32px',
        gap: '6px'
      }
    }, /*#__PURE__*/React.createElement("input", {
      style: inputStyle,
      placeholder: "nombre_columna",
      value: c.col,
      onChange: e => updateItem(setInsertCols, c.id, 'col', e.target.value)
    }), /*#__PURE__*/React.createElement("input", {
      style: inputStyle,
      placeholder: "'valor' o expresi\xF3n",
      value: c.val,
      onChange: e => updateItem(setInsertCols, c.id, 'val', e.target.value)
    }), /*#__PURE__*/React.createElement("button", {
      style: btnSmStyle('#ef4444'),
      onClick: () => removeItem(setInsertCols, c.id)
    }, "\u2715")))), tipo === 'UPDATE' && /*#__PURE__*/React.createElement("div", {
      style: {
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#f8fafc',
        padding: '8px 12px',
        display: 'flex',
        justifyContent: 'space-between'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.78rem',
        fontWeight: 'bold',
        color: '#475569'
      }
    }, "SET \u2014 Campos a actualizar"), /*#__PURE__*/React.createElement("button", {
      style: btnSmStyle('#475569'),
      onClick: () => addItem(setSets)
    }, "+ Campo")), sets.map(s => /*#__PURE__*/React.createElement("div", {
      key: s.id,
      style: {
        padding: '6px 12px',
        borderTop: '1px solid #f1f5f9',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 32px',
        gap: '6px'
      }
    }, /*#__PURE__*/React.createElement("input", {
      style: inputStyle,
      placeholder: "campo",
      value: s.campo,
      onChange: e => updateItem(setSets, s.id, 'campo', e.target.value)
    }), /*#__PURE__*/React.createElement("input", {
      style: inputStyle,
      placeholder: "'nuevo_valor'",
      value: s.valor,
      onChange: e => updateItem(setSets, s.id, 'valor', e.target.value)
    }), /*#__PURE__*/React.createElement("button", {
      style: btnSmStyle('#ef4444'),
      onClick: () => removeItem(setSets, s.id)
    }, "\u2715")))), ['SELECT', 'UPDATE', 'DELETE'].includes(tipo) && /*#__PURE__*/React.createElement("div", {
      style: {
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#f8fafc',
        padding: '8px 12px',
        display: 'flex',
        justifyContent: 'space-between'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.78rem',
        fontWeight: 'bold',
        color: '#475569'
      }
    }, "JOINs (Opcional)"), /*#__PURE__*/React.createElement("button", {
      style: btnSmStyle('#475569'),
      onClick: () => addItem(setJoins)
    }, "+ JOIN")), joins.map(j => /*#__PURE__*/React.createElement("div", {
      key: j.id,
      style: {
        padding: '6px 12px',
        borderTop: '1px solid #f1f5f9',
        display: 'grid',
        gridTemplateColumns: '100px 1fr 1fr 32px',
        gap: '6px'
      }
    }, /*#__PURE__*/React.createElement("select", {
      style: inputStyle,
      value: j.tipo,
      onChange: e => updateItem(setJoins, j.id, 'tipo', e.target.value)
    }, /*#__PURE__*/React.createElement("option", null, "INNER"), /*#__PURE__*/React.createElement("option", null, "LEFT"), /*#__PURE__*/React.createElement("option", null, "RIGHT"), /*#__PURE__*/React.createElement("option", null, "FULL"), /*#__PURE__*/React.createElement("option", null, "CROSS")), /*#__PURE__*/React.createElement("input", {
      style: inputStyle,
      placeholder: "tabla alias",
      value: j.tabla,
      onChange: e => updateItem(setJoins, j.id, 'tabla', e.target.value)
    }), /*#__PURE__*/React.createElement("input", {
      style: inputStyle,
      placeholder: "a.id = b.id",
      value: j.on,
      onChange: e => updateItem(setJoins, j.id, 'on', e.target.value)
    }), /*#__PURE__*/React.createElement("button", {
      style: btnSmStyle('#ef4444'),
      onClick: () => removeItem(setJoins, j.id)
    }, "\u2715")))), tipo !== 'INSERT' && /*#__PURE__*/React.createElement("div", {
      style: {
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: tipo === 'DELETE' ? '#fef2f2' : '#f8fafc',
        padding: '8px 12px',
        display: 'flex',
        justifyContent: 'space-between'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.78rem',
        fontWeight: 'bold',
        color: tipo === 'DELETE' ? '#ef4444' : '#475569'
      }
    }, "WHERE ", tipo === 'DELETE' && '⚠️ OBLIGATORIO'), /*#__PURE__*/React.createElement("button", {
      style: btnSmStyle('#475569'),
      onClick: () => addItem(setWheres)
    }, "+ Condici\xF3n")), wheres.map((w, i) => /*#__PURE__*/React.createElement("div", {
      key: w.id,
      style: {
        padding: '6px 12px',
        borderTop: '1px solid #f1f5f9',
        display: 'grid',
        gridTemplateColumns: '70px 1fr 32px',
        gap: '6px'
      }
    }, i > 0 ? /*#__PURE__*/React.createElement("select", {
      style: inputStyle,
      value: w.logico,
      onChange: e => updateItem(setWheres, w.id, 'logico', e.target.value)
    }, /*#__PURE__*/React.createElement("option", null, "AND"), /*#__PURE__*/React.createElement("option", null, "OR"), /*#__PURE__*/React.createElement("option", null, "AND NOT"), /*#__PURE__*/React.createElement("option", null, "OR NOT")) : /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.78rem',
        fontWeight: 'bold',
        color: '#94a3b8',
        display: 'flex',
        alignItems: 'center'
      }
    }, "WHERE"), /*#__PURE__*/React.createElement("input", {
      style: inputStyle,
      placeholder: "campo = 'valor' o EXISTS (...)",
      value: w.valor,
      onChange: e => updateItem(setWheres, w.id, 'valor', e.target.value)
    }), /*#__PURE__*/React.createElement("button", {
      style: btnSmStyle('#ef4444'),
      onClick: () => removeItem(setWheres, w.id)
    }, "\u2715")))), tipo === 'SELECT' && /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '1rem'
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: '0.75rem',
        fontWeight: 'bold',
        color: '#64748b',
        display: 'block',
        marginBottom: '4px'
      }
    }, "GROUP BY"), /*#__PURE__*/React.createElement("input", {
      style: inputStyle,
      placeholder: "col1, col2",
      value: groupBy,
      onChange: e => setGroupBy(e.target.value)
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: '0.75rem',
        fontWeight: 'bold',
        color: '#64748b',
        display: 'block',
        marginBottom: '4px'
      }
    }, "ORDER BY"), /*#__PURE__*/React.createElement("input", {
      style: inputStyle,
      placeholder: "col1 DESC, col2 ASC",
      value: orderBy,
      onChange: e => setOrderBy(e.target.value)
    })))), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        if (!nombre.trim()) {
          alert('Escribe un nombre para la query.');
          return;
        }
        onSave({
          id: editQuery ? editQuery.id : uid().toString(),
          nombre,
          tipo: activeTab === 'sql' ? 'CUSTOM' : tipo,
          query: queryPreview,
          fechaCreacion: editQuery ? editQuery.fechaCreacion : new Date().toLocaleDateString(),
          isRaw: activeTab === 'sql',
          visualData: {
            tipo,
            withClauses,
            tablaFrom,
            columnas,
            joins,
            wheres,
            sets,
            insertCols,
            orderBy,
            groupBy,
            topN
          }
        });
      },
      style: {
        background: '#475569',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        padding: '10px',
        fontWeight: 'bold',
        cursor: 'pointer',
        fontSize: '0.9rem',
        marginTop: 'auto'
      }
    }, "\uD83D\uDCBE ", editQuery ? 'Guardar Cambios' : 'Guardar Query')), /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#0f172a',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '1rem',
        borderBottom: '1px solid #1e293b'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.72rem',
        fontWeight: 'bold',
        color: '#64748b',
        marginBottom: '6px',
        letterSpacing: '0.05em'
      }
    }, "PREVIEW EN TIEMPO REAL"), /*#__PURE__*/React.createElement("pre", {
      style: {
        color: '#7dd3fc',
        fontFamily: 'monospace',
        fontSize: '0.78rem',
        margin: 0,
        whiteSpace: 'pre-wrap',
        maxHeight: '220px',
        overflowY: 'auto'
      }
    }, queryPreview || '-- Completa los campos...')), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '1rem',
        overflowY: 'auto',
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.72rem',
        fontWeight: 'bold',
        color: '#64748b',
        marginBottom: '8px',
        letterSpacing: '0.05em'
      }
    }, "GU\xCDA \u2014 ", activeTab === 'sql' ? 'CUSTOM SQL' : tipo), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.75rem',
        color: '#94a3b8',
        marginBottom: '10px'
      }
    }, activeTab === 'sql' ? 'Libertad Total para escribir SQL nativo.' : ejInfo.titulo), activeTab !== 'sql' && ejInfo.notas.map((n, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        fontSize: '0.72rem',
        color: tipo === 'DELETE' && i < 2 ? '#fca5a5' : '#64748b',
        marginBottom: '4px',
        display: 'flex',
        gap: '6px'
      }
    }, /*#__PURE__*/React.createElement("span", null, tipo === 'DELETE' && i < 2 ? '⚠️' : '•'), /*#__PURE__*/React.createElement("span", null, n))))))));
  };

  // =================================================================================================
  // USER QUERIES PANEL
  // =================================================================================================
  const UserQueriesPanel = ({
    activeId,
    onSelect,
    onDelete,
    onReorder,
    onEditRequest
  }) => {
    const [queries, setQueries] = useState([]);
    const [confirmDelete, setConfirmDelete] = useState(null);
    useEffect(() => {
      try {
        const saved = JSON.parse(localStorage.getItem('nexus_user_queries') || '[]');
        setQueries(saved);
      } catch {
        setQueries([]);
      }
    }, []);
    const handleDelete = id => {
      try {
        const existing = JSON.parse(localStorage.getItem('nexus_user_queries') || '[]');
        const updated = existing.filter(q => q.id !== id);
        localStorage.setItem('nexus_user_queries', JSON.stringify(updated));
        setQueries(updated);
        setConfirmDelete(null);
        onDelete(id);
      } catch {}
    };
    const moveQuery = (idx, dir) => {
      const arr = [...queries];
      const target = idx + dir;
      if (target < 0 || target >= arr.length) return;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      setQueries(arr);
      onReorder(arr);
    };
    const tipoColor = {
      SELECT: '#475569',
      INSERT: '#059669',
      UPDATE: '#d97706',
      DELETE: '#ef4444',
      CUSTOM: '#3b82f6'
    };
    return /*#__PURE__*/React.createElement(React.Fragment, null, confirmDelete && /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: 'white',
        borderRadius: '12px',
        padding: '2rem',
        maxWidth: '400px',
        textAlign: 'center',
        boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '2rem',
        marginBottom: '1rem'
      }
    }, "\uD83D\uDDD1\uFE0F"), /*#__PURE__*/React.createElement("h3", {
      style: {
        margin: '0 0 0.5rem',
        color: '#1e293b'
      }
    }, "\xBFEliminar query?"), /*#__PURE__*/React.createElement("p", {
      style: {
        color: '#64748b',
        fontSize: '0.9rem',
        margin: '0 0 1.5rem'
      }
    }, "Esta acci\xF3n no se puede deshacer."), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '1rem',
        justifyContent: 'center'
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setConfirmDelete(null),
      style: {
        padding: '8px 20px',
        borderRadius: '6px',
        border: '2px solid #e2e8f0',
        background: 'white',
        cursor: 'pointer',
        fontWeight: 'bold'
      }
    }, "Cancelar"), /*#__PURE__*/React.createElement("button", {
      onClick: () => handleDelete(confirmDelete),
      style: {
        padding: '8px 20px',
        borderRadius: '6px',
        border: 'none',
        background: '#ef4444',
        color: 'white',
        cursor: 'pointer',
        fontWeight: 'bold'
      }
    }, "Eliminar")))), /*#__PURE__*/React.createElement("div", {
      style: {
        borderTop: '2px solid #e2e8f0',
        marginTop: '0.5rem',
        paddingTop: '0.5rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '0.5rem 1rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.7rem',
        fontWeight: 'bold',
        color: '#94a3b8',
        letterSpacing: '0.05em'
      }
    }, "MIS QUERIES"), /*#__PURE__*/React.createElement("button", {
      onClick: () => onEditRequest(null),
      style: {
        fontSize: '0.7rem',
        fontWeight: 'bold',
        background: '#475569',
        color: 'white',
        border: 'none',
        borderRadius: '4px',
        padding: '3px 8px',
        cursor: 'pointer'
      }
    }, "+ Nueva")), queries.length === 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '0.75rem 1rem',
        fontSize: '0.75rem',
        color: '#94a3b8',
        fontStyle: 'italic'
      }
    }, "Sin queries guardadas."), queries.map((q, idx) => /*#__PURE__*/React.createElement("div", {
      key: q.id,
      style: {
        borderBottom: '1px solid #f1f5f9',
        background: activeId === `user_${q.id}` ? '#f1f5f9' : 'white'
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "query-btn",
      style: {
        width: '100%',
        borderLeft: activeId === `user_${q.id}` ? `4px solid ${tipoColor[q.tipo] || '#475569'}` : '4px solid transparent'
      },
      onClick: () => onSelect(q)
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.65rem',
        fontWeight: 'bold',
        padding: '2px 5px',
        borderRadius: '3px',
        background: tipoColor[q.tipo] || '#475569',
        color: 'white',
        flexShrink: 0
      }
    }, q.tipo), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: '600',
        fontSize: '0.82rem',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }
    }, q.nombre), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.68rem',
        color: '#94a3b8'
      }
    }, q.fechaCreacion)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        flexShrink: 0
      },
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => moveQuery(idx, -1),
      style: {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: '#94a3b8',
        fontSize: '0.7rem',
        padding: '1px 3px'
      }
    }, "\u25B2"), /*#__PURE__*/React.createElement("button", {
      onClick: () => moveQuery(idx, 1),
      style: {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: '#94a3b8',
        fontSize: '0.7rem',
        padding: '1px 3px'
      }
    }, "\u25BC"), /*#__PURE__*/React.createElement("button", {
      onClick: () => setConfirmDelete(q.id),
      style: {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: '#ef4444',
        fontSize: '0.75rem',
        padding: '1px 3px'
      }
    }, "\u2715"))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '0.3rem',
        padding: '0 0.75rem 0.5rem',
        justifyContent: 'flex-end'
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => onEditRequest(q),
      style: {
        fontSize: '0.65rem',
        background: '#f1f5f9',
        border: 'none',
        borderRadius: '3px',
        padding: '2px 7px',
        cursor: 'pointer',
        color: '#475569',
        fontWeight: 'bold'
      }
    }, "\u270F\uFE0F Editar"))))));
  };

  // =================================================================================================
  // MAIN COMPONENT
  // =================================================================================================
  return () => {
    const [activeId, setActiveId] = useState('vocalcom_hist');
    const [params, setParams] = useState(QUERY_LIBRARY['vocalcom_hist'].defaultParams);
    const [sql, setSql] = useState('');
    const [campaigns, setCampaigns] = useState([]);
    const [userActiveQuery, setUserActiveQuery] = useState(null);
    const [userQueryResult, setUserQueryResult] = useState(null);
    const [isExecuting, setIsExecuting] = useState(false);
    const [builderState, setBuilderState] = useState({
      show: false,
      editQuery: null
    });
    const [refreshSidebar, setRefreshSidebar] = useState(0);
    useEffect(() => {
      const init = async () => {
        try {
          const camps = await db.getAll('campaigns');
          if (camps) setCampaigns(camps.map(c => c.name));
        } catch (e) {}
      };
      init();
    }, []);
    const exportToCSV = (data, filename) => {
      if (!data || !data.length) return;
      const keys = Object.keys(data[0]);
      const csvContent = [keys.join(';'), ...data.map(row => keys.map(k => {
        let val = row[k] === null || row[k] === undefined ? '' : String(row[k]);
        val = val.replace(/"/g, '""');
        if (val.search(/("|,|\n|;)/g) >= 0) val = `"${val}"`;
        return val;
      }).join(';'))].join('\n');
      const blob = new Blob(["\uFEFF" + csvContent], {
        type: 'text/csv;charset=utf-8;'
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${filename.replace(/[^a-z0-9]/gi, '_').toUpperCase()}.csv`;
      link.click();
    };
    const handleQueryChange = id => {
      setActiveId(id);
      setParams(QUERY_LIBRARY[id].defaultParams);
      setSql('');
      setUserQueryResult(null);
    };
    const activeModule = QUERY_LIBRARY[activeId];
    const isVicidial = activeId === 'vicidial_hist';
    return /*#__PURE__*/React.createElement("div", {
      className: "app-container"
    }, /*#__PURE__*/React.createElement("style", null, cssStyles), builderState.show && /*#__PURE__*/React.createElement(QueryBuilderPro, {
      editQuery: builderState.editQuery,
      onClose: () => setBuilderState({
        show: false,
        editQuery: null
      }),
      onSave: query => {
        try {
          const existing = JSON.parse(localStorage.getItem('nexus_user_queries') || '[]');
          const idx = existing.findIndex(q => q.id === query.id);
          if (idx >= 0) existing[idx] = query;else existing.push(query);
          localStorage.setItem('nexus_user_queries', JSON.stringify(existing));
          setBuilderState({
            show: false,
            editQuery: null
          });
          utils.addToast(`Query guardada.`, 'success');
          setRefreshSidebar(prev => prev + 1);
          setUserActiveQuery(query);
          setUserQueryResult(null);
        } catch (e) {
          utils.addToast('Error al guardar.', 'error');
        }
      }
    }), /*#__PURE__*/React.createElement("div", {
      className: "header"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '1rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: 'rgba(255,255,255,0.1)',
        padding: '0.6rem',
        borderRadius: '8px'
      }
    }, /*#__PURE__*/React.createElement(ui.Icon, {
      name: "terminal",
      size: 28
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
      style: {
        margin: 0,
        fontSize: '1.4rem'
      }
    }, "Nexus Query Builder"), /*#__PURE__*/React.createElement("div", {
      style: {
        opacity: 0.7,
        fontSize: '0.85rem'
      }
    }, "Generador SQL Corporativo"))), /*#__PURE__*/React.createElement("button", {
      className: "btn",
      style: {
        background: 'rgba(255,255,255,0.1)',
        color: 'white'
      },
      onClick: goHome
    }, /*#__PURE__*/React.createElement(ui.Icon, {
      name: "x",
      size: 18
    }), " Cerrar")), /*#__PURE__*/React.createElement("div", {
      className: "builder-layout"
    }, /*#__PURE__*/React.createElement("div", {
      className: "sidebar"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '1rem',
        background: '#f8fafc',
        borderBottom: '1px solid #e2e8f0',
        fontSize: '0.75rem',
        fontWeight: 'bold',
        color: '#94a3b8',
        letterSpacing: '0.05em'
      }
    }, "CAT\xC1LOGO"), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        overflowY: 'auto'
      }
    }, Object.keys(QUERY_LIBRARY).map(key => {
      const q = QUERY_LIBRARY[key];
      return /*#__PURE__*/React.createElement("button", {
        key: key,
        className: `query-btn ${activeId === key && !userActiveQuery ? 'active' : ''}`,
        onClick: () => {
          handleQueryChange(key);
          setUserActiveQuery(null);
          setUserQueryResult(null);
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          flexShrink: 0
        }
      }, /*#__PURE__*/React.createElement(ui.Icon, {
        name: q.meta.icon,
        size: 16
      })), /*#__PURE__*/React.createElement("div", {
        style: {
          overflow: 'hidden'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }
      }, q.meta.label), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '0.7rem',
          fontWeight: 'normal',
          opacity: 0.7,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }
      }, q.meta.desc)));
    }), /*#__PURE__*/React.createElement(UserQueriesPanel, {
      key: refreshSidebar,
      activeId: userActiveQuery ? `user_${userActiveQuery.id}` : '',
      onSelect: q => {
        setUserActiveQuery(q);
        setUserQueryResult(null);
      },
      onDelete: id => {
        if (userActiveQuery && userActiveQuery.id === id) {
          setUserActiveQuery(null);
          handleQueryChange('vocalcom_hist');
        }
      },
      onReorder: newArr => {
        localStorage.setItem('nexus_user_queries', JSON.stringify(newArr));
      },
      onEditRequest: q => setBuilderState({
        show: true,
        editQuery: q
      })
    }))), /*#__PURE__*/React.createElement("div", {
      className: "main-panel"
    }, userActiveQuery ? /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: '#f1f5f9',
        padding: '1rem',
        borderRadius: '8px',
        border: '1px solid #e2e8f0'
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.7rem',
        fontWeight: 'bold',
        padding: '2px 8px',
        borderRadius: '4px',
        background: userActiveQuery.tipo === 'DELETE' ? '#ef4444' : userActiveQuery.tipo === 'UPDATE' ? '#d97706' : userActiveQuery.tipo === 'INSERT' ? '#059669' : userActiveQuery.tipo === 'CUSTOM' ? '#3b82f6' : '#475569',
        color: 'white',
        marginRight: '8px'
      }
    }, userActiveQuery.tipo), /*#__PURE__*/React.createElement("strong", null, userActiveQuery.nombre), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.75rem',
        color: '#94a3b8',
        marginLeft: '8px'
      }
    }, userActiveQuery.fechaCreacion)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '0.5rem'
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn",
      style: {
        background: '#e2e8f0',
        color: '#475569',
        padding: '0.5rem 1rem'
      },
      onClick: () => setBuilderState({
        show: true,
        editQuery: userActiveQuery
      })
    }, "\u270F\uFE0F Editar"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      disabled: isExecuting,
      onClick: async () => {
        if (!window.nexusAPI) {
          utils.addToast('Sin conexión SQL activa.', 'error');
          return;
        }
        if (userActiveQuery.tipo === 'DELETE') {
          if (!window.confirm('⚠️ OPERACIÓN DESTRUCTIVA\n\nEstás a punto de ejecutar un DELETE.\n\n¿Confirmas?')) return;
        }
        setIsExecuting(true);
        try {
          const r = await window.nexusAPI.executeSQL(userActiveQuery.query);
          if (!r.success) throw new Error(r.error);
          setUserQueryResult(r.data);
          utils.addToast(`Ejecutado: ${Array.isArray(r.data) ? r.data.length + ' registros' : 'OK'}`, 'success');
        } catch (e) {
          utils.addToast('Error: ' + e.message, 'error');
        }
        setIsExecuting(false);
      }
    }, isExecuting ? '⏳ Ejecutando...' : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(ui.Icon, {
      name: "play",
      size: 16
    }), " Ejecutar")))), /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'relative',
        marginTop: '1rem',
        marginBottom: '0.5rem'
      }
    }, /*#__PURE__*/React.createElement("button", {
      style: {
        position: 'absolute',
        top: '12px',
        right: '15px',
        background: 'rgba(255,255,255,0.15)',
        border: '1px solid rgba(255,255,255,0.4)',
        color: 'white',
        padding: '4px 10px',
        borderRadius: '4px',
        cursor: 'pointer',
        zIndex: 10,
        fontWeight: 'bold'
      },
      onClick: () => {
        navigator.clipboard.writeText(userActiveQuery.query);
        utils.addToast('Copiado', 'success');
      }
    }, "\uD83D\uDCCB Copiar Script"), /*#__PURE__*/React.createElement("div", {
      className: "code-box",
      style: {
        minHeight: '80px',
        maxHeight: '180px',
        overflowY: 'auto',
        marginTop: 0,
        paddingTop: '3rem'
      }
    }, userActiveQuery.query)), userQueryResult && Array.isArray(userQueryResult) && userQueryResult.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'flex-end',
        marginTop: '0.5rem'
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn",
      style: {
        background: '#10b981',
        color: 'white',
        padding: '0.4rem 1rem'
      },
      onClick: () => exportToCSV(userQueryResult, userActiveQuery.nombre)
    }, "\uD83D\uDCE5 Exportar a CSV")), /*#__PURE__*/React.createElement("div", {
      style: {
        overflowX: 'auto',
        border: '1px solid #e2e8f0',
        borderRadius: '8px'
      }
    }, /*#__PURE__*/React.createElement("table", {
      style: {
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: '0.82rem'
      }
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
      style: {
        background: '#f8fafc'
      }
    }, Object.keys(userQueryResult[0]).map(k => /*#__PURE__*/React.createElement("th", {
      key: k,
      style: {
        padding: '8px 12px',
        textAlign: 'left',
        borderBottom: '2px solid #e2e8f0',
        fontWeight: 'bold',
        color: '#475569',
        whiteSpace: 'nowrap'
      }
    }, k)))), /*#__PURE__*/React.createElement("tbody", null, userQueryResult.slice(0, 500).map((row, i) => /*#__PURE__*/React.createElement("tr", {
      key: i,
      style: {
        borderBottom: '1px solid #f1f5f9',
        background: i % 2 === 0 ? 'white' : '#f8fafc'
      }
    }, Object.values(row).map((v, j) => /*#__PURE__*/React.createElement("td", {
      key: j,
      style: {
        padding: '6px 12px',
        color: '#334155'
      }
    }, String(v ?? ''))))))), userQueryResult.length > 500 && /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '8px 12px',
        fontSize: '0.75rem',
        color: '#94a3b8',
        borderTop: '1px solid #e2e8f0'
      }
    }, "Mostrando 500 de ", userQueryResult.length, " registros."))), userQueryResult && (!Array.isArray(userQueryResult) || userQueryResult.length === 0) && /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#f0fdf4',
        border: '1px solid #bbf7d0',
        borderRadius: '8px',
        padding: '1rem',
        color: '#166534',
        fontWeight: 'bold',
        fontSize: '0.9rem'
      }
    }, "\u2705 Query ejecutada correctamente. Sin registros devueltos.")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: '1.5rem',
        marginBottom: '1.5rem',
        paddingBottom: '1rem',
        borderBottom: '1px dashed #e2e8f0'
      }
    }, /*#__PURE__*/React.createElement("h2", {
      style: {
        color: 'var(--silver-main)',
        marginTop: 0,
        marginBottom: '0.5rem'
      }
    }, activeModule.meta.label), /*#__PURE__*/React.createElement("p", {
      style: {
        color: '#64748b',
        fontSize: '0.9rem',
        margin: 0
      }
    }, activeModule.meta.desc)), activeModule.renderForm(params, (keyOrObj, value) => {
      if (typeof keyOrObj === 'object') setParams(prev => ({
        ...prev,
        ...keyOrObj
      }));else setParams(prev => ({
        ...prev,
        [keyOrObj]: value
      }));
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: 'right',
        marginTop: '2rem',
        display: 'flex',
        gap: '1rem',
        justifyContent: 'flex-end',
        alignItems: 'center'
      }
    }, userQueryResult && Array.isArray(userQueryResult) && userQueryResult.length > 0 && (() => {
      const dateSuffix = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const baseName = activeId === 'vocalcom_hist' ? `Historico_${params.campaign || 'Base'}_${dateSuffix}` : activeId === 'vicidial_hist' ? `Vicidial_${params.campaniaId || 'Base'}_${dateSuffix}` : activeId === 'agent_connection_states' ? `REPORTE_ESTADOS_CONEXION_AGENTE_${params.agentIds.replace(/[^a-zA-Z0-9]/g, '_')}_${dateSuffix}` : activeModule.meta.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return isVicidial ? /*#__PURE__*/React.createElement("button", {
        className: "btn",
        style: {
          padding: '0.6rem 1.2rem',
          background: '#0369a1',
          color: 'white',
          fontWeight: 'bold',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        },
        onClick: () => exportToXLSX(userQueryResult, baseName)
      }, /*#__PURE__*/React.createElement(ui.Icon, {
        name: "download",
        size: 18
      }), " Descargar Excel (", userQueryResult.length, " filas)") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
        className: "btn",
        style: {
          padding: '0.6rem 1.2rem',
          background: '#0369a1',
          color: 'white',
          fontWeight: 'bold',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        },
        onClick: () => exportToXLSX(userQueryResult, baseName)
      }, /*#__PURE__*/React.createElement(ui.Icon, {
        name: "download",
        size: 18
      }), " Excel (", userQueryResult.length, " filas)"), /*#__PURE__*/React.createElement("button", {
        className: "btn",
        style: {
          padding: '0.6rem 1.2rem',
          background: '#475569',
          color: 'white',
          fontWeight: 'bold',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        },
        onClick: () => exportToCSV(userQueryResult, baseName)
      }, /*#__PURE__*/React.createElement(ui.Icon, {
        name: "download",
        size: 18
      }), " CSV (", userQueryResult.length, " filas)"));
    })(), /*#__PURE__*/React.createElement("button", {
      style: {
        padding: '0.6rem 1.2rem',
        borderRadius: '6px',
        background: '#e2e8f0',
        color: '#475569',
        fontWeight: 'bold',
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      },
      onClick: () => {
        const res = activeModule.generateSQL(params);
        setSql(res);
        setUserQueryResult(null);
        utils.addToast('Query generada. Revise el script antes de ejecutar.', 'info');
      }
    }, /*#__PURE__*/React.createElement(ui.Icon, {
      name: "code",
      size: 18
    }), " Generar Query"), /*#__PURE__*/React.createElement("button", {
      style: {
        padding: '0.6rem 1.2rem',
        borderRadius: '6px',
        background: '#10b981',
        color: 'white',
        fontWeight: 'bold',
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        boxShadow: '0 4px 6px -1px rgba(16,185,129,0.2)'
      },
      disabled: isExecuting,
      onClick: async () => {
        const res = activeModule.generateSQL(params);
        setSql(res);
        if (!window.nexusAPI) {
          utils.addToast('No hay conexión SQL activa.', 'error');
          return;
        }
        setIsExecuting(true);
        utils.addToast('Ejecutando consulta en el servidor...', 'info');
        try {
          const queryRes = await window.nexusAPI.executeSQL(res);
          if (!queryRes.success) throw new Error(queryRes.error);
          if (isVicidial) {
            const rows = queryRes.data || [];
            if (rows.length === 0) {
              utils.addToast('Sin registros para el período seleccionado.', 'info');
            } else {
              await exportToXLSX(rows, `Vicidial_${params.campaniaId}_${params.fechaInicio}_${params.fechaFin}`);
              utils.addToast(`¡Éxito! ${rows.length} registros exportados a Excel.`, 'success');
            }
            setUserQueryResult(null);
          } else {
            setUserQueryResult(queryRes.data || []);
            utils.addToast(Array.isArray(queryRes.data) ? `¡Éxito! ${queryRes.data.length} filas extraídas.` : '¡Éxito! Operación completada.', 'success');
          }
        } catch (e) {
          utils.addToast('Error SQL: ' + e.message, 'error');
        }
        setIsExecuting(false);
      }
    }, isExecuting ? '⏳ Ejecutando...' : isVicidial ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(ui.Icon, {
      name: "download",
      size: 18
    }), " Ejecutar y Exportar Excel") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(ui.Icon, {
      name: "play",
      size: 18
    }), " Ejecutar SQL"))), sql && /*#__PURE__*/React.createElement("div", {
      className: "fade-in",
      style: {
        position: 'relative',
        marginTop: '1rem',
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("button", {
      style: {
        position: 'absolute',
        top: '12px',
        right: '15px',
        background: 'rgba(255,255,255,0.15)',
        border: '1px solid rgba(255,255,255,0.4)',
        color: 'white',
        padding: '4px 10px',
        borderRadius: '4px',
        cursor: 'pointer',
        zIndex: 10,
        fontWeight: 'bold'
      },
      onClick: () => {
        navigator.clipboard.writeText(sql);
        utils.addToast('Copiado', 'success');
      }
    }, "\uD83D\uDCCB Copiar Script"), /*#__PURE__*/React.createElement("div", {
      className: "code-box",
      style: {
        height: '120px',
        marginTop: 0,
        paddingTop: '3rem'
      }
    }, sql)), userQueryResult && (!Array.isArray(userQueryResult) || userQueryResult.length === 0) && /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#f0fdf4',
        border: '1px solid #bbf7d0',
        borderRadius: '8px',
        padding: '1rem',
        color: '#166534',
        fontWeight: 'bold',
        fontSize: '0.9rem',
        marginTop: '1rem'
      }
    }, "\u2705 Ejecuci\xF3n exitosa. Operaci\xF3n completada.")))));
  };
};