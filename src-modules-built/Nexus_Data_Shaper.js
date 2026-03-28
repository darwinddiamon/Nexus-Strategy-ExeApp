window.NexusModuleMeta = {
  icon: 'scissors',
  color: 'bg-red-500',
  title: 'Nexus Data Shaper'
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
    addToast,
    readFile
  } = utils;

  // =================================================================================================
  // [BLOQUE 0] CONFIGURACIÓN GLOBAL Y ESTILOS (CORREGIDO: LAYOUT DROPZONE)
  // =================================================================================================
  const cssStyles = `
        :root { 
            --primary: #EF4444; 
            --primary-dark: #DC2626;
            --bg-soft: #FEF2F2; 
            --border: #FCA5A5; 
            --text-main: #7F1D1D; 
            --white: #ffffff; 
            --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
            --shadow-lg: 0 10px 15px -3px rgba(239, 68, 68, 0.1);
        }

        .app-container { font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #1F2937; max-width: 1200px; margin: 0 auto; }

        /* HEADER */
        .header { 
            background: linear-gradient(135deg, #DC2626, #EF4444); 
            color: white; 
            padding: 1.5rem 2rem; 
            border-radius: 16px; 
            margin-bottom: 2.5rem; 
            display: flex; justify-content: space-between; align-items: center; 
            box-shadow: var(--shadow-lg);
        }

        /* CARDS */
        .card { 
            background: var(--white); 
            border: 1px solid #F3F4F6; 
            border-radius: 16px; 
            padding: 2.5rem; 
            margin-bottom: 2rem; 
            box-shadow: var(--shadow-md); 
        }
        
        /* GRILLA */
        .tools-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.5rem; }

        .tool-card { 
            border: 1px solid #E5E7EB; border-radius: 12px; padding: 1.25rem; background: white; 
            transition: all 0.2s; cursor: default;
        }
        .tool-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
        .tool-card.active { border-color: var(--primary); background: #FEF2F2; box-shadow: 0 0 0 2px #FEF2F2; }
        
        /* DROP ZONE (CORREGIDA) */
        .drop-zone { 
            display: block; /* CRÍTICO: Comportamiento de bloque para no montarse */
            width: 100%;    /* Ancho completo */
            box-sizing: border-box;
            border: 2px dashed #FECACA; 
            border-radius: 16px; 
            padding: 4rem 2rem; 
            text-align: center; 
            background: linear-gradient(to bottom, #FFF, #FFF5F5); 
            cursor: pointer; 
            transition: all 0.3s;
            margin-top: 1rem; /* Separación segura del texto superior */
        }
        .drop-zone:hover { border-color: var(--primary); background: #FEF2F2; transform: scale(1.01); }

        /* UI INTERNA */
        .tool-ui-container { margin-top: 1rem; padding: 1.5rem; background: white; border: 1px solid #FECACA; border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
        .form-label { display: block; font-size: 0.75rem; font-weight: 700; color: var(--text-main); margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em; }
        .form-select { width: 100%; padding: 0.6rem 1rem; border: 1px solid #D1D5DB; border-radius: 8px; font-size: 0.95rem; outline: none; }
        .form-select:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1); }
        
        /* --- PEGAR ESTO DENTRO DE cssStyles --- */

        .section-label { 
            font-size: 0.7rem; font-weight: 800; color: #6B7280; 
            margin-bottom: 0.4rem; text-transform: uppercase; letter-spacing: 0.05em; display: block; 
        }
        
        /* Selectores integrados (Gris suave) */
        .integrated-select { 
            width: 100%; padding: 0.6rem; border: 1px solid #E5E7EB; border-radius: 8px; 
            font-size: 0.9rem; background-color: #F9FAFB; transition: 0.2s; outline: none; 
        }
        .integrated-select:focus { 
            border-color: var(--primary); background: white; box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.1); 
        }
        
        /* Botones de Opción (Tarjetas) */
        .radio-group { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); /* Se adapta automáticamente */
            gap: 0.5rem; 
            margin-bottom: 1rem; 
        }
        .radio-card { 
            border: 1px solid #E5E7EB; border-radius: 8px; padding: 0.75rem; text-align: center; 
            cursor: pointer; transition: all 0.2s; background: #F9FAFB;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
        }
        .radio-card:hover { border-color: #FCA5A5; background: white; }
        .radio-card.selected { 
            border-color: var(--primary); background: #FFF1F2; color: #991B1B; 
            font-weight: 600; box-shadow: 0 1px 2px rgba(239, 68, 68, 0.1); 
        }
        .radio-title { font-size: 0.8rem; font-weight: 600; line-height: 1.2; word-break: break-word; }
        .radio-desc { font-size: 0.65rem; opacity: 0.8; margin-top: 2px; display: none; } /* Ocultamos descripciones largas en pantallas muy chicas si es necesario, o lo dejamos visible */
        
        @media (min-width: 300px) { .radio-desc { display: block; } }


        /* Fila de Switch limpia */
        .toggle-row { 
            display: flex; align-items: center; justify-content: space-between; 
            padding: 0.75rem; background: #F9FAFB; border-radius: 8px; border: 1px solid #F3F4F6; 
        }
        .toggle-label { font-size: 0.85rem; font-weight: 600; color: #374151; }

        /* BOTONES */
        .btn { padding: 0.75rem 2rem; border-radius: 10px; font-weight: 600; cursor: pointer; border: none; font-size: 1rem; transition: all 0.2s; }
        .btn:hover { opacity: 0.9; transform: translateY(-1px); }
        .btn-primary { background: var(--primary); color: white; box-shadow: 0 4px 6px -1px rgba(220, 38, 38, 0.3); }

        /* SWITCH */
        .switch { position: relative; display: inline-block; width: 44px; height: 24px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #E5E7EB; transition: .3s; border-radius: 34px; }
        input:checked + .slider { background-color: var(--primary); }
        input:checked + .slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .3s; border-radius: 50%; transform: translateX(0); }
        input:checked + .slider:before { transform: translateX(20px); }

        /* --- PEGAR ESTO DENTRO DE cssStyles --- */

        /* TABS (Pestañas) */
        .tabs-header { 
            display: flex; 
            flex-wrap: wrap; /* CRÍTICO: Permite que bajen si no caben */
            border-bottom: 2px solid #E5E7EB; 
            margin-bottom: 1.5rem; 
            gap: 0.5rem; /* Menor espacio entre ellas */
        }
        .tab-btn { 
            padding: 0.5rem 1rem; 
            border: none; 
            background: none; 
            cursor: pointer; 
            font-weight: 600; 
            color: #6B7280; 
            border-bottom: 3px solid transparent; 
            transition: 0.2s; 
            white-space: nowrap; /* Evita que el texto del botón se parta feo */
            font-size: 0.9rem;
        }
        .tab-btn:hover { color: var(--text-main); background: #F9FAFB; border-radius: 6px 6px 0 0; }
        .tab-btn.active { color: var(--primary); border-bottom-color: var(--primary); background: transparent; }

        /* BUILDER DE CONCATENACIÓN */
        .concat-builder { background: #F9FAFB; padding: 1rem; border-radius: 8px; border: 1px solid #E5E7EB; }
        .builder-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
        .step-badge { 
            background: #E5E7EB; color: #374151; font-size: 0.7rem; padding: 2px 6px; 
            border-radius: 4px; font-weight: bold; min-width: 24px; text-align: center;
        }
        .icon-btn { cursor: pointer; padding: 4px; border-radius: 4px; color: #6B7280; }
        .icon-btn:hover { background: #FECACA; color: #EF4444; }

        /* INPUTS PEQUEÑOS */
        .input-sm { padding: 0.4rem; border: 1px solid #D1D5DB; border-radius: 6px; font-size: 0.85rem; width: 100%; }

        /* --- PEGAR EN cssStyles --- */

        /* PHONE MAPPER */
        .phone-mapper-list { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem; }
        .phone-row { 
            display: grid; grid-template-columns: 40px 1fr 20px 1fr 30px; 
            gap: 0.5rem; align-items: center; background: #F9FAFB; padding: 0.5rem; 
            border: 1px solid #E5E7EB; border-radius: 8px; 
        }
        .phone-label { font-weight: bold; color: var(--primary); font-size: 0.8rem; text-align: center; }
        .plus-icon { text-align: center; color: #9CA3AF; font-weight: bold; }
        
        /* BOTONES DE ACCIÓN RÁPIDA */
        .action-bar { display: flex; gap: 0.5rem; margin-bottom: 1rem; }

        /* --- ESTILOS DE NORMALIZACIÓN (PASO 2) --- */
        .norm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem; }
        @media (max-width: 600px) { .norm-grid { grid-template-columns: 1fr; } }
        
        .norm-box { 
            border: 2px solid #E5E7EB; border-radius: 8px; padding: 1rem; 
            background: #F9FAFB; max-height: 300px; display: flex; flex-direction: column; 
        }
        .norm-box.unique { border-color: #10B981; background: #ECFDF5; } /* Verde */
        .norm-box.repeat { border-color: #F59E0B; background: #FFFBEB; } /* Naranja */
        
        .norm-header { font-weight: bold; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem; }
        
        .norm-list { overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 4px; }
        
        .norm-item { 
            background: white; border: 1px solid #E5E7EB; padding: 0.4rem 0.8rem; 
            border-radius: 6px; cursor: pointer; font-size: 0.85rem; transition: 0.2s; 
            display: flex; align-items: center; gap: 0.5rem;
        }
        .norm-item:hover { transform: translateX(2px); border-color: #EF4444; }
        .norm-item.protected { opacity: 0.6; cursor: not-allowed; background: #EEE; border-color: #DDD; }

        /* --- HERRAMIENTA 6: ENRIQUECER (VLookup y Clasificación) --- */
        
        /* Zona de carga de archivo secundario */
        .secondary-dropzone { 
            border: 2px dashed #CBD5E1; 
            border-radius: 8px; 
            padding: 2rem; 
            text-align: center; 
            background: #F8FAFC; 
            cursor: pointer; 
            transition: all 0.2s ease; 
        }
        .secondary-dropzone:hover { 
            border-color: var(--primary); 
            background: #FEF2F2; /* Un tono rojizo suave acorde a tu tema */
            transform: translateY(-2px);
        }

        /* Contenedor visual del Cruce activo */
        .vlookup-box { 
            border: 2px solid #E5E7EB; 
            border-radius: 8px; 
            overflow: hidden; 
            background: white; 
            margin-bottom: 1rem;
        }
        .vlookup-header { 
            background: #F3F4F6; 
            padding: 1rem; 
            border-bottom: 1px solid #E5E7EB; 
            font-weight: bold; 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
        }
        .vlookup-body { 
            padding: 1.5rem; 
        }

        /* Selector de columnas (Grid de checkboxes) */
        .col-selector { 
            max-height: 250px; 
            overflow-y: auto; 
            border: 1px solid #D1D5DB; 
            border-radius: 6px; 
            padding: 0.8rem; 
            display: grid; 
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); 
            gap: 0.5rem; 
            background: #F9FAFB; 
        }
        .col-option { 
            display: flex; 
            gap: 8px; 
            align-items: center; 
            font-size: 0.85rem; 
            padding: 6px; 
            border-radius: 4px; 
            cursor: pointer; 
            background: white;
            border: 1px solid transparent;
            transition: 0.1s;
        }
        .col-option:hover { 
            background: #F3F4F6; 
            border-color: #D1D5DB;
        }
        .col-option input { 
            cursor: pointer; 
            accent-color: var(--primary); 
        }


    `;
  const TOOLS = [{
    id: 'rut',
    label: '1. Normalizador RUT',
    icon: 'id-card',
    desc: 'Validar, limpiar y calcular DV.'
  }, {
    id: 'text',
    label: '2. Limpieza Texto',
    icon: 'type',
    desc: 'Mayúsculas, espacios y caracteres.'
  }, {
    id: 'columns',
    label: '3. Estructura',
    icon: 'columns',
    desc: 'Separar, unir y mover columnas.'
  }, {
    id: 'phones',
    label: '4. Teléfonos',
    icon: 'phone',
    desc: 'Normalizar a 9 dígitos Chileno.'
  }, {
    id: 'dates',
    label: '5. Fechas',
    icon: 'calendar',
    desc: 'Formatos y extracción de tiempo.'
  }, {
    id: 'enrich',
    label: '6. Enriquecer',
    icon: 'database',
    desc: 'Cruce BuscarV con otros archivos.'
  }, {
    id: 'ranking',
    label: '7. Ranking y Conteos',
    icon: 'list',
    desc: 'Ranking Nexus, Conteos secuenciales y Totales.'
  }];

  // UTILIDAD AUXILIAR MATEMÁTICA (DV)
  const calculateDV = T => {
    let M = 0,
      S = 1;
    for (; T; T = Math.floor(T / 10)) S = (S + T % 10 * (9 - M++ % 6)) % 11;
    return S ? S - 1 : 'K';
  };
  return () => {
    // [BLOQUE 0.1] ESTADOS GLOBALES
    const [step, setStep] = useState(1);
    const [activeTab, setActiveTab] = useState('batch'); // 'batch' = Masivo, 'quick' = Utilidades

    // --- ESTADOS: UTILIDADES EXPRESS ---
    const [quickText, setQuickText] = useState('');
    const [quickR3, setQuickR3] = useState({
      a: '',
      b: '',
      c: ''
    });
    const [quickDates, setQuickDates] = useState({
      d1: '',
      d2: ''
    });

    // --- LÓGICA: UTILIDADES EXPRESS ---
    const transformQuickText = mode => {
      if (!quickText) return;
      let res = quickText;
      switch (mode) {
        case 'upper':
          res = res.toUpperCase();
          break;
        case 'lower':
          res = res.toLowerCase();
          break;
        case 'title':
          res = res.toLowerCase().replace(/(?:^|\s)\S/g, a => a.toUpperCase());
          break;
        case 'clean':
          res = res.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, ' ');
          break;
        case 'sql':
          res = res.split(/\n|,/).map(s => `'${s.trim()}'`).filter(s => s !== "''").join(',');
          break;
      }
      setQuickText(res);
    };
    const calcR3 = () => {
      const {
        a,
        b,
        c
      } = quickR3;
      if (!a || !b || !c) return '---';
      const res = parseFloat(b) * parseFloat(c) / parseFloat(a);
      return isNaN(res) ? 'Error' : Number.isInteger(res) ? res : res.toFixed(2);
    };
    const calcDays = () => {
      if (!quickDates.d1 || !quickDates.d2) return '---';
      const diff = new Date(quickDates.d2) - new Date(quickDates.d1);
      const days = diff / (1000 * 60 * 60 * 24);
      return isNaN(days) ? 'Error' : `${Math.ceil(days)} días`;
    };
    const [loading, setLoading] = useState(false);
    const [loadingMsg, setLoadingMsg] = useState('');
    const [masterData, setMasterData] = useState([]);
    const [columns, setColumns] = useState([]);
    const [filesMeta, setFilesMeta] = useState([]);
    const [config, setConfig] = useState({
      pivotField: '',
      duplicateStrategy: ''
    });

    // Configuración para la Normalización (Paso 2)
    const [normConfig, setNormConfig] = useState({
      uniqueCols: [],
      repeatCols: []
    });

    // ESTADOS DE HERRAMIENTAS
    const [activeTools, setActiveTools] = useState({});
    const [toolSettings, setToolSettings] = useState({});

    // --- CORRECCIÓN PANTALLA GRIS: Estado de Campañas movido aquí ---
    const [dbCampaigns, setDbCampaigns] = useState([]);
    useEffect(() => {
      const loadCamps = async () => {
        if (db) setDbCampaigns((await db.getAll('campaigns')) || []);
      };
      loadCamps();
    }, []);
    // ---------------------------------------------------------------

    // [NUEVO] ESTADOS PARA REFINAMIENTO (POST-PIPELINE)
    const [filterRules, setFilterRules] = useState([]); // {id, col, op, val}
    const [sortRules, setSortRules] = useState([]); // {id, col, dir: 'asc'|'desc'}

    // --- AUTO-CORRECCIÓN VISUAL (Tarjeta Roja + Icono Maletín/Caja) ---
    useEffect(() => {
      const fixVisuals = async () => {
        if (!db) return;
        try {
          const modules = await db.getAll('modules');
          // 1. Buscamos el módulo en la base de datos local
          const me = modules.find(m => m.title === 'Nexus Data Shaper' || m.title === 'Data Shaper');

          // 2. Verificamos si necesita corrección (Si no es Rojo o no es 'briefcase')
          if (me && (me.color !== 'bg-red-600' || me.icon !== 'briefcase')) {
            // 3. Aplicamos los valores correctos
            me.color = 'bg-red-600'; // Rojo Nexus
            me.icon = 'briefcase'; // 'briefcase' es el ícono de Maletín/Caja en esta librería

            // 4. Guardamos el cambio
            await db.addOrUpdate('modules', [me]);
          }
        } catch (e) {
          console.error("Error actualizando tarjeta:", e);
        }
      };
      // Ejecutamos la corrección
      fixVisuals();
    }, []);

    // [MODIFICADO] LÓGICA DE COMPARACIÓN
    const compareValues = (cell, val, op) => {
      const c = String(cell || '').toUpperCase().trim();

      // 1. LÓGICA DE LISTAS (MULTIPLE)
      if (op === 'in' || op === 'not_in') {
        // val debe ser un array. Si es string lo convertimos por seguridad.
        const searchSet = Array.isArray(val) ? val : [String(val).toUpperCase()];
        const match = searchSet.includes(c);
        return op === 'in' ? match : !match;
      }

      // 2. LÓGICA ESTÁNDAR (TEXTO/NUMERO)
      const v = String(val || '').toUpperCase().trim();
      const numC = parseFloat(c.replace(',', '.'));
      const numV = parseFloat(v.replace(',', '.'));
      const isNum = !isNaN(numC) && !isNaN(numV) && !['contains', '=', '<>'].includes(op);
      switch (op) {
        case '=':
          return c === v;
        case '<>':
          return c !== v;
        case 'contains':
          return c.includes(v);
        case '>':
          return isNum ? numC > numV : false;
        case '<':
          return isNum ? numC < numV : false;
        default:
          return true;
      }
    };

    // [NUEVO HELPER] Obtener valores únicos para ordenar (Top 100)
    const getUniqueValues = col => {
      if (!col) return [];
      const unique = new Set(masterData.map(r => String(r[col] || '').trim().toUpperCase()));
      return Array.from(unique).sort().slice(0, 100); // Limitamos a 100 para no romper la UI
    };

    // [MODIFICADO] COMPUTAR DATOS FINALES
    const getFinalData = () => {
      let data = [...masterData];

      // 1. FILTROS
      if (filterRules.length > 0) {
        data = data.filter(row => {
          let result = compareValues(row[filterRules[0].col], filterRules[0].val, filterRules[0].op);
          for (let i = 1; i < filterRules.length; i++) {
            const rule = filterRules[i];
            const currentMatch = compareValues(row[rule.col], rule.val, rule.op);
            rule.logic === 'OR' ? result = result || currentMatch : result = result && currentMatch;
          }
          return result;
        });
      }

      // 2. ORDENAMIENTO
      if (sortRules.length > 0) {
        data.sort((a, b) => {
          for (const rule of sortRules) {
            if (!rule.col) continue;
            const valA = String(a[rule.col] || '').trim().toUpperCase();
            const valB = String(b[rule.col] || '').trim().toUpperCase();
            let comparison = 0;

            // TIPO: PERSONALIZADO (Lista Visual)
            if (rule.type === 'custom') {
              // Ahora rule.customValues es un ARRAY de strings
              const orderList = Array.isArray(rule.customValues) ? rule.customValues : [];
              let idxA = orderList.indexOf(valA);
              let idxB = orderList.indexOf(valB);

              // Si no está en la lista, lo mandamos al final
              if (idxA === -1) idxA = 9999;
              if (idxB === -1) idxB = 9999;
              comparison = idxA - idxB;
            }
            // TIPO: ESTÁNDAR
            else {
              const numA = parseFloat(valA.replace(',', '.'));
              const numB = parseFloat(valB.replace(',', '.'));
              if (!isNaN(numA) && !isNaN(numB)) comparison = numA - numB;else comparison = valA.localeCompare(valB);
              if (rule.dir === 'desc') comparison = -comparison;
            }
            if (comparison !== 0) return comparison;
          }
          return 0;
        });
      }
      return data;
    };

    // =================================================================================================
    // [BLOQUE 1] LOGICA DE CARGA MASIVA (1 a 300 ARCHIVOS)
    // =================================================================================================
    const handleFileUpload = async e => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      setLoading(true);
      let accumulatedData = [];
      let templateCols = [];
      let validCount = 0;
      let discardedCount = 0;
      let meta = [];
      const readFileAsync = file => new Promise(resolve => {
        const reader = new FileReader();
        if (file.name.match(/\.(csv|txt)$/i)) {
          reader.onload = evt => {
            Papa.parse(evt.target.result, {
              header: true,
              skipEmptyLines: true,
              dynamicTyping: true,
              complete: res => resolve(res.data),
              error: () => resolve([])
            });
          };
          reader.readAsText(file, 'ISO-8859-1');
        } else {
          reader.onload = evt => {
            try {
              const wb = XLSX.read(evt.target.result, {
                type: 'binary'
              });
              const firstSheet = wb.SheetNames[0];
              if (!firstSheet) return resolve([]);
              const data = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], {
                defval: ''
              });
              resolve(data);
            } catch (err) {
              resolve([]);
            }
          };
          reader.readAsBinaryString(file);
        }
      });
      for (let i = 0; i < files.length; i++) {
        setLoadingMsg(`Analizando archivo ${i + 1} de ${files.length}...`);
        await new Promise(r => setTimeout(r, 10));
        const rows = await readFileAsync(files[i]);
        if (!rows || rows.length === 0) {
          discardedCount++;
          continue;
        }
        const cleanRows = rows.map(r => {
          const obj = {};
          Object.keys(r).forEach(k => obj[k.trim()] = r[k]);
          return obj;
        });
        if (accumulatedData.length === 0) {
          templateCols = Object.keys(cleanRows[0]);
          accumulatedData = cleanRows;
        } else {
          accumulatedData = [...accumulatedData, ...cleanRows];
        }
        validCount++;
        meta.push({
          name: files[i].name,
          count: cleanRows.length
        });
      }
      if (accumulatedData.length === 0) {
        setLoading(false);
        addToast(`Todos los archivos estaban vacíos o ilegibles.`, 'warning');
        return;
      }
      setMasterData(accumulatedData);
      setColumns(templateCols);
      setFilesMeta(meta);
      const suggestedPivot = templateCols.find(c => /rut|id|code|codigo/i.test(c)) || templateCols[0];
      setConfig(prev => ({
        ...prev,
        pivotField: suggestedPivot
      }));
      setLoading(false);
      setStep(2);
      addToast(`Carga: ${validCount} OK | ${discardedCount} descartados.`, 'success');
    };

    // Detecta qué columnas varían para un mismo ID (Heurística)
    const autoClassifyNormalization = pivot => {
      if (!pivot) return;
      const grouped = {};
      // Muestreo de 500 filas para no bloquear la UI
      const sample = masterData.slice(0, 500);
      sample.forEach(row => {
        const key = String(row[pivot] || '').trim();
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(row);
      });
      const unique = [pivot]; // El ID siempre es único
      const repeat = [];
      columns.forEach(col => {
        if (col === pivot) return;
        let isVariable = false;

        // Buscamos si en algún grupo hay valores distintos para esta columna
        for (const key in grouped) {
          if (grouped[key].length > 1) {
            const vals = new Set(grouped[key].map(r => String(r[col] || '')));
            if (vals.size > 1) {
              isVariable = true; // Varía (ej: Monto, Teléfono)
              break;
            }
          }
        }
        if (isVariable) repeat.push(col);else unique.push(col);
      });
      setNormConfig({
        uniqueCols: unique,
        repeatCols: repeat
      });
    };
    const executeConsolidation = () => {
      if (!config.pivotField) {
        addToast("Selecciona un Campo Pivote", "error");
        return;
      }
      setLoading(true);
      setLoadingMsg('Procesando Estructura...');
      setTimeout(() => {
        let finalData = [];

        // CASO 1: ELIMINAR DUPLICADOS (Keep First)
        if (config.duplicateStrategy === 'remove') {
          const seen = new Set();
          finalData = masterData.filter(r => {
            const k = String(r[config.pivotField]).trim();
            if (!k || seen.has(k)) return false;
            seen.add(k);
            return true;
          });
        }

        // CASO 2: NORMALIZAR (Flatten / Aplanar)
        else if (config.duplicateStrategy === 'normalize') {
          const grouped = {};
          // 1. Agrupar todo
          masterData.forEach(r => {
            const k = String(r[config.pivotField]).trim();
            if (!k) return;
            if (!grouped[k]) grouped[k] = [];
            grouped[k].push(r);
          });

          // 2. Calcular profundidad máxima (cuántas columnas crear)
          let maxDepth = 1;
          Object.values(grouped).forEach(g => {
            if (g.length > maxDepth) maxDepth = g.length;
          });

          // 3. Aplanar
          Object.keys(grouped).forEach(key => {
            const group = grouped[key];
            const baseRow = group[0];
            const newRow = {};

            // A. Campos Únicos (Se toman de la primera fila)
            normConfig.uniqueCols.forEach(col => {
              newRow[col] = baseRow[col];
            });

            // B. Campos Repetibles (Se expanden Col_1, Col_2...)
            normConfig.repeatCols.forEach(col => {
              for (let i = 0; i < maxDepth; i++) {
                const val = group[i] ? group[i][col] : '';
                newRow[`${col}_${i + 1}`] = val;
              }
            });
            finalData.push(newRow);
          });

          // Actualizar columnas globales tras normalizar
          if (finalData.length > 0) setColumns(Object.keys(finalData[0]));
        }

        // CASO 3: MANTENER TODO (Default)
        else {
          finalData = [...masterData];
        }
        setMasterData(finalData);
        setLoading(false);
        setStep(3); // Avanzar a Herramientas
        addToast(`Consolidación lista: ${finalData.length} registros.`, 'success');
      }, 500);
    };

    // =================================================================================================
    // [BLOQUE 2] MOTOR LÓGICO (PIPELINE)
    // =================================================================================================
    const runPipeline = async () => {
      setLoading(true);
      let currentData = [...masterData];
      const order = ['rut', 'text', 'columns', 'phones', 'dates', 'enrich', 'ranking', 'filter', 'sort'];
      try {
        for (const toolId of order) {
          if (activeTools[toolId]) {
            switch (toolId) {
              // -------------------------------------------------------------
              // HERRAMIENTA 1: RUT 
              // -------------------------------------------------------------
              case 'rut':
                const cfg = toolSettings['rut'];
                if (!cfg || !cfg.col) throw new Error("Configura la columna RUT para continuar.");
                currentData = currentData.map(row => {
                  let raw = String(row[cfg.col] || '').trim();
                  // Limpieza Universal
                  let clean = raw.replace(/[^0-9kK]/g, '').toUpperCase();
                  let body = '',
                    dv = '';
                  if (clean.length < 1) return row;

                  // FASE 1: OBTENCIÓN
                  if (cfg.action === 'calc') {
                    body = clean;
                    const bodyNum = parseInt(body, 10);
                    // Evitar NaN si el cuerpo está vacío
                    if (!isNaN(bodyNum)) {
                      dv = String(calculateDV(bodyNum));
                      body = String(bodyNum);
                    }
                  } else {
                    if (raw.includes('-')) {
                      const parts = raw.split('-');
                      body = parts[0].replace(/[^0-9]/g, '');
                      dv = parts[1] ? parts[1].replace(/[^0-9kK]/g, '').toUpperCase() : '';
                    } else {
                      if (clean.length > 1) {
                        dv = clean.slice(-1);
                        body = clean.slice(0, -1);
                      } else {
                        body = clean;
                      }
                    }
                    if (body) body = String(parseInt(body, 10));
                  }

                  // FASE 2: FORMATO SALIDA
                  let finalVal = '';
                  let extraCols = {};
                  if (cfg.style === 'split') {
                    finalVal = body;
                    extraCols[`DV_${cfg.col}`] = dv;
                  } else if (cfg.style === 'dv_only') {
                    // NUEVO CASO: SOLO DV
                    // La columna principal queda limpia (solo cuerpo)
                    finalVal = body;
                    // Y forzamos la creación de la columna DV
                    extraCols[`DV_${cfg.col}`] = dv;
                  } else if (cfg.style === 'dots') {
                    const formattedBody = body ? Number(body).toLocaleString('es-CL').replace(/,/g, '.') : '';
                    finalVal = `${formattedBody}-${dv}`;
                  } else if (cfg.style === 'hyphen') {
                    finalVal = `${body}-${dv}`;
                  } else {
                    finalVal = `${body}${dv}`;
                  }

                  // FASE 3: ESCRITURA
                  const newRow = {
                    ...row
                  };

                  // Si elige "Solo DV", el usuario suele querer conservar su columna original intacta
                  // o tener una columna limpia al lado.
                  if (cfg.newCol) {
                    newRow[`RUT_NORM_${cfg.col}`] = finalVal;
                  } else {
                    newRow[cfg.col] = finalVal;
                  }
                  return {
                    ...newRow,
                    ...extraCols
                  };
                });
                break;

              // -------------------------------------------------------------
              // HERRAMIENTA 2: LIMPIEZA DE TEXTO (V3.0)
              // -------------------------------------------------------------
              case 'text':
                const tCfg = toolSettings['text'];
                if (tCfg.scope === 'specific' && (!tCfg.targetCols || tCfg.targetCols.length === 0)) {
                  throw new Error("Selecciona al menos una columna para limpiar.");
                }
                const targetColumns = tCfg.scope === 'all' ? columns : tCfg.targetCols;
                currentData = currentData.map(row => {
                  const newRow = {
                    ...row
                  };
                  targetColumns.forEach(col => {
                    let val = newRow[col];
                    if (val === null || val === undefined) val = '';
                    val = String(val);

                    // 1. CARACTERES (Acentos, Ñ)
                    if (tCfg.accents) {
                      // Reemplazo explícito de vocales con acento agudo (á), grave (à) y diéresis (ä) y circunflejo (â)
                      val = val.replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e').replace(/[íìïî]/g, 'i').replace(/[óòöô]/g, 'o').replace(/[úùüû]/g, 'u').replace(/[ÁÀÄÂ]/g, 'A').replace(/[ÉÈËÊ]/g, 'E').replace(/[ÍÌÏÎ]/g, 'I').replace(/[ÓÒÖÔ]/g, 'O').replace(/[ÚÙÜÛ]/g, 'U');
                    }
                    if (tCfg.n_tilde) {
                      val = val.replace(/ñ/g, 'n').replace(/Ñ/g, 'N');
                    }

                    // 2. SÍMBOLOS (%, *, ?, `)
                    if (tCfg.symbols) {
                      // Paso A: Regex estricta. Deja solo a-z, 0-9 y espacios.
                      // Esto elimina AUTOMÁTICAMENTE %, *, ?, acentos invertidos sueltos (`), puntos, comas, etc.
                      val = val.replace(/[^a-zA-Z0-9\s]/g, '');
                    }

                    // 3. ESPACIOS
                    if (tCfg.spaceMode === 'remove_all') {
                      val = val.replace(/\s+/g, '');
                    } else if (tCfg.spaceMode === 'normalize') {
                      val = val.replace(/\s+/g, ' ').trim();
                    }

                    // 4. CASING
                    if (tCfg.casing === 'upper') val = val.toUpperCase();else if (tCfg.casing === 'lower') val = val.toLowerCase();else if (tCfg.casing === 'capital') {
                      val = val.toLowerCase().replace(/(?:^|\s|["'([{])+\S/g, match => match.toUpperCase());
                    }

                    // 5. VACÍO REAL
                    if (val.trim().length === 0) val = "";

                    // GUARDAR
                    if (tCfg.newCol) {
                      newRow[`${col}_CLEAN`] = val;
                    } else {
                      newRow[col] = val;
                    }
                  });
                  return newRow;
                });
                break;

              // -------------------------------------------------------------
              // HERRAMIENTA 3: ESTRUCTURA (CONCAT, SPLIT, EXTRACT)
              // -------------------------------------------------------------
              case 'columns':
                const cCfg = toolSettings['columns'];
                if (!cCfg) break;
                currentData = currentData.map(row => {
                  let newRow = {
                    ...row
                  };

                  // 1. CONCATENACIÓN
                  if (cCfg.concats && cCfg.concats.length > 0) {
                    cCfg.concats.forEach(op => {
                      if (!op.targetName) return;
                      let finalString = "";
                      op.parts.forEach(part => {
                        if (part.type === 'col') finalString += String(newRow[part.value] || '');else finalString += String(part.value || '');
                      });
                      newRow[op.targetName] = finalString;
                    });
                  }

                  // 2. SEPARAR NOMBRES (NOMBRES ESTÉTICOS)
                  if (cCfg.nameSplits && cCfg.nameSplits.length > 0) {
                    cCfg.nameSplits.forEach(op => {
                      if (!op.col || !newRow[op.col]) return;
                      let rawName = String(newRow[op.col]).trim().replace(/\s+/g, ' ');
                      const parts = rawName.split(' ');
                      const applyCasing = txt => {
                        if (!txt) return '';
                        if (op.casing === 'upper') return txt.toUpperCase();
                        if (op.casing === 'lower') return txt.toLowerCase();
                        return txt.toLowerCase().replace(/(?:^|\s)\S/g, a => a.toUpperCase());
                      };
                      let n1 = '',
                        n2 = '',
                        n3 = '';

                      // LÓGICA DE ASIGNACIÓN
                      if (op.mode === '3col') {
                        if (parts.length === 1) {
                          n1 = parts[0];
                        } else if (parts.length === 2) {
                          n1 = parts[0];
                          n2 = parts[1];
                        } else {
                          n3 = parts.pop();
                          n2 = parts.pop();
                          n1 = parts.join(' ');
                        }

                        // --- NOMBRES CORTOS Y LIMPIOS ---
                        newRow[`NOM_CUT`] = applyCasing(n1);
                        newRow[`PAT_CUT`] = applyCasing(n2);
                        newRow[`MAT_CUT`] = applyCasing(n3);
                      } else {
                        if (parts.length === 1) {
                          n1 = parts[0];
                        } else if (parts.length === 2) {
                          n1 = parts[0];
                          n2 = parts[1];
                        } else {
                          const last2 = parts.splice(-2);
                          n2 = last2.join(' ');
                          n1 = parts.join(' ');
                        }

                        // --- NOMBRES CORTOS Y LIMPIOS ---
                        newRow[`NOM_CUT`] = applyCasing(n1);
                        newRow[`APE_CUT`] = applyCasing(n2);
                      }
                    });
                  }

                  // 3. EXTRACCIÓN
                  if (cCfg.extracts) {
                    cCfg.extracts.forEach(op => {
                      if (!op.col || !op.targetName) return;
                      const val = String(newRow[op.col] || '');
                      const match = val.match(/\d+/);
                      newRow[op.targetName] = match ? match[0] : '';
                    });
                  }

                  // 4. SUBSTRING
                  if (cCfg.substrings) {
                    cCfg.substrings.forEach(op => {
                      if (!op.col || !op.targetName) return;
                      const val = String(newRow[op.col] || '');
                      let res = "";
                      if (op.mode === 'left') res = val.substring(0, op.val1);else if (op.mode === 'right') res = val.substring(val.length - op.val1);else if (op.mode === 'mid') {
                        const start = Math.max(0, op.val1 - 1);
                        res = val.substring(start, start + op.val2);
                      }
                      newRow[op.targetName] = res;
                    });
                  }
                  return newRow;
                });
                break;

              // -------------------------------------------------------------
              // HERRAMIENTA 4: TELÉFONOS CHILE (9 DÍGITOS)
              // -------------------------------------------------------------
              case 'phones':
                const pCfg = toolSettings['phones'];
                if (!pCfg || !pCfg.mappings || pCfg.mappings.length === 0) break;

                // Lista de números basura comunes
                const JUNK_NUMBERS = new Set(['000000000', '111111111', '222222222', '333333333', '444444444', '555555555', '666666666', '777777777', '888888888', '999999999', '123456789', '987654321', '100000000', '200000000', '900000000']);
                currentData = currentData.map(row => {
                  let collectedPhones = [];

                  // 1. EXTRAER Y NORMALIZAR CADA SLOT
                  pCfg.mappings.forEach(map => {
                    if (!map.col1) return;

                    // Concatenar Col1 + Col2 (si existe)
                    let raw = String(row[map.col1] || '');
                    if (map.col2) raw += String(row[map.col2] || '');

                    // --- LIMPIEZA BASE ---
                    // Dejar solo números
                    let clean = raw.replace(/\D/g, '');

                    // Quitar prefijo 56 si existe y el largo da para quitarlo (evitar romper numeros que empiezan con 56 real)
                    if (clean.startsWith('56') && clean.length >= 10) {
                      clean = clean.substring(2);
                    }

                    // Quitar ceros a la izquierda
                    clean = clean.replace(/^0+/, '');

                    // --- LÓGICA 9 DÍGITOS ---
                    let finalPhone = null;
                    if (clean.length === 9) {
                      finalPhone = clean;
                    } else if (clean.length === 8) {
                      // Regla de corrección:
                      // Si empieza con 2 (Fijo Santiago antiguo), agregamos 2.
                      // Si empieza con otro, asumimos que falta el 9 de celular/región.
                      if (clean.startsWith('2')) finalPhone = '2' + clean;else finalPhone = '9' + clean;
                    } else if (clean.length > 9) {
                      // Tomar los 9 de la derecha
                      finalPhone = clean.slice(-9);
                    }
                    // Si es menor a 8, se considera basura/incompleto y se ignora (finalPhone null)

                    if (finalPhone) collectedPhones.push(finalPhone);
                  });

                  // 2. FILTROS DE FILA
                  // A. Borrar Basura
                  if (pCfg.removeJunk) {
                    collectedPhones = collectedPhones.filter(p => !JUNK_NUMBERS.has(p));
                  }

                  // B. Deduplicar
                  if (pCfg.dedupe) {
                    collectedPhones = [...new Set(collectedPhones)];
                  }

                  // 3. ORDENAMIENTO (Mobile First)
                  if (pCfg.mobileFirst) {
                    const mobiles = collectedPhones.filter(p => p.startsWith('9'));
                    const landlines = collectedPhones.filter(p => !p.startsWith('9'));
                    collectedPhones = [...mobiles, ...landlines];
                  }

                  // 4. ESCRITURA (SALIDA)
                  // Generamos columnas TEL_1, TEL_2... según lo encontrado.
                  // Los huecos se compactan automáticamente porque `collectedPhones` es un array denso.

                  const newRow = {
                    ...row
                  };

                  // Rellenar hasta el máximo configurado o encontrado
                  // Usamos el tamaño del mapping original para definir hasta qué TEL llegar, 
                  // o mínimo la cantidad encontrada.
                  const maxSlots = Math.max(pCfg.mappings.length, collectedPhones.length);
                  for (let i = 0; i < maxSlots; i++) {
                    const colName = `TEL_${i + 1}`;
                    if (collectedPhones[i]) {
                      // SALIDA NUMÉRICA (Number) para Excel
                      newRow[colName] = Number(collectedPhones[i]);
                    } else {
                      newRow[colName] = ""; // Vacío limpio
                    }
                  }
                  return newRow;
                });
                break;

              // -------------------------------------------------------------
              // HERRAMIENTA 5: FECHAS INTELIGENTES (FORMATO, EXTRAER, CALCULAR)
              // -------------------------------------------------------------
              case 'dates':
                const dCfg = toolSettings['dates'];
                if (!dCfg || !dCfg.rules || dCfg.rules.length === 0) break;

                // --- MOTORES DE INTELIGENCIA ---
                const smartDateParser = val => {
                  if (!val) return null;
                  // Excel Serial
                  if (typeof val === 'number' && val > 10000 && val < 60000) return new Date((val - 25569) * 86400 * 1000);
                  let str = String(val).trim();
                  if (!str) return null;

                  // Compactos
                  if (/^20\d{6}$/.test(str) || /^19\d{6}$/.test(str)) return new Date(`${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}T12:00:00`);

                  // Español Texto
                  const esMonths = {
                    enero: 0,
                    febrero: 1,
                    marzo: 2,
                    abril: 3,
                    mayo: 4,
                    junio: 5,
                    julio: 6,
                    agosto: 7,
                    septiembre: 8,
                    octubre: 9,
                    noviembre: 10,
                    diciembre: 11
                  };
                  const txtMatch = str.match(/(\d{1,2})\s+de\s+([a-zA-Z]+)(?:\s+del|\s+de)?\s+(\d{4})/i);
                  if (txtMatch) {
                    const mName = txtMatch[2].toLowerCase();
                    if (esMonths[mName] !== undefined) return new Date(parseInt(txtMatch[3]), esMonths[mName], parseInt(txtMatch[1]), 12);
                  }

                  // Separadores
                  let clean = str.replace(/[.-]/g, '/');
                  const p = clean.split('/');
                  if (p.length === 3) {
                    if (p[2].length === 4) return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]), 12);
                    if (p[0].length === 4) return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]), 12);
                  }
                  const native = new Date(str);
                  return isNaN(native.getTime()) ? null : native;
                };
                const getISOWeek = d => {
                  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
                  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
                  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
                  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
                };
                const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

                // --- PROCESAMIENTO SECUENCIAL ---
                currentData = currentData.map(row => {
                  let newRow = {
                    ...row
                  };
                  dCfg.rules.forEach(rule => {
                    const sourceVal = newRow[rule.col];
                    const dateObj = smartDateParser(sourceVal);
                    let result = '';
                    if (dateObj) {
                      const d = dateObj.getDate();
                      const m = dateObj.getMonth();
                      const y = dateObj.getFullYear();

                      // A. FORMATEAR
                      if (rule.action === 'format') {
                        const p = rule.params.pattern;
                        const dd = String(d).padStart(2, '0');
                        const mm = String(m + 1).padStart(2, '0');
                        if (p === 'DD/MM/YYYY') result = `${dd}/${mm}/${y}`;else if (p === 'DD-MM-YYYY') result = `${dd}-${mm}-${y}`;else if (p === 'YYYY-MM-DD') result = `${y}-${mm}-${dd}`;else if (p === 'YYYYMMDD') result = `${y}${mm}${dd}`;else if (p.includes('TEXT')) {
                          const mName = new Intl.DateTimeFormat('es-CL', {
                            month: 'long'
                          }).format(dateObj);
                          if (p === 'TEXT_FULL') result = `${dd} de ${cap(mName)} del ${y}`;else result = `${dd} ${cap(mName).slice(0, 3)} ${y}`;
                        }
                      }
                      // B. EXTRAER
                      else if (rule.action === 'extract') {
                        const type = rule.params.extract;
                        const dName = new Intl.DateTimeFormat('es-CL', {
                          weekday: 'long'
                        }).format(dateObj);
                        const mName = new Intl.DateTimeFormat('es-CL', {
                          month: 'long'
                        }).format(dateObj);
                        if (type === 'm_full_y_short_upper') result = `${mName.toUpperCase()}_${String(y).slice(-2)}`; // ENERO_26
                        else if (type === 'day_num') result = d;else if (type === 'day_name_full') result = cap(dName);else if (type === 'day_name_short') result = cap(dName).slice(0, 3);else if (type === 'day_week_iso') result = dateObj.getDay() || 7;else if (type === 'month_num') result = m + 1;else if (type === 'month_name_full') result = cap(mName);else if (type === 'month_name_short') result = cap(mName).slice(0, 3);else if (type === 'year_full') result = y;else if (type === 'week_num') result = getISOWeek(dateObj);else if (type === 'quarter') result = 'Q' + Math.ceil((m + 1) / 3);else if (type === 'm_y_short') result = `${cap(mName).slice(0, 3)}-${String(y).slice(-2)}`;else if (type === 'm_y_full') result = `${cap(mName)} ${y}`;else if (type === 'yyyymm') result = `${y}${String(m + 1).padStart(2, '0')}`;
                      }
                      // C. CALCULAR
                      else if (rule.action === 'calc') {
                        const now = new Date();
                        if (rule.params.calc === 'age') {
                          result = now.getFullYear() - y;
                          if (now.getMonth() < m || now.getMonth() === m && now.getDate() < d) result--;
                        } else if (rule.params.calc === 'days_diff') {
                          result = Math.floor((now - dateObj) / 86400000);
                        } else if (rule.params.calc === 'antiquity_months') {
                          result = (now.getFullYear() - y) * 12 + (now.getMonth() - m);
                          if (result < 0) result = 0;
                        }
                      }
                    }
                    if (rule.outputMode === 'new') {
                      let suffix = '_NEW';
                      if (rule.action === 'extract') suffix = `_${rule.params.extract.split('_')[0].toUpperCase()}`;
                      if (rule.action === 'calc') suffix = `_${rule.params.calc.toUpperCase()}`;
                      if (rule.action === 'format') suffix = '_FMT';
                      newRow[`${rule.col}${suffix}`] = result;
                    } else {
                      newRow[rule.col] = result;
                    }
                  });
                  return newRow;
                });
                break;

              // -------------------------------------------------------------
              // HERRAMIENTA 6: ENRIQUECER (CRUCE, ETIQUETAS, RANGOS)
              // -------------------------------------------------------------
              case 'enrich':
                const eCfg = toolSettings['enrich'];
                if (!eCfg) break;

                // A. CRUCE (VLOOKUP)
                if (eCfg.vlookup && eCfg.vlookup.dataB && eCfg.vlookup.dataB.length > 0 && eCfg.vlookup.keyA && eCfg.vlookup.keyB) {
                  const {
                    dataB,
                    keyA,
                    keyB,
                    action,
                    selectedCols
                  } = eCfg.vlookup;
                  const lookupMap = new Map();
                  dataB.forEach(row => {
                    const k = String(row[keyB] || '').trim().toUpperCase();
                    if (k) lookupMap.set(k, row);
                  });
                  currentData = currentData.map(row => {
                    const rowKey = String(row[keyA] || '').trim().toUpperCase();
                    const match = lookupMap.get(rowKey);
                    const newRow = {
                      ...row
                    };
                    newRow['CRUCE_ESTATUS'] = match ? 'CRUZADO' : 'SIN_COINCIDENCIA';
                    if (match && selectedCols) {
                      selectedCols.forEach(col => {
                        const val = match[col];
                        if (action === 'add_cols') newRow[`${col}_B`] = val;else newRow[col] = val;
                      });
                    } else if (action === 'add_cols' && selectedCols) {
                      selectedCols.forEach(col => newRow[`${col}_B`] = '');
                    }
                    return newRow;
                  });
                }

                // B. CLASIFICACIÓN INTELIGENTE (RANGOS)
                if (eCfg.rules && eCfg.rules.length > 0) {
                  // Helper Fecha
                  const parseVal = (val, isDate) => {
                    if (!val) return null;
                    if (isDate) {
                      if (typeof val === 'number' && val > 10000) return new Date((val - 25569) * 86400 * 1000).getTime();
                      const s = String(val).trim();
                      // 20230101
                      if (/^20\d{6}$/.test(s)) return new Date(s.substring(0, 4), parseInt(s.substring(4, 6)) - 1, s.substring(6, 8)).getTime();
                      // DD/MM/YYYY
                      if (s.includes('/') || s.includes('-')) {
                        const p = s.replace(/-/g, '/').split('/');
                        if (p.length === 3) {
                          if (p[2].length === 4) return new Date(p[2], p[1] - 1, p[0]).getTime();
                          if (p[0].length === 4) return new Date(p[0], p[1] - 1, p[2]).getTime();
                        }
                      }
                      const d = new Date(s);
                      return isNaN(d.getTime()) ? null : d.getTime();
                    } else {
                      const v = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
                      return isNaN(v) ? null : v;
                    }
                  };

                  // 1. PRE-ESCANEO: Obtener Min/Max REALES de cada columna usada
                  const colStats = {};
                  eCfg.rules.filter(r => r.type.includes('range')).forEach(r => {
                    let min = Infinity,
                      max = -Infinity;
                    let hasData = false;
                    currentData.forEach(d => {
                      const v = parseVal(d[r.col], r.isDate);
                      if (v !== null) {
                        if (v < min) min = v;
                        if (v > max) max = v;
                        hasData = true;
                      }
                    });
                    if (hasData) colStats[r.id] = {
                      min,
                      max
                    };
                  });

                  // 2. APLICAR REGLAS
                  currentData = currentData.map(row => {
                    const newRow = {
                      ...row
                    };
                    eCfg.rules.forEach(r => {
                      const raw = String(newRow[r.col] || '');
                      let res = '';
                      if (r.type === 'tags') {
                        res = r.mapping && r.mapping[raw] ? r.mapping[raw] : raw;
                      } else {
                        const val = parseVal(raw, r.isDate);
                        if (val === null) {
                          res = 'N/A';
                        } else {
                          // RANGOS
                          const stats = colStats[r.id];
                          // Si no hay stats (columna vacía), saltar
                          if (!stats) {
                            res = 'Error Datos';
                          }
                          // A. RANGO ANCHO FIJO (Dinámico desde Min)
                          else if (r.type === 'range_width') {
                            let w = parseFloat(r.param1);
                            // Si es fecha, param1 son DÍAS -> convertir a ms
                            if (r.isDate) w = (w || 30) * 86400000;else w = w || 1000;

                            // Desplazamiento desde el Mínimo real
                            const offset = val - stats.min;
                            const bucketIdx = Math.floor(offset / w);
                            const start = stats.min + bucketIdx * w;
                            const end = start + w;
                            if (r.isDate) res = `[${new Date(start).toLocaleDateString()} - ${new Date(end).toLocaleDateString()})`;else res = `[${start} - ${end})`;
                          }
                          // B. RANGO CANTIDAD (Dinámico Min-Max)
                          else if (r.type === 'range_count') {
                            const c = parseInt(r.param1) || 10;
                            if (stats.max > stats.min) {
                              const totalWidth = stats.max - stats.min;
                              const w = totalWidth / c;
                              // Evitar overflow en el valor máximo exacto
                              const b = Math.min(Math.floor((val - stats.min) / w), c - 1);
                              if (r.isDate) {
                                const sTs = stats.min + b * w;
                                const eTs = stats.min + (b + 1) * w;
                                res = `[${new Date(sTs).toLocaleDateString()} - ${new Date(eTs).toLocaleDateString()})`;
                              } else {
                                res = `Tramo ${b + 1}`;
                              }
                            } else res = 'Único';
                          }
                          // C. RANGO MANUAL (Cortes definidos)
                          else if (r.type === 'range_manual') {
                            const cuts = r.param1.split(',').map(s => parseVal(s.trim(), r.isDate)).filter(n => n !== null).sort((a, b) => a - b);
                            if (cuts.length === 0) res = 'Error Cortes';else if (val < cuts[0]) res = `< ${r.isDate ? new Date(cuts[0]).toLocaleDateString() : cuts[0]}`;else if (val >= cuts[cuts.length - 1]) res = `>= ${r.isDate ? new Date(cuts[cuts.length - 1]).toLocaleDateString() : cuts[cuts.length - 1]}`;else {
                              for (let k = 0; k < cuts.length - 1; k++) {
                                if (val >= cuts[k] && val < cuts[k + 1]) {
                                  const v1 = r.isDate ? new Date(cuts[k]).toLocaleDateString() : cuts[k];
                                  const v2 = r.isDate ? new Date(cuts[k + 1]).toLocaleDateString() : cuts[k + 1];
                                  res = `[${v1} - ${v2})`;
                                  break;
                                }
                              }
                            }
                          }
                        }
                      }
                      const suffix = r.type === 'tags' ? '_TAG' : '_RANGO';
                      if (r.newCol) newRow[`${r.col}${suffix}`] = res;else newRow[r.col] = res;
                    });
                    return newRow;
                  });
                }
                break;

              // HERRAMIENTA 7: RANKING Y CONTEOS (VERSIÓN INDEPENDIENTE)
              case 'ranking':
                const rCfg = toolSettings['ranking'];
                if (!rCfg) break;

                // --- 1. PREPARACIÓN (Mapas y Conteos) ---

                // 1.1 Datos de Ranking Nexus (Opción 1)
                let rankMap = new Map();
                if (rCfg.opt1_active && rCfg.opt1_campaign && rCfg.opt1_statusCol) {
                  try {
                    // Accedemos a la DB global inyectada en el contexto
                    const allTyps = await db.getAll('typifications');
                    const campaignTyps = allTyps.filter(t => t.campaign === rCfg.opt1_campaign);
                    campaignTyps.forEach(t => rankMap.set(t.status.toUpperCase().trim(), parseInt(t.ranking) || 999));
                  } catch (e) {
                    console.error("Error Nexus DB", e);
                  }
                }

                // 1.2 Conteos Totales (Opción 3) - Pre-cálculo
                const totalCounts = {};
                if (rCfg.opt3_active && rCfg.opt3_col) {
                  currentData.forEach(row => {
                    const val = String(row[rCfg.opt3_col] || '').trim();
                    totalCounts[val] = (totalCounts[val] || 0) + 1;
                  });
                }

                // 1.3 Inicializar Conteo Secuencial (Opción 2)
                const runningCounts = {};

                // --- 2. PROCESAMIENTO FILA A FILA ---
                currentData = currentData.map(row => {
                  let newRow = {
                    ...row
                  };

                  // >> OPCIÓN 1: Ranking Nexus (Asignar valor numérico)
                  if (rCfg.opt1_active && rCfg.opt1_statusCol) {
                    const status = String(row[rCfg.opt1_statusCol] || '').toUpperCase().trim();
                    const rank = rankMap.has(status) ? rankMap.get(status) : 999;
                    newRow['NEXUS_RANK'] = rank;
                  }

                  // >> OPCIÓN 2: Conteo Secuencial (1..N)
                  if (rCfg.opt2_active && rCfg.opt2_col) {
                    const val = String(row[rCfg.opt2_col] || '').trim();
                    runningCounts[val] = (runningCounts[val] || 0) + 1;
                    newRow['CONTEO_SEQ'] = runningCounts[val];
                  }

                  // >> OPCIÓN 3: Frecuencia Total (N..N)
                  if (rCfg.opt3_active && rCfg.opt3_col) {
                    const val = String(row[rCfg.opt3_col] || '').trim();
                    newRow['CONTEO_TOTAL'] = totalCounts[val] || 0;
                  }
                  return newRow;
                });

                // --- 3. ORDENAMIENTO (Solo si Opción 1 lo solicita) ---
                if (rCfg.opt1_active && rCfg.opt1_applySort) {
                  currentData.sort((a, b) => {
                    // Criterio A: Ranking (Ascendente = 1 es mejor)
                    const rankA = a['NEXUS_RANK'] || 999;
                    const rankB = b['NEXUS_RANK'] || 999;
                    if (rankA !== rankB) {
                      return rCfg.opt1_order === 'asc' ? rankA - rankB : rankB - rankA;
                    }

                    // Criterio B: Desempate
                    if (rCfg.opt1_tieBreaker === 'random') return 0.5 - Math.random();
                    if ((rCfg.opt1_tieBreaker === 'recent' || rCfg.opt1_tieBreaker === 'oldest') && rCfg.opt1_dateCol) {
                      const dateA = new Date(a[rCfg.opt1_dateCol]);
                      const dateB = new Date(b[rCfg.opt1_dateCol]);
                      const vA = isNaN(dateA.getTime()) ? 0 : dateA.getTime();
                      const vB = isNaN(dateB.getTime()) ? 0 : dateB.getTime();
                      if (rCfg.opt1_tieBreaker === 'recent') return vB - vA; // Más reciente arriba
                      if (rCfg.opt1_tieBreaker === 'oldest') return vA - vB; // Más antiguo arriba
                    }
                    return 0;
                  });
                }
                break;
            }
          }
        }
        setMasterData(currentData);
        setStep(4);
        addToast("Pipeline completado", "success");
      } catch (error) {
        console.error(error);
        addToast(`Error: ${error.message}`, 'error');
      } finally {
        setLoading(false);
      }
    };

    // =================================================================================================
    // [BLOQUE 3] VISTAS INDIVIDUALES (INTERFAZ)
    // =================================================================================================

    // ----------------------------------------------------------------------
    // VISTA: HERRAMIENTA 1 (RUT) - DISEÑO MODERNO INTEGRADO
    // ----------------------------------------------------------------------

    const renderRutUI = () => {
      const settings = toolSettings['rut'] || {
        col: '',
        action: 'format',
        style: 'hyphen',
        newCol: true
      };
      const update = (f, v) => setToolSettings(p => ({
        ...p,
        rut: {
          ...settings,
          [f]: v
        }
      }));
      return /*#__PURE__*/React.createElement("div", {
        className: "tool-ui-container"
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          marginBottom: '1.2rem'
        }
      }, /*#__PURE__*/React.createElement("label", {
        className: "section-label"
      }, "1. Columna Objetivo"), /*#__PURE__*/React.createElement("select", {
        className: "integrated-select",
        value: settings.col,
        onChange: e => update('col', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "-- Seleccionar Columna --"), columns.map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c)))), /*#__PURE__*/React.createElement("div", {
        style: {
          marginBottom: '1.2rem'
        }
      }, /*#__PURE__*/React.createElement("label", {
        className: "section-label"
      }, "2. Acci\xF3n"), /*#__PURE__*/React.createElement("div", {
        className: "radio-group"
      }, /*#__PURE__*/React.createElement("div", {
        className: `radio-card ${settings.action === 'format' ? 'selected' : ''}`,
        onClick: () => update('action', 'format')
      }, /*#__PURE__*/React.createElement("div", {
        className: "radio-title"
      }, "\uD83E\uDDF9 Limpiar"), /*#__PURE__*/React.createElement("div", {
        className: "radio-desc"
      }, "Ya tiene DV")), /*#__PURE__*/React.createElement("div", {
        className: `radio-card ${settings.action === 'calc' ? 'selected' : ''}`,
        onClick: () => update('action', 'calc')
      }, /*#__PURE__*/React.createElement("div", {
        className: "radio-title"
      }, "\uD83E\uDDEE Calcular"), /*#__PURE__*/React.createElement("div", {
        className: "radio-desc"
      }, "Falta el DV")))), /*#__PURE__*/React.createElement("div", {
        style: {
          marginBottom: '1.2rem'
        }
      }, /*#__PURE__*/React.createElement("label", {
        className: "section-label"
      }, "3. Formato Salida"), /*#__PURE__*/React.createElement("select", {
        className: "integrated-select",
        value: settings.style,
        onChange: e => update('style', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: "hyphen"
      }, "12345678-K (Guion)"), /*#__PURE__*/React.createElement("option", {
        value: "dots"
      }, "12.345.678-K (Puntos)"), /*#__PURE__*/React.createElement("option", {
        value: "simple"
      }, "12345678K (Pegado)"), /*#__PURE__*/React.createElement("option", {
        value: "split"
      }, "Separar (RUT | DV)"), /*#__PURE__*/React.createElement("option", {
        value: "dv_only"
      }, "Solo DV (Columna Extra)"))), /*#__PURE__*/React.createElement("div", {
        className: "toggle-row"
      }, /*#__PURE__*/React.createElement("span", {
        className: "toggle-label"
      }, settings.style === 'dv_only' ? 'Mantener RUT original limpio' : 'Generar Columna Nueva'), /*#__PURE__*/React.createElement("label", {
        className: "switch"
      }, /*#__PURE__*/React.createElement("input", {
        type: "checkbox",
        checked: settings.newCol,
        onChange: e => update('newCol', e.target.checked)
      }), /*#__PURE__*/React.createElement("span", {
        className: "slider"
      }))));
    };

    // ----------------------------------------------------------------------
    // VISTA: HERRAMIENTA 2 (TEXTO)
    // ----------------------------------------------------------------------
    const renderTextUI = () => {
      const settings = toolSettings['text'] || {
        scope: 'specific',
        targetCols: [],
        casing: 'none',
        accents: false,
        n_tilde: false,
        symbols: false,
        spaceMode: 'normalize',
        newCol: false
      };
      const update = (f, v) => setToolSettings(p => ({
        ...p,
        text: {
          ...settings,
          [f]: v
        }
      }));
      const toggleCol = col => {
        const current = settings.targetCols || [];
        const newCols = current.includes(col) ? current.filter(c => c !== col) : [...current, col];
        update('targetCols', newCols);
      };
      return /*#__PURE__*/React.createElement("div", {
        className: "tool-ui-container"
      }, /*#__PURE__*/React.createElement("h4", {
        style: {
          marginTop: 0,
          color: 'var(--text-main)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '1rem'
        }
      }, /*#__PURE__*/React.createElement(Icon, {
        name: "type"
      }), " Configuraci\xF3n de Texto"), /*#__PURE__*/React.createElement("div", {
        style: {
          marginBottom: '1.2rem',
          borderBottom: '1px solid #eee',
          paddingBottom: '1rem'
        }
      }, /*#__PURE__*/React.createElement("label", {
        className: "section-label"
      }, "1. Alcance"), /*#__PURE__*/React.createElement("div", {
        className: "radio-group"
      }, /*#__PURE__*/React.createElement("div", {
        className: `radio-card ${settings.scope === 'specific' ? 'selected' : ''}`,
        onClick: () => update('scope', 'specific')
      }, /*#__PURE__*/React.createElement("div", {
        className: "radio-title"
      }, "Columnas")), /*#__PURE__*/React.createElement("div", {
        className: `radio-card ${settings.scope === 'all' ? 'selected' : ''}`,
        onClick: () => update('scope', 'all')
      }, /*#__PURE__*/React.createElement("div", {
        className: "radio-title"
      }, "Todo el Archivo"))), settings.scope === 'specific' && /*#__PURE__*/React.createElement("div", {
        style: {
          maxHeight: '120px',
          overflowY: 'auto',
          background: '#F9FAFB',
          border: '1px solid #E5E7EB',
          borderRadius: '8px',
          padding: '0.5rem'
        }
      }, columns.map(c => /*#__PURE__*/React.createElement("label", {
        key: c,
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.2rem',
          cursor: 'pointer',
          fontSize: '0.85rem'
        }
      }, /*#__PURE__*/React.createElement("input", {
        type: "checkbox",
        checked: settings.targetCols.includes(c),
        onChange: () => toggleCol(c)
      }), c)), settings.targetCols.length === 0 && /*#__PURE__*/React.createElement("div", {
        style: {
          color: '#EF4444',
          fontSize: '0.75rem'
        }
      }, "* Marca al menos una"))), /*#__PURE__*/React.createElement("div", {
        style: {
          marginBottom: '1.2rem'
        }
      }, /*#__PURE__*/React.createElement("label", {
        className: "section-label"
      }, "2. Espacios"), /*#__PURE__*/React.createElement("div", {
        className: "radio-group"
      }, /*#__PURE__*/React.createElement("div", {
        className: `radio-card ${settings.spaceMode === 'keep' ? 'selected' : ''}`,
        onClick: () => update('spaceMode', 'keep')
      }, /*#__PURE__*/React.createElement("div", {
        className: "radio-title"
      }, "Original"), /*#__PURE__*/React.createElement("div", {
        className: "radio-desc"
      }, "Intacto")), /*#__PURE__*/React.createElement("div", {
        className: `radio-card ${settings.spaceMode === 'normalize' ? 'selected' : ''}`,
        onClick: () => update('spaceMode', 'normalize')
      }, /*#__PURE__*/React.createElement("div", {
        className: "radio-title"
      }, "Normalizar"), /*#__PURE__*/React.createElement("div", {
        className: "radio-desc"
      }, "Trim+Compact")), /*#__PURE__*/React.createElement("div", {
        className: `radio-card ${settings.spaceMode === 'remove_all' ? 'selected' : ''}`,
        onClick: () => update('spaceMode', 'remove_all')
      }, /*#__PURE__*/React.createElement("div", {
        className: "radio-title"
      }, "Sin Espacios"), /*#__PURE__*/React.createElement("div", {
        className: "radio-desc"
      }, "Borrar todo")))), /*#__PURE__*/React.createElement("div", {
        style: {
          marginBottom: '1.2rem'
        }
      }, /*#__PURE__*/React.createElement("label", {
        className: "section-label"
      }, "3. Reglas"), /*#__PURE__*/React.createElement("select", {
        className: "integrated-select",
        value: settings.casing,
        onChange: e => update('casing', e.target.value),
        style: {
          marginBottom: '0.8rem'
        }
      }, /*#__PURE__*/React.createElement("option", {
        value: "none"
      }, "\uD83D\uDD20 MANTENER FORMATO"), /*#__PURE__*/React.createElement("option", {
        value: "upper"
      }, "\uD83D\uDD20 TODO MAY\xDASCULAS"), /*#__PURE__*/React.createElement("option", {
        value: "lower"
      }, "\uD83D\uDD21 todo min\xFAsculas"), /*#__PURE__*/React.createElement("option", {
        value: "capital"
      }, "\uD83D\uDD20 Nombre Propio")), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'grid',
          gap: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement("div", {
        className: "toggle-row",
        style: {
          padding: '0.4rem 0.8rem'
        }
      }, /*#__PURE__*/React.createElement("span", {
        className: "toggle-label",
        style: {
          fontWeight: 'normal',
          fontSize: '0.8rem'
        }
      }, "Quitar Acentos (\xE1, \xE0, \xE4 \u2192 a)"), /*#__PURE__*/React.createElement("label", {
        className: "switch",
        style: {
          transform: 'scale(0.8)'
        }
      }, /*#__PURE__*/React.createElement("input", {
        type: "checkbox",
        checked: settings.accents,
        onChange: e => update('accents', e.target.checked)
      }), /*#__PURE__*/React.createElement("span", {
        className: "slider"
      }))), /*#__PURE__*/React.createElement("div", {
        className: "toggle-row",
        style: {
          padding: '0.4rem 0.8rem'
        }
      }, /*#__PURE__*/React.createElement("span", {
        className: "toggle-label",
        style: {
          fontWeight: 'normal',
          fontSize: '0.8rem'
        }
      }, "Normalizar \xD1 (\xF1 \u2192 n)"), /*#__PURE__*/React.createElement("label", {
        className: "switch",
        style: {
          transform: 'scale(0.8)'
        }
      }, /*#__PURE__*/React.createElement("input", {
        type: "checkbox",
        checked: settings.n_tilde,
        onChange: e => update('n_tilde', e.target.checked)
      }), /*#__PURE__*/React.createElement("span", {
        className: "slider"
      }))), /*#__PURE__*/React.createElement("div", {
        className: "toggle-row",
        style: {
          padding: '0.4rem 0.8rem'
        }
      }, /*#__PURE__*/React.createElement("span", {
        className: "toggle-label",
        style: {
          fontWeight: 'normal',
          fontSize: '0.8rem'
        }
      }, "Borrar S\xEDmbolos (%, *, ?, `)"), /*#__PURE__*/React.createElement("label", {
        className: "switch",
        style: {
          transform: 'scale(0.8)'
        }
      }, /*#__PURE__*/React.createElement("input", {
        type: "checkbox",
        checked: settings.symbols,
        onChange: e => update('symbols', e.target.checked)
      }), /*#__PURE__*/React.createElement("span", {
        className: "slider"
      }))))), /*#__PURE__*/React.createElement("div", {
        className: "toggle-row",
        style: {
          background: '#FEF2F2',
          borderColor: '#FECACA'
        }
      }, /*#__PURE__*/React.createElement("span", {
        className: "toggle-label",
        style: {
          color: '#991B1B'
        }
      }, "Generar Columna Nueva"), /*#__PURE__*/React.createElement("label", {
        className: "switch"
      }, /*#__PURE__*/React.createElement("input", {
        type: "checkbox",
        checked: settings.newCol,
        onChange: e => update('newCol', e.target.checked)
      }), /*#__PURE__*/React.createElement("span", {
        className: "slider"
      }))));
    };

    // ----------------------------------------------------------------------
    // VISTA: HERRAMIENTA 3 (ESTRUCTURA) - MEJORADA
    // ----------------------------------------------------------------------
    const renderColumnsUI = () => {
      const settings = toolSettings['columns'] || {
        activeTab: 'concat',
        concats: [],
        nameSplits: [],
        // { col, casing, mode: '2col'|'3col' }
        extracts: [],
        substrings: []
      };
      const update = (f, v) => setToolSettings(p => ({
        ...p,
        columns: {
          ...settings,
          [f]: v
        }
      }));

      // FUNCIONES DE AGREGAR
      const addConcatStep = () => update('concats', [...settings.concats, {
        id: Date.now(),
        targetName: 'NUEVA_COL',
        parts: [{
          type: 'col',
          value: columns[0] || ''
        }]
      }]);
      const updateConcatPart = (i, pI, f, v) => {
        const n = [...settings.concats];
        n[i].parts[pI][f] = v;
        update('concats', n);
      };
      const addPart = i => {
        const n = [...settings.concats];
        n[i].parts.push({
          type: 'sep',
          value: ' '
        });
        n[i].parts.push({
          type: 'col',
          value: columns[0] || ''
        });
        update('concats', n);
      };

      // AHORA SOPORTA MODO
      const addNameSplit = () => update('nameSplits', [...settings.nameSplits, {
        col: '',
        casing: 'capital',
        mode: '2col'
      }]);
      const addExtract = () => update('extracts', [...settings.extracts, {
        col: '',
        targetName: 'NUMERO'
      }]);
      const addSubstring = () => update('substrings', [...settings.substrings, {
        col: '',
        mode: 'left',
        val1: 1,
        val2: 0,
        targetName: 'RECORTADO'
      }]);
      return /*#__PURE__*/React.createElement("div", {
        className: "tool-ui-container"
      }, /*#__PURE__*/React.createElement("h4", {
        style: {
          marginTop: 0,
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement(Icon, {
        name: "columns"
      }), " Manipulaci\xF3n de Estructura"), /*#__PURE__*/React.createElement("div", {
        className: "tabs-header"
      }, /*#__PURE__*/React.createElement("button", {
        className: `tab-btn ${settings.activeTab === 'concat' ? 'active' : ''}`,
        onClick: () => update('activeTab', 'concat')
      }, "\uD83D\uDD17 Unir"), /*#__PURE__*/React.createElement("button", {
        className: `tab-btn ${settings.activeTab === 'names' ? 'active' : ''}`,
        onClick: () => update('activeTab', 'names')
      }, "\u2702\uFE0F Nombres"), /*#__PURE__*/React.createElement("button", {
        className: `tab-btn ${settings.activeTab === 'extract' ? 'active' : ''}`,
        onClick: () => update('activeTab', 'extract')
      }, "\uD83D\uDD22 Extraer #"), /*#__PURE__*/React.createElement("button", {
        className: `tab-btn ${settings.activeTab === 'sub' ? 'active' : ''}`,
        onClick: () => update('activeTab', 'sub')
      }, "\uD83D\uDCCF Recortar")), settings.activeTab === 'concat' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '0.8rem',
          color: '#666',
          marginBottom: '1rem'
        }
      }, "Unir columnas con separadores."), settings.concats.map((item, i) => /*#__PURE__*/React.createElement("div", {
        key: item.id,
        className: "concat-builder",
        style: {
          marginBottom: '1rem'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement("input", {
        className: "input-sm",
        style: {
          fontWeight: 'bold'
        },
        placeholder: "Nombre Columna Final",
        value: item.targetName,
        onChange: e => {
          const n = [...settings.concats];
          n[i].targetName = e.target.value;
          update('concats', n);
        }
      }), /*#__PURE__*/React.createElement("button", {
        className: "icon-btn",
        onClick: () => {
          const n = settings.concats.filter((_, x) => x !== i);
          update('concats', n);
        }
      }, "\uD83D\uDDD1\uFE0F")), item.parts.map((part, pI) => /*#__PURE__*/React.createElement("div", {
        key: pI,
        className: "builder-row"
      }, /*#__PURE__*/React.createElement("span", {
        className: "step-badge"
      }, pI + 1), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        style: {
          width: '85px'
        },
        value: part.type,
        onChange: e => updateConcatPart(i, pI, 'type', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: "col"
      }, "Columna"), /*#__PURE__*/React.createElement("option", {
        value: "sep"
      }, "Separador"), /*#__PURE__*/React.createElement("option", {
        value: "text"
      }, "Texto")), part.type === 'col' && /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: part.value,
        onChange: e => updateConcatPart(i, pI, 'value', e.target.value)
      }, columns.map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c))), part.type === 'sep' && /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: part.value,
        onChange: e => updateConcatPart(i, pI, 'value', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: " "
      }, "Espacio"), /*#__PURE__*/React.createElement("option", {
        value: "-"
      }, "Guion (-)"), /*#__PURE__*/React.createElement("option", {
        value: "_"
      }, "Bajo (_)"), /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "Nada"), /*#__PURE__*/React.createElement("option", {
        value: "/"
      }, "Slash (/)")), part.type === 'text' && /*#__PURE__*/React.createElement("input", {
        className: "input-sm",
        placeholder: "Texto...",
        value: part.value,
        onChange: e => updateConcatPart(i, pI, 'value', e.target.value)
      }), item.parts.length > 1 && /*#__PURE__*/React.createElement("span", {
        className: "icon-btn",
        onClick: () => {
          const n = [...settings.concats];
          n[i].parts = n[i].parts.filter((_, x) => x !== pI);
          update('concats', n);
        }
      }, "x"))), /*#__PURE__*/React.createElement("button", {
        className: "btn btn-outline",
        style: {
          width: '100%',
          marginTop: '0.5rem',
          fontSize: '0.75rem'
        },
        onClick: () => addPart(i)
      }, "+ Pieza"))), /*#__PURE__*/React.createElement("button", {
        className: "btn btn-primary",
        style: {
          width: '100%'
        },
        onClick: addConcatStep
      }, "+ Nueva Uni\xF3n")), settings.activeTab === 'names' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '0.8rem',
          color: '#666',
          marginBottom: '1rem'
        }
      }, "Separa Nombres y Apellidos inteligentemente."), settings.nameSplits.map((item, i) => /*#__PURE__*/React.createElement("div", {
        key: i,
        className: "concat-builder",
        style: {
          marginBottom: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          marginBottom: '0.5rem',
          fontWeight: 'bold',
          fontSize: '0.75rem',
          color: 'var(--primary)'
        }
      }, "Regla #", i + 1), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'grid',
          gap: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: item.col,
        onChange: e => {
          const n = [...settings.nameSplits];
          n[i].col = e.target.value;
          update('nameSplits', n);
        }
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "-- Columna Origen --"), columns.map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c))), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: item.mode || '2col',
        onChange: e => {
          const n = [...settings.nameSplits];
          n[i].mode = e.target.value;
          update('nameSplits', n);
        }
      }, /*#__PURE__*/React.createElement("option", {
        value: "2col"
      }, "2 Cols: Nombres | Apellidos"), /*#__PURE__*/React.createElement("option", {
        value: "3col"
      }, "3 Cols: Nombres | Pat | Mat")), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: item.casing,
        onChange: e => {
          const n = [...settings.nameSplits];
          n[i].casing = e.target.value;
          update('nameSplits', n);
        }
      }, /*#__PURE__*/React.createElement("option", {
        value: "capital"
      }, "Propio (Juan)"), /*#__PURE__*/React.createElement("option", {
        value: "upper"
      }, "MAY\xDAS (JUAN)"), /*#__PURE__*/React.createElement("option", {
        value: "lower"
      }, "min\xFAs (juan)")))), /*#__PURE__*/React.createElement("div", {
        style: {
          marginTop: '0.5rem',
          textAlign: 'right'
        }
      }, /*#__PURE__*/React.createElement("button", {
        className: "icon-btn",
        style: {
          color: '#EF4444',
          border: '1px solid #FECACA',
          padding: '2px 8px'
        },
        onClick: () => {
          const n = settings.nameSplits.filter((_, x) => x !== i);
          update('nameSplits', n);
        }
      }, "Eliminar Regla")))), /*#__PURE__*/React.createElement("button", {
        className: "btn btn-primary",
        style: {
          width: '100%'
        },
        onClick: addNameSplit
      }, "+ Separar Columna")), settings.activeTab === 'extract' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '0.8rem',
          color: '#666',
          marginBottom: '1rem'
        }
      }, "Busca y extrae la primera secuencia num\xE9rica."), settings.extracts.map((item, i) => /*#__PURE__*/React.createElement("div", {
        key: i,
        className: "concat-builder",
        style: {
          marginBottom: '0.5rem',
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center'
        }
      }, /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        style: {
          flex: 1
        },
        value: item.col,
        onChange: e => {
          const n = [...settings.extracts];
          n[i].col = e.target.value;
          update('extracts', n);
        }
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "Columna"), columns.map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c))), /*#__PURE__*/React.createElement("span", null, "\u2794"), /*#__PURE__*/React.createElement("input", {
        className: "input-sm",
        style: {
          flex: 1
        },
        placeholder: "Nombre Destino",
        value: item.targetName,
        onChange: e => {
          const n = [...settings.extracts];
          n[i].targetName = e.target.value;
          update('extracts', n);
        }
      }), /*#__PURE__*/React.createElement("button", {
        className: "icon-btn",
        onClick: () => {
          const n = settings.extracts.filter((_, x) => x !== i);
          update('extracts', n);
        }
      }, "\uD83D\uDDD1\uFE0F"))), /*#__PURE__*/React.createElement("button", {
        className: "btn btn-primary",
        style: {
          width: '100%'
        },
        onClick: addExtract
      }, "+ Extracci\xF3n")), settings.activeTab === 'sub' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '0.8rem',
          color: '#666',
          marginBottom: '1rem'
        }
      }, "Recortes por posici\xF3n de caracteres."), settings.substrings.map((item, i) => /*#__PURE__*/React.createElement("div", {
        key: i,
        className: "concat-builder",
        style: {
          marginBottom: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: item.col,
        onChange: e => {
          const n = [...settings.substrings];
          n[i].col = e.target.value;
          update('substrings', n);
        }
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "Columna"), columns.map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c))), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: item.mode,
        onChange: e => {
          const n = [...settings.substrings];
          n[i].mode = e.target.value;
          update('substrings', n);
        }
      }, /*#__PURE__*/React.createElement("option", {
        value: "left"
      }, "Izquierda"), /*#__PURE__*/React.createElement("option", {
        value: "right"
      }, "Derecha"), /*#__PURE__*/React.createElement("option", {
        value: "mid"
      }, "Centro"))), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center'
        }
      }, /*#__PURE__*/React.createElement("input", {
        type: "number",
        className: "input-sm",
        style: {
          width: '50px'
        },
        placeholder: "#",
        value: item.val1,
        onChange: e => {
          const n = [...settings.substrings];
          n[i].val1 = parseInt(e.target.value);
          update('substrings', n);
        }
      }), item.mode === 'mid' && /*#__PURE__*/React.createElement("input", {
        type: "number",
        className: "input-sm",
        style: {
          width: '50px'
        },
        placeholder: "Cant",
        value: item.val2,
        onChange: e => {
          const n = [...settings.substrings];
          n[i].val2 = parseInt(e.target.value);
          update('substrings', n);
        }
      }), /*#__PURE__*/React.createElement("span", null, "\u2794"), /*#__PURE__*/React.createElement("input", {
        className: "input-sm",
        placeholder: "Destino",
        value: item.targetName,
        onChange: e => {
          const n = [...settings.substrings];
          n[i].targetName = e.target.value;
          update('substrings', n);
        }
      }), /*#__PURE__*/React.createElement("button", {
        className: "icon-btn",
        onClick: () => {
          const n = settings.substrings.filter((_, x) => x !== i);
          update('substrings', n);
        }
      }, "\uD83D\uDDD1\uFE0F")))), /*#__PURE__*/React.createElement("button", {
        className: "btn btn-primary",
        style: {
          width: '100%'
        },
        onClick: addSubstring
      }, "+ Recorte")));
    };

    // ----------------------------------------------------------------------
    // VISTA: HERRAMIENTA 4 (DEPURAR TELÉFONOS CHILE)
    // ----------------------------------------------------------------------
    const renderPhonesUI = () => {
      const settings = toolSettings['phones'] || {
        mappings: [],
        dedupe: true,
        removeJunk: true,
        mobileFirst: false
      };
      const update = (f, v) => setToolSettings(p => ({
        ...p,
        phones: {
          ...settings,
          [f]: v
        }
      }));

      // --- MOTOR DE DETECCIÓN: ESCANEO PROFUNDO ---
      const autoDetect = () => {
        // 1. LISTAS DE DEFINICIÓN
        const blacklist = ['ID', 'RUT', 'RUN', 'DNI', 'FOLIO', 'IDENT', 'OPERAC', 'CODIGO_INT', 'DDAS', 'NRT', 'PPAL', 'SCORE', 'TRAMO', 'SEGMENTO', 'GRUPO', 'CARTERA', 'FECHA', 'DATE', 'VENC', 'NAC', 'ANTIGUEDAD', 'ANIVERSARIO', 'FEC', 'MONTO', 'SALDO', 'DEUDA', 'PAGO', 'VALOR', 'UF', 'PESOS', 'CUPO', 'DISPONIBLE', 'OFERTA', 'CALLE', 'DIR', 'COMUNA', 'CIUDAD', 'REGION', 'BLOCK', 'DIRECCION', 'PASAJE'];
        const allowListPhones = ['FONO', 'PHONE', 'TEL', 'CEL', 'MOVIL', 'WSP', 'WHATSAPP', 'CONTACTO', 'OFICINA', 'CASA', 'PARTICULAR', 'NUMERO', 'CALL', 'MOBILE'];
        const allowListAreas = ['AREA', 'COD', 'PREFIJO', 'LADA', 'DDN', 'INDICATIVO'];
        let candidates = [];
        let potentialAreas = [];
        let potentialPhones = [];

        // 2. BARRIDO DE COLUMNAS
        columns.forEach((col, index) => {
          const header = col.toUpperCase();

          // A. BLOQUEO (BLACKLIST)
          if (blacklist.some(bad => header.includes(bad))) return;

          // B. ADMISIÓN (WHITELIST)
          const matchesPhoneKW = allowListPhones.some(kw => header.includes(kw));
          const matchesAreaKW = allowListAreas.some(kw => header.includes(kw));
          if (!matchesPhoneKW && !matchesAreaKW) return;

          // C. ESCANEO PROFUNDO (DEEP SCAN)
          // Buscamos hasta 100 muestras VÁLIDAS recorriendo todo el archivo si es necesario.
          // Esto asegura encontrar datos dispersos en bases masivas.
          let samples = [];
          for (let i = 0; i < masterData.length; i++) {
            const val = String(masterData[i][col] || '').trim();
            if (val !== '') {
              samples.push(val);
            }
            // Si ya tenemos 100 muestras no vacías, es suficiente estadística. Paramos.
            if (samples.length >= 100) break;
          }

          // Si recorrimos toda la base y no encontramos nada, saltamos
          if (samples.length === 0) return;

          // Calcular promedio de dígitos sobre las muestras encontradas
          const totalDigits = samples.reduce((acc, val) => acc + val.replace(/\D/g, '').length, 0);
          const avgLen = totalDigits / samples.length;

          // REGLA ANTI-FECHAS (YYYYMMDD) sobre la primera muestra encontrada
          const sampleClean = samples[0].replace(/\D/g, '');
          if (avgLen === 8 && (sampleClean.startsWith('19') || sampleClean.startsWith('20'))) return;

          // D. CLASIFICACIÓN FINAL
          let type = 'unknown';
          if (matchesAreaKW) {
            // Dice AREA. Solo si es innegablemente un teléfono (7+ dígitos) lo cambiamos.
            if (avgLen >= 7) type = 'phone';else type = 'area';
          } else if (matchesPhoneKW) {
            // Dice FONO. Asumimos FONO por defecto.
            // Solo si es innegablemente un área (promedio < 4 dígitos), lo cambiamos.
            // Esto permite capturar FONO5, FONO6 aunque tengan datos raros, pero descarta códigos puros.
            if (avgLen > 0 && avgLen <= 3) type = 'area';else type = 'phone';
          }

          // Guardar hallazgo
          if (type === 'phone') potentialPhones.push({
            col,
            index
          });else if (type === 'area') potentialAreas.push({
            col,
            index,
            used: false
          });
        });

        // 3. EMPAREJAMIENTO (AREA + FONO)
        potentialPhones.forEach(phoneObj => {
          let bestArea = '';
          const prevArea = potentialAreas.filter(a => !a.used && a.index < phoneObj.index).sort((a, b) => b.index - a.index)[0];
          if (prevArea) {
            bestArea = prevArea.col;
            prevArea.used = true;
          }
          candidates.push({
            id: Date.now() + phoneObj.index,
            col1: phoneObj.col,
            // FONO
            col2: bestArea // AREA
          });
        });
        if (candidates.length === 0) {
          addToast("No se encontraron columnas de teléfono en el escaneo.", "warning");
          update('mappings', [{
            id: Date.now(),
            col1: '',
            col2: ''
          }]);
        } else {
          update('mappings', candidates);
          addToast(`Detectados ${candidates.length} teléfonos tras escaneo profundo.`, "success");
        }
      };
      const addSlot = () => update('mappings', [...settings.mappings, {
        id: Date.now(),
        col1: '',
        col2: ''
      }]);
      const updateSlot = (idx, f, v) => {
        const n = [...settings.mappings];
        n[idx][f] = v;
        update('mappings', n);
      };
      const removeSlot = idx => {
        const n = settings.mappings.filter((_, i) => i !== idx);
        update('mappings', n);
      };
      return /*#__PURE__*/React.createElement("div", {
        className: "tool-ui-container"
      }, /*#__PURE__*/React.createElement("h4", {
        style: {
          marginTop: 0,
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement(Icon, {
        name: "phone"
      }), " Normalizador Chile (9 D\xEDgitos)"), /*#__PURE__*/React.createElement("div", {
        className: "action-bar"
      }, /*#__PURE__*/React.createElement("button", {
        className: "btn btn-primary",
        style: {
          flex: 1,
          fontSize: '0.8rem',
          padding: '0.6rem'
        },
        onClick: autoDetect
      }, "\uD83D\uDD0D Auto-Detectar (Escaneo Profundo)"), /*#__PURE__*/React.createElement("button", {
        className: "btn btn-outline",
        style: {
          flex: 1,
          fontSize: '0.8rem',
          padding: '0.6rem'
        },
        onClick: addSlot
      }, "+ Agregar Manual")), /*#__PURE__*/React.createElement("div", {
        className: "phone-mapper-list"
      }, settings.mappings.length === 0 && /*#__PURE__*/React.createElement("div", {
        style: {
          textAlign: 'center',
          color: '#999',
          fontSize: '0.8rem',
          padding: '1rem'
        }
      }, "Haz clic en Auto-Detectar o agrega manualmente"), settings.mappings.map((map, i) => /*#__PURE__*/React.createElement("div", {
        key: map.id,
        className: "phone-row"
      }, /*#__PURE__*/React.createElement("div", {
        className: "phone-label"
      }, "TEL_", i + 1), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          flexDirection: 'column'
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: '0.65rem',
          color: '#666',
          marginBottom: '2px'
        }
      }, "\xC1rea (Opc)"), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: map.col2,
        onChange: e => updateSlot(i, 'col2', e.target.value),
        style: {
          opacity: map.col2 ? 1 : 0.6
        }
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "(Ninguna)"), columns.map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c)))), /*#__PURE__*/React.createElement("div", {
        className: "plus-icon",
        style: {
          paddingTop: '1rem'
        }
      }, "+"), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          flexDirection: 'column'
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: '0.65rem',
          color: '#666',
          marginBottom: '2px'
        }
      }, "N\xFAmero (Req)"), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: map.col1,
        onChange: e => updateSlot(i, 'col1', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "(Seleccionar)"), columns.map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c)))), /*#__PURE__*/React.createElement("button", {
        className: "icon-btn",
        style: {
          color: '#EF4444',
          marginTop: '1rem'
        },
        onClick: () => removeSlot(i)
      }, "\uD83D\uDDD1\uFE0F")))), /*#__PURE__*/React.createElement("div", {
        style: {
          marginTop: '1.5rem',
          borderTop: '1px solid #eee',
          paddingTop: '1rem'
        }
      }, /*#__PURE__*/React.createElement("label", {
        className: "section-label"
      }, "Opciones de Salida"), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'grid',
          gap: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement("div", {
        className: "toggle-row",
        style: {
          padding: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement("span", {
        className: "toggle-label",
        style: {
          fontWeight: 'normal'
        }
      }, "\uD83D\uDEAB Eliminar Duplicados (Fila)"), /*#__PURE__*/React.createElement("label", {
        className: "switch",
        style: {
          transform: 'scale(0.8)'
        }
      }, /*#__PURE__*/React.createElement("input", {
        type: "checkbox",
        checked: settings.dedupe,
        onChange: e => update('dedupe', e.target.checked)
      }), /*#__PURE__*/React.createElement("span", {
        className: "slider"
      }))), /*#__PURE__*/React.createElement("div", {
        className: "toggle-row",
        style: {
          padding: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement("span", {
        className: "toggle-label",
        style: {
          fontWeight: 'normal'
        }
      }, "\uD83D\uDDD1\uFE0F Borrar Basura (11111111...)"), /*#__PURE__*/React.createElement("label", {
        className: "switch",
        style: {
          transform: 'scale(0.8)'
        }
      }, /*#__PURE__*/React.createElement("input", {
        type: "checkbox",
        checked: settings.removeJunk,
        onChange: e => update('removeJunk', e.target.checked)
      }), /*#__PURE__*/React.createElement("span", {
        className: "slider"
      }))), /*#__PURE__*/React.createElement("div", {
        className: "toggle-row",
        style: {
          padding: '0.5rem',
          border: '1px solid #BFDBFE',
          background: '#EFF6FF'
        }
      }, /*#__PURE__*/React.createElement("span", {
        className: "toggle-label",
        style: {
          fontWeight: 'bold',
          color: '#1E3A8A'
        }
      }, "\uD83D\uDCF1 Priorizar Celulares (Inicio)"), /*#__PURE__*/React.createElement("label", {
        className: "switch",
        style: {
          transform: 'scale(0.8)'
        }
      }, /*#__PURE__*/React.createElement("input", {
        type: "checkbox",
        checked: settings.mobileFirst,
        onChange: e => update('mobileFirst', e.target.checked)
      }), /*#__PURE__*/React.createElement("span", {
        className: "slider"
      }))))));
    };

    // ----------------------------------------------------------------------
    // VISTA: HERRAMIENTA 5 (FECHAS INTELIGENTES)
    // ----------------------------------------------------------------------
    const renderDatesUI = () => {
      const settings = toolSettings['dates'] || {
        rules: [],
        pending: {
          col: '',
          action: 'format',
          formatPattern: 'DD/MM/YYYY',
          extractType: 'month_name_full',
          calcType: 'age',
          outputMode: 'new'
        }
      };
      const update = (f, v) => setToolSettings(p => ({
        ...p,
        dates: {
          ...settings,
          [f]: v
        }
      }));
      const updatePending = (f, v) => setToolSettings(p => ({
        ...p,
        dates: {
          ...settings,
          pending: {
            ...settings.pending,
            [f]: v
          }
        }
      }));
      const addRule = () => {
        const p = settings.pending;
        if (!p.col) {
          addToast('Selecciona una columna', 'warning');
          return;
        }
        const newRule = {
          id: Date.now(),
          col: p.col,
          action: p.action,
          params: {
            pattern: p.formatPattern,
            extract: p.extractType,
            calc: p.calcType
          },
          outputMode: p.outputMode
        };
        update('rules', [...settings.rules, newRule]);
        addToast('Regla agregada', 'success');
      };
      const removeRule = id => update('rules', settings.rules.filter(r => r.id !== id));
      return /*#__PURE__*/React.createElement("div", {
        className: "tool-ui-container"
      }, /*#__PURE__*/React.createElement("h4", {
        style: {
          marginTop: 0,
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement(Icon, {
        name: "calendar"
      }), " Motor de Fechas (Multi-Regla)"), /*#__PURE__*/React.createElement("div", {
        style: {
          background: '#F3F4F6',
          padding: '1rem',
          borderRadius: '8px',
          border: '1px solid #E5E7EB',
          marginBottom: '1.5rem'
        }
      }, /*#__PURE__*/React.createElement("h5", {
        style: {
          marginTop: 0,
          marginBottom: '0.8rem',
          color: 'var(--primary)'
        }
      }, "\u2795 Nueva Regla"), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.5rem',
          marginBottom: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
        className: "form-label",
        style: {
          fontSize: '0.75rem'
        }
      }, "Columna"), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: settings.pending.col,
        onChange: e => updatePending('col', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "(Seleccionar)"), columns.map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c)))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
        className: "form-label",
        style: {
          fontSize: '0.75rem'
        }
      }, "Acci\xF3n"), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: settings.pending.action,
        onChange: e => updatePending('action', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: "format"
      }, "\uD83D\uDEE0\uFE0F Formatear"), /*#__PURE__*/React.createElement("option", {
        value: "extract"
      }, "\uD83D\uDD0D Extraer"), /*#__PURE__*/React.createElement("option", {
        value: "calc"
      }, "\uD83E\uDDEE Calcular")))), /*#__PURE__*/React.createElement("div", {
        style: {
          marginBottom: '0.8rem'
        }
      }, settings.pending.action === 'format' && /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: settings.pending.formatPattern,
        onChange: e => updatePending('formatPattern', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: "DD/MM/YYYY"
      }, "DD/MM/AAAA (08/01/2026)"), /*#__PURE__*/React.createElement("option", {
        value: "DD-MM-YYYY"
      }, "DD-MM-AAAA (08-01-2026)"), /*#__PURE__*/React.createElement("option", {
        value: "YYYY-MM-DD"
      }, "AAAA-MM-DD (2026-01-08)"), /*#__PURE__*/React.createElement("option", {
        value: "TEXT_FULL"
      }, "Texto Completo (08 de Enero del 2026)"), /*#__PURE__*/React.createElement("option", {
        value: "TEXT_SHORT"
      }, "Texto Corto (08 Ene 2026)")), settings.pending.action === 'extract' && /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: settings.pending.extractType,
        onChange: e => updatePending('extractType', e.target.value)
      }, /*#__PURE__*/React.createElement("optgroup", {
        label: "Combinados (NUEVO)"
      }, /*#__PURE__*/React.createElement("option", {
        value: "m_full_y_short_upper"
      }, "Mes_A\xF1o (ENERO_26)"), /*#__PURE__*/React.createElement("option", {
        value: "m_y_short"
      }, "Mes-A\xF1o (Ene-26)"), /*#__PURE__*/React.createElement("option", {
        value: "m_y_full"
      }, "Mes A\xF1o (Enero 2026)"), /*#__PURE__*/React.createElement("option", {
        value: "yyyymm"
      }, "A\xF1oMes (202601)")), /*#__PURE__*/React.createElement("optgroup", {
        label: "D\xEDa"
      }, /*#__PURE__*/React.createElement("option", {
        value: "day_num"
      }, "D\xEDa N\xFAmero (1-31)"), /*#__PURE__*/React.createElement("option", {
        value: "day_name_full"
      }, "Nombre D\xEDa (Lunes)"), /*#__PURE__*/React.createElement("option", {
        value: "day_name_short"
      }, "Abreviado (Lun)"), /*#__PURE__*/React.createElement("option", {
        value: "day_week_iso"
      }, "N\xB0 Semana ISO (1-7)")), /*#__PURE__*/React.createElement("optgroup", {
        label: "Mes"
      }, /*#__PURE__*/React.createElement("option", {
        value: "month_num"
      }, "Mes N\xFAmero (1-12)"), /*#__PURE__*/React.createElement("option", {
        value: "month_name_full"
      }, "Nombre Mes (Enero)"), /*#__PURE__*/React.createElement("option", {
        value: "month_name_short"
      }, "Abreviado (Ene)")), /*#__PURE__*/React.createElement("optgroup", {
        label: "A\xF1o / Otros"
      }, /*#__PURE__*/React.createElement("option", {
        value: "year_full"
      }, "A\xF1o (2026)"), /*#__PURE__*/React.createElement("option", {
        value: "week_num"
      }, "N\xB0 Semana del A\xF1o"), /*#__PURE__*/React.createElement("option", {
        value: "quarter"
      }, "Trimestre (Q1-Q4)"))), settings.pending.action === 'calc' && /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: settings.pending.calcType,
        onChange: e => updatePending('calcType', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: "age"
      }, "Edad (A\xF1os)"), /*#__PURE__*/React.createElement("option", {
        value: "antiquity_months"
      }, "Antig\xFCedad (Meses)"), /*#__PURE__*/React.createElement("option", {
        value: "days_diff"
      }, "D\xEDas Transcurridos"))), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'flex-end'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          flex: 1
        }
      }, /*#__PURE__*/React.createElement("label", {
        className: "form-label",
        style: {
          fontSize: '0.75rem'
        }
      }, "Destino"), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: settings.pending.outputMode,
        onChange: e => updatePending('outputMode', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: "new"
      }, "Nueva Columna"), /*#__PURE__*/React.createElement("option", {
        value: "overwrite"
      }, "Sobrescribir"))), /*#__PURE__*/React.createElement("button", {
        className: "btn btn-primary",
        style: {
          padding: '0.4rem 1rem',
          fontSize: '0.85rem'
        },
        onClick: addRule
      }, "+ Agregar"))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
        className: "section-label"
      }, "Reglas Activas (", settings.rules.length, ")"), settings.rules.length === 0 && /*#__PURE__*/React.createElement("div", {
        style: {
          color: '#999',
          fontSize: '0.8rem',
          fontStyle: 'italic'
        }
      }, "No hay reglas definidas."), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem'
        }
      }, settings.rules.map((rule, i) => /*#__PURE__*/React.createElement("div", {
        key: rule.id,
        className: "card",
        style: {
          padding: '0.6rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderLeft: '3px solid var(--primary)'
        }
      }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
        style: {
          fontWeight: 'bold',
          fontSize: '0.85rem'
        }
      }, i + 1, ". ", rule.action.toUpperCase(), " ", rule.col), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '0.75rem',
          color: '#666'
        }
      }, rule.action === 'format' && `→ ${rule.params.pattern}`, rule.action === 'extract' && `→ ${rule.params.extract}`, rule.action === 'calc' && `→ ${rule.params.calc}`, /*#__PURE__*/React.createElement("span", {
        style: {
          marginLeft: '0.5rem',
          background: '#eee',
          padding: '1px 4px',
          borderRadius: '3px'
        }
      }, rule.outputMode === 'new' ? '+ Columna' : 'Sobrescribir'))), /*#__PURE__*/React.createElement("button", {
        className: "icon-btn",
        style: {
          color: '#EF4444'
        },
        onClick: () => removeRule(rule.id)
      }, "\uD83D\uDDD1\uFE0F"))))));
    };

    // ----------------------------------------------------------------------
    // VISTA: HERRAMIENTA 6 (ENRIQUECER - CRUCE, ETIQUETAS, RANGOS)
    // ----------------------------------------------------------------------
    const renderEnrichUI = () => {
      const settings = toolSettings['enrich'] || {
        activeTab: 'vlookup',
        vlookup: {
          fileB_Name: '',
          dataB: [],
          colsB: [],
          keyA: '',
          keyB: '',
          action: 'add_cols',
          selectedCols: []
        },
        rules: [],
        pending: {
          col: '',
          type: 'range_width',
          param1: '',
          newCol: true,
          isDate: false
        }
      };
      const update = (f, v) => setToolSettings(p => ({
        ...p,
        enrich: {
          ...settings,
          [f]: v
        }
      }));
      const updateVlookupBatch = updates => update('vlookup', {
        ...settings.vlookup,
        ...updates
      });
      const updateVl = (f, v) => update('vlookup', {
        ...settings.vlookup,
        [f]: v
      });
      const updatePend = (f, v) => update('pending', {
        ...settings.pending,
        [f]: v
      });

      // --- CARGA ARCHIVO B ---
      const handleFileB = e => {
        const file = e.target.files[0];
        if (!file) return;
        e.target.value = null;
        const reader = new FileReader();
        const processData = (data, filename) => {
          if (data && data.length > 0) {
            updateVlookupBatch({
              dataB: data,
              colsB: Object.keys(data[0]),
              fileB_Name: filename
            });
            addToast(`Datos cargados: ${data.length} filas`, "success");
          } else addToast("Archivo vacío", "error");
        };
        if (file.name.match(/\.(csv|txt)$/i)) {
          reader.onload = evt => {
            Papa.parse(evt.target.result, {
              header: true,
              skipEmptyLines: true,
              dynamicTyping: true,
              complete: res => processData(res.data, file.name),
              error: err => addToast(`Error CSV: ${err.message}`, "error")
            });
          };
          reader.readAsText(file, 'ISO-8859-1');
        } else {
          reader.onload = evt => {
            try {
              const wb = XLSX.read(evt.target.result, {
                type: 'binary'
              });
              const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
                defval: ''
              });
              processData(data, file.name);
            } catch (err) {
              addToast("Error Excel: " + err.message, "error");
            }
          };
          reader.readAsBinaryString(file);
        }
      };
      const getMatchStats = () => {
        const {
          dataB,
          keyA,
          keyB
        } = settings.vlookup;
        if (!dataB || !dataB.length || !keyA || !keyB) return null;
        const sample = masterData.slice(0, 1000);
        const keysB = new Set(dataB.map(r => String(r[keyB] || '').trim().toUpperCase()));
        let matches = 0;
        sample.forEach(row => {
          if (keysB.has(String(row[keyA] || '').trim().toUpperCase())) matches++;
        });
        return {
          count: matches,
          total: sample.length,
          pct: sample.length ? (matches / sample.length * 100).toFixed(1) : 0
        };
      };
      const matchStats = getMatchStats();

      // --- GESTIÓN REGLAS ---
      const addRule = () => {
        const p = settings.pending;
        if (!p.col) {
          addToast("Selecciona columna", "warning");
          return;
        }
        const newRule = {
          id: Date.now(),
          ...p,
          mapping: {}
        };
        update('rules', [...settings.rules, newRule]);
        addToast("Regla creada", "success");
      };
      const removeRule = id => update('rules', settings.rules.filter(r => r.id !== id));
      return /*#__PURE__*/React.createElement("div", {
        className: "tool-ui-container"
      }, /*#__PURE__*/React.createElement("h4", {
        style: {
          marginTop: 0,
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement(Icon, {
        name: "database"
      }), " Enriquecer y Clasificar"), /*#__PURE__*/React.createElement("div", {
        className: "tabs-header",
        style: {
          marginBottom: '1.5rem'
        }
      }, /*#__PURE__*/React.createElement("button", {
        className: `tab-btn ${settings.activeTab === 'vlookup' ? 'active' : ''}`,
        onClick: () => update('activeTab', 'vlookup')
      }, "\uD83D\uDCC2 Cruce (BuscarV)"), /*#__PURE__*/React.createElement("button", {
        className: `tab-btn ${settings.activeTab === 'rules' ? 'active' : ''}`,
        onClick: () => update('activeTab', 'rules')
      }, "\uD83D\uDCCA Clasificaci\xF3n")), settings.activeTab === 'vlookup' && /*#__PURE__*/React.createElement("div", {
        className: "fade-in"
      }, /*#__PURE__*/React.createElement("input", {
        type: "file",
        id: "enrich-file-input",
        hidden: true,
        onChange: handleFileB,
        accept: ".xlsx,.xls,.csv,.txt"
      }), !settings.vlookup.dataB || settings.vlookup.dataB.length === 0 ? /*#__PURE__*/React.createElement("div", {
        className: "secondary-dropzone",
        onClick: () => document.getElementById('enrich-file-input').click()
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '2rem',
          marginBottom: '0.5rem'
        }
      }, "\uD83D\uDCE5"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("strong", null, "Cargar Archivo B")), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '0.75rem',
          color: '#666'
        }
      }, "Excel o CSV")) : /*#__PURE__*/React.createElement("div", {
        className: "vlookup-box"
      }, /*#__PURE__*/React.createElement("div", {
        className: "vlookup-header"
      }, /*#__PURE__*/React.createElement("span", null, "\uD83D\uDCC4 ", settings.vlookup.fileB_Name, " ", /*#__PURE__*/React.createElement("small", null, "(", settings.vlookup.dataB.length, " filas)")), /*#__PURE__*/React.createElement("button", {
        className: "btn-xs",
        style: {
          background: '#FEE2E2',
          color: '#EF4444',
          border: 'none',
          borderRadius: '4px',
          padding: '4px 8px',
          cursor: 'pointer'
        },
        onClick: () => updateVlookupBatch({
          dataB: [],
          colsB: [],
          fileB_Name: ''
        })
      }, "Cambiar")), /*#__PURE__*/React.createElement("div", {
        className: "vlookup-body"
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '1rem',
          marginBottom: '1rem'
        }
      }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
        className: "section-label"
      }, "Llave A"), /*#__PURE__*/React.createElement("select", {
        className: "integrated-select",
        value: settings.vlookup.keyA,
        onChange: e => updateVl('keyA', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "-- Seleccionar --"), columns.map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c)))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
        className: "section-label"
      }, "Llave B"), /*#__PURE__*/React.createElement("select", {
        className: "integrated-select",
        value: settings.vlookup.keyB,
        onChange: e => updateVl('keyB', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "-- Seleccionar --"), settings.vlookup.colsB.map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c))))), matchStats && /*#__PURE__*/React.createElement("div", {
        className: `alert ${matchStats.count > 0 ? 'alert-success' : 'alert-error'}`,
        style: {
          padding: '0.6rem',
          fontSize: '0.85rem',
          marginBottom: '1rem'
        }
      }, matchStats.count > 0 ? `✅ Match: ${matchStats.pct}% (${matchStats.count}/${matchStats.total})` : `⚠️ Sin coincidencias.`), /*#__PURE__*/React.createElement("label", {
        className: "section-label"
      }, "Columnas a Traer"), /*#__PURE__*/React.createElement("div", {
        className: "col-selector",
        style: {
          marginBottom: '1rem'
        }
      }, settings.vlookup.colsB.map(col => /*#__PURE__*/React.createElement("label", {
        key: col,
        className: "col-option"
      }, /*#__PURE__*/React.createElement("input", {
        type: "checkbox",
        checked: settings.vlookup.selectedCols.includes(col),
        onChange: () => {
          const s = settings.vlookup.selectedCols;
          updateVl('selectedCols', s.includes(col) ? s.filter(c => c !== col) : [...s, col]);
        }
      }), " ", /*#__PURE__*/React.createElement("span", {
        style: {
          marginLeft: '6px'
        }
      }, col)))), /*#__PURE__*/React.createElement("label", {
        className: "section-label"
      }, "Acci\xF3n"), /*#__PURE__*/React.createElement("div", {
        className: "radio-group",
        style: {
          gridTemplateColumns: '1fr 1fr'
        }
      }, /*#__PURE__*/React.createElement("div", {
        className: `radio-card ${settings.vlookup.action === 'add_cols' ? 'selected' : ''}`,
        onClick: () => updateVl('action', 'add_cols')
      }, /*#__PURE__*/React.createElement("div", {
        className: "radio-title"
      }, "\u2795 Nueva Columna")), /*#__PURE__*/React.createElement("div", {
        className: `radio-card ${settings.vlookup.action === 'update_values' ? 'selected' : ''}`,
        onClick: () => updateVl('action', 'update_values')
      }, /*#__PURE__*/React.createElement("div", {
        className: "radio-title"
      }, "\u270F\uFE0F Actualizar")))))), settings.activeTab === 'rules' && /*#__PURE__*/React.createElement("div", {
        className: "fade-in"
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          background: '#F3F4F6',
          padding: '1rem',
          borderRadius: '8px',
          marginBottom: '1rem',
          border: '1px solid #E5E7EB'
        }
      }, /*#__PURE__*/React.createElement("h5", {
        style: {
          margin: '0 0 0.8rem 0',
          color: 'var(--primary)'
        }
      }, "Nueva Regla"), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.5rem',
          marginBottom: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: settings.pending.col,
        onChange: e => updatePend('col', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "Columna..."), columns.map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c))), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: settings.pending.type,
        onChange: e => updatePend('type', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: "range_width"
      }, "Rango: Intervalo Fijo"), /*#__PURE__*/React.createElement("option", {
        value: "range_count"
      }, "Rango: Cantidad Tramos"), /*#__PURE__*/React.createElement("option", {
        value: "range_manual"
      }, "Rango: Manual (Cortes)"), /*#__PURE__*/React.createElement("option", {
        value: "tags"
      }, "Etiquetar (Texto)"))), settings.pending.type.includes('range') && /*#__PURE__*/React.createElement("div", {
        style: {
          marginBottom: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement("label", {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '0.5rem',
          fontSize: '0.8rem',
          cursor: 'pointer'
        }
      }, /*#__PURE__*/React.createElement("input", {
        type: "checkbox",
        checked: settings.pending.isDate,
        onChange: e => updatePend('isDate', e.target.checked)
      }), /*#__PURE__*/React.createElement("span", null, "\uD83D\uDCC5 ", /*#__PURE__*/React.createElement("strong", null, "Es Fecha"), " (Detectar M\xEDnimo autom\xE1ticamente)")), /*#__PURE__*/React.createElement("input", {
        type: "text",
        className: "input-sm",
        placeholder: settings.pending.isDate ? settings.pending.type === 'range_manual' ? 'Ej: 01/01/2026, 01/06/2026' : 'Ej: 7 (cada 7 días)' : settings.pending.type === 'range_manual' ? 'Ej: 1000, 5000' : 'Valor del intervalo...',
        value: settings.pending.param1,
        onChange: e => updatePend('param1', e.target.value)
      }), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '0.7rem',
          color: '#666',
          marginTop: '4px'
        }
      }, settings.pending.type === 'range_width' && "El sistema buscará el Mínimo real y sumará este intervalo.", settings.pending.type === 'range_count' && "Divide la diferencia entre Máximo y Mínimo.")), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          gap: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: settings.pending.newCol,
        onChange: e => updatePend('newCol', e.target.value === 'true')
      }, /*#__PURE__*/React.createElement("option", {
        value: "true"
      }, "Nueva Columna"), /*#__PURE__*/React.createElement("option", {
        value: "false"
      }, "Sobrescribir")), /*#__PURE__*/React.createElement("button", {
        className: "btn btn-primary",
        style: {
          padding: '0.2rem 1rem'
        },
        onClick: addRule
      }, "Agregar"))), settings.rules.map((r, i) => /*#__PURE__*/React.createElement("div", {
        key: r.id,
        className: "card",
        style: {
          padding: '0.5rem',
          marginBottom: '0.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderLeft: '3px solid var(--primary)'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '0.85rem'
        }
      }, /*#__PURE__*/React.createElement("b", null, i + 1, ". ", r.type.toUpperCase()), ": ", r.col, r.isDate ? ' 📅' : '', " ", r.type.includes('range') && `(${r.param1})`), /*#__PURE__*/React.createElement("button", {
        className: "icon-btn",
        onClick: () => removeRule(r.id),
        style: {
          color: '#EF4444'
        }
      }, "\uD83D\uDDD1\uFE0F")))));
    };

    // VISTA: HERRAMIENTA 7 (RANKING Y CONTEOS - INDEPENDIENTE)
    const renderRankingUI = () => {
      const settings = toolSettings['ranking'] || {
        opt1_active: false,
        opt1_campaign: '',
        opt1_statusCol: '',
        opt1_applySort: false,
        opt1_order: 'asc',
        opt1_tieBreaker: 'none',
        opt1_dateCol: '',
        opt2_active: false,
        opt2_col: '',
        opt3_active: false,
        opt3_col: ''
      };

      // NOTA: Usamos dbCampaigns definido al inicio del archivo principal.

      const update = (k, v) => setToolSettings(p => ({
        ...p,
        ranking: {
          ...settings,
          [k]: v
        }
      }));
      return /*#__PURE__*/React.createElement("div", {
        className: "tool-ui-container"
      }, /*#__PURE__*/React.createElement("h4", {
        style: {
          marginTop: 0,
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement(Icon, {
        name: "list"
      }), " Ranking & Conteos"), /*#__PURE__*/React.createElement("div", {
        style: {
          background: '#F0F9FF',
          padding: '0.8rem',
          borderRadius: '6px',
          marginBottom: '0.8rem',
          border: '1px solid #BAE6FD'
        }
      }, /*#__PURE__*/React.createElement("div", {
        className: "toggle-row",
        style: {
          marginBottom: '0.5rem',
          background: 'transparent',
          border: 'none',
          padding: 0
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontWeight: 'bold',
          color: '#0284C7'
        }
      }, "1. Ranking Gesti\xF3n (Nexus)"), /*#__PURE__*/React.createElement("label", {
        className: "switch"
      }, /*#__PURE__*/React.createElement("input", {
        type: "checkbox",
        checked: settings.opt1_active,
        onChange: e => update('opt1_active', e.target.checked)
      }), /*#__PURE__*/React.createElement("span", {
        className: "slider"
      }))), settings.opt1_active && /*#__PURE__*/React.createElement("div", {
        className: "fade-in",
        style: {
          display: 'grid',
          gap: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
        className: "form-label"
      }, "Campa\xF1a"), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: settings.opt1_campaign,
        onChange: e => update('opt1_campaign', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "--Sel--"), dbCampaigns.map(c => /*#__PURE__*/React.createElement("option", {
        key: c.code,
        value: c.code
      }, c.name)))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
        className: "form-label"
      }, "Col. Status"), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: settings.opt1_statusCol,
        onChange: e => update('opt1_statusCol', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "--Sel--"), columns.map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c))))), /*#__PURE__*/React.createElement("div", {
        style: {
          background: 'white',
          padding: '0.5rem',
          borderRadius: '4px',
          fontSize: '0.8rem'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          marginBottom: '0.3rem',
          fontWeight: 'bold',
          color: '#666'
        }
      }, "Acci\xF3n:"), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          gap: '1rem'
        }
      }, /*#__PURE__*/React.createElement("label", {
        style: {
          cursor: 'pointer'
        }
      }, /*#__PURE__*/React.createElement("input", {
        type: "radio",
        checked: !settings.opt1_applySort,
        onChange: () => update('opt1_applySort', false)
      }), " Solo Columna"), /*#__PURE__*/React.createElement("label", {
        style: {
          cursor: 'pointer'
        }
      }, /*#__PURE__*/React.createElement("input", {
        type: "radio",
        checked: settings.opt1_applySort,
        onChange: () => update('opt1_applySort', true)
      }), " Columna + Ordenar"))), settings.opt1_applySort && /*#__PURE__*/React.createElement("div", {
        style: {
          borderTop: '1px dashed #BAE6FD',
          paddingTop: '0.5rem',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
        className: "form-label"
      }, "Desempate"), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: settings.opt1_tieBreaker,
        onChange: e => update('opt1_tieBreaker', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: "none"
      }, "Ninguno"), /*#__PURE__*/React.createElement("option", {
        value: "recent"
      }, "Reciente"), /*#__PURE__*/React.createElement("option", {
        value: "oldest"
      }, "Antiguo"), /*#__PURE__*/React.createElement("option", {
        value: "random"
      }, "Aleatorio"))), (settings.opt1_tieBreaker === 'recent' || settings.opt1_tieBreaker === 'oldest') && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
        className: "form-label"
      }, "Col. Fecha"), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: settings.opt1_dateCol,
        onChange: e => update('opt1_dateCol', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "--Sel--"), columns.map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c))))))), /*#__PURE__*/React.createElement("div", {
        style: {
          background: '#FDF2F8',
          padding: '0.8rem',
          borderRadius: '6px',
          marginBottom: '0.8rem',
          border: '1px solid #FBCFE8'
        }
      }, /*#__PURE__*/React.createElement("div", {
        className: "toggle-row",
        style: {
          marginBottom: '0.5rem',
          background: 'transparent',
          border: 'none',
          padding: 0
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontWeight: 'bold',
          color: '#BE185D'
        }
      }, "2. Conteo Secuencial (1, 2, 3...)"), /*#__PURE__*/React.createElement("label", {
        className: "switch"
      }, /*#__PURE__*/React.createElement("input", {
        type: "checkbox",
        checked: settings.opt2_active,
        onChange: e => update('opt2_active', e.target.checked)
      }), /*#__PURE__*/React.createElement("span", {
        className: "slider"
      }))), settings.opt2_active && /*#__PURE__*/React.createElement("div", {
        className: "fade-in"
      }, /*#__PURE__*/React.createElement("label", {
        className: "form-label"
      }, "Columna Identificador"), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: settings.opt2_col,
        onChange: e => update('opt2_col', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "-- Seleccionar --"), columns.map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c))))), /*#__PURE__*/React.createElement("div", {
        style: {
          background: '#F0FDF4',
          padding: '0.8rem',
          borderRadius: '6px',
          border: '1px solid #BBF7D0'
        }
      }, /*#__PURE__*/React.createElement("div", {
        className: "toggle-row",
        style: {
          marginBottom: '0.5rem',
          background: 'transparent',
          border: 'none',
          padding: 0
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontWeight: 'bold',
          color: '#15803D'
        }
      }, "3. Frecuencia Total (5, 5, 5...)"), /*#__PURE__*/React.createElement("label", {
        className: "switch"
      }, /*#__PURE__*/React.createElement("input", {
        type: "checkbox",
        checked: settings.opt3_active,
        onChange: e => update('opt3_active', e.target.checked)
      }), /*#__PURE__*/React.createElement("span", {
        className: "slider"
      }))), settings.opt3_active && /*#__PURE__*/React.createElement("div", {
        className: "fade-in"
      }, /*#__PURE__*/React.createElement("label", {
        className: "form-label"
      }, "Columna Identificador"), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: settings.opt3_col,
        onChange: e => update('opt3_col', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "-- Seleccionar --"), columns.map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c))))));
    };
    const renderFilterUI = () => /*#__PURE__*/React.createElement("div", {
      className: "tool-ui-container"
    });
    const renderSortUI = () => /*#__PURE__*/React.createElement("div", {
      className: "tool-ui-container"
    });

    // =================================================================================================
    // [BLOQUE 4] VISTA PRINCIPAL (LAYOUT GENERAL)
    // =================================================================================================

    const exportData = ext => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(masterData), "Data");
      if (ext === 'csv') XLSX.writeFile(wb, `Nexus_Export.csv`, {
        bookType: 'csv'
      });else XLSX.writeFile(wb, `Nexus_Export.xlsx`);
    };
    return /*#__PURE__*/React.createElement("div", {
      className: "min-h-screen bg-gray-50 p-6 pb-32 app-container"
    }, /*#__PURE__*/React.createElement("style", null, cssStyles), /*#__PURE__*/React.createElement("div", {
      className: "header"
    }, /*#__PURE__*/React.createElement("h1", null, /*#__PURE__*/React.createElement(Icon, {
      name: "tool"
    }), " Nexus Data Shaper"), /*#__PURE__*/React.createElement("button", {
      className: "btn",
      style: {
        background: 'rgba(255,255,255,0.2)'
      },
      onClick: goHome
    }, "Salir")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '1rem',
        marginBottom: '1.5rem',
        borderBottom: '2px solid #E5E7EB',
        paddingLeft: '1rem'
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setActiveTab('batch'),
      style: {
        padding: '0.75rem 1.5rem',
        fontWeight: 'bold',
        color: activeTab === 'batch' ? '#EF4444' : '#6B7280',
        borderBottom: activeTab === 'batch' ? '3px solid #EF4444' : '3px solid transparent',
        background: 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        fontSize: '1rem',
        marginBottom: '-2px',
        transition: 'all 0.2s'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "layers",
      size: 18
    }), " Procesador Masivo"), /*#__PURE__*/React.createElement("button", {
      onClick: () => setActiveTab('quick'),
      style: {
        padding: '0.75rem 1.5rem',
        fontWeight: 'bold',
        color: activeTab === 'quick' ? '#EF4444' : '#6B7280',
        borderBottom: activeTab === 'quick' ? '3px solid #EF4444' : '3px solid transparent',
        background: 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        fontSize: '1rem',
        marginBottom: '-2px',
        transition: 'all 0.2s'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "briefcase",
      size: 18
    }), " Utilidades Express")), activeTab === 'batch' && step === 1 && /*#__PURE__*/React.createElement("div", {
      className: "card slide-up",
      style: {
        textAlign: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: '2rem'
      }
    }, /*#__PURE__*/React.createElement("h2", {
      style: {
        color: '#991B1B',
        fontWeight: '800',
        fontSize: '2rem'
      }
    }, "Paso 1: Carga Masiva"), /*#__PURE__*/React.createElement("p", {
      style: {
        color: '#666'
      }
    }, "Sube de 1 a 300 archivos (Excel, CSV, TXT). ", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.85rem',
        color: '#EF4444'
      }
    }, "* Los archivos vac\xEDos ser\xE1n ignorados autom\xE1ticamente."))), loading ? /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '3rem',
        background: '#FEF2F2',
        borderRadius: '12px',
        border: '1px solid #FECACA'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "spinner",
      style: {
        borderTopColor: '#EF4444',
        width: '40px',
        height: '40px',
        margin: '0 auto 1rem auto'
      }
    }), /*#__PURE__*/React.createElement("h3", {
      style: {
        color: '#991B1B',
        fontWeight: 'bold'
      }
    }, loadingMsg)) : /*#__PURE__*/React.createElement("label", {
      className: "drop-zone"
    }, /*#__PURE__*/React.createElement("input", {
      type: "file",
      multiple: true,
      accept: ".xlsx,.xls,.csv,.txt",
      onChange: handleFileUpload,
      hidden: true
    }), /*#__PURE__*/React.createElement(Icon, {
      name: "upload-cloud",
      size: 64,
      style: {
        color: '#EF4444',
        marginBottom: '1rem'
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '1.3rem',
        fontWeight: 'bold',
        color: '#7F1D1D'
      }
    }, "Arrastra tus archivos aqu\xED"))), activeTab === 'batch' && step === 2 && /*#__PURE__*/React.createElement("div", {
      className: "card slide-up"
    }, /*#__PURE__*/React.createElement("h2", {
      style: {
        color: '#991B1B',
        fontWeight: 'bold',
        marginBottom: '1rem'
      }
    }, "Paso 2: Consolidaci\xF3n"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: '1.5rem'
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "section-label"
    }, "I. Campo Pivote (ID \xDAnico)"), /*#__PURE__*/React.createElement("select", {
      className: "integrated-select",
      value: config.pivotField,
      onChange: e => setConfig({
        ...config,
        pivotField: e.target.value
      })
    }, columns.map(c => /*#__PURE__*/React.createElement("option", {
      key: c,
      value: c
    }, c)))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: '1.5rem'
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "section-label"
    }, "II. Estrategia de Duplicados"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '1rem'
      }
    }, [{
      id: 'keep',
      label: 'Mantener Todo',
      icon: '📋',
      desc: 'Unir sin cambios'
    }, {
      id: 'remove',
      label: 'Eliminar Duplicados',
      icon: '🗑️',
      desc: 'Dejar solo el primero'
    }, {
      id: 'normalize',
      label: 'Normalizar',
      icon: '🔄',
      desc: 'Aplanar (Filas a Columnas)'
    }].map(m => /*#__PURE__*/React.createElement("button", {
      key: m.id,
      className: `btn ${config.duplicateStrategy === m.id ? 'btn-primary' : ''}`,
      style: {
        border: '1px solid #E5E7EB',
        flex: 1,
        opacity: config.duplicateStrategy === m.id ? 1 : 0.7,
        background: config.duplicateStrategy === m.id ? 'var(--primary)' : '#F9FAFB',
        color: config.duplicateStrategy === m.id ? 'white' : '#374151',
        padding: '1rem'
      },
      onClick: () => {
        setConfig({
          ...config,
          duplicateStrategy: m.id
        });
        // Al elegir normalizar, calculamos automáticamente
        if (m.id === 'normalize') autoClassifyNormalization(config.pivotField);
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '1.5rem',
        marginBottom: '0.5rem'
      }
    }, m.icon), /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 'bold'
      }
    }, m.label), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.75rem',
        opacity: 0.8
      }
    }, m.desc))))), config.duplicateStrategy === 'normalize' && config.pivotField && /*#__PURE__*/React.createElement("div", {
      className: "tool-ui-container",
      style: {
        marginBottom: '1.5rem',
        background: '#FFF'
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "section-label"
    }, "III. Configuraci\xF3n de Normalizaci\xF3n"), /*#__PURE__*/React.createElement("div", {
      className: "alert alert-info",
      style: {
        fontSize: '0.85rem',
        marginBottom: '1rem'
      }
    }, "Revisa qu\xE9 columnas son ", /*#__PURE__*/React.createElement("strong", null, "\xDAnicas"), " (se mantienen) y cu\xE1les son ", /*#__PURE__*/React.createElement("strong", null, "Repetibles"), " (se expanden). Haz clic para moverlas."), /*#__PURE__*/React.createElement("div", {
      className: "norm-grid"
    }, /*#__PURE__*/React.createElement("div", {
      className: "norm-box unique"
    }, /*#__PURE__*/React.createElement("div", {
      className: "norm-header",
      style: {
        color: '#059669'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "check"
    }), " \xDAnicos (Fijos)"), /*#__PURE__*/React.createElement("div", {
      className: "norm-list"
    }, normConfig.uniqueCols.map(col => /*#__PURE__*/React.createElement("div", {
      key: col,
      className: `norm-item ${col === config.pivotField ? 'protected' : ''}`,
      onClick: () => {
        if (col === config.pivotField) return;
        setNormConfig(p => ({
          uniqueCols: p.uniqueCols.filter(c => c !== col),
          repeatCols: [...p.repeatCols, col]
        }));
      }
    }, col === config.pivotField ? '🔑 ' : '', col)))), /*#__PURE__*/React.createElement("div", {
      className: "norm-box repeat"
    }, /*#__PURE__*/React.createElement("div", {
      className: "norm-header",
      style: {
        color: '#D97706'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "columns"
    }), " Repetibles (Expandir)"), /*#__PURE__*/React.createElement("div", {
      className: "norm-list"
    }, normConfig.repeatCols.map(col => /*#__PURE__*/React.createElement("div", {
      key: col,
      className: "norm-item",
      onClick: () => {
        setNormConfig(p => ({
          repeatCols: p.repeatCols.filter(c => c !== col),
          uniqueCols: [...p.uniqueCols, col]
        }));
      }
    }, "\u27A1\uFE0F ", col)))))), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      style: {
        width: '100%',
        padding: '1rem',
        fontSize: '1.1rem'
      },
      disabled: loading || !config.duplicateStrategy,
      onClick: executeConsolidation
    }, loading ? 'Procesando...' : 'Confirmar Estructura y Avanzar →')), activeTab === 'batch' && step === 3 && /*#__PURE__*/React.createElement("div", {
      className: "card"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: '1.5rem'
      }
    }, /*#__PURE__*/React.createElement("h2", {
      style: {
        color: '#991B1B',
        fontWeight: 'bold'
      }
    }, "Caja de Herramientas"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: runPipeline
    }, "Ejecutar Pipeline")), /*#__PURE__*/React.createElement("div", {
      className: "tools-grid"
    }, TOOLS.map(tool => /*#__PURE__*/React.createElement("div", {
      key: tool.id,
      className: `tool-card ${activeTools[tool.id] ? 'active' : ''}`
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: '0.5rem',
        cursor: 'pointer'
      },
      onClick: () => setActiveTools(p => ({
        ...p,
        [tool.id]: !p[tool.id]
      }))
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 'bold',
        color: activeTools[tool.id] ? '#991B1B' : '#666',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: tool.icon
    }), " ", tool.label), /*#__PURE__*/React.createElement("label", {
      className: "switch",
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("input", {
      type: "checkbox",
      checked: !!activeTools[tool.id],
      onChange: () => setActiveTools(p => ({
        ...p,
        [tool.id]: !p[tool.id]
      }))
    }), /*#__PURE__*/React.createElement("span", {
      className: "slider"
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.8rem',
        color: '#666'
      }
    }, tool.desc), activeTools[tool.id] && tool.id === 'rut' && renderRutUI(), activeTools[tool.id] && tool.id === 'text' && renderTextUI(), activeTools[tool.id] && tool.id === 'columns' && renderColumnsUI(), activeTools[tool.id] && tool.id === 'phones' && renderPhonesUI(), activeTools[tool.id] && tool.id === 'dates' && renderDatesUI(), activeTools[tool.id] && tool.id === 'enrich' && renderEnrichUI(), activeTools[tool.id] && tool.id === 'ranking' && renderRankingUI(), activeTools[tool.id] && tool.id === 'filter' && renderFilterUI(), activeTools[tool.id] && tool.id === 'sort' && renderSortUI())))), activeTab === 'batch' && step === 4 && /*#__PURE__*/React.createElement("div", {
      className: "card slide-up"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: 'center',
        marginBottom: '2rem'
      }
    }, /*#__PURE__*/React.createElement("h2", {
      style: {
        color: '#991B1B',
        fontWeight: '800',
        fontSize: '2rem'
      }
    }, "Paso 4: Refinar y Exportar"), /*#__PURE__*/React.createElement("p", {
      style: {
        color: '#666'
      }
    }, "Aplica filtros finales y orden antes de descargar.")), /*#__PURE__*/React.createElement("div", {
      className: "tools-grid",
      style: {
        marginBottom: '2rem',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "tool-ui-container",
      style: {
        margin: 0,
        borderTop: '4px solid var(--primary)'
      }
    }, /*#__PURE__*/React.createElement("h4", {
      style: {
        marginTop: 0,
        marginBottom: '1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        color: 'var(--text-main)'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "filter"
    }), " Filtros Avanzados"), filterRules.map((rule, i) => {
      // Detectar si es modo lista
      const isListMode = rule.op === 'in' || rule.op === 'not_in';
      // Obtener opciones únicas si es modo lista
      const uniqueOptions = isListMode ? getUniqueValues(rule.col) : [];
      return /*#__PURE__*/React.createElement("div", {
        key: rule.id,
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: '0.3rem',
          marginBottom: '0.5rem'
        }
      }, i > 0 && /*#__PURE__*/React.createElement("div", {
        style: {
          alignSelf: 'center',
          margin: '0.2rem 0'
        }
      }, /*#__PURE__*/React.createElement("select", {
        style: {
          background: '#EFF6FF',
          color: '#1E40AF',
          border: '1px solid #BFDBFE',
          borderRadius: '12px',
          padding: '2px 8px',
          fontSize: '0.7rem',
          fontWeight: 'bold',
          cursor: 'pointer'
        },
        value: rule.logic,
        onChange: e => {
          const n = [...filterRules];
          n[i].logic = e.target.value;
          setFilterRules(n);
        }
      }, /*#__PURE__*/React.createElement("option", {
        value: "AND"
      }, "Y (AND)"), /*#__PURE__*/React.createElement("option", {
        value: "OR"
      }, "O (OR)"))), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'grid',
          gridTemplateColumns: '20px 1fr 100px 1fr 30px',
          gap: '0.5rem',
          alignItems: 'start'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontWeight: 'bold',
          color: '#991B1B',
          fontSize: '0.8rem',
          paddingTop: '6px'
        }
      }, i + 1, "."), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: rule.col,
        onChange: e => {
          const n = [...filterRules];
          n[i].col = e.target.value;
          n[i].val = n[i].op === 'in' || n[i].op === 'not_in' ? [] : ''; // Reset val al cambiar col
          setFilterRules(n);
        }
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "Columna..."), columns.map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c))), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        value: rule.op,
        onChange: e => {
          const n = [...filterRules];
          const oldOp = n[i].op;
          const newOp = e.target.value;
          n[i].op = newOp;

          // Si cambiamos entre modos (Texto <-> Lista), reseteamos el valor
          const isOldList = oldOp === 'in' || oldOp === 'not_in';
          const isNewList = newOp === 'in' || newOp === 'not_in';
          if (isOldList !== isNewList) {
            n[i].val = isNewList ? [] : '';
          }
          setFilterRules(n);
        }
      }, /*#__PURE__*/React.createElement("optgroup", {
        label: "Texto / Valor"
      }, /*#__PURE__*/React.createElement("option", {
        value: "="
      }, "Igual a"), /*#__PURE__*/React.createElement("option", {
        value: "<>"
      }, "Distinto de"), /*#__PURE__*/React.createElement("option", {
        value: "contains"
      }, "Contiene"), /*#__PURE__*/React.createElement("option", {
        value: ">"
      }, ">"), /*#__PURE__*/React.createElement("option", {
        value: "<"
      }, "<")), /*#__PURE__*/React.createElement("optgroup", {
        label: "Lista"
      }, /*#__PURE__*/React.createElement("option", {
        value: "in"
      }, "Es uno de..."), /*#__PURE__*/React.createElement("option", {
        value: "not_in"
      }, "NO es uno de..."))), /*#__PURE__*/React.createElement("div", null, isListMode ? rule.col ? /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: '2px'
        }
      }, /*#__PURE__*/React.createElement("select", {
        multiple: true,
        className: "input-sm",
        style: {
          height: '100px',
          fontSize: '0.75rem',
          padding: '2px'
        },
        value: Array.isArray(rule.val) ? rule.val : [],
        onChange: e => {
          const selected = Array.from(e.target.selectedOptions, option => option.value);
          const n = [...filterRules];
          n[i].val = selected;
          setFilterRules(n);
        }
      }, uniqueOptions.map(opt => /*#__PURE__*/React.createElement("option", {
        key: opt,
        value: opt
      }, opt))), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '0.65rem',
          color: '#666',
          textAlign: 'right'
        }
      }, "Ctrl+Click para seleccionar varios")) : /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '0.7rem',
          color: '#999',
          fontStyle: 'italic',
          paddingTop: '4px'
        }
      }, "Selecciona columna...") : /*#__PURE__*/React.createElement("input", {
        className: "input-sm",
        placeholder: "Valor...",
        value: rule.val,
        onChange: e => {
          const n = [...filterRules];
          n[i].val = e.target.value;
          setFilterRules(n);
        }
      })), /*#__PURE__*/React.createElement("button", {
        className: "icon-btn",
        style: {
          color: '#EF4444',
          paddingTop: '6px'
        },
        onClick: () => setFilterRules(filterRules.filter(r => r.id !== rule.id))
      }, "\u2715")));
    }), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      style: {
        width: '100%',
        fontSize: '0.8rem',
        padding: '0.6rem'
      },
      onClick: () => setFilterRules([...filterRules, {
        id: Date.now(),
        col: '',
        op: '=',
        val: '',
        logic: 'AND'
      }])
    }, "+ Agregar Filtro")), /*#__PURE__*/React.createElement("div", {
      className: "tool-ui-container",
      style: {
        margin: 0,
        borderTop: '4px solid #F59E0B'
      }
    }, /*#__PURE__*/React.createElement("h4", {
      style: {
        marginTop: 0,
        marginBottom: '1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        color: 'var(--text-main)'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "list"
    }), " Ordenamiento"), sortRules.map((rule, i) => /*#__PURE__*/React.createElement("div", {
      key: rule.id,
      style: {
        padding: '0.5rem',
        background: '#FFFBEB',
        borderRadius: '8px',
        border: '1px solid #FDE68A',
        marginBottom: '0.8rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '20px 1fr 30px',
        gap: '0.5rem',
        alignItems: 'center',
        marginBottom: '0.5rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 'bold',
        color: '#D97706',
        fontSize: '0.8rem'
      }
    }, i + 1, "."), /*#__PURE__*/React.createElement("select", {
      className: "input-sm",
      value: rule.col,
      onChange: e => {
        const n = [...sortRules];
        n[i].col = e.target.value;
        // Resetear valores custom al cambiar columna
        if (n[i].type === 'custom') n[i].customValues = [];
        setSortRules(n);
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "Columna a Ordenar..."), columns.map(c => /*#__PURE__*/React.createElement("option", {
      key: c,
      value: c
    }, c))), /*#__PURE__*/React.createElement("button", {
      className: "icon-btn",
      style: {
        color: '#EF4444'
      },
      onClick: () => setSortRules(sortRules.filter(r => r.id !== rule.id))
    }, "\u2715")), /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: '0.5rem'
      }
    }, /*#__PURE__*/React.createElement("select", {
      className: "input-sm",
      style: {
        width: '100%',
        fontWeight: 'bold',
        color: '#D97706'
      },
      value: rule.type || 'standard',
      onChange: e => {
        const n = [...sortRules];
        n[i].type = e.target.value;
        if (e.target.value === 'custom') n[i].customValues = []; // Init array
        setSortRules(n);
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: "standard"
    }, "\uD83D\uDD24 Num\xE9rico / Alfabetico (Est\xE1ndar)"), /*#__PURE__*/React.createElement("option", {
      value: "custom"
    }, "\uD83C\uDFA8 Orden Personalizado (Manual)"))), rule.type === 'custom' ? /*#__PURE__*/React.createElement("div", {
      style: {
        background: 'white',
        padding: '0.5rem',
        borderRadius: '6px',
        border: '1px solid #E5E7EB'
      }
    }, (!rule.customValues || rule.customValues.length === 0) && /*#__PURE__*/React.createElement("button", {
      className: "btn btn-sm",
      style: {
        width: '100%',
        fontSize: '0.75rem',
        background: '#FEF3C7',
        color: '#D97706',
        border: '1px solid #FCD34D'
      },
      onClick: () => {
        const n = [...sortRules];
        n[i].customValues = getUniqueValues(rule.col);
        setSortRules(n);
      }
    }, "\uD83D\uDCE5 Cargar Valores de la Columna"), rule.customValues && rule.customValues.length > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        maxHeight: '150px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.7rem',
        color: '#999',
        textAlign: 'center',
        marginBottom: '4px'
      }
    }, "Arriba = Mayor Prioridad"), rule.customValues.map((val, idx) => /*#__PURE__*/React.createElement("div", {
      key: idx,
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: '#FAFAFA',
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '0.8rem',
        border: '1px solid #EEE'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        maxWidth: '160px'
      }
    }, val), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '2px'
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "icon-btn",
      style: {
        fontSize: '0.7rem',
        padding: '2px'
      },
      onClick: () => {
        if (idx === 0) return;
        const n = [...sortRules];
        const arr = [...n[i].customValues];
        [arr[idx], arr[idx - 1]] = [arr[idx - 1], arr[idx]]; // Swap Up
        n[i].customValues = arr;
        setSortRules(n);
      }
    }, "\u2B06\uFE0F"), /*#__PURE__*/React.createElement("button", {
      className: "icon-btn",
      style: {
        fontSize: '0.7rem',
        padding: '2px'
      },
      onClick: () => {
        if (idx === rule.customValues.length - 1) return;
        const n = [...sortRules];
        const arr = [...n[i].customValues];
        [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]]; // Swap Down
        n[i].customValues = arr;
        setSortRules(n);
      }
    }, "\u2B07\uFE0F")))), /*#__PURE__*/React.createElement("button", {
      className: "btn-xs",
      style: {
        marginTop: '4px',
        fontSize: '0.7rem',
        color: '#EF4444',
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        textDecoration: 'underline'
      },
      onClick: () => {
        const n = [...sortRules];
        n[i].customValues = [];
        setSortRules(n);
      }
    }, "Recargar lista"))) : /*#__PURE__*/React.createElement("div", {
      className: "radio-group",
      style: {
        gridTemplateColumns: '1fr 1fr',
        margin: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: `radio-card ${rule.dir === 'asc' ? 'selected' : ''}`,
      style: {
        padding: '6px',
        fontSize: '0.8rem'
      },
      onClick: () => {
        const n = [...sortRules];
        n[i].dir = 'asc';
        setSortRules(n);
      }
    }, "A-Z / 0-9"), /*#__PURE__*/React.createElement("div", {
      className: `radio-card ${rule.dir === 'desc' ? 'selected' : ''}`,
      style: {
        padding: '6px',
        fontSize: '0.8rem'
      },
      onClick: () => {
        const n = [...sortRules];
        n[i].dir = 'desc';
        setSortRules(n);
      }
    }, "Z-A / 9-0")))), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      style: {
        width: '100%',
        fontSize: '0.8rem',
        padding: '0.6rem'
      },
      onClick: () => setSortRules([...sortRules, {
        id: Date.now(),
        col: '',
        dir: 'asc',
        type: 'standard',
        customValues: []
      }])
    }, "+ Agregar Nivel Orden"))), /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#FEF2F2',
        padding: '2rem',
        borderRadius: '16px',
        border: '2px dashed #FECACA',
        textAlign: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '1rem',
        color: '#7F1D1D',
        fontWeight: 'bold',
        marginBottom: '0.5rem',
        letterSpacing: '0.05em'
      }
    }, "REGISTROS FINALES"), (() => {
      const finalData = getFinalData();
      return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '3rem',
          fontWeight: '900',
          color: '#EF4444',
          lineHeight: 1,
          marginBottom: '0.5rem'
        }
      }, finalData.length.toLocaleString()), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '0.9rem',
          color: '#991B1B',
          opacity: 0.8,
          marginBottom: '2rem'
        }
      }, "de ", masterData.length.toLocaleString(), " procesados originalmente"), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          gap: '1rem',
          justifyContent: 'center',
          flexWrap: 'wrap'
        }
      }, /*#__PURE__*/React.createElement("button", {
        className: "btn btn-primary",
        style: {
          fontSize: '1.1rem',
          padding: '1rem 2rem'
        },
        onClick: () => {
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(finalData), "Data");
          XLSX.writeFile(wb, `Nexus_Export_Final.xlsx`);
        }
      }, /*#__PURE__*/React.createElement(Icon, {
        name: "download"
      }), " Descargar Excel"), /*#__PURE__*/React.createElement("button", {
        className: "btn",
        style: {
          border: '2px solid #EF4444',
          color: '#EF4444',
          fontSize: '1.1rem',
          padding: '1rem 2rem'
        },
        onClick: () => {
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(finalData), "Data");
          XLSX.writeFile(wb, `Nexus_Export_Final.csv`, {
            bookType: 'csv'
          });
        }
      }, "Descargar CSV")));
    })()), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: 'center',
        marginTop: '2rem'
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn",
      style: {
        background: 'transparent',
        color: '#666',
        border: '1px solid #ddd'
      },
      onClick: () => {
        setStep(1);
        setMasterData([]);
        setFilterRules([]);
        setSortRules([]);
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "rotate-ccw"
    }), " Reiniciar Todo"))), activeTab === 'quick' && /*#__PURE__*/React.createElement("div", {
      className: "card slide-up",
      style: {
        padding: 0,
        overflow: 'hidden',
        display: 'flex',
        height: '650px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: '240px',
        background: '#F1F5F9',
        borderRight: '1px solid #E2E8F0',
        padding: '1.5rem 1rem',
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        fontSize: '0.7rem',
        fontWeight: '800',
        color: '#64748B',
        textTransform: 'uppercase',
        marginBottom: '1rem',
        paddingLeft: '0.5rem',
        letterSpacing: '0.05em'
      }
    }, "Herramientas Express"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem'
      }
    }, [{
      id: 'math',
      icon: 'bar-chart-2',
      label: 'Estadística & Grid'
    }, {
      id: 'names',
      icon: 'users',
      label: 'Procesador Nombres'
    }, {
      id: 'text',
      icon: 'type',
      label: 'Texto & SQL'
    }, {
      id: 'dates',
      icon: 'calendar',
      label: 'Calculadora Fechas'
    }, {
      id: 'dv',
      icon: 'check-square',
      label: 'Calculadora DV'
    }].map(item => /*#__PURE__*/React.createElement("button", {
      key: item.id,
      onClick: () => setQuickText(item.id),
      style: {
        textAlign: 'left',
        padding: '0.75rem 1rem',
        borderRadius: '8px',
        border: '1px solid transparent',
        background: quickText === item.id ? 'white' : 'transparent',
        color: quickText === item.id ? '#EF4444' : '#64748B',
        fontWeight: quickText === item.id ? '700' : '500',
        boxShadow: quickText === item.id ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '0.8rem',
        transition: 'all 0.2s',
        fontSize: '0.85rem'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: item.icon,
      size: 18
    }), " ", item.label)))), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        padding: '2rem',
        background: '#fff',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column'
      }
    }, (quickText === 'math' || !quickText) && /*#__PURE__*/React.createElement("div", {
      className: "fade-in",
      style: {
        height: '100%',
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: '1.5rem'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        marginTop: 0,
        color: '#1E293B',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        fontSize: '1.2rem',
        fontWeight: 'bold'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "bar-chart-2"
    }), " An\xE1lisis de Series Num\xE9ricas"), /*#__PURE__*/React.createElement("p", {
      style: {
        fontSize: '0.85rem',
        color: '#64748B',
        margin: 0
      }
    }, "Pega una columna de Excel para obtener estad\xEDsticas inmediatas.")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '2rem',
        flex: 1,
        minHeight: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "section-label"
    }, "Input (Columna Num\xE9rica)"), /*#__PURE__*/React.createElement("textarea", {
      id: "mathInput",
      style: {
        flex: 1,
        width: '100%',
        padding: '1rem',
        border: '1px solid #CBD5E1',
        borderRadius: '8px',
        fontFamily: 'monospace',
        resize: 'none',
        fontSize: '0.9rem'
      },
      placeholder: "1000\n2500\n500.50\n...",
      onChange: e => {
        // Auto-Calcular al escribir
        const raw = e.target.value;
        const nums = raw.replace(/[$,]/g, '').split(/[\n\t,;]+/).map(n => parseFloat(n.trim())).filter(n => !isNaN(n));
        if (nums.length === 0) {
          document.getElementById('stats-box').style.opacity = '0.5';
          return;
        }
        document.getElementById('stats-box').style.opacity = '1';

        // Cálculos
        nums.sort((a, b) => a - b);
        const sum = nums.reduce((a, b) => a + b, 0);
        const avg = sum / nums.length;
        const min = nums[0];
        const max = nums[nums.length - 1];

        // Cuartiles
        const q1 = nums[Math.floor(nums.length / 4)];
        const median = nums[Math.floor(nums.length / 2)];
        const q3 = nums[Math.floor(nums.length * (3 / 4))];
        document.getElementById('stat-count').innerText = nums.length.toLocaleString();
        document.getElementById('stat-sum').innerText = sum.toLocaleString('es-CL', {
          maximumFractionDigits: 2
        });
        document.getElementById('stat-avg').innerText = avg.toLocaleString('es-CL', {
          maximumFractionDigits: 2
        });
        document.getElementById('stat-min').innerText = min.toLocaleString('es-CL');
        document.getElementById('stat-max').innerText = max.toLocaleString('es-CL');
        document.getElementById('stat-med').innerText = median.toLocaleString('es-CL');
        document.getElementById('stat-q1').innerText = q1.toLocaleString('es-CL');
        document.getElementById('stat-q3').innerText = q3.toLocaleString('es-CL');
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '0.5rem',
        marginTop: '0.5rem'
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-sm",
      style: {
        flex: 1,
        background: '#EFF6FF',
        color: '#1E40AF',
        border: '1px solid #BFDBFE'
      },
      onClick: () => {
        const el = document.getElementById('mathInput');
        const nums = el.value.replace(/[$,]/g, '').split(/[\n\t]+/).map(n => parseFloat(n.trim())).filter(n => !isNaN(n));
        el.value = nums.map(n => Math.round(n * 1.19)).join('\n');
        el.dispatchEvent(new Event('change', {
          bubbles: true
        })); // Trigger recalc
      }
    }, "+ IVA (19%)"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-sm",
      style: {
        flex: 1,
        background: '#EFF6FF',
        color: '#1E40AF',
        border: '1px solid #BFDBFE'
      },
      onClick: () => {
        const el = document.getElementById('mathInput');
        const nums = el.value.replace(/[$,]/g, '').split(/[\n\t]+/).map(n => parseFloat(n.trim())).filter(n => !isNaN(n));
        el.value = nums.map(n => Math.round(n / 1.19)).join('\n');
        el.dispatchEvent(new Event('change', {
          bubbles: true
        }));
      }
    }, "- IVA (Neto)"))), /*#__PURE__*/React.createElement("div", {
      id: "stats-box",
      style: {
        background: '#F8FAFC',
        borderRadius: '12px',
        border: '1px solid #E2E8F0',
        padding: '1.5rem',
        overflowY: 'auto',
        opacity: 0.5,
        transition: 'opacity 0.2s'
      }
    }, /*#__PURE__*/React.createElement("h4", {
      style: {
        marginTop: 0,
        color: '#64748B',
        fontSize: '0.8rem',
        textTransform: 'uppercase'
      }
    }, "Resumen Estad\xEDstico"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '1rem',
        marginBottom: '1.5rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: 'white',
        padding: '1rem',
        borderRadius: '8px',
        border: '1px solid #E2E8F0',
        textAlign: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.75rem',
        color: '#94A3B8',
        textTransform: 'uppercase'
      }
    }, "Suma Total"), /*#__PURE__*/React.createElement("div", {
      id: "stat-sum",
      style: {
        fontSize: '1.5rem',
        fontWeight: '900',
        color: '#0F172A'
      }
    }, "0")), /*#__PURE__*/React.createElement("div", {
      style: {
        background: 'white',
        padding: '1rem',
        borderRadius: '8px',
        border: '1px solid #E2E8F0',
        textAlign: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.75rem',
        color: '#94A3B8',
        textTransform: 'uppercase'
      }
    }, "Promedio"), /*#__PURE__*/React.createElement("div", {
      id: "stat-avg",
      style: {
        fontSize: '1.5rem',
        fontWeight: '900',
        color: '#3B82F6'
      }
    }, "0"))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: '1rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        borderBottom: '1px solid #E2E8F0',
        padding: '0.5rem 0'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: '#64748B'
      }
    }, "N\xB0 Registros"), /*#__PURE__*/React.createElement("span", {
      id: "stat-count",
      style: {
        fontWeight: 'bold'
      }
    }, "0")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        borderBottom: '1px solid #E2E8F0',
        padding: '0.5rem 0'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: '#64748B'
      }
    }, "M\xEDnimo"), /*#__PURE__*/React.createElement("span", {
      id: "stat-min",
      style: {
        fontWeight: 'bold'
      }
    }, "0")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        borderBottom: '1px solid #E2E8F0',
        padding: '0.5rem 0'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: '#64748B'
      }
    }, "M\xE1ximo"), /*#__PURE__*/React.createElement("span", {
      id: "stat-max",
      style: {
        fontWeight: 'bold'
      }
    }, "0"))), /*#__PURE__*/React.createElement("h4", {
      style: {
        marginTop: '1.5rem',
        color: '#64748B',
        fontSize: '0.8rem',
        textTransform: 'uppercase'
      }
    }, "Distribuci\xF3n (Cuartiles)"), /*#__PURE__*/React.createElement("div", {
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
        marginBottom: '0.5rem'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.8rem',
        color: '#64748B'
      }
    }, "Q1 (25%)"), /*#__PURE__*/React.createElement("span", {
      id: "stat-q1",
      style: {
        fontWeight: 'bold',
        color: '#059669'
      }
    }, "0")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: '0.5rem',
        background: '#F0FDF4',
        padding: '0.2rem 0.5rem',
        borderRadius: '4px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.8rem',
        color: '#166534',
        fontWeight: 'bold'
      }
    }, "Mediana (50%)"), /*#__PURE__*/React.createElement("span", {
      id: "stat-med",
      style: {
        fontWeight: 'bold',
        color: '#166534'
      }
    }, "0")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.8rem',
        color: '#64748B'
      }
    }, "Q3 (75%)"), /*#__PURE__*/React.createElement("span", {
      id: "stat-q3",
      style: {
        fontWeight: 'bold',
        color: '#059669'
      }
    }, "0")))))), quickText === 'names' && /*#__PURE__*/React.createElement("div", {
      className: "fade-in",
      style: {
        height: '100%',
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: '1.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
      style: {
        marginTop: 0,
        color: '#1E293B',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        fontSize: '1.2rem',
        fontWeight: 'bold'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "users"
    }), " Procesador de Nombres Masivo"), /*#__PURE__*/React.createElement("p", {
      style: {
        fontSize: '0.85rem',
        color: '#64748B',
        margin: 0
      }
    }, "Separa o Une columnas de nombres completas.")), /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#F1F5F9',
        padding: '4px',
        borderRadius: '8px',
        display: 'flex'
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-sm",
      style: {
        background: !quickR3.mode || quickR3.mode === 'split' ? 'white' : 'transparent',
        boxShadow: !quickR3.mode || quickR3.mode === 'split' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
        color: '#334155'
      },
      onClick: () => setQuickR3({
        ...quickR3,
        mode: 'split'
      })
    }, "\u2702\uFE0F Separar"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-sm",
      style: {
        background: quickR3.mode === 'join' ? 'white' : 'transparent',
        boxShadow: quickR3.mode === 'join' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
        color: '#334155'
      },
      onClick: () => setQuickR3({
        ...quickR3,
        mode: 'join'
      })
    }, "\uD83D\uDD17 Unir"))), (!quickR3.mode || quickR3.mode === 'split') && /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '1rem',
        marginBottom: '1rem'
      }
    }, /*#__PURE__*/React.createElement("select", {
      id: "splitMode",
      className: "integrated-select",
      style: {
        width: 'auto'
      },
      defaultValue: "3"
    }, /*#__PURE__*/React.createElement("option", {
      value: "3"
    }, "3 Cols: Nombres | Paterno | Materno"), /*#__PURE__*/React.createElement("option", {
      value: "2"
    }, "2 Cols: Nombres | Apellidos")), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: () => {
        const raw = document.getElementById('nameInputArea').value;
        const mode = document.getElementById('splitMode').value;
        const lines = raw.split('\n').filter(l => l.trim() !== '');
        let html = `<table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
                                                        <thead><tr style="background:#F1F5F9; text-align:left;">
                                                            <th style="padding:8px; border:1px solid #E2E8F0;">Nombres</th>
                                                            <th style="padding:8px; border:1px solid #E2E8F0;">${mode === '3' ? 'A. Paterno' : 'Apellidos'}</th>
                                                            ${mode === '3' ? '<th style="padding:8px; border:1px solid #E2E8F0;">A. Materno</th>' : ''}
                                                        </tr></thead><tbody>`;
        let tsv = "";
        lines.forEach(line => {
          // Lógica Heurística Masiva
          let parts = line.trim().replace(/\s+/g, ' ').split(' ');
          let n = '',
            p = '',
            m = '';
          if (mode === '3') {
            if (parts.length === 1) {
              n = parts[0];
            } else if (parts.length === 2) {
              n = parts[0];
              p = parts[1];
            } else if (parts.length === 3) {
              n = parts[0];
              p = parts[1];
              m = parts[2];
            } else if (parts.length === 4) {
              n = parts[0] + ' ' + parts[1];
              p = parts[2];
              m = parts[3];
            } else {
              m = parts.pop();
              p = parts.pop();
              n = parts.join(' ');
            }
            html += `<tr><td style="padding:6px; border:1px solid #E2E8F0;">${n}</td><td style="padding:6px; border:1px solid #E2E8F0;">${p}</td><td style="padding:6px; border:1px solid #E2E8F0;">${m}</td></tr>`;
            tsv += `${n}\t${p}\t${m}\n`;
          } else {
            // Modo 2 Cols
            if (parts.length === 1) {
              n = parts[0];
            } else if (parts.length === 2) {
              n = parts[0];
              p = parts[1];
            } else {
              // Asumimos 2 ultimos son apellidos, resto nombre
              let last = parts.pop();
              let pen = parts.pop();
              p = pen + ' ' + last;
              n = parts.join(' ');
            }
            html += `<tr><td style="padding:6px; border:1px solid #E2E8F0;">${n}</td><td style="padding:6px; border:1px solid #E2E8F0;">${p}</td></tr>`;
            tsv += `${n}\t${p}\n`;
          }
        });
        html += '</tbody></table>';
        document.getElementById('nameOutput').innerHTML = html;
        document.getElementById('hiddenNameTSV').value = tsv;
      }
    }, "\u26A1 Procesar Lista"), /*#__PURE__*/React.createElement("button", {
      className: "btn",
      style: {
        background: '#10B981',
        color: 'white',
        border: 'none'
      },
      onClick: () => {
        const tsv = document.getElementById('hiddenNameTSV').value;
        if (!tsv) return addToast('Nada que copiar', 'warning');
        navigator.clipboard.writeText(tsv);
        addToast('Tabla copiada al portapapeles', 'success');
      }
    }, "\uD83D\uDCCB Copiar Tabla")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '2rem',
        flex: 1,
        minHeight: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "section-label"
    }, "Pegar Lista (Desde Excel)"), /*#__PURE__*/React.createElement("textarea", {
      id: "nameInputArea",
      style: {
        flex: 1,
        padding: '1rem',
        border: '1px solid #CBD5E1',
        borderRadius: '8px',
        resize: 'none',
        fontSize: '0.85rem',
        whiteSpace: 'pre'
      },
      placeholder: "Juan Perez\nMaria Jose Gonzalez..."
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "section-label"
    }, "Resultado (Vista Previa)"), /*#__PURE__*/React.createElement("div", {
      id: "nameOutput",
      style: {
        flex: 1,
        border: '1px solid #E2E8F0',
        borderRadius: '8px',
        overflow: 'auto',
        background: '#F8FAFC'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '2rem',
        textAlign: 'center',
        color: '#94A3B8'
      }
    }, "Los resultados aparecer\xE1n aqu\xED...")), /*#__PURE__*/React.createElement("input", {
      type: "hidden",
      id: "hiddenNameTSV"
    })))), quickR3.mode === 'join' && /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#FFF7ED',
        border: '1px solid #FED7AA',
        padding: '1rem',
        borderRadius: '8px',
        marginBottom: '1rem',
        fontSize: '0.9rem',
        color: '#9A3412'
      }
    }, /*#__PURE__*/React.createElement("strong", null, "Instrucciones:"), " Copia tus columnas m\xFAltiples desde Excel (Nombre, Paterno, Materno) y p\xE9galas en el cuadro. El sistema las detectar\xE1 como columnas separadas por tabulador y las unir\xE1 en una sola frase."), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("textarea", {
      id: "joinInput",
      style: {
        flex: 1,
        padding: '1rem',
        border: '1px solid #CBD5E1',
        borderRadius: '8px',
        resize: 'none',
        fontSize: '0.85rem',
        whiteSpace: 'pre',
        fontFamily: 'monospace'
      },
      placeholder: "Pega aqu\xED tus columnas de Excel..."
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '1rem',
        marginTop: '1rem'
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: () => {
        const raw = document.getElementById('joinInput').value;
        // Detectar tabs
        const lines = raw.split('\n');
        const joined = lines.map(line => {
          // Unir por espacio, filtrar vacíos, trim
          return line.split('\t').map(c => c.trim()).filter(c => c).join(' ');
        }).join('\n');
        document.getElementById('joinInput').value = joined;
        addToast('Columnas unidas correctamente', 'success');
      }
    }, "\uD83D\uDD17 Unir Columnas"), /*#__PURE__*/React.createElement("button", {
      className: "btn",
      style: {
        background: '#F1F5F9',
        color: '#475569',
        border: '1px solid #CBD5E1'
      },
      onClick: () => {
        const val = document.getElementById('joinInput').value;
        navigator.clipboard.writeText(val);
        addToast('Lista unida copiada', 'success');
      }
    }, "\uD83D\uDCCB Copiar Resultado"))))), quickText === 'text' && (() => {
      // 1. Estado Dinámico Inyectado en toolSettings
      const sqlCfg = toolSettings['quickSql'] || {
        tableMode: 'static',
        tableStatic: 'mi_tabla',
        sets: [{
          id: 1,
          field: 'estado',
          mode: 'static',
          staticVal: ''
        }],
        wheres: [{
          id: 2,
          field: 'id',
          mode: '0',
          staticVal: ''
        }],
        useIn: true,
        detectedCols: 1
      };
      const updateSql = updates => setToolSettings(p => ({
        ...p,
        quickSql: {
          ...sqlCfg,
          ...updates
        }
      }));

      // 2. Generador Dinámico de Selectores basados en lo pegado
      const colOptions = Array.from({
        length: sqlCfg.detectedCols
      }, (_, i) => i);
      return /*#__PURE__*/React.createElement("div", {
        className: "fade-in",
        style: {
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.5rem',
          flexShrink: 0
        }
      }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
        style: {
          marginTop: 0,
          color: '#334155',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '1.2rem',
          fontWeight: 'bold'
        }
      }, /*#__PURE__*/React.createElement(Icon, {
        name: "type"
      }), " Laboratorio de Texto & SQL Din\xE1mico"), /*#__PURE__*/React.createElement("p", {
        style: {
          fontSize: '0.85rem',
          color: '#64748B',
          margin: 0
        }
      }, "Limpieza y generaci\xF3n masiva de consultas."))), /*#__PURE__*/React.createElement("div", {
        style: {
          position: 'relative',
          minHeight: '150px',
          marginBottom: '1rem',
          flexShrink: 0
        }
      }, /*#__PURE__*/React.createElement("textarea", {
        id: "quickTextInput",
        style: {
          width: '100%',
          height: '100%',
          padding: '1rem',
          borderRadius: '12px',
          border: '1px solid #CBD5E1',
          fontFamily: 'monospace',
          fontSize: '0.9rem',
          resize: 'vertical',
          boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)'
        },
        placeholder: "Pega tu lista de Excel aqu\xED...",
        onKeyUp: e => {
          // Escáner de columnas en tiempo real
          const firstLine = e.target.value.split('\n').find(l => l.trim() !== '') || '';
          const cols = Math.max(1, firstLine.split(/\t/).length);
          if (cols !== sqlCfg.detectedCols) updateSql({
            detectedCols: cols
          });
        }
      }), /*#__PURE__*/React.createElement("button", {
        onClick: () => {
          document.getElementById('quickTextInput').value = '';
          updateSql({
            detectedCols: 1
          });
          addToast('Lienzo limpio', 'info');
        },
        style: {
          position: 'absolute',
          top: '12px',
          right: '12px',
          background: '#fff',
          border: '1px solid #E2E8F0',
          padding: '6px 12px',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '0.75rem',
          color: '#64748B',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
        }
      }, /*#__PURE__*/React.createElement(Icon, {
        name: "trash-2",
        size: 12
      }), " Limpiar")), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '0.8rem',
          marginBottom: '1.5rem',
          flexShrink: 0
        }
      }, /*#__PURE__*/React.createElement("button", {
        className: "btn",
        style: {
          padding: '0.6rem',
          fontSize: '0.85rem',
          background: '#EFF6FF',
          color: '#1E40AF',
          border: '1px solid #BFDBFE'
        },
        onClick: () => {
          const el = document.getElementById('quickTextInput');
          el.value = el.value.toUpperCase();
        }
      }, "\uD83D\uDD20 MAY\xDASCULAS"), /*#__PURE__*/React.createElement("button", {
        className: "btn",
        style: {
          padding: '0.6rem',
          fontSize: '0.85rem',
          background: '#EFF6FF',
          color: '#1E40AF',
          border: '1px solid #BFDBFE'
        },
        onClick: () => {
          const el = document.getElementById('quickTextInput');
          el.value = el.value.toLowerCase();
        }
      }, "\uD83D\uDD21 min\xFAsculas"), /*#__PURE__*/React.createElement("button", {
        className: "btn",
        style: {
          padding: '0.6rem',
          fontSize: '0.85rem',
          background: '#EFF6FF',
          color: '#1E40AF',
          border: '1px solid #BFDBFE'
        },
        onClick: () => {
          const el = document.getElementById('quickTextInput');
          el.value = el.value.toLowerCase().replace(/(?:^|\s|["'([{])+\S/g, match => match.toUpperCase());
        }
      }, "\uD83D\uDD20 T\xEDtulo Propio"), /*#__PURE__*/React.createElement("button", {
        className: "btn",
        style: {
          padding: '0.6rem',
          fontSize: '0.85rem',
          background: '#ECFDF5',
          color: '#065F46',
          border: '1px solid #A7F3D0'
        },
        onClick: () => {
          const el = document.getElementById('quickTextInput');
          el.value = el.value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, ' ');
        }
      }, "\u2728 Saneamiento"), /*#__PURE__*/React.createElement("button", {
        className: "btn",
        style: {
          padding: '0.6rem',
          fontSize: '0.85rem',
          background: '#F5F3FF',
          color: '#5B21B6',
          border: '1px solid #DDD6FE'
        },
        onClick: () => {
          const el = document.getElementById('quickTextInput');
          el.value = el.value.split(/\n|,/).map(s => "'" + s.trim() + "'").filter(s => s !== "''" && s !== "' '").join(',');
        }
      }, "\uD83D\uDCBE SQL IN ('...')"), /*#__PURE__*/React.createElement("button", {
        className: "btn",
        style: {
          padding: '0.6rem',
          fontSize: '0.85rem',
          background: '#FFFBEB',
          color: '#B45309',
          border: '1px solid #FCD34D'
        },
        onClick: () => {
          const el = document.getElementById('quickTextInput');
          el.value = el.value.replace(/\D/g, '');
        }
      }, "\uD83D\uDD22 Solo N\xFAmeros")), /*#__PURE__*/React.createElement("div", {
        style: {
          background: '#F8FAFC',
          padding: '1.5rem',
          borderRadius: '12px',
          border: '1px solid #E2E8F0',
          flexShrink: 0
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem'
        }
      }, /*#__PURE__*/React.createElement("h4", {
        style: {
          margin: 0,
          color: '#0F766E',
          fontSize: '1rem',
          fontWeight: 'bold',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement(Icon, {
        name: "database",
        size: 18
      }), " Constructor SQL Din\xE1mico", /*#__PURE__*/React.createElement("span", {
        style: {
          background: '#CCFBF1',
          color: '#0F766E',
          padding: '2px 8px',
          borderRadius: '12px',
          fontSize: '0.75rem',
          marginLeft: '0.5rem'
        }
      }, sqlCfg.detectedCols, " Columnas Detectadas"))), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center',
          marginBottom: '1rem'
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          width: '85px',
          fontSize: '0.8rem',
          fontWeight: 'bold',
          color: '#475569'
        }
      }, "TABLA"), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        style: {
          width: '140px',
          fontWeight: 'bold'
        },
        value: sqlCfg.tableMode,
        onChange: e => updateSql({
          tableMode: e.target.value
        })
      }, /*#__PURE__*/React.createElement("option", {
        value: "static"
      }, "Texto Fijo \u2794"), colOptions.map(n => /*#__PURE__*/React.createElement("option", {
        key: 't' + n,
        value: n
      }, "Columna ", n + 1))), sqlCfg.tableMode === 'static' && /*#__PURE__*/React.createElement("input", {
        type: "text",
        className: "input-sm",
        placeholder: "ej. usuarios",
        value: sqlCfg.tableStatic,
        onChange: e => updateSql({
          tableStatic: e.target.value
        }),
        style: {
          flex: 1
        }
      })), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '1.5rem'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          background: '#FFF',
          padding: '1rem',
          borderRadius: '8px',
          border: '1px solid #CBD5E1'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '0.8rem'
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: '0.8rem',
          fontWeight: 'bold',
          color: '#059669'
        }
      }, "VALORES (SET)"), /*#__PURE__*/React.createElement("button", {
        className: "btn-xs",
        style: {
          fontSize: '0.7rem',
          color: '#059669',
          background: '#ECFDF5',
          border: '1px solid #A7F3D0',
          borderRadius: '4px',
          padding: '2px 8px'
        },
        onClick: () => {
          updateSql({
            sets: [...sqlCfg.sets, {
              id: Date.now(),
              field: '',
              mode: 'static',
              staticVal: ''
            }]
          });
        }
      }, "+ A\xF1adir SET")), sqlCfg.sets.map((setObj, i) => /*#__PURE__*/React.createElement("div", {
        key: setObj.id,
        style: {
          display: 'flex',
          gap: '0.3rem',
          alignItems: 'center',
          marginBottom: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement("input", {
        type: "text",
        className: "input-sm",
        placeholder: "campo",
        value: setObj.field,
        onChange: e => {
          const n = [...sqlCfg.sets];
          n[i].field = e.target.value;
          updateSql({
            sets: n
          });
        },
        style: {
          width: '35%'
        }
      }), /*#__PURE__*/React.createElement("span", {
        style: {
          color: '#94A3B8'
        }
      }, "="), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        style: {
          width: '35%'
        },
        value: setObj.mode,
        onChange: e => {
          const n = [...sqlCfg.sets];
          n[i].mode = e.target.value;
          updateSql({
            sets: n
          });
        }
      }, /*#__PURE__*/React.createElement("option", {
        value: "static"
      }, "Fijo \u2794"), colOptions.map(n => /*#__PURE__*/React.createElement("option", {
        key: 's' + n,
        value: n
      }, "Col ", n + 1))), setObj.mode === 'static' ? /*#__PURE__*/React.createElement("input", {
        type: "text",
        className: "input-sm",
        placeholder: "Valor...",
        value: setObj.staticVal,
        onChange: e => {
          const n = [...sqlCfg.sets];
          n[i].staticVal = e.target.value;
          updateSql({
            sets: n
          });
        },
        style: {
          flex: 1
        }
      }) : /*#__PURE__*/React.createElement("div", {
        style: {
          flex: 1
        }
      }), /*#__PURE__*/React.createElement("button", {
        className: "icon-btn",
        style: {
          color: '#EF4444',
          padding: '2px'
        },
        onClick: () => {
          const n = sqlCfg.sets.filter(s => s.id !== setObj.id);
          updateSql({
            sets: n
          });
        }
      }, "\u2715")))), /*#__PURE__*/React.createElement("div", {
        style: {
          background: '#FFF',
          padding: '1rem',
          borderRadius: '8px',
          border: '1px solid #CBD5E1'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '0.8rem'
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: '0.8rem',
          fontWeight: 'bold',
          color: '#DC2626'
        }
      }, "CONDICIONES (WHERE)"), /*#__PURE__*/React.createElement("button", {
        className: "btn-xs",
        style: {
          fontSize: '0.7rem',
          color: '#DC2626',
          background: '#FEF2F2',
          border: '1px solid #FECACA',
          borderRadius: '4px',
          padding: '2px 8px'
        },
        onClick: () => {
          updateSql({
            wheres: [...sqlCfg.wheres, {
              id: Date.now(),
              field: '',
              mode: 'static',
              staticVal: ''
            }]
          });
        }
      }, "+ A\xF1adir AND")), sqlCfg.wheres.map((wObj, i) => /*#__PURE__*/React.createElement("div", {
        key: wObj.id,
        style: {
          display: 'flex',
          gap: '0.3rem',
          alignItems: 'center',
          marginBottom: '0.5rem'
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: '0.65rem',
          fontWeight: 'bold',
          width: '30px'
        }
      }, i === 0 ? 'WHR' : 'AND'), /*#__PURE__*/React.createElement("input", {
        type: "text",
        className: "input-sm",
        placeholder: "id",
        value: wObj.field,
        onChange: e => {
          const n = [...sqlCfg.wheres];
          n[i].field = e.target.value;
          updateSql({
            wheres: n
          });
        },
        style: {
          width: '30%'
        }
      }), /*#__PURE__*/React.createElement("span", {
        style: {
          color: '#94A3B8'
        }
      }, "="), /*#__PURE__*/React.createElement("select", {
        className: "input-sm",
        style: {
          width: '35%'
        },
        value: wObj.mode,
        onChange: e => {
          const n = [...sqlCfg.wheres];
          n[i].mode = e.target.value;
          updateSql({
            wheres: n
          });
        }
      }, /*#__PURE__*/React.createElement("option", {
        value: "static"
      }, "Fijo \u2794"), colOptions.map(n => /*#__PURE__*/React.createElement("option", {
        key: 'w' + n,
        value: n
      }, "Col ", n + 1))), wObj.mode === 'static' ? /*#__PURE__*/React.createElement("input", {
        type: "text",
        className: "input-sm",
        placeholder: "Valor...",
        value: wObj.staticVal,
        onChange: e => {
          const n = [...sqlCfg.wheres];
          n[i].staticVal = e.target.value;
          updateSql({
            wheres: n
          });
        },
        style: {
          flex: 1
        }
      }) : /*#__PURE__*/React.createElement("div", {
        style: {
          flex: 1
        }
      }), /*#__PURE__*/React.createElement("button", {
        className: "icon-btn",
        style: {
          color: '#EF4444',
          padding: '2px'
        },
        onClick: () => {
          const n = sqlCfg.wheres.filter(w => w.id !== wObj.id);
          updateSql({
            wheres: n
          });
        }
      }, "\u2715"))))), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: '1.5rem',
          borderTop: '1px solid #E2E8F0',
          paddingTop: '1rem'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '0.8rem',
          background: '#ECFEFF',
          padding: '0.5rem 1rem',
          borderRadius: '8px',
          border: '1px solid #99F6E4'
        }
      }, /*#__PURE__*/React.createElement("label", {
        className: "switch",
        style: {
          transform: 'scale(0.8)',
          margin: 0
        }
      }, /*#__PURE__*/React.createElement("input", {
        type: "checkbox",
        checked: sqlCfg.useIn,
        onChange: e => updateSql({
          useIn: e.target.checked
        })
      }), /*#__PURE__*/React.createElement("span", {
        className: "slider"
      })), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: '0.85rem',
          fontWeight: 'bold',
          color: '#0F766E'
        }
      }, "\u26A1 Agrupar Multi-Cardinalidad con IN()")), /*#__PURE__*/React.createElement("button", {
        className: "btn btn-primary",
        style: {
          padding: '0.8rem 2rem',
          fontSize: '0.9rem'
        },
        onClick: () => {
          const data = document.getElementById('quickTextInput')?.value || '';
          if (!data.trim()) return addToast('No hay datos para procesar', 'warning');
          const lines = data.split('\n').filter(l => l.trim() !== '');
          const groups = {};
          const singles = [];
          lines.forEach(line => {
            const cols = line.split(/\t/);

            // 1. Resolver Tabla
            const tVal = sqlCfg.tableMode === 'static' ? sqlCfg.tableStatic : (cols[parseInt(sqlCfg.tableMode)] || '').trim();
            if (!tVal) return;

            // 2. Resolver SETs
            const sets = [];
            sqlCfg.sets.forEach(s => {
              if (s.field.trim()) {
                let v = s.mode === 'static' ? s.staticVal : (cols[parseInt(s.mode)] || '').trim();
                v = isNaN(v) || v === '' ? "'" + v + "'" : v;
                sets.push(s.field.trim() + " = " + v);
              }
            });
            const setString = sets.join(', ');

            // 3. Resolver WHEREs
            const wheres = [];
            let pWhereF = '';
            let pWhereV = '';
            sqlCfg.wheres.forEach((w, idx) => {
              if (w.field.trim()) {
                let v = w.mode === 'static' ? w.staticVal : (cols[parseInt(w.mode)] || '').trim();
                if (idx === 0 && sqlCfg.useIn) {
                  pWhereF = w.field.trim();
                  pWhereV = v;
                } else {
                  v = isNaN(v) || v === '' ? "'" + v + "'" : v;
                  wheres.push(w.field.trim() + " = " + v);
                }
              }
            });

            // 4. Lógica de Agrupación (Diagrama de Venn)
            if (sqlCfg.useIn && pWhereF) {
              const groupKey = tVal + "|||" + setString + "|||" + wheres.join(' AND ');
              if (!groups[groupKey]) {
                groups[groupKey] = {
                  table: tVal,
                  setStr: setString,
                  otherW: wheres.length > 0 ? " AND " + wheres.join(' AND ') : "",
                  pF: pWhereF,
                  ids: []
                };
              }
              if (pWhereV) groups[groupKey].ids.push(pWhereV);
            } else {
              // Línea por línea (Uno a uno)
              if (pWhereF) {
                let v = isNaN(pWhereV) || pWhereV === '' ? "'" + pWhereV + "'" : pWhereV;
                wheres.unshift(pWhereF + " = " + v);
              }
              if (wheres.length > 0 && setString) {
                singles.push("UPDATE " + tVal + " SET " + setString + " WHERE " + wheres.join(' AND ') + ";");
              } else if (wheres.length > 0 && !setString) {
                singles.push("DELETE FROM " + tVal + " WHERE " + wheres.join(' AND ') + ";");
              }
            }
          });

          // 5. Construcción Final Segura (Sin Backticks para Babel)
          let result = '';
          if (sqlCfg.useIn) {
            const queries = [];
            for (const key in groups) {
              const g = groups[key];
              if (g.ids.length === 0) continue;
              const uniqueIds = [...new Set(g.ids)];
              const idList = uniqueIds.map(id => isNaN(id) || id === '' ? "'" + id + "'" : id).join(', ');
              if (g.setStr) {
                queries.push("UPDATE " + g.table + " SET " + g.setStr + " WHERE " + g.pF + " IN (" + idList + ")" + g.otherW + ";");
              } else {
                queries.push("DELETE FROM " + g.table + " WHERE " + g.pF + " IN (" + idList + ")" + g.otherW + ";");
              }
            }
            result = queries.join('\n');
          } else {
            result = singles.join('\n');
          }
          document.getElementById('quickTextInput').value = result;
          addToast('Scripts agrupados generados con éxito', 'success');
        }
      }, "\u26A1 Generar SQL Masivo"))));
    })(), quickText === 'dates' && /*#__PURE__*/React.createElement("div", {
      className: "fade-in"
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        marginTop: 0,
        color: '#334155',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        marginBottom: '2rem'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "calendar"
    }), " Calculadora de Fechas"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '2rem',
        alignItems: 'flex-start'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#F8FAFC',
        padding: '1.5rem',
        borderRadius: '12px',
        border: '1px solid #E2E8F0'
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "section-label",
      style: {
        marginBottom: '0.5rem'
      }
    }, "Fecha Inicial"), /*#__PURE__*/React.createElement("input", {
      className: "input-sm",
      type: "date",
      value: quickDates.d1,
      onChange: e => setQuickDates({
        ...quickDates,
        d1: e.target.value
      }),
      style: {
        fontSize: '1.1rem',
        padding: '0.6rem',
        width: '100%'
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        margin: '1rem 0',
        textAlign: 'center',
        color: '#94A3B8'
      }
    }, "VS"), /*#__PURE__*/React.createElement("label", {
      className: "section-label",
      style: {
        marginBottom: '0.5rem'
      }
    }, "Fecha Final"), /*#__PURE__*/React.createElement("input", {
      className: "input-sm",
      type: "date",
      value: quickDates.d2,
      onChange: e => setQuickDates({
        ...quickDates,
        d2: e.target.value
      }),
      style: {
        fontSize: '1.1rem',
        padding: '0.6rem',
        width: '100%'
      }
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: 'center',
        padding: '2.5rem',
        background: '#F0FDFA',
        borderRadius: '12px',
        border: '2px dashed #5EEAD4',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.9rem',
        color: '#0F766E',
        textTransform: 'uppercase',
        fontWeight: 'bold',
        marginBottom: '0.5rem'
      }
    }, "Diferencia Total"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '4rem',
        fontWeight: '900',
        color: '#0D9488',
        lineHeight: 1
      }
    }, (() => {
      if (!quickDates.d1 || !quickDates.d2) return '--';
      const diff = new Date(quickDates.d2) - new Date(quickDates.d1);
      return Math.ceil(diff / (1000 * 60 * 60 * 24));
    })()), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '1.2rem',
        color: '#0F766E'
      }
    }, "d\xEDas corridos"))))), quickText === 'dv' && /*#__PURE__*/React.createElement("div", {
      className: "fade-in",
      style: {
        height: '100%',
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: '1.5rem'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        marginTop: 0,
        color: '#1E293B',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        fontSize: '1.2rem',
        fontWeight: 'bold'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "check-square"
    }), " Calculadora de D\xEDgito Verificador (Chile)"), /*#__PURE__*/React.createElement("p", {
      style: {
        fontSize: '0.85rem',
        color: '#64748B',
        margin: 0
      }
    }, "Calcula el DV masivamente y exporta en el formato que necesites.")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '2rem',
        flex: 1,
        minHeight: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "section-label"
    }, "Pegar RUTs (Sin DV ni puntos)"), /*#__PURE__*/React.createElement("textarea", {
      id: "dvInput",
      style: {
        flex: 1,
        padding: '1rem',
        border: '1px solid #CBD5E1',
        borderRadius: '8px',
        resize: 'none',
        fontSize: '0.85rem',
        whiteSpace: 'pre',
        fontFamily: 'monospace'
      },
      placeholder: "12345678\n11222333..."
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: '1rem'
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "section-label"
    }, "Formato de Salida"), /*#__PURE__*/React.createElement("select", {
      id: "dvFormat",
      className: "integrated-select"
    }, /*#__PURE__*/React.createElement("option", {
      value: "RUT_TAB_DV"
    }, "RUT [TABULACI\xD3N] DV (Ideal Excel en 2 columnas)"), /*#__PURE__*/React.createElement("option", {
      value: "RUT-DV"
    }, "RUT-DV (12345678-5)"), /*#__PURE__*/React.createElement("option", {
      value: "RUTDV"
    }, "RUTDV (123456785)"))), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      style: {
        marginTop: '1rem'
      },
      onClick: () => {
        const raw = document.getElementById('dvInput').value;
        const format = document.getElementById('dvFormat').value;
        const lines = raw.split('\n').filter(l => l.trim() !== '');
        const calculateDV = rutStr => {
          let t = parseInt(String(rutStr).replace(/[^\d]/g, ''), 10);
          if (isNaN(t)) return '';
          let m = 0,
            s = 1;
          for (; t; t = Math.floor(t / 10)) {
            s = (s + t % 10 * (9 - m++ % 6)) % 11;
          }
          return s ? String(s - 1) : 'K';
        };
        const processed = lines.map(line => {
          const cleanRut = line.replace(/[^\dKk]/g, '').replace(/[Kk]$/, '');
          if (!cleanRut) return line;
          const dv = calculateDV(cleanRut);
          if (format === 'RUT-DV') return `${cleanRut}-${dv}`;
          if (format === 'RUTDV') return `${cleanRut}${dv}`;
          if (format === 'RUT_TAB_DV') return `${cleanRut}\t${dv}`;
          return `${cleanRut}-${dv}`;
        }).join('\n');
        document.getElementById('dvOutput').value = processed;
        addToast('Cálculo completado', 'success');
      }
    }, "\uD83E\uDDEE Calcular DV")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "section-label"
    }, "Resultado"), /*#__PURE__*/React.createElement("textarea", {
      id: "dvOutput",
      readOnly: true,
      style: {
        flex: 1,
        padding: '1rem',
        border: '1px solid #E2E8F0',
        borderRadius: '8px',
        background: '#F8FAFC',
        resize: 'none',
        fontSize: '0.85rem',
        whiteSpace: 'pre',
        fontFamily: 'monospace'
      },
      placeholder: "Los resultados aparecer\xE1n aqu\xED..."
    }), /*#__PURE__*/React.createElement("button", {
      className: "btn",
      style: {
        background: '#10B981',
        color: 'white',
        border: 'none',
        marginTop: '1rem'
      },
      onClick: () => {
        const val = document.getElementById('dvOutput').value;
        if (!val) return addToast('Nada que copiar', 'warning');
        navigator.clipboard.writeText(val);
        addToast('Resultados copiados al portapapeles', 'success');
      }
    }, "\uD83D\uDCCB Copiar Resultados")))))));
  };
};