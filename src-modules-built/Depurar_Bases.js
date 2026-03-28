window.NexusModuleMeta = {
  icon: 'filter',
  color: 'bg-emerald-600',
  title: 'Depurar Bases'
};
window.NexusActiveModule = ({
  React,
  useState,
  useEffect,
  useRef,
  ui,
  utils,
  db,
  goHome
}) => {
  const {
    Icon
  } = ui;
  const {
    addToast,
    readFile
  } = utils;

  // ========================================================================
  // UTILIDAD: Descifrado Excel ECMA-376 Agile (AES-256)
  // ========================================================================
  const aesCbcNoPadding = async (key, iv, data) => {
    const crypto = window.crypto.subtle;
    const bs = 16;
    let input = data;
    if (data.length % bs !== 0) {
      input = new Uint8Array(Math.ceil(data.length / bs) * bs);
      input.set(data);
    }
    const lastBlock = input.slice(input.length - bs);
    const paddingBlock = new Uint8Array(bs);
    paddingBlock.fill(bs);
    const imported = await crypto.importKey('raw', key, {
      name: 'AES-CBC'
    }, false, ['encrypt', 'decrypt']);
    const encPad = new Uint8Array(await crypto.encrypt({
      name: 'AES-CBC',
      iv: lastBlock
    }, imported, paddingBlock));
    const combined = new Uint8Array(input.length + bs);
    combined.set(input);
    combined.set(encPad.slice(0, bs), input.length);
    const decrypted = new Uint8Array(await crypto.decrypt({
      name: 'AES-CBC',
      iv: iv
    }, imported, combined));
    return decrypted.slice(0, input.length);
  };
  const decryptExcelBuffer = async (buffer, password) => {
    const crypto = window.crypto.subtle;
    const uint8 = new Uint8Array(buffer);
    const cc = (a, b) => {
      const r = new Uint8Array(a.length + b.length);
      r.set(a);
      r.set(b, a.length);
      return r;
    };
    const ccAll = bufs => {
      const t = bufs.reduce((s, b) => s + b.length, 0);
      const r = new Uint8Array(t);
      let o = 0;
      bufs.forEach(b => {
        r.set(b, o);
        o += b.length;
      });
      return r;
    };
    const cfb = window.XLSX.CFB.read(uint8, {
      type: 'array'
    });
    const encInfo = window.XLSX.CFB.find(cfb, '/EncryptionInfo');
    const encPkg = window.XLSX.CFB.find(cfb, '/EncryptedPackage');
    if (!encInfo || !encPkg) throw new Error('Archivo no contiene streams de cifrado');
    const infoBytes = new Uint8Array(encInfo.content);
    const pkgBytes = new Uint8Array(encPkg.content);
    const vMajor = new DataView(infoBytes.buffer, infoBytes.byteOffset).getUint16(0, true);
    if (vMajor !== 4) throw new Error('Solo se soporta cifrado Agile (v4). Este archivo usa v' + vMajor);
    const doc = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(infoBytes.slice(8)), 'text/xml');
    let pNode = null,
      kNode = null;
    doc.querySelectorAll('*').forEach(el => {
      if (el.getAttribute('spinCount') && el.getAttribute('encryptedKeyValue')) pNode = el;
      if (el.getAttribute('saltValue') && !el.getAttribute('spinCount') && el.getAttribute('blockSize')) kNode = el;
    });
    if (!pNode || !kNode) throw new Error('XML de cifrado incompleto');
    const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const spinCount = parseInt(pNode.getAttribute('spinCount'));
    const keyBits = parseInt(pNode.getAttribute('keyBits'));
    const blockSize = parseInt(pNode.getAttribute('blockSize'));
    const saltValue = b64(pNode.getAttribute('saltValue'));
    const encKeyValue = b64(pNode.getAttribute('encryptedKeyValue'));
    const dataSaltValue = b64(kNode.getAttribute('saltValue'));
    const dataBlockSize = parseInt(kNode.getAttribute('blockSize'));
    const dataKeyBits = parseInt(kNode.getAttribute('keyBits'));
    const utf16 = new Uint8Array(password.length * 2);
    for (let i = 0; i < password.length; i++) {
      utf16[i * 2] = password.charCodeAt(i) & 0xFF;
      utf16[i * 2 + 1] = password.charCodeAt(i) >> 8 & 0xFF;
    }
    let h = new Uint8Array(await crypto.digest('SHA-512', cc(saltValue, utf16)));
    for (let i = 0; i < spinCount; i++) {
      const ib = new Uint8Array(4);
      new DataView(ib.buffer).setUint32(0, i, true);
      h = new Uint8Array(await crypto.digest('SHA-512', cc(ib, h)));
    }
    const dh = new Uint8Array(await crypto.digest('SHA-512', cc(h, new Uint8Array([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]))));
    const derivedKey = dh.slice(0, keyBits / 8);
    const decKeyRaw = await aesCbcNoPadding(derivedKey, saltValue.slice(0, blockSize), encKeyValue);
    const secretKey = decKeyRaw.slice(0, dataKeyBits / 8);
    const totalSize = new DataView(pkgBytes.buffer, pkgBytes.byteOffset).getUint32(0, true) + new DataView(pkgBytes.buffer, pkgBytes.byteOffset).getUint32(4, true) * 0x100000000;
    const encContent = pkgBytes.slice(8);
    const segments = [];
    let offset = 0;
    let segIdx = 0;
    while (offset < encContent.length) {
      const seg = encContent.slice(offset, Math.min(offset + 4096, encContent.length));
      const sb = new Uint8Array(4);
      new DataView(sb.buffer).setUint32(0, segIdx, true);
      const ivH = new Uint8Array(await crypto.digest('SHA-512', cc(dataSaltValue, sb)));
      segments.push(await aesCbcNoPadding(secretKey, ivH.slice(0, dataBlockSize), seg));
      offset += 4096;
      segIdx++;
    }
    return ccAll(segments).slice(0, Math.min(totalSize, ccAll(segments).length));
  };

  // ========================================================================
  // UTILIDAD: Leer Excel con soporte multi-hojas y contraseña
  // ========================================================================
  const leerExcelConHojas = (file, sheetName, password) => {
    return new Promise((resolve, reject) => {
      if (file.name.toLowerCase().match(/\.(csv|txt)$/)) {
        const reader = new FileReader();
        reader.onload = e => {
          Papa.parse(e.target.result, {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            complete: res => resolve({
              multiSheet: false,
              data: res.data,
              columns: res.meta.fields || []
            }),
            error: err => reject(err)
          });
        };
        reader.onerror = () => reject(new Error('Error al leer CSV'));
        reader.readAsText(file, 'ISO-8859-1');
        return;
      }
      const reader = new FileReader();
      reader.onload = async e => {
        try {
          let buffer = e.target.result;
          const isCfb = file.name.toLowerCase().match(/\.(xls|xlsb)$/) === null;
          if (password && isCfb) buffer = await decryptExcelBuffer(buffer, password);
          const wb = XLSX.read(new Uint8Array(buffer), {
            type: 'array'
          });
          if (wb.SheetNames.length > 1 && !sheetName) {
            resolve({
              multiSheet: true,
              sheetNames: wb.SheetNames,
              wb,
              decrypted: !!password
            });
            return;
          }
          const targetSheet = sheetName || wb.SheetNames[0];
          const ws = wb.Sheets[targetSheet];
          const headers = XLSX.utils.sheet_to_json(ws, {
            header: 1
          })[0] || [];
          const data = XLSX.utils.sheet_to_json(ws, {
            defval: ''
          });
          resolve({
            multiSheet: false,
            data,
            columns: headers
          });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Error al leer archivo'));
      reader.readAsArrayBuffer(file);
    });
  };

  // ========================================================================
  // COMPONENTE: Selector de Hojas
  // ========================================================================
  const SelectorHojas = ({
    pendientes,
    onConfirm,
    onCancel
  }) => {
    const [selecciones, setSelecciones] = useState(() => {
      const init = {};
      pendientes.forEach(p => {
        init[p.name] = p.sheetNames[0];
      });
      return init;
    });
    return /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#ecfdf5',
        border: '2px solid #059669',
        borderRadius: 12,
        padding: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        marginBottom: '1rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "layers",
      size: 20,
      style: {
        color: '#059669'
      }
    }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("strong", {
      style: {
        color: '#064e3b',
        fontSize: '0.9rem'
      }
    }, "M\xFAltiples hojas detectadas"), /*#__PURE__*/React.createElement("p", {
      style: {
        color: '#047857',
        fontSize: '0.75rem',
        margin: '4px 0 0'
      }
    }, "Selecciona cu\xE1l hoja procesar en cada archivo."))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxHeight: 200,
        overflowY: 'auto'
      }
    }, pendientes.map((p, idx) => /*#__PURE__*/React.createElement("div", {
      key: idx,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: 'white',
        padding: 10,
        borderRadius: 8,
        border: '1px solid #10b981'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.75rem',
        fontFamily: 'monospace',
        color: '#374151',
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }
    }, p.name), /*#__PURE__*/React.createElement("select", {
      style: {
        border: '1px solid #10b981',
        borderRadius: 6,
        padding: '4px 8px',
        fontSize: '0.75rem',
        fontWeight: 600,
        background: '#ecfdf5',
        minWidth: 140
      },
      value: selecciones[p.name],
      onChange: e => setSelecciones(prev => ({
        ...prev,
        [p.name]: e.target.value
      }))
    }, p.sheetNames.map(s => /*#__PURE__*/React.createElement("option", {
      key: s,
      value: s
    }, s)))))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 12,
        justifyContent: 'flex-end'
      }
    }, onCancel && /*#__PURE__*/React.createElement("button", {
      onClick: onCancel,
      style: {
        padding: '8px 16px',
        fontSize: '0.75rem',
        fontWeight: 700,
        color: '#6b7280',
        background: '#f3f4f6',
        border: '1px solid #d1d5db',
        borderRadius: 6,
        cursor: 'pointer'
      }
    }, "Cancelar"), /*#__PURE__*/React.createElement("button", {
      onClick: () => onConfirm(selecciones),
      style: {
        padding: '8px 16px',
        fontSize: '0.75rem',
        fontWeight: 700,
        color: 'white',
        background: '#059669',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer'
      }
    }, "Confirmar")));
  };

  // ========================================================================
  // COMPONENTE: Panel de Contraseñas
  // ========================================================================
  const PanelContrasenas = ({
    protectedFiles,
    passwords,
    setPasswords,
    onDesbloquear,
    onCancel
  }) => {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#fffbeb',
        border: '2px solid #f59e0b',
        borderRadius: 12,
        padding: '1rem',
        marginBottom: '1rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: '0.75rem'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "lock",
      size: 18,
      style: {
        color: '#d97706'
      }
    }), /*#__PURE__*/React.createElement("strong", {
      style: {
        color: '#92400e',
        fontSize: '0.85rem'
      }
    }, "Archivos Protegidos (", protectedFiles.length, ")")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxHeight: 150,
        overflowY: 'auto'
      }
    }, protectedFiles.map((pf, idx) => /*#__PURE__*/React.createElement("div", {
      key: idx,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'white',
        padding: 8,
        borderRadius: 6,
        border: '1px solid #fbbf24'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.7rem',
        fontFamily: 'monospace',
        color: '#374151',
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }
    }, pf.name), /*#__PURE__*/React.createElement("input", {
      type: "text",
      placeholder: "Contrase\xF1a",
      style: {
        width: 120,
        border: '1px solid #fbbf24',
        borderRadius: 4,
        padding: '4px 6px',
        fontSize: '0.7rem',
        fontFamily: 'monospace'
      },
      value: passwords[pf.name] || '',
      onChange: e => setPasswords(prev => ({
        ...prev,
        [pf.name]: e.target.value
      }))
    })))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        marginTop: '0.75rem'
      }
    }, onCancel && /*#__PURE__*/React.createElement("button", {
      onClick: onCancel,
      style: {
        flex: 1,
        padding: '8px',
        fontSize: '0.8rem',
        fontWeight: 700,
        color: '#6b7280',
        background: '#f3f4f6',
        border: '1px solid #d1d5db',
        borderRadius: 6,
        cursor: 'pointer'
      }
    }, "Cancelar"), /*#__PURE__*/React.createElement("button", {
      onClick: () => onDesbloquear(passwords),
      style: {
        flex: 1,
        padding: '8px',
        fontSize: '0.8rem',
        fontWeight: 700,
        color: 'white',
        background: '#d97706',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer'
      }
    }, "\uD83D\uDD13 Desbloquear")));
  };

  // 1. Inyección de Estilos Originales (Adaptados a Nexus)
  const cssStyles = `
        :root { --primary: #059669; --accent: #10b981; --success: #059669; --warning: #d97706; --error: #dc2626; --background: #ecfdf5; --white: #FFFFFF; --border: #d1fae5; --text-dark: #064e3b; --text-light: #374151; --shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
        
        .app-container { font-family: system-ui, -apple-system, sans-serif; color: var(--text-dark); display: flex; flex-direction: column; gap: 1.5rem; }
        
        /* Teléfonos (FIX CRÍTICO) */
        .phone-list { display: flex; flex-direction: column; gap: 4px; }
        .phone-list span { display: inline-block; padding: 2px 6px; background: #f3f4f6; border-radius: 4px; font-family: monospace; font-size: 0.85rem; border: 1px solid #e5e7eb; }

        /* Header y Estructura */
        .header { background: linear-gradient(135deg, var(--primary), var(--accent)); color: white; padding: 1.5rem; border-radius: 12px; margin-bottom: 1rem; box-shadow: var(--shadow); }
        .header h1 { font-size: 1.5rem; font-weight: 800; margin: 0; letter-spacing: -0.025em; }
        .card { background: white; border-radius: 12px; padding: 2rem; box-shadow: var(--shadow); border: 1px solid var(--border); margin-bottom: 1.5rem; }
        .card-title { font-size: 1.5rem; font-weight: 700; color: var(--primary); margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; border-bottom: 2px solid var(--border); padding-bottom: 0.5rem; }
        .card-subtitle { color: var(--text-light); font-size: 0.95rem; margin-bottom: 1.5rem; display: block; }

        /* Botones */
        .btn { padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; border: none; transition: all 0.2s; font-size: 0.95rem; }
        .btn:hover { transform: translateY(-1px); }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .btn-primary { background: var(--primary); color: white; } .btn-primary:hover { background: #047857; }
        .btn-secondary { background: white; border: 2px solid var(--border); color: var(--text-dark); }
        .btn-outline { background: transparent; border: 2px solid var(--primary); color: var(--primary); }
        .btn-error { background: var(--error); color: white; }
        .btn-success { background: var(--primary); color: white; }
        .btn-warning { background: var(--warning); color: white; }

        /* Formularios (Ordenados) */
        .form-group { margin-bottom: 1.5rem; }
        .form-label { display: block; font-weight: 700; margin-bottom: 0.5rem; color: var(--text-dark); font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em; }
        .form-input, .form-select, .form-textarea { width: 100%; padding: 0.75rem; border: 2px solid #cbd5e1; border-radius: 8px; font-size: 1rem; outline: none; transition: border-color 0.2s; background: #f8fafc; }
        .form-input:focus, .form-select:focus { border-color: var(--primary); background: white; ring: 2px solid var(--border); }

        /* Tablas */
        .table-container { overflow-x: auto; border-radius: 8px; border: 1px solid var(--border); margin-top: 1rem; }
        .table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
        .table th { background: #f0fdf4; color: var(--primary); padding: 1rem; text-align: left; font-weight: 800; border-bottom: 2px solid var(--border); white-space: nowrap; }
        .table td { padding: 0.75rem 1rem; border-bottom: 1px solid var(--border); color: var(--text-light); vertical-align: top; }
        
        /* Utilidades */
        .grid { display: grid; gap: 1.5rem; }
        .grid-2 { grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); }
        .grid-3 { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
        .alert { padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem; border-left: 4px solid; font-size: 0.95rem; display: flex; align-items: center; gap: 0.75rem; }
        .alert-info { background: #eff6ff; border-color: #3b82f6; color: #1e40af; }
        .alert-success { background: #ecfdf5; border-color: #059669; color: #064e3b; }
        .alert-error { background: #fef2f2; border-color: #dc2626; color: #991b1b; }
        
        .spinner { width: 24px; height: 24px; border: 3px solid var(--border); border-top-color: var(--primary); border-radius: 50%; animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Tarjetas de Opción (Paso 4) */
        .option-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1.5rem; margin: 1.5rem 0; }
        .option-card { border: 2px solid var(--border); border-radius: 12px; padding: 1.5rem; cursor: pointer; transition: all 0.2s ease; text-align: center; background: white; }
        .option-card:hover { border-color: var(--accent); transform: translateY(-4px); box-shadow: var(--shadow); }
        .option-card.selected { border-color: var(--primary); background: #ecfdf5; ring: 2px solid var(--primary); }
        .option-card-title { font-weight: 700; font-size: 1.1rem; color: var(--primary); margin-bottom: 0.5rem; }

        /* Barra de Progreso */
        .progress-container { background: white; padding: 1.5rem; border-radius: 12px; box-shadow: var(--shadow); border: 1px solid var(--border); overflow-x: auto; margin-bottom: 1rem; }
        .progress-bar { display: flex; justify-content: space-between; position: relative; min-width: 800px; padding: 0 1rem; }
        .progress-line { position: absolute; top: 15px; left: 0; right: 0; height: 3px; background: var(--border); z-index: 0; border-radius: 3px; }
        .progress-line-filled { position: absolute; top: 15px; left: 0; height: 3px; background: var(--primary); z-index: 1; transition: width 0.3s ease; border-radius: 3px; }
        .progress-step { display: flex; flex-direction: column; align-items: center; position: relative; z-index: 2; min-width: 80px; cursor: default; }
        .progress-step-circle { width: 34px; height: 34px; border-radius: 50%; background: white; border: 3px solid var(--border); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.9rem; margin-bottom: 0.5rem; transition: all 0.3s; color: var(--text-light); }
        .progress-step.active .progress-step-circle { background: var(--primary); border-color: var(--primary); color: white; transform: scale(1.1); box-shadow: 0 0 0 4px #d1fae5; }
        .progress-step.completed .progress-step-circle { background: var(--primary); border-color: var(--primary); color: white; }
        .progress-step-label { font-size: 0.75rem; font-weight: 600; color: var(--text-light); text-transform: uppercase; letter-spacing: 0.5px; }
        .progress-step.active .progress-step-label { color: var(--primary); }

        .file-list { margin-top: 1rem; display: grid; gap: 0.5rem; }
        .file-item { background: white; border: 1px solid var(--border); padding: 0.75rem; border-radius: 8px; display: flex; align-items: center; gap: 0.75rem; }
        .nav-buttons { display: flex; justify-content: space-between; margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--border); }
        .checkbox-group { display: flex; align-items: center; gap: 0.5rem; margin: 0.5rem 0; }
        .checkbox { width: 1.2rem; height: 1.2rem; accent-color: var(--primary); cursor: pointer; }

        /* Tooltip de columna */
        .col-tooltip-wrap { position: relative; display: inline-block; }
        .col-tooltip-wrap .col-tooltip {
            visibility: hidden; opacity: 0; pointer-events: none;
            position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);
            background: #1f2937; color: #f9fafb; font-size: 0.72rem; font-family: system-ui, sans-serif;
            white-space: pre-wrap; min-width: 200px; max-width: 320px; padding: 0.5rem 0.75rem;
            border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 10000;
            transition: opacity 0.15s ease, visibility 0.15s ease;
            line-height: 1.5;
        }
        .col-tooltip-wrap:hover .col-tooltip { visibility: visible; opacity: 1; }
        .col-tooltip-wrap .col-tooltip::after {
            content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
            border: 5px solid transparent; border-top-color: #1f2937;
        }
    `;

  // Initial campaigns data (Vacío porque ahora cargan de Nexus)
  const initialCampaigns = [];

  // --- NUEVO v6: Definir el estado inicial fuera del componente ---
  const getInitialState = () => {
    // --- Lógica de Campañas (CORREGIDA v6.4) ---
    // Primero definimos la lista de campañas
    let campaignsList;
    try {
      const savedCampaigns = localStorage.getItem('depurador_campaigns');
      campaignsList = savedCampaigns ? JSON.parse(savedCampaigns) : initialCampaigns;
    } catch (e) {
      console.error("Error loading campaigns, resetting.", e);
      campaignsList = initialCampaigns;
    }

    // --- INICIO: Lógica de Reglas de Exclusión (NUEVO v6.6) ---
    let exclusionRulesList;
    try {
      const savedRules = localStorage.getItem('depurador_exclusion_rules');
      // Asegurarnos que siempre sea un array, incluso si no hay nada guardado
      exclusionRulesList = savedRules ? JSON.parse(savedRules) : [];
    } catch (e) {
      console.error("Error loading exclusion rules, resetting.", e);
      exclusionRulesList = [];
    }
    // --- FIN: Lógica de Reglas de Exclusión ---

    // Ahora retornamos el objeto de estado completo
    return {
      files: [],
      data: [],
      columns: [],
      pivotField: '',
      hasDuplicates: false,
      duplicateCount: 0,
      uniqueCount: 0,
      // <-- Asegurarse que esté (fix v6.5.1)
      processingMode: '',
      normalizedFields: [],
      uniqueFields: [],
      phoneFields: {},
      horizontalDuplicateCount: 0,
      columnRules: [],
      transformRules: [],
      sortRules: [],
      prioritizeCellphones: false,
      campaign: '',
      baseName: '',
      baseMonth: '',
      baseSuffix: '',
      // --- CAMPOS ANTIGUOS ELIMINADOS v6.6 ---
      // exclusionFile: null,
      // exclusionData: [],
      // exclusionPivot: '',

      // --- NUEVO CAMPO v6.6 ---
      exclusionRules: exclusionRulesList,
      filters: [],
      processedData: [],
      campaigns: campaignsList // Usar la variable definida arriba
    };
  };

  // Main App Component
  function App() {
    const [currentStep, setCurrentStep] = useState(1);

    // CAMBIO v6: Usar la función getInitialState
    const [appData, setAppData] = useState(getInitialState());

    // --- CONEXIÓN A BASE DE DATOS NEXUS ---
    useEffect(() => {
      const loadFromNexus = async () => {
        try {
          // 1. Cargar Campañas
          const dbCampaigns = await db.getAll('campaigns');
          if (dbCampaigns && dbCampaigns.length > 0) {
            // Adaptamos el formato de Nexus ({code, name}) al formato de esta App ({name, client})
            const formatted = dbCampaigns.map(c => ({
              name: c.name,
              client: 'NEXUS_DB'
            }));
            setAppData(prev => ({
              ...prev,
              campaigns: formatted
            }));
          }

          // 2. Auto-Corrección Visual (Tarjeta Verde)
          const modules = await db.getAll('modules');

          // Filtramos TODOS los que contengan "Depurar Bases" para no depender del "V2"
          const depuradores = modules.filter(m => m.title && m.title.includes('Depurar Bases'));
          for (const me of depuradores) {
            if (me.color !== 'bg-emerald-600' || me.icon !== 'filter') {
              me.color = 'bg-emerald-600';
              me.icon = 'filter';
              await db.addOrUpdate('modules', [me]);
            }
          }
        } catch (e) {
          console.error("Error conectando a Nexus DB:", e);
        }
      };
      loadFromNexus();
    }, []);
    // --------------------------------------

    const updateAppData = updates => {
      // --- NUEVO v6.4: Persistencia de Campañas ---
      if (updates.campaigns) {
        try {
          // Guardar la nueva lista de campañas en localStorage
          localStorage.setItem('depurador_campaigns', JSON.stringify(updates.campaigns));
        } catch (e) {
          console.error("Error saving campaigns to localStorage", e);
        }
      }

      // --- NUEVO v6.6: Persistencia de Reglas de Exclusión ---
      if (updates.exclusionRules) {
        try {
          localStorage.setItem('depurador_exclusion_rules', JSON.stringify(updates.exclusionRules));
        } catch (e) {
          console.error("Error saving exclusion rules to localStorage", e);
        }
      }
      // --- FIN NUEVO ---

      setAppData(prev => ({
        ...prev,
        ...updates
      }));
    };
    const goToStep = step => {
      setCurrentStep(step);
    };

    // MODIFICADO v7: Lógica de navegación actualizada (FIX v6.4.1)
    const nextStep = () => {
      let next = currentStep + 1;

      // La lógica del Paso 3 ya no está aquí, se maneja en el componente

      // El 'else if' original del Paso 3 fue eliminado,
      // y el 'else if' del Paso 4 ahora es un 'if'.
      if (currentStep === 4 && appData.processingMode !== 'normalize') {
        next = 6; // Saltar 5
      } else if (currentStep === 5) {
        next = 6;
      } else if (currentStep === 6) {
        next = 6.6; // Ir a limpieza de basura
      } else if (currentStep === 6.6) {
        next = 7; // Ir a campaña
      } else if (currentStep === 7) {
        next = 8; // Ir a exclusiones
      } else if (currentStep === 8) {
        next = 9; // Ir a Creador de Columnas
      } else if (currentStep === 9) {
        next = 10; // Ir a Filtros
      } else if (currentStep === 10) {
        next = 11; // Ir a Ordenar (NUEVO)
      } else if (currentStep === 11) {
        next = 12; // Ir a Reportes
      } else if (currentStep === 12) {
        next = 13; // Ir a Exportar
      }
      setCurrentStep(next);
    };

    // MODIFICADO v7: Lógica de navegación actualizada
    const prevStep = () => {
      let prev = currentStep - 1;
      if (currentStep === 13) {
        prev = 12; // Volver a Reportes
      } else if (currentStep === 12) {
        prev = 11; // Volver a Ordenar (NUEVO)
      } else if (currentStep === 11) {
        prev = 10; // Volver a Filtros
      } else if (currentStep === 10) {
        prev = 9; // Volver a Creador de Columnas
      } else if (currentStep === 9) {
        prev = 8; // Volver a Exclusiones
      } else if (currentStep === 8) {
        prev = 7; // Volver a Campaña
      } else if (currentStep === 7) {
        prev = 6.6; // Volver a limpieza de basura
      } else if (currentStep === 6.6) {
        prev = 6; // Volver a teléfonos
      } else if (currentStep === 6) {
        if (appData.processingMode === 'normalize') {
          prev = 5; // Volver a normalización
        } else if (appData.hasDuplicates) {
          prev = 4; // Volver a modo de procesamiento
        } else {
          prev = 3; // Volver a pivote
        }
      } else if (currentStep === 5) {
        prev = 4;
      } else if (currentStep === 4) {
        prev = 3;
      } else if (currentStep === 3) {
        prev = 2;
      } else if (currentStep === 2) {
        prev = 1;
      }
      setCurrentStep(prev);
    };

    // --- NUEVO v6: Función de Reset (MEJORADA v6.9) ---
    const handleResetApp = (confirm = true) => {
      // Añadido 'confirm'
      const doReset = () => {
        try {
          // Limpiar la memoria persistente (SOLO REGLAS, MANTIENE CAMPAÑAS)
          localStorage.removeItem('depurador_exclusion_rules');
        } catch (e) {
          console.error("Error clearing localStorage", e);
        }

        // Resetear el estado de React
        setAppData(getInitialState());
        setCurrentStep(1);
      };
      if (confirm) {
        // Mensaje actualizado
        if (window.confirm("¿Estás seguro de que deseas reiniciar todo el proceso? Se perderán las reglas de exclusión guardadas (tus campañas se mantendrán).")) {
          doReset();
        }
      } else {
        // Si confirm=false, reiniciar sin preguntar (para el botón de 'Descargar y Reiniciar')
        doReset();
      }
    };
    return /*#__PURE__*/React.createElement("div", {
      className: "app-container"
    }, /*#__PURE__*/React.createElement(Header, {
      onReset: handleResetApp
    }), /*#__PURE__*/React.createElement(ProgressBar, {
      currentStep: currentStep
    }), /*#__PURE__*/React.createElement("div", {
      className: "main-content"
    }, currentStep === 1 && /*#__PURE__*/React.createElement(Step1FileUpload, {
      appData: appData,
      updateAppData: updateAppData,
      nextStep: nextStep
    }), currentStep === 2 && /*#__PURE__*/React.createElement(Step2Preview, {
      appData: appData,
      updateAppData: updateAppData,
      nextStep: nextStep,
      prevStep: prevStep
    }), currentStep === 3 && /*#__PURE__*/React.createElement(Step3PivotField, {
      appData: appData,
      updateAppData: updateAppData,
      nextStep: nextStep,
      prevStep: prevStep,
      goToStep: goToStep
    }), currentStep === 4 && /*#__PURE__*/React.createElement(Step4ProcessingMode, {
      appData: appData,
      updateAppData: updateAppData,
      nextStep: nextStep,
      prevStep: prevStep
    }), currentStep === 5 && /*#__PURE__*/React.createElement(Step5Normalization, {
      appData: appData,
      updateAppData: updateAppData,
      nextStep: nextStep,
      prevStep: prevStep
    }), currentStep === 6 && /*#__PURE__*/React.createElement(Step6Phones, {
      appData: appData,
      updateAppData: updateAppData,
      nextStep: nextStep,
      prevStep: prevStep
    }), currentStep === 6.6 && /*#__PURE__*/React.createElement(Step6p6JunkPhones, {
      appData: appData,
      updateAppData: updateAppData,
      nextStep: nextStep,
      prevStep: prevStep
    }), currentStep === 7 && /*#__PURE__*/React.createElement(Step7Campaign, {
      appData: appData,
      updateAppData: updateAppData,
      nextStep: nextStep,
      prevStep: prevStep
    }), currentStep === 8 && /*#__PURE__*/React.createElement(Step8Exclusions, {
      appData: appData,
      updateAppData: updateAppData,
      nextStep: nextStep,
      prevStep: prevStep
    }), currentStep === 9 && /*#__PURE__*/React.createElement(Step9ColumnBuilder, {
      appData: appData,
      updateAppData: updateAppData,
      nextStep: nextStep,
      prevStep: prevStep
    }), currentStep === 10 && /*#__PURE__*/React.createElement(Step10Filters, {
      appData: appData,
      updateAppData: updateAppData,
      nextStep: nextStep,
      prevStep: prevStep
    }), currentStep === 11 && /*#__PURE__*/React.createElement(Step11Sorting, {
      appData: appData,
      updateAppData: updateAppData,
      nextStep: nextStep,
      prevStep: prevStep
    }), currentStep === 12 && /*#__PURE__*/React.createElement(Step12Reports, {
      appData: appData,
      updateAppData: updateAppData,
      nextStep: nextStep,
      prevStep: prevStep
    }), currentStep === 13 && /*#__PURE__*/React.createElement(Step13Export, {
      appData: appData,
      updateAppData: updateAppData,
      prevStep: prevStep,
      onReset: () => handleResetApp(false)
    })));
  }

  // Header Component
  // CAMBIO v6: Modificado para aceptar y usar onReset
  function Header({
    onReset
  }) {
    return /*#__PURE__*/React.createElement("div", {
      className: "header"
    }, /*#__PURE__*/React.createElement("div", {
      className: "header-content"
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "\uD83D\uDCCA DEPURADOR DE BASES CALL CENTER"), /*#__PURE__*/React.createElement("div", {
      className: "header-subtitle"
    }, "por Darwin Diamon ")), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-error",
      style: {
        padding: '0.6rem 1rem'
      },
      onClick: onReset,
      title: "Reiniciar todo el proceso"
    }, "\uD83D\uDD04 Reiniciar Proceso")));
  }

  // Progress Bar Component
  function ProgressBar({
    currentStep
  }) {
    // CAMBIO v7: Añadido Paso 11 (Ordenar) y re-numerado el resto
    const steps = [{
      num: 1,
      label: "Carga",
      icon: "📁"
    }, {
      num: 2,
      label: "Validación",
      icon: "✓"
    }, {
      num: 3,
      label: "Pivote",
      icon: "🔑"
    }, {
      num: 6,
      label: "Teléfonos",
      icon: "📞"
    }, {
      num: 7,
      label: "Campaña",
      icon: "🏷️"
    }, {
      num: 8,
      label: "Exclusiones",
      icon: "🚫"
    }, {
      num: 9,
      label: "Columnas",
      icon: "✨"
    }, {
      num: 10,
      label: "Filtros",
      icon: "⚙️"
    }, {
      num: 11,
      label: "Ordenar",
      icon: "↕️"
    },
    // NUEVO
    {
      num: 12,
      label: "Reportes",
      icon: "📊"
    },
    // Re-numerado
    {
      num: 13,
      label: "Exportar",
      icon: "⬇️"
    } // Re-numerado
    ];
    const mainStep = Math.floor(currentStep);
    const stepToFind = mainStep === 6.6 ? 6 : mainStep;
    const mainStepIndex = steps.findIndex(s => s.num === stepToFind);
    let progress = 0;
    if (mainStepIndex !== -1) {
      progress = mainStepIndex / (steps.length - 1) * 100;
    }
    return /*#__PURE__*/React.createElement("div", {
      className: "progress-container"
    }, /*#__PURE__*/React.createElement("div", {
      className: "progress-bar"
    }, /*#__PURE__*/React.createElement("div", {
      className: "progress-line"
    }), /*#__PURE__*/React.createElement("div", {
      className: "progress-line-filled",
      style: {
        width: `${progress}%`
      }
    }), steps.map(step => {
      const isActive = Math.floor(currentStep) === step.num || step.num === 6 && currentStep === 6.6;
      const isCompleted = currentStep > step.num;
      return /*#__PURE__*/React.createElement("div", {
        key: step.num,
        className: `progress-step ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`
      }, /*#__PURE__*/React.createElement("div", {
        className: "progress-step-circle"
      }, currentStep > step.num ? '✓' : step.icon), /*#__PURE__*/React.createElement("div", {
        className: "progress-step-label"
      }, step.label));
    })));
  }

  // --- INICIO LÓGICA DE PROCESAMIENTO ---
  const eliminateDuplicatesReal = (data, pivotField) => {
    const seen = {};
    const result = [];
    for (let i = 0; i < data.length; i++) {
      const key = String(data[i][pivotField] || '').trim();
      if (!seen[key]) {
        seen[key] = true;
        result.push(data[i]);
      }
    }
    return result;
  };
  // --- FIN LÓGICA DE PROCESAMIENTO ---

  // --- INICIO LÓGICA DE RUT (NUEVO) ---
  function cleanRut(rut) {
    // Limpia un string de RUT, dejando solo números y la letra K
    if (typeof rut !== 'string') return '';
    return rut.replace(/[^0-9kK]/g, '').toUpperCase();
  }
  function calculateDV(rut) {
    // Calcula el DV a partir de un número de RUT (ej. 12345678)
    const rutLimpio = String(rut).replace(/[^0-9]/g, ''); // Solo números
    if (rutLimpio.length < 1) return '';
    let M = 0,
      S = 1;
    for (; M < rutLimpio.length; M++) {
      S = (S + rutLimpio.charAt(rutLimpio.length - 1 - M) * (9 - M % 6)) % 11;
    }
    return S ? String(S - 1) : 'K';
  }
  // --- FIN LÓGICA DE RUT (NUEVO) ---

  // --- INICIO LÓGICA DE TRANSFORMACIÓN (NUEVO v6.3) ---
  function applyTransform(value, rule) {
    const strValue = String(value || '');
    switch (rule.transformType) {
      case 'static':
        return rule.staticValue;
      case 'extract_number':
        // \d+ (uno o más dígitos). Esto captura '3', '10', '125', etc.
        const match = strValue.match(/\d+/);
        const extracted = match ? match[0] : '';
        // NUEVO: Convertir a número si la regla lo indica (por defecto es true)
        if (rule.convertToNumber !== false && extracted !== '') {
          return Number(extracted);
        }
        return extracted;
      case 'substring':
        const start = parseInt(rule.subStart, 10) || 0;
        const length = parseInt(rule.subLength, 10);
        if (!isNaN(length) && length > 0) {
          return strValue.substring(start, start + length);
        }
        return strValue.substring(start);
      // Si no hay largo, hasta el final

      case 'before_char':
        if (!rule.char) return strValue;
        const indexBefore = strValue.indexOf(rule.char);
        // Si no lo encuentra, devuelve el string original
        return indexBefore !== -1 ? strValue.substring(0, indexBefore) : strValue;
      case 'after_char':
        if (!rule.char) return strValue;
        const indexAfter = strValue.indexOf(rule.char);
        // Si no lo encuentra, devuelve el string original
        return indexAfter !== -1 ? strValue.substring(indexAfter + rule.char.length) : strValue;
      case 'copy':
      default:
        return strValue;
    }
  }
  // --- FIN LÓGICA DE TRANSFORMACIÓN (NUEVO v6.3) ---

  // --- INICIO LÓGICA DE CRITERIOS (NUEVO v6.7.2) ---
  function checkCriteria(cellValue, criteria) {
    const {
      operator,
      values,
      value
    } = criteria;
    const cell = String(cellValue || '').trim();
    const filterVal = String(value || '').trim();

    // Operadores de Texto (para 'es_igual_a', 'contiene', etc.)
    switch (operator) {
      case 'es_uno_de':
        return new Set(values).has(cell);
      case 'no_es_uno_de':
        return !new Set(values).has(cell);
      case 'es_igual_a':
        return cell === filterVal;
      case 'no_es_igual_a':
        return cell !== filterVal;
      case 'contiene':
        if (filterVal === '') return false;
        return cell.includes(filterVal);
      case 'no_contiene':
        if (filterVal === '') return false;
        return !cell.includes(filterVal);
      case 'empieza_con':
        return cell.startsWith(filterVal);
      case 'termina_con':
        return cell.endsWith(filterVal);
    }

    // Operadores Numéricos (para 'mayor_que', 'menor_que', etc.)
    const cellNum = parseFloat(cell.replace(/[^0-9,.-]/g, '')); // Limpiar un poco más
    const filterNum = parseFloat(filterVal.replace(/[^0-9,.-]/g, ''));

    // Si el operador es numérico pero los valores no lo son, no hay match
    if (isNaN(cellNum) || isNaN(filterNum)) {
      return false;
    }
    switch (operator) {
      case 'mayor_que':
        return cellNum > filterNum;
      case 'menor_que':
        return cellNum < filterNum;
      case 'mayor_igual_que':
        return cellNum >= filterNum;
      case 'menor_igual_que':
        return cellNum <= filterNum;
      default:
        return false;
    }
  }
  // --- FIN LÓGICA DE CRITERIOS ---

  // ========================================================================
  // COMPONENTE: Panel de Diagnóstico de Conflictos de Estructura
  // ========================================================================
  const PanelDiagnosticoConflicto = ({
    conflictState,
    rawFiles,
    onMapear,
    onCancelar,
    guideFileName,
    onChangeGuide
  }) => {
    const {
      baseColumns,
      mismatchedFiles,
      matchedFiles
    } = conflictState;
    const allFiles = [...(matchedFiles || []), ...(mismatchedFiles || [])];
    const totalFiles = allFiles.length;

    // --- Mapa de presencia: col → Set de nombres de archivos que la tienen ---
    const colPresenceMap = {};
    allFiles.forEach(f => {
      f.columns.forEach(col => {
        if (!colPresenceMap[col]) colPresenceMap[col] = new Set();
        colPresenceMap[col].add(f.name);
      });
    });
    const colsEnTodos = Object.entries(colPresenceMap).filter(([, files]) => files.size === totalFiles).map(([col]) => col).sort();
    const colsFaltantes = baseColumns.filter(col => colPresenceMap[col] && colPresenceMap[col].size < totalFiles).map(col => ({
      col,
      falta_en: allFiles.filter(f => !f.columns.includes(col)).map(f => f.name)
    }));
    const colsExtras = Object.entries(colPresenceMap).filter(([col]) => !baseColumns.includes(col)).map(([col, files]) => ({
      col,
      presente_en: Array.from(files)
    }));
    const [expandido, setExpandido] = useState(false);

    // Helper: genera texto del tooltip para una columna
    const tooltipText = col => {
      const enTodos = colPresenceMap[col] && colPresenceMap[col].size === totalFiles;
      if (enTodos) return `✅ Presente en todos los archivos (${totalFiles}/${totalFiles})`;
      const presentes = colPresenceMap[col] ? Array.from(colPresenceMap[col]) : [];
      const ausentes = allFiles.map(f => f.name).filter(n => !presentes.includes(n));
      const lines = [`📊 Presente en ${presentes.length}/${totalFiles} archivos`, presentes.length ? `\n✓ Con esta col:\n${presentes.map(n => '  · ' + n.replace(/\.[^.]+$/, '')).join('\n')}` : '', ausentes.length ? `\n✗ Sin esta col:\n${ausentes.map(n => '  · ' + n.replace(/\.[^.]+$/, '')).join('\n')}` : ''];
      return lines.filter(Boolean).join('');
    };

    // Badge con tooltip
    const ColBadge = ({
      col,
      bgColor,
      textColor
    }) => /*#__PURE__*/React.createElement("span", {
      className: "col-tooltip-wrap"
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        background: bgColor,
        color: textColor,
        fontSize: '0.72rem',
        fontFamily: 'monospace',
        padding: '2px 6px',
        borderRadius: 4,
        cursor: 'help'
      }
    }, col), /*#__PURE__*/React.createElement("span", {
      className: "col-tooltip"
    }, tooltipText(col)));
    return /*#__PURE__*/React.createElement("div", {
      style: {
        border: '2px solid #f59e0b',
        borderRadius: 12,
        overflow: 'hidden',
        marginBottom: '1rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#fffbeb',
        padding: '1rem 1.25rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '1.2rem'
      }
    }, "\u26A0\uFE0F"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 800,
        color: '#b45309',
        fontSize: '0.95rem'
      }
    }, "Estructuras Diferentes Detectadas"), /*#__PURE__*/React.createElement("div", {
      style: {
        color: '#92400e',
        fontSize: '0.78rem',
        marginTop: 2
      }
    }, mismatchedFiles.length, " de ", totalFiles, " archivos difieren \xB7 ", colsEnTodos.length, " col. comunes \xB7 ", colsFaltantes.length + colsExtras.length, " col. con diferencias"))), /*#__PURE__*/React.createElement("button", {
      onClick: () => setExpandido(p => !p),
      style: {
        background: 'white',
        border: '1px solid #f59e0b',
        borderRadius: 6,
        padding: '4px 10px',
        fontSize: '0.75rem',
        fontWeight: 700,
        color: '#b45309',
        cursor: 'pointer'
      }
    }, expandido ? '▲ Ocultar análisis' : '▼ Ver análisis detallado')), /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#fef9c3',
        borderTop: '1px solid #fde68a',
        padding: '0.65rem 1.25rem',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.8rem',
        fontWeight: 700,
        color: '#92400e'
      }
    }, "\uD83D\uDCD0 Archivo gu\xEDa:"), /*#__PURE__*/React.createElement("select", {
      style: {
        border: '1px solid #f59e0b',
        borderRadius: 6,
        padding: '3px 8px',
        fontSize: '0.78rem',
        background: 'white',
        color: '#374151',
        fontWeight: 600,
        cursor: 'pointer'
      },
      value: guideFileName || '',
      onChange: e => onChangeGuide(e.target.value || null)
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "\uD83D\uDD22 Autom\xE1tico (estructura mayoritaria)"), allFiles.map(f => /*#__PURE__*/React.createElement("option", {
      key: f.name,
      value: f.name
    }, f.name.replace(/\.[^.]+$/, ''), " \u2014 ", f.columns.length, " cols"))), guideFileName ? /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.72rem',
        color: '#b45309'
      }
    }, "Comparando todo vs. este archivo") : /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '0.72rem',
        color: '#92400e'
      }
    }, "El template es la estructura que m\xE1s se repite entre los archivos")), expandido && /*#__PURE__*/React.createElement("div", {
      style: {
        background: 'white',
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '0.8rem',
        color: '#6b7280',
        background: '#f8fafc',
        padding: '0.5rem 0.75rem',
        borderRadius: 6,
        border: '1px solid #e2e8f0'
      }
    }, "\uD83D\uDCD0 ", /*#__PURE__*/React.createElement("strong", null, "Template activo:"), " ", guideFileName ? guideFileName.replace(/\.[^.]+$/, '') : 'Estructura mayoritaria', " \u2014 ", baseColumns.length, " columnas", /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: 8,
        color: '#9ca3af',
        fontSize: '0.7rem'
      }
    }, "(pasa el cursor sobre cualquier columna para ver en qu\xE9 archivos est\xE1 presente)")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '0.75rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        border: '1px solid #d1fae5',
        borderRadius: 8,
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#ecfdf5',
        padding: '0.5rem 0.75rem',
        fontWeight: 700,
        fontSize: '0.8rem',
        color: '#065f46'
      }
    }, "\u2705 Comunes en todos (", colsEnTodos.length, ")"), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '0.5rem 0.75rem',
        maxHeight: 130,
        overflowY: 'auto',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4
      }
    }, colsEnTodos.length === 0 ? /*#__PURE__*/React.createElement("span", {
      style: {
        color: '#9ca3af',
        fontSize: '0.75rem'
      }
    }, "Ninguna columna es igual en todos") : colsEnTodos.map(c => /*#__PURE__*/React.createElement(ColBadge, {
      key: c,
      col: c,
      bgColor: "#d1fae5",
      textColor: "#065f46"
    })))), /*#__PURE__*/React.createElement("div", {
      style: {
        border: '1px solid #fde68a',
        borderRadius: 8,
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#fef9c3',
        padding: '0.5rem 0.75rem',
        fontWeight: 700,
        fontSize: '0.8rem',
        color: '#92400e'
      }
    }, "\u26A0\uFE0F Del template, ausentes en algunos (", colsFaltantes.length, ")"), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '0.5rem 0.75rem',
        maxHeight: 130,
        overflowY: 'auto',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4
      }
    }, colsFaltantes.length === 0 ? /*#__PURE__*/React.createElement("span", {
      style: {
        color: '#9ca3af',
        fontSize: '0.75rem'
      }
    }, "Ninguna falta") : colsFaltantes.map(({
      col
    }) => /*#__PURE__*/React.createElement(ColBadge, {
      key: col,
      col: col,
      bgColor: "#fde68a",
      textColor: "#92400e"
    })))), /*#__PURE__*/React.createElement("div", {
      style: {
        border: '1px solid #fecaca',
        borderRadius: 8,
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#fef2f2',
        padding: '0.5rem 0.75rem',
        fontWeight: 700,
        fontSize: '0.8rem',
        color: '#991b1b'
      }
    }, "\uD83D\uDD34 Extras (fuera del template) (", colsExtras.length, ")"), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '0.5rem 0.75rem',
        maxHeight: 130,
        overflowY: 'auto',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4
      }
    }, colsExtras.length === 0 ? /*#__PURE__*/React.createElement("span", {
      style: {
        color: '#9ca3af',
        fontSize: '0.75rem'
      }
    }, "Sin columnas extra") : colsExtras.map(({
      col
    }) => /*#__PURE__*/React.createElement(ColBadge, {
      key: col,
      col: col,
      bgColor: "#fecaca",
      textColor: "#991b1b"
    }))))), mismatchedFiles.length > 0 && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 700,
        fontSize: '0.82rem',
        color: '#374151',
        marginBottom: 6
      }
    }, "\uD83D\uDDC2\uFE0F Detalle por archivo conflictivo:"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 6
      }
    }, mismatchedFiles.map((f, idx) => {
      const faltanEnEste = baseColumns.filter(c => !f.columns.includes(c));
      const sobranEnEste = f.columns.filter(c => !baseColumns.includes(c));
      return /*#__PURE__*/React.createElement("div", {
        key: idx,
        style: {
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 8,
          padding: '0.6rem 0.85rem'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontWeight: 700,
          fontSize: '0.78rem',
          color: '#991b1b',
          marginBottom: 4
        }
      }, "\u26A0\uFE0F ", f.name), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          gap: '1rem',
          flexWrap: 'wrap'
        }
      }, faltanEnEste.length > 0 && /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          gap: 3,
          alignItems: 'center',
          flexWrap: 'wrap'
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: '0.7rem',
          color: '#6b7280'
        }
      }, "Faltan: "), faltanEnEste.map(c => /*#__PURE__*/React.createElement(ColBadge, {
        key: c,
        col: c,
        bgColor: "#fde68a",
        textColor: "#92400e"
      }))), sobranEnEste.length > 0 && /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          gap: 3,
          alignItems: 'center',
          flexWrap: 'wrap'
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: '0.7rem',
          color: '#6b7280'
        }
      }, "Sobran: "), sobranEnEste.map(c => /*#__PURE__*/React.createElement(ColBadge, {
        key: c,
        col: c,
        bgColor: "#fecaca",
        textColor: "#991b1b"
      })))));
    })))), /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#fffbeb',
        borderTop: '1px solid #fde68a',
        padding: '0.75rem 1.25rem',
        display: 'flex',
        gap: '0.5rem',
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: onMapear,
      style: {
        fontSize: '0.85rem'
      }
    }, "\uD83D\uDEE0\uFE0F Mapear y Homologar"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-error",
      onClick: onCancelar,
      style: {
        fontSize: '0.85rem'
      }
    }, "\u274C Cancelar Carga")));
  };

  // Step 1: File Upload (MEJORADO: Filtro de Encabezados y Filas Vacías)
  function Step1FileUpload({
    appData,
    updateAppData,
    nextStep
  }) {
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // OPCIÓN DE CONTROL: Activada por defecto
    const [removeRepeatedHeaders, setRemoveRepeatedHeaders] = useState(true);
    const [sqlMode, setSqlMode] = useState(false);
    const [sqlQuery, setSqlQuery] = useState('');
    const fileInputRef = useRef(null);

    // --- NUEVOS ESTADOS PARA MAPEO Y CONFLICTOS ---
    const [rawFiles, setRawFiles] = useState([]); // Guarda los archivos parseados temporalmente
    const [conflictState, setConflictState] = useState({
      hasConflict: false,
      baseColumns: [],
      mismatchedFiles: [],
      matchedFiles: []
    });
    const [showMappingModal, setShowMappingModal] = useState(false);
    // Archivo guía: nombre del archivo cuya estructura se usa como plantilla
    const [guideFileName, setGuideFileName] = useState(null);
    // ----------------------------------------------

    // --- ESTADOS PARA MULTI-HOJAS Y ARCHIVOS PROTEGIDOS ---
    const [pendientesHojas, setPendientesHojas] = useState([]);
    const [sheetSelections, setSheetSelections] = useState({});
    const [protectedFiles, setProtectedFiles] = useState([]);
    const [passwords, setPasswords] = useState({});
    const [pendingFiles, setPendingFiles] = useState([]);
    // ----------------------------------------------

    // --- INICIO LÓGICA DE MAPEO (PASO 4) ---
    const [mappingRules, setMappingRules] = useState([]);
    const addMappingRule = type => {
      setMappingRules(prev => [...prev, {
        id: Date.now() + Math.random(),
        type: type,
        // 'rename', 'concat', 'static', 'conditional', 'drop'
        targetColumn: '',
        // Nombre de la columna final
        sourceColumn: '',
        // Para rename, drop o condicional
        sourceColumns: [],
        // Para concat (múltiples columnas)
        separator: ' ',
        // Para concat
        staticValue: '',
        // Para static
        condOperator: '==',
        // Para condicional
        condValue: '',
        trueValue: '',
        falseValue: ''
      }]);
    };
    const removeMappingRule = id => {
      setMappingRules(prev => prev.filter(r => r.id !== id));
    };
    const updateMappingRule = (id, field, value) => {
      setMappingRules(prev => prev.map(r => r.id === id ? {
        ...r,
        [field]: value
      } : r));
    };

    // Función para obtener todas las columnas únicas de TODOS los archivos cargados
    const getAvailableColumns = () => {
      const cols = new Set();
      rawFiles.forEach(f => f.columns.forEach(c => cols.add(c)));
      return Array.from(cols).sort();
    };

    // ====================================================================
    // CONFIRMAR SELECCIÓN DE HOJAS Y REPROCESAR
    // ====================================================================
    const confirmarHojas = selecciones => {
      const newSelections = {
        ...sheetSelections,
        ...selecciones
      };
      setSheetSelections(newSelections);
      setPendientesHojas([]);

      // Reprocesar archivos con las selecciones actualizadas
      if (pendingFiles.length > 0) {
        const filesToProcess = pendingFiles;
        setPendingFiles([]);
        setTimeout(async () => {
          setLoading(true);
          let parsedFiles = [];
          let blocked = [];
          for (const file of filesToProcess) {
            try {
              const pending = pendientesHojas.find(p => p.name === file.name);
              let result;
              if (pending && pending.wb) {
                const targetSheet = newSelections[file.name] || pending.wb.SheetNames[0];
                const ws = pending.wb.Sheets[targetSheet];
                const headers = XLSX.utils.sheet_to_json(ws, {
                  header: 1
                })[0] || [];
                const data = XLSX.utils.sheet_to_json(ws, {
                  defval: ''
                });
                result = {
                  multiSheet: false,
                  data,
                  columns: headers
                };
              } else {
                result = await leerExcelConHojas(file, newSelections[file.name] || null, passwords[file.name] || null);
              }
              if (result.multiSheet) continue;
              if (result.data && result.data.length > 0) {
                const fileColumns = result.columns.map(c => String(c).trim().toUpperCase());
                const upperData = result.data.map(row => {
                  const newRow = {};
                  result.columns.forEach(origCol => {
                    newRow[String(origCol).trim().toUpperCase()] = row[origCol];
                  });
                  return newRow;
                });
                parsedFiles.push({
                  file,
                  name: file.name,
                  columns: fileColumns,
                  data: upperData
                });
              }
            } catch (err) {
              blocked.push({
                name: file.name,
                file
              });
            }
          }
          if (blocked.length > 0) {
            setProtectedFiles(blocked);
            setPendingFiles(filesToProcess);
            setLoading(false);
            return;
          }
          if (parsedFiles.length === 0) {
            setError('No se pudieron cargar archivos');
            setLoading(false);
            return;
          }
          setRawFiles(parsedFiles);
          setFiles(filesToProcess);
          const {
            guideColumns,
            matchedFiles,
            mismatchedFiles
          } = calcularEstructuraGuia(parsedFiles, guideFileName);
          if (mismatchedFiles.length > 0) {
            setConflictState({
              hasConflict: true,
              baseColumns: guideColumns,
              matchedFiles,
              mismatchedFiles
            });
            setLoading(false);
          } else {
            setConflictState({
              hasConflict: false,
              baseColumns: [],
              mismatchedFiles: [],
              matchedFiles: []
            });
            processAndMergeFiles(parsedFiles, guideColumns, filesToProcess);
          }
        }, 50);
      }
    };

    // ====================================================================
    // DESBLOQUEAR ARCHIVOS PROTEGIDOS Y REPROCESAR
    // ====================================================================
    const desbloquearArchivos = passwordsFromUI => {
      const newPasswords = {
        ...passwords,
        ...passwordsFromUI
      };
      setPasswords(newPasswords);
      setProtectedFiles([]);
      setError('');

      // Reprocesar archivos con las contraseñas actualizadas
      if (pendingFiles.length > 0) {
        const filesToProcess = pendingFiles;
        setPendingFiles([]);
        setTimeout(async () => {
          setLoading(true);
          let parsedFiles = [];
          let multiSheetPending = [];
          let stillBlocked = [];
          for (const file of filesToProcess) {
            try {
              const result = await leerExcelConHojas(file, sheetSelections[file.name] || null, newPasswords[file.name] || null);
              if (result.multiSheet) {
                multiSheetPending.push({
                  name: file.name,
                  file,
                  sheetNames: result.sheetNames,
                  wb: result.wb
                });
                continue;
              }
              if (result.data && result.data.length > 0) {
                const fileColumns = result.columns.map(c => String(c).trim().toUpperCase());
                const upperData = result.data.map(row => {
                  const newRow = {};
                  result.columns.forEach(origCol => {
                    newRow[String(origCol).trim().toUpperCase()] = row[origCol];
                  });
                  return newRow;
                });
                parsedFiles.push({
                  file,
                  name: file.name,
                  columns: fileColumns,
                  data: upperData
                });
              }
            } catch (err) {
              stillBlocked.push({
                name: file.name,
                file
              });
            }
          }
          if (multiSheetPending.length > 0) {
            setPendientesHojas(multiSheetPending);
            setPendingFiles(filesToProcess);
            setLoading(false);
            return;
          }
          if (stillBlocked.length > 0) {
            setProtectedFiles(stillBlocked);
            setPendingFiles(filesToProcess);
            setError(`${stillBlocked.length} archivo(s) con contraseña incorrecta`);
            setLoading(false);
            return;
          }
          if (parsedFiles.length === 0) {
            setError('No se pudieron cargar archivos');
            setLoading(false);
            return;
          }
          setRawFiles(parsedFiles);
          setFiles(filesToProcess);
          const {
            guideColumns,
            matchedFiles,
            mismatchedFiles
          } = calcularEstructuraGuia(parsedFiles, guideFileName);
          if (mismatchedFiles.length > 0) {
            setConflictState({
              hasConflict: true,
              baseColumns: guideColumns,
              matchedFiles,
              mismatchedFiles
            });
            setLoading(false);
          } else {
            setConflictState({
              hasConflict: false,
              baseColumns: [],
              mismatchedFiles: [],
              matchedFiles: []
            });
            processAndMergeFiles(parsedFiles, guideColumns, filesToProcess);
          }
        }, 50);
      }
    };

    // ====================================================================
    // CANCELAR OPERACIÓN DE HOJAS O CONTRASEÑAS
    // ====================================================================
    const cancelarOperacion = () => {
      setPendientesHojas([]);
      setProtectedFiles([]);
      setPendingFiles([]);
      setSheetSelections({});
      setPasswords({});
      setError('');
      setLoading(false);
    };

    // --- INICIO MOTOR DE EJECUCIÓN (PASO 6) ---
    const applyMappingAndMerge = () => {
      setLoading(true);
      setShowMappingModal(false);

      // 1. Aplicar todas las reglas a los datos crudos en memoria
      const mappedFiles = rawFiles.map(fileObj => {
        const mappedData = fileObj.data.map(row => {
          let newRow = {
            ...row
          };
          mappingRules.forEach(rule => {
            // NUEVO: Lógica de Concatenación Temprana
            if (rule.type === 'concat' && rule.sourceColumns && rule.sourceColumns.length > 0 && rule.targetColumn) {
              const vals = rule.sourceColumns.map(col => String(newRow[col] || '').trim()).filter(v => v !== ''); // Evitamos concatenar vacíos si la columna no existe en este archivo

              // FIX: Asignar siempre el valor (incluso vacío) para que la columna nazca desde la primera fila
              newRow[rule.targetColumn] = vals.length > 0 ? vals.join(rule.separator || ' ') : '';

              // FIX: Eliminar originales siempre (independiente de si tenían datos o no en esta fila)
              if (!rule.keepOriginals) {
                rule.sourceColumns.forEach(col => {
                  if (col && col !== rule.targetColumn) delete newRow[col];
                });
              }
            } else if (rule.type === 'rename' && rule.sourceColumn && rule.targetColumn) {
              if (newRow[rule.sourceColumn] !== undefined) {
                newRow[rule.targetColumn] = newRow[rule.sourceColumn];
                delete newRow[rule.sourceColumn]; // Desecha el nombre viejo
              }
            } else if (rule.type === 'static' && rule.targetColumn) {
              newRow[rule.targetColumn] = rule.staticValue;
            } else if (rule.type === 'conditional' && rule.sourceColumn && rule.targetColumn) {
              const sourceVal = String(newRow[rule.sourceColumn] || '').trim().toUpperCase();
              let mappedValue = rule.falseValue;

              // Búsqueda tolerante a mayúsculas/minúsculas y espacios para evitar que el mapeo falle
              if (rule.valueMap) {
                const matchedKey = Object.keys(rule.valueMap).find(k => String(k).trim().toUpperCase() === sourceVal);
                if (matchedKey !== undefined && rule.valueMap[matchedKey] !== '') {
                  mappedValue = rule.valueMap[matchedKey];
                }
              }

              // Asignar el valor para asegurar que la columna exista desde la primera fila
              newRow[rule.targetColumn] = mappedValue || '';

              // Eliminar la columna original si no se debe conservar
              if (!rule.keepOriginals && rule.sourceColumn !== rule.targetColumn) {
                delete newRow[rule.sourceColumn];
              }
            } else if (rule.type === 'drop' && rule.sourceColumn) {
              delete newRow[rule.sourceColumn];
            }
          });
          return newRow;
        });

        // Extraer las nuevas columnas resultantes
        const newColumns = mappedData.length > 0 ? Object.keys(mappedData[0]) : [];
        return {
          ...fileObj,
          data: mappedData,
          columns: newColumns
        };
      });

      // 2. Validación Estructural Post-Mapeo
      const baseColumns = mappedFiles[0].columns;
      let stillHasConflict = false;
      for (let i = 1; i < mappedFiles.length; i++) {
        const fileCols = mappedFiles[i].columns;
        const isMatch = fileCols.length === baseColumns.length && fileCols.every(c => baseColumns.includes(c));
        if (!isMatch) {
          stillHasConflict = true;
          break;
        }
      }
      if (stillHasConflict) {
        alert('⚠️ Aún hay diferencias en la estructura de los archivos. Usa "Homologar" para igualar nombres o "Desechar" para quitar columnas sobrantes.');
        setLoading(false);
        setShowMappingModal(true); // Reabre el modal para seguir corrigiendo
        return;
      }

      // 3. Si todo cuadra, se envía al procesador original (Paso 2)
      setConflictState({
        hasConflict: false,
        baseColumns: [],
        mismatchedFiles: [],
        matchedFiles: []
      });
      processAndMergeFiles(mappedFiles, baseColumns, mappedFiles.map(f => f.file));
    };
    // --- FIN LÓGICA DE MAPEO (PASO 4 Y 6) ---

    // --- NUEVA LÓGICA DE PROCESAMIENTO Y FUSIÓN ---
    const processAndMergeFiles = (filesToProcess, finalColumns, filesMetadata) => {
      let allData = [];
      let headersRemovedCount = 0;
      const cols = finalColumns || (filesToProcess[0] ? filesToProcess[0].columns : []);
      filesToProcess.forEach(fileObj => {
        let cleanData = fileObj.data.map(row => {
          const newRow = {};
          cols.forEach(col => {
            let val = row[col];
            if (typeof val === 'string') {
              val = val.trim().replace(/\s+/g, ' ');
              const cleanNum = val.replace(',', '.');
              if (!isNaN(cleanNum) && val !== '' && (!val.startsWith('0') || val.startsWith('0.') || val === '0')) {
                val = Number(cleanNum);
              }
            }
            newRow[col] = val;
          });
          return newRow;
        });

        // --- FILTRO INTELIGENTE (ELIMINAR BASURA) ---
        const initialLength = cleanData.length;
        cleanData = cleanData.filter(row => {
          const isEmpty = Object.values(row).every(val => val === null || val === undefined || String(val).trim() === '');
          if (isEmpty) return false;
          if (removeRepeatedHeaders && allData.length > 0) {
            let matchCount = 0;
            let validFields = 0;
            Object.keys(row).forEach(key => {
              const val = String(row[key]).toUpperCase().trim();
              if (val) {
                validFields++;
                if (val === key) matchCount++;
              }
            });
            if (validFields > 0 && matchCount / validFields > 0.5) return false;
          }
          return true;
        });
        if (cleanData.length < initialLength) {
          headersRemovedCount += initialLength - cleanData.length;
        }
        allData = [...allData, ...cleanData];
      });
      if (headersRemovedCount > 0) {
        setTimeout(() => alert(`🛡️ Limpieza Nexus: Se eliminaron ${headersRemovedCount} filas (encabezados repetidos o filas vacías).`), 100);
      }
      updateAppData({
        files: filesMetadata,
        data: allData,
        columns: cols,
        processedData: []
      });
      setLoading(false);
    };

    // ====================================================================
    // UTILIDAD: Determinar estructura guía por mayoría o por elección manual
    // Devuelve { guideColumns, matchedFiles, mismatchedFiles }
    // ====================================================================
    const calcularEstructuraGuia = (parsedFiles, overrideGuideName = null) => {
      if (parsedFiles.length === 0) return {
        guideColumns: [],
        matchedFiles: [],
        mismatchedFiles: []
      };

      // Si el usuario fijó un archivo guía manualmente, usarlo directamente
      if (overrideGuideName) {
        const guideFile = parsedFiles.find(f => f.name === overrideGuideName);
        if (guideFile) {
          const guideCols = guideFile.columns;
          const matched = [],
            mismatched = [];
          parsedFiles.forEach(f => {
            const ok = f.columns.length === guideCols.length && f.columns.every(c => guideCols.includes(c));
            (ok ? matched : mismatched).push(f);
          });
          return {
            guideColumns: guideCols,
            matchedFiles: matched,
            mismatchedFiles: mismatched
          };
        }
      }

      // Mayoría: encontrar la estructura (fingerprint) más frecuente
      const fingerprints = {};
      parsedFiles.forEach(f => {
        const key = [...f.columns].sort().join('|');
        if (!fingerprints[key]) fingerprints[key] = {
          columns: f.columns,
          count: 0,
          firstName: f.name
        };
        fingerprints[key].count++;
      });
      const majority = Object.values(fingerprints).sort((a, b) => b.count - a.count)[0];
      const guideCols = majority.columns;
      const matched = [],
        mismatched = [];
      parsedFiles.forEach(f => {
        const ok = f.columns.length === guideCols.length && f.columns.every(c => guideCols.includes(c));
        (ok ? matched : mismatched).push(f);
      });
      return {
        guideColumns: guideCols,
        matchedFiles: matched,
        mismatchedFiles: mismatched
      };
    };

    // --- NUEVA LÓGICA DE LECTURA (DETECCIÓN DE CONFLICTOS) ---
    const handleFileSelect = async selectedFiles => {
      if (selectedFiles.length > 200) {
        setError('Máximo 200 archivos permitidos');
        return;
      }
      setLoading(true);
      setError('');
      try {
        const fileList = Array.from(selectedFiles);
        let parsedFiles = [];

        // --- FUNCIÓN DE LECTURA CON SOPORTE MULTI-HOJAS Y CONTRASEÑA ---
        const readFileLocal = async (f, sheetName, password) => {
          try {
            const result = await leerExcelConHojas(f, sheetName, password);
            if (result.multiSheet) {
              return {
                multiSheet: true,
                sheetNames: result.sheetNames,
                name: f.name,
                file: f
              };
            }
            return {
              data: result.data,
              name: f.name,
              columns: result.columns,
              file: f
            };
          } catch (err) {
            // Si falla, puede ser archivo protegido
            return {
              error: true,
              name: f.name,
              file: f,
              message: err.message
            };
          }
        };
        let multiSheetPending = [];
        let blocked = [];
        for (const file of fileList) {
          const result = await readFileLocal(file, sheetSelections[file.name] || null, passwords[file.name] || null);
          if (result.multiSheet) {
            multiSheetPending.push({
              name: result.name,
              file: result.file,
              sheetNames: result.sheetNames,
              wb: result.wb
            });
            continue;
          }
          if (result.error) {
            blocked.push({
              name: result.name,
              file: result.file
            });
            continue;
          }
          if (!result.data || result.data.length === 0) continue;
          const fileColumns = result.columns.map(c => String(c).trim().toUpperCase());
          const fileDataObj = {
            file: result.file,
            name: result.name,
            columns: fileColumns,
            data: []
          };
          const upperData = result.data.map(row => {
            const newRow = {};
            result.columns.forEach(origCol => {
              newRow[String(origCol).trim().toUpperCase()] = row[origCol];
            });
            return newRow;
          });
          fileDataObj.data = upperData;
          parsedFiles.push(fileDataObj);
        }

        // --- SI HAY ARCHIVOS CON MÚLTIPLES HOJAS, PAUSAR ---
        if (multiSheetPending.length > 0) {
          setPendientesHojas(multiSheetPending);
          setPendingFiles(fileList);
          setLoading(false);
          return;
        }

        // --- SI HAY ARCHIVOS PROTEGIDOS, MOSTRAR PANEL ---
        if (blocked.length > 0) {
          setProtectedFiles(blocked);
          setPendingFiles(fileList);
          setLoading(false);
          setError(`${blocked.length} archivo(s) protegido(s) con contraseña.`);
          return;
        }
        if (parsedFiles.length === 0) throw new Error('Archivos vacíos o sin datos legibles.');
        setRawFiles(parsedFiles);
        setFiles(fileList);

        // Determinar estructura guía (mayoría o archivo manual si ya fue elegido)
        const {
          guideColumns,
          matchedFiles,
          mismatchedFiles
        } = calcularEstructuraGuia(parsedFiles, guideFileName);
        if (mismatchedFiles.length > 0) {
          setConflictState({
            hasConflict: true,
            baseColumns: guideColumns,
            matchedFiles,
            mismatchedFiles
          });
          setLoading(false);
          return;
        }
        processAndMergeFiles(parsedFiles, guideColumns, fileList);
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };

    // --- NUEVA LÓGICA DE ELIMINACIÓN INDIVIDUAL ---
    const removeSingleFile = indexToRemove => {
      const newFiles = files.filter((_, idx) => idx !== indexToRemove);
      const newRawFiles = rawFiles.filter((_, idx) => idx !== indexToRemove);
      setFiles(newFiles);
      setRawFiles(newRawFiles);
      if (newFiles.length === 0) {
        setConflictState({
          hasConflict: false,
          baseColumns: [],
          mismatchedFiles: [],
          matchedFiles: []
        });
        updateAppData({
          files: [],
          data: [],
          columns: [],
          processedData: []
        });
        return;
      }

      // Re-evaluar conflictos con los archivos restantes usando mayoría
      const {
        guideColumns,
        matchedFiles: matched,
        mismatchedFiles: mismatched
      } = calcularEstructuraGuia(newRawFiles, guideFileName);
      if (mismatched.length > 0) {
        setConflictState({
          hasConflict: true,
          baseColumns: guideColumns,
          matchedFiles: matched,
          mismatchedFiles: mismatched
        });
      } else {
        setConflictState({
          hasConflict: false,
          baseColumns: [],
          mismatchedFiles: [],
          matchedFiles: []
        });
        processAndMergeFiles(newRawFiles, guideColumns, newFiles);
      }
    };
    const handleDrop = e => {
      e.preventDefault();
      e.currentTarget.classList.remove('dragover');
      handleFileSelect(e.dataTransfer.files);
    };
    const handleDragOver = e => {
      e.preventDefault();
      e.currentTarget.classList.add('dragover');
    };
    const handleDragLeave = e => {
      e.preventDefault();
      e.currentTarget.classList.remove('dragover');
    };
    const handleSqlLoad = async () => {
      if (!sqlQuery.trim()) return;
      setLoading(true);
      setError('');
      try {
        const result = await window.nexusAPI.executeSQL(sqlQuery);
        if (!result.success) throw new Error(result.error);
        if (!result.data || result.data.length === 0) throw new Error('La consulta no devolvió resultados.');
        const cols = Object.keys(result.data[0]);
        const parsedFile = {
          name: '⚡ SQL',
          data: result.data,
          columns: cols
        };
        setRawFiles([parsedFile]);
        setFiles([{
          name: '⚡ SQL',
          rowCount: result.data.length
        }]);
        processAndMergeFiles([parsedFile], cols, [{
          name: '⚡ SQL',
          rowCount: result.data.length
        }]);
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };
    return /*#__PURE__*/React.createElement("div", {
      className: "card"
    }, /*#__PURE__*/React.createElement("h2", {
      className: "card-title"
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "link"
    }), " Paso 1: Carga de Archivos"), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle"
    }, "Soporta Excel (.xls, .xlsx), CSV (.csv) y archivos de texto (.txt). M\xE1ximo 200 archivos."), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '8px',
        margin: '1rem 0'
      }
    }, /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => setSqlMode(false),
      style: {
        padding: '6px 18px',
        borderRadius: '8px',
        fontWeight: 'bold',
        fontSize: '0.85rem',
        border: '2px solid var(--primary)',
        background: !sqlMode ? 'var(--primary)' : 'white',
        color: !sqlMode ? 'white' : 'var(--primary)',
        cursor: 'pointer'
      }
    }, "\uD83D\uDCC2 Archivo"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => setSqlMode(true),
      style: {
        padding: '6px 18px',
        borderRadius: '8px',
        fontWeight: 'bold',
        fontSize: '0.85rem',
        border: '2px solid #3b82f6',
        background: sqlMode ? '#3b82f6' : 'white',
        color: sqlMode ? 'white' : '#3b82f6',
        cursor: 'pointer'
      }
    }, "\u26A1 SQL")), sqlMode && /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: '1rem'
      }
    }, /*#__PURE__*/React.createElement("textarea", {
      style: {
        width: '100%',
        minHeight: '100px',
        padding: '0.75rem',
        border: '2px solid #3b82f6',
        borderRadius: '8px',
        fontFamily: 'monospace',
        fontSize: '0.85rem',
        resize: 'vertical',
        boxSizing: 'border-box'
      },
      value: sqlQuery,
      onChange: e => setSqlQuery(e.target.value),
      placeholder: "SELECT * FROM tabla WHERE..."
    }), /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: "btn btn-primary",
      style: {
        marginTop: '0.5rem',
        background: '#3b82f6',
        border: 'none'
      },
      onClick: handleSqlLoad
    }, "\u26A1 Ejecutar y Cargar")), error && !protectedFiles.length && /*#__PURE__*/React.createElement("div", {
      className: "alert alert-error"
    }, "\u26A0\uFE0F ", error), pendientesHojas.length > 0 && /*#__PURE__*/React.createElement(SelectorHojas, {
      pendientes: pendientesHojas,
      onConfirm: confirmarHojas,
      onCancel: cancelarOperacion
    }), protectedFiles.length > 0 && /*#__PURE__*/React.createElement(PanelContrasenas, {
      protectedFiles: protectedFiles,
      passwords: passwords,
      setPasswords: setPasswords,
      onDesbloquear: desbloquearArchivos,
      onCancel: cancelarOperacion
    }), /*#__PURE__*/React.createElement("div", {
      className: "checkbox-group",
      style: {
        marginBottom: '1rem',
        padding: '0.5rem',
        background: '#f8fafc',
        borderRadius: '8px',
        border: '1px solid #e2e8f0'
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "checkbox",
      id: "cb-remove-headers",
      className: "checkbox",
      checked: removeRepeatedHeaders,
      onChange: e => setRemoveRepeatedHeaders(e.target.checked)
    }), /*#__PURE__*/React.createElement("label", {
      htmlFor: "cb-remove-headers",
      style: {
        cursor: 'pointer',
        fontSize: '0.9rem',
        color: 'var(--text-dark)'
      }
    }, /*#__PURE__*/React.createElement("strong", null, "\uD83D\uDEE1\uFE0F Limpieza Autom\xE1tica:"), " Eliminar encabezados repetidos y filas vac\xEDas")), files.length === 0 ? /*#__PURE__*/React.createElement("div", {
      className: "file-upload-area",
      onDrop: handleDrop,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onClick: () => fileInputRef.current?.click(),
      style: {
        border: '2px dashed var(--border)',
        padding: '2rem',
        textAlign: 'center',
        borderRadius: '12px',
        cursor: 'pointer',
        background: '#f8fafc'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "file-upload-icon",
      style: {
        fontSize: '3rem',
        marginBottom: '1rem'
      }
    }, "\uD83D\uDCC1"), /*#__PURE__*/React.createElement("div", {
      className: "file-upload-text",
      style: {
        fontWeight: 'bold',
        color: 'var(--primary)'
      }
    }, "Arrastra archivos aqu\xED o haz clic para seleccionar"), /*#__PURE__*/React.createElement("div", {
      className: "file-upload-hint",
      style: {
        color: 'var(--text-light)',
        marginTop: '0.5rem'
      }
    }, "Excel, CSV o TXT - Hasta 200 archivos"), /*#__PURE__*/React.createElement("input", {
      ref: fileInputRef,
      type: "file",
      multiple: true,
      accept: ".xls,.xlsx,.csv,.txt",
      style: {
        display: 'none'
      },
      onChange: e => handleFileSelect(e.target.files)
    })) : /*#__PURE__*/React.createElement(React.Fragment, null, conflictState.hasConflict ? /*#__PURE__*/React.createElement(PanelDiagnosticoConflicto, {
      conflictState: conflictState,
      rawFiles: rawFiles,
      guideFileName: guideFileName,
      onChangeGuide: newGuide => {
        setGuideFileName(newGuide);
        // Recalcular conflictos en caliente con la nueva guía
        const {
          guideColumns,
          matchedFiles,
          mismatchedFiles
        } = calcularEstructuraGuia(rawFiles, newGuide);
        if (mismatchedFiles.length > 0) {
          setConflictState({
            hasConflict: true,
            baseColumns: guideColumns,
            matchedFiles,
            mismatchedFiles
          });
        } else {
          setConflictState({
            hasConflict: false,
            baseColumns: [],
            mismatchedFiles: [],
            matchedFiles: []
          });
          processAndMergeFiles(rawFiles, guideColumns, files);
        }
      },
      onMapear: () => setShowMappingModal(true),
      onCancelar: () => {
        setConflictState({
          hasConflict: false,
          baseColumns: [],
          mismatchedFiles: [],
          matchedFiles: []
        });
        setFiles([]);
        setRawFiles([]);
        setLoading(false);
      }
    }) : /*#__PURE__*/React.createElement("div", {
      className: "alert alert-success",
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem'
      }
    }, /*#__PURE__*/React.createElement("div", null, "\u2705 ", files.length, " archivo(s) cargado(s) - ", (appData.data?.length || 0).toLocaleString(), " registros totales"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-secondary",
      style: {
        padding: '0.4rem 0.8rem',
        fontSize: '0.85rem'
      },
      onClick: () => setShowMappingModal(true)
    }, "\uD83D\uDEE0\uFE0F Mapeo Opcional (A\xF1adir/Modificar)")), /*#__PURE__*/React.createElement("div", {
      className: "file-list",
      style: {
        maxHeight: '200px',
        overflowY: 'auto',
        marginTop: '1rem'
      }
    }, files.map((file, idx) => {
      // Identificar si este archivo es uno de los conflictivos
      const isMismatched = conflictState.hasConflict && conflictState.mismatchedFiles.some(mf => mf.file === file);
      return /*#__PURE__*/React.createElement("div", {
        key: idx,
        className: "file-item",
        style: isMismatched ? {
          borderLeft: '4px solid var(--error)',
          background: '#fef2f2',
          display: 'flex'
        } : {
          display: 'flex'
        }
      }, /*#__PURE__*/React.createElement("div", {
        className: "file-item-info",
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexGrow: 1
        }
      }, /*#__PURE__*/React.createElement("span", {
        className: "file-item-icon"
      }, isMismatched ? '⚠️' : '📄'), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
        className: "file-item-name",
        style: {
          color: isMismatched ? 'var(--error)' : 'inherit',
          fontWeight: isMismatched ? 'bold' : 'normal'
        }
      }, file.name), /*#__PURE__*/React.createElement("div", {
        className: "file-item-size"
      }, (file.size / 1024).toFixed(2), " KB"))), /*#__PURE__*/React.createElement("button", {
        onClick: () => removeSingleFile(idx),
        style: {
          background: 'transparent',
          border: 'none',
          color: 'var(--error)',
          cursor: 'pointer',
          fontSize: '1.2rem',
          padding: '0.2rem 0.5rem',
          marginLeft: 'auto'
        },
        title: "Eliminar este archivo"
      }, "\uD83D\uDDD1\uFE0F"));
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: '1rem'
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      onClick: () => {
        setFiles([]);
        setRawFiles([]);
        updateAppData({
          files: [],
          data: [],
          columns: [],
          processedData: []
        });
      }
    }, "\uD83D\uDD04 Empezar de Nuevo"))), loading && /*#__PURE__*/React.createElement("div", {
      className: "spinner"
    }), /*#__PURE__*/React.createElement("div", {
      className: "nav-buttons"
    }, /*#__PURE__*/React.createElement("div", null), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: nextStep,
      disabled: files.length === 0 || loading || conflictState.hasConflict
    }, "Continuar \u2192")), showMappingModal && /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        zIndex: 9999,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '1rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "card",
      style: {
        width: '100%',
        maxWidth: '850px',
        maxHeight: '90vh',
        overflowY: 'auto',
        margin: 0,
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '2px solid var(--border)',
        paddingBottom: '1rem',
        marginBottom: '1rem'
      }
    }, /*#__PURE__*/React.createElement("h2", {
      className: "card-title",
      style: {
        margin: 0,
        border: 'none',
        padding: 0
      }
    }, "\uD83D\uDEE0\uFE0F \xC1rea de Staging y Mapeo"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-error",
      style: {
        padding: '0.3rem 0.7rem'
      },
      onClick: () => setShowMappingModal(false)
    }, "\u2715")), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle"
    }, "Aplica reglas a los datos crudos antes de unirlos. Especialmente \xFAtil para homologar columnas de archivos distintos o inyectar reglas de negocio tempranas."), (() => {
      // Algoritmo de similitud de strings (Levenshtein simplificado)
      const similaridad = (a, b) => {
        a = a.toUpperCase();
        b = b.toUpperCase();
        if (a === b) return 1;
        if (a.includes(b) || b.includes(a)) return 0.85;
        // Bigramas compartidos
        const bigramas = s => {
          const bg = new Set();
          for (let i = 0; i < s.length - 1; i++) bg.add(s.slice(i, i + 2));
          return bg;
        };
        const bgA = bigramas(a),
          bgB = bigramas(b);
        let shared = 0;
        bgA.forEach(bg => {
          if (bgB.has(bg)) shared++;
        });
        return 2 * shared / (bgA.size + bgB.size + 0.001);
      };

      // Columnas del template (guía)
      const templateCols = conflictState.baseColumns || [];
      // Todas las columnas de archivos conflictivos que NO están en el template
      const extraCols = new Set();
      (conflictState.mismatchedFiles || []).forEach(f => {
        f.columns.forEach(c => {
          if (!templateCols.includes(c)) extraCols.add(c);
        });
      });

      // Generar sugerencias: para cada columna extra, buscar la más parecida en el template
      const sugerencias = [];
      extraCols.forEach(extraCol => {
        let mejor = null,
          mejorScore = 0;
        templateCols.forEach(tc => {
          const score = similaridad(extraCol, tc);
          if (score > mejorScore) {
            mejorScore = score;
            mejor = tc;
          }
        });
        // Solo sugerir si hay similitud razonable (> 0.4) y la sugerencia no ya fue usada
        if (mejor && mejorScore > 0.4) {
          sugerencias.push({
            desde: extraCol,
            hacia: mejor,
            score: mejorScore
          });
        }
      });
      if (sugerencias.length === 0) return null;
      return /*#__PURE__*/React.createElement("div", {
        style: {
          background: '#f0fdf4',
          border: '1px solid #86efac',
          borderRadius: 8,
          padding: '1rem',
          marginBottom: '1.25rem'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontWeight: 700,
          fontSize: '0.82rem',
          color: '#166534',
          marginBottom: 8
        }
      }, "\uD83D\uDCA1 Sugerencias autom\xE1ticas de homologaci\xF3n (columnas con nombres similares detectadas)"), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 6
        }
      }, sugerencias.map((s, idx) => {
        // Verificar si ya existe una regla para este par
        const yaAplicada = mappingRules.some(r => r.type === 'rename' && r.sourceColumn === s.desde && r.targetColumn === s.hacia);
        return /*#__PURE__*/React.createElement("div", {
          key: idx,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap'
          }
        }, /*#__PURE__*/React.createElement("span", {
          style: {
            background: '#fecaca',
            color: '#991b1b',
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            padding: '2px 8px',
            borderRadius: 4
          }
        }, s.desde), /*#__PURE__*/React.createElement("span", {
          style: {
            color: '#6b7280',
            fontSize: '0.8rem'
          }
        }, "\u2192"), /*#__PURE__*/React.createElement("span", {
          style: {
            background: '#bbf7d0',
            color: '#166534',
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            padding: '2px 8px',
            borderRadius: 4
          }
        }, s.hacia), /*#__PURE__*/React.createElement("span", {
          style: {
            color: '#9ca3af',
            fontSize: '0.7rem'
          }
        }, "(", Math.round(s.score * 100), "% similar)"), yaAplicada ? /*#__PURE__*/React.createElement("span", {
          style: {
            fontSize: '0.7rem',
            color: '#059669',
            fontWeight: 700
          }
        }, "\u2713 Ya aplicada") : /*#__PURE__*/React.createElement("button", {
          onClick: () => {
            setMappingRules(prev => [...prev, {
              id: Date.now() + Math.random(),
              type: 'rename',
              targetColumn: s.hacia,
              sourceColumn: s.desde,
              sourceColumns: [],
              separator: ' ',
              staticValue: '',
              keepOriginals: false,
              valueMap: {},
              falseValue: '',
              condOperator: '==',
              condValue: '',
              trueValue: ''
            }]);
          },
          style: {
            background: 'var(--primary)',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            padding: '2px 10px',
            fontSize: '0.72rem',
            fontWeight: 700,
            cursor: 'pointer'
          }
        }, "+ Aplicar"));
      })));
    })(), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '0.5rem',
        flexWrap: 'wrap',
        marginBottom: '1.5rem'
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      style: {
        fontSize: '0.85rem'
      },
      onClick: () => addMappingRule('rename')
    }, "\uD83D\uDD04 Homologar/Renombrar"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      style: {
        fontSize: '0.85rem'
      },
      onClick: () => addMappingRule('concat')
    }, "\uD83D\uDD17 Concatenar"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      style: {
        fontSize: '0.85rem'
      },
      onClick: () => addMappingRule('static')
    }, "\uD83D\uDCCC Campo Fijo"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      style: {
        fontSize: '0.85rem'
      },
      onClick: () => addMappingRule('conditional')
    }, "\u2696\uFE0F Condicional"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      style: {
        fontSize: '0.85rem',
        color: 'var(--error)',
        borderColor: 'var(--error)'
      },
      onClick: () => addMappingRule('drop')
    }, "\uD83D\uDDD1\uFE0F Desechar Columna")), mappingRules.length === 0 ? /*#__PURE__*/React.createElement("div", {
      className: "alert alert-info"
    }, "A\xFAn no has creado ninguna regla de pre-procesamiento.") : /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        marginBottom: '1.5rem'
      }
    }, mappingRules.map(rule => /*#__PURE__*/React.createElement("div", {
      key: rule.id,
      style: {
        border: '1px solid var(--border)',
        padding: '1.5rem',
        borderRadius: '8px',
        background: '#f8fafc',
        position: 'relative'
      }
    }, /*#__PURE__*/React.createElement("button", {
      style: {
        position: 'absolute',
        top: '0.5rem',
        right: '0.5rem',
        background: 'transparent',
        border: 'none',
        color: 'var(--error)',
        cursor: 'pointer',
        fontWeight: 'bold',
        fontSize: '1.2rem'
      },
      onClick: () => removeMappingRule(rule.id),
      title: "Eliminar regla"
    }, "\u2715"), rule.type === 'concat' && /*#__PURE__*/React.createElement("div", {
      className: "grid grid-2",
      style: {
        gap: '1rem',
        alignItems: 'start'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "form-group",
      style: {
        marginBottom: 0
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label",
      style: {
        fontSize: '0.8rem',
        color: 'var(--primary)'
      }
    }, "1. Columnas a Unir (En tu orden exacto):"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        background: 'white',
        padding: '0.75rem',
        borderRadius: '8px',
        border: '1px solid var(--border)'
      }
    }, Array.from({
      length: Math.min(6, (rule.sourceColumns?.length || 0) + 1)
    }).map((_, idx) => /*#__PURE__*/React.createElement("div", {
      key: idx,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 'bold',
        color: 'var(--primary)',
        width: '20px'
      }
    }, idx + 1, "."), /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      style: {
        padding: '0.4rem',
        fontSize: '0.85rem'
      },
      value: rule.sourceColumns && rule.sourceColumns[idx] || '',
      onChange: e => {
        let current = [...(rule.sourceColumns || [])];
        current[idx] = e.target.value;
        // Limpiamos los vacíos para que no queden huecos si eliminas una del medio
        current = current.filter(Boolean);
        updateMappingRule(rule.id, 'sourceColumns', current);
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "-- Seleccionar Columna --"), getAvailableColumns().map(c => /*#__PURE__*/React.createElement("option", {
      key: c,
      value: c
    }, c))))), /*#__PURE__*/React.createElement("small", {
      style: {
        color: 'var(--text-light)',
        fontSize: '0.75rem',
        marginTop: '0.25rem'
      }
    }, "Se unir\xE1n exactamente de arriba hacia abajo. (M\xE1ximo 6 columnas)."))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "form-group",
      style: {
        marginBottom: 0
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label",
      style: {
        fontSize: '0.8rem',
        color: 'var(--primary)'
      }
    }, "2. Separador:"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      className: "form-input",
      placeholder: "Ej: un espacio, o un gui\xF3n -",
      value: rule.separator,
      onChange: e => updateMappingRule(rule.id, 'separator', e.target.value)
    })), /*#__PURE__*/React.createElement("div", {
      className: "form-group",
      style: {
        marginBottom: 0
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label",
      style: {
        fontSize: '0.8rem',
        color: 'var(--primary)'
      }
    }, "3. Nombre Columna Final:"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      className: "form-input",
      placeholder: "Ej: NOMBRE_COMPLETO",
      value: rule.targetColumn,
      onChange: e => updateMappingRule(rule.id, 'targetColumn', e.target.value.toUpperCase())
    })), /*#__PURE__*/React.createElement("div", {
      className: "form-group",
      style: {
        marginBottom: 0,
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        marginTop: '0.5rem'
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "checkbox",
      id: `keep-${rule.id}`,
      checked: rule.keepOriginals || false,
      onChange: e => updateMappingRule(rule.id, 'keepOriginals', e.target.checked),
      style: {
        cursor: 'pointer'
      }
    }), /*#__PURE__*/React.createElement("label", {
      htmlFor: `keep-${rule.id}`,
      style: {
        fontSize: '0.8rem',
        color: 'var(--text-dark)',
        cursor: 'pointer',
        margin: 0
      }
    }, "Conservar columnas originales (no eliminarlas)")))), rule.type === 'rename' && (() => {
      // Archivo que contiene la columna origen (para contextualizar)
      const archivosConOrigen = rule.sourceColumn ? (conflictState.mismatchedFiles || []).filter(f => f.columns.includes(rule.sourceColumn)).map(f => f.name.replace(/\.[^.]+$/, '')) : [];
      return /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem'
        }
      }, /*#__PURE__*/React.createElement("div", {
        className: "grid grid-2",
        style: {
          gap: '1rem',
          alignItems: 'start'
        }
      }, /*#__PURE__*/React.createElement("div", {
        className: "form-group",
        style: {
          marginBottom: 0
        }
      }, /*#__PURE__*/React.createElement("label", {
        className: "form-label",
        style: {
          fontSize: '0.8rem',
          color: 'var(--primary)'
        }
      }, "1. Columna a homologar (origen):"), /*#__PURE__*/React.createElement("select", {
        className: "form-select",
        value: rule.sourceColumn,
        onChange: e => updateMappingRule(rule.id, 'sourceColumn', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "-- Seleccionar Columna --"), conflictState.hasConflict && (() => {
        const templateCols = conflictState.baseColumns || [];
        const extraCols = new Set();
        (conflictState.mismatchedFiles || []).forEach(f => f.columns.forEach(c => {
          if (!templateCols.includes(c)) extraCols.add(c);
        }));
        const extras = Array.from(extraCols).sort();
        const resto = getAvailableColumns().filter(c => !extraCols.has(c));
        return /*#__PURE__*/React.createElement(React.Fragment, null, extras.length > 0 && /*#__PURE__*/React.createElement("optgroup", {
          label: "\u26A0\uFE0F Columnas en conflicto (extras)"
        }, extras.map(c => /*#__PURE__*/React.createElement("option", {
          key: c,
          value: c
        }, c))), resto.length > 0 && /*#__PURE__*/React.createElement("optgroup", {
          label: "Otras columnas"
        }, resto.map(c => /*#__PURE__*/React.createElement("option", {
          key: c,
          value: c
        }, c))));
      })(), !conflictState.hasConflict && getAvailableColumns().map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c))), archivosConOrigen.length > 0 && /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '0.7rem',
          color: '#6b7280',
          marginTop: 3
        }
      }, "\uD83D\uDCC2 Presente en: ", archivosConOrigen.join(', '))), /*#__PURE__*/React.createElement("div", {
        className: "form-group",
        style: {
          marginBottom: 0
        }
      }, /*#__PURE__*/React.createElement("label", {
        className: "form-label",
        style: {
          fontSize: '0.8rem',
          color: 'var(--primary)'
        }
      }, "2. Renombrar como (destino):"), /*#__PURE__*/React.createElement("select", {
        className: "form-select",
        style: {
          marginBottom: '0.4rem'
        },
        value: conflictState.baseColumns?.includes(rule.targetColumn) ? rule.targetColumn : '__custom__',
        onChange: e => {
          if (e.target.value !== '__custom__') {
            updateMappingRule(rule.id, 'targetColumn', e.target.value);
          }
        }
      }, /*#__PURE__*/React.createElement("option", {
        value: "__custom__"
      }, "\u270F\uFE0F Escribir nombre personalizado..."), (conflictState.baseColumns || []).map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c))), /*#__PURE__*/React.createElement("input", {
        type: "text",
        className: "form-input",
        placeholder: "O escribe aqu\xED el nombre final",
        value: rule.targetColumn,
        onChange: e => updateMappingRule(rule.id, 'targetColumn', e.target.value.toUpperCase())
      }), rule.targetColumn && !(conflictState.baseColumns || []).includes(rule.targetColumn) && /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '0.7rem',
          color: '#d97706',
          marginTop: 3
        }
      }, "\u26A0\uFE0F Nombre personalizado (no est\xE1 en el template actual)"), rule.targetColumn && (conflictState.baseColumns || []).includes(rule.targetColumn) && /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '0.7rem',
          color: '#059669',
          marginTop: 3
        }
      }, "\u2713 Coincide con columna del template"))));
    })(), rule.type === 'static' && /*#__PURE__*/React.createElement("div", {
      className: "grid grid-2",
      style: {
        gap: '1rem',
        alignItems: 'end'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "form-group",
      style: {
        marginBottom: 0
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label",
      style: {
        fontSize: '0.8rem',
        color: 'var(--primary)'
      }
    }, "1. Crear nueva columna llamada:"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      className: "form-input",
      placeholder: "Ej: MARCA_ESTRATEGIA",
      value: rule.targetColumn,
      onChange: e => updateMappingRule(rule.id, 'targetColumn', e.target.value.toUpperCase())
    })), /*#__PURE__*/React.createElement("div", {
      className: "form-group",
      style: {
        marginBottom: 0
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label",
      style: {
        fontSize: '0.8rem',
        color: 'var(--primary)'
      }
    }, "2. Rellenar siempre con este valor:"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      className: "form-input",
      placeholder: "Ej: 1",
      value: rule.staticValue,
      onChange: e => updateMappingRule(rule.id, 'staticValue', e.target.value)
    }))), rule.type === 'conditional' && /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "grid grid-2",
      style: {
        gap: '1rem',
        alignItems: 'end'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "form-group",
      style: {
        marginBottom: 0
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label",
      style: {
        fontSize: '0.8rem',
        color: 'var(--primary)'
      }
    }, "1. Columna a Evaluar:"), /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      value: rule.sourceColumn,
      onChange: e => {
        updateMappingRule(rule.id, 'sourceColumn', e.target.value);
        updateMappingRule(rule.id, 'valueMap', {}); // Resetear mapa al cambiar columna
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "-- Seleccionar Columna --"), getAvailableColumns().map(c => /*#__PURE__*/React.createElement("option", {
      key: c,
      value: c
    }, c)))), /*#__PURE__*/React.createElement("div", {
      className: "form-group",
      style: {
        marginBottom: 0
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label",
      style: {
        fontSize: '0.8rem',
        color: 'var(--primary)'
      }
    }, "2. Nombre Columna Final:"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      className: "form-input",
      placeholder: "Ej: NUEVO_ESTADO",
      value: rule.targetColumn,
      onChange: e => updateMappingRule(rule.id, 'targetColumn', e.target.value.toUpperCase())
    }))), rule.sourceColumn && /*#__PURE__*/React.createElement("div", {
      style: {
        background: 'white',
        padding: '1rem',
        borderRadius: '8px',
        border: '1px solid var(--border)'
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label",
      style: {
        fontSize: '0.8rem',
        color: 'var(--primary)'
      }
    }, "3. Mapeo Din\xE1mico (Asigna un nuevo valor a cada opci\xF3n detectada):"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        maxHeight: '200px',
        overflowY: 'auto',
        paddingRight: '0.5rem'
      }
    }, (() => {
      const uniqueVals = new Set();
      rawFiles.forEach(f => f.data.forEach(row => {
        const val = String(row[rule.sourceColumn] || '').trim().toUpperCase();
        if (val) uniqueVals.add(val);
      }));
      const valsArray = Array.from(uniqueVals).sort();
      if (valsArray.length === 0) return /*#__PURE__*/React.createElement("div", {
        className: "alert alert-warning"
      }, "No hay datos en esta columna.");
      return valsArray.map(val => /*#__PURE__*/React.createElement("div", {
        key: val,
        style: {
          display: 'flex',
          gap: '1rem',
          alignItems: 'center'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          flex: '1',
          fontWeight: 'bold',
          fontSize: '0.9rem',
          color: 'var(--text-dark)',
          textAlign: 'right'
        }
      }, val), /*#__PURE__*/React.createElement("div", {
        style: {
          color: 'var(--primary)'
        }
      }, "\u2192"), /*#__PURE__*/React.createElement("div", {
        style: {
          flex: '1'
        }
      }, /*#__PURE__*/React.createElement("input", {
        type: "text",
        className: "form-input",
        placeholder: "Ej: LLAMAR",
        style: {
          padding: '0.4rem',
          fontSize: '0.9rem'
        },
        value: rule.valueMap && rule.valueMap[val] || '',
        onChange: e => {
          const currentMap = rule.valueMap || {};
          updateMappingRule(rule.id, 'valueMap', {
            ...currentMap,
            [val]: e.target.value.toUpperCase()
          });
        }
      }))));
    })()), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: '1rem',
        borderTop: '1px solid var(--border)',
        paddingTop: '1rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '1rem',
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: '1',
        fontSize: '0.9rem',
        color: 'var(--text-light)',
        textAlign: 'right'
      }
    }, /*#__PURE__*/React.createElement("em", null, "Valor por defecto (si la celda est\xE1 vac\xEDa o no fue mapeada):")), /*#__PURE__*/React.createElement("div", {
      style: {
        color: 'var(--text-light)'
      }
    }, "\u2192"), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: '1'
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "text",
      className: "form-input",
      placeholder: "Ej: STANDBY (Opcional)",
      style: {
        padding: '0.4rem',
        fontSize: '0.9rem'
      },
      value: rule.falseValue || '',
      onChange: e => updateMappingRule(rule.id, 'falseValue', e.target.value.toUpperCase())
    })))))), rule.type === 'drop' && (() => {
      const templateCols = conflictState.baseColumns || [];
      const extraCols = new Set();
      (conflictState.mismatchedFiles || []).forEach(f => f.columns.forEach(c => {
        if (!templateCols.includes(c)) extraCols.add(c);
      }));
      const extras = Array.from(extraCols).sort();
      const resto = getAvailableColumns().filter(c => !extraCols.has(c));

      // Info de presencia de la columna seleccionada
      const allFiles = [...(conflictState.matchedFiles || []), ...(conflictState.mismatchedFiles || [])];
      const presenciaInfo = rule.sourceColumn && allFiles.length > 0 ? allFiles.filter(f => f.columns.includes(rule.sourceColumn)).map(f => f.name.replace(/\.[^.]+$/, '')) : [];
      const ausenciaInfo = rule.sourceColumn && allFiles.length > 0 ? allFiles.filter(f => !f.columns.includes(rule.sourceColumn)).map(f => f.name.replace(/\.[^.]+$/, '')) : [];
      return /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          width: '55%',
          minWidth: 240
        }
      }, /*#__PURE__*/React.createElement("div", {
        className: "form-group",
        style: {
          marginBottom: 0
        }
      }, /*#__PURE__*/React.createElement("label", {
        className: "form-label",
        style: {
          fontSize: '0.8rem',
          color: 'var(--error)'
        }
      }, "Selecciona la columna a eliminar:"), /*#__PURE__*/React.createElement("select", {
        className: "form-select",
        value: rule.sourceColumn,
        onChange: e => updateMappingRule(rule.id, 'sourceColumn', e.target.value)
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, "-- Seleccionar --"), conflictState.hasConflict ? /*#__PURE__*/React.createElement(React.Fragment, null, extras.length > 0 && /*#__PURE__*/React.createElement("optgroup", {
        label: "\u26A0\uFE0F Columnas en conflicto (extras)"
      }, extras.map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c))), resto.length > 0 && /*#__PURE__*/React.createElement("optgroup", {
        label: "Columnas del template"
      }, resto.map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c)))) : getAvailableColumns().map(c => /*#__PURE__*/React.createElement("option", {
        key: c,
        value: c
      }, c)))), rule.sourceColumn && allFiles.length > 0 && /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: '0.71rem',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 6,
          padding: '0.4rem 0.6rem',
          lineHeight: 1.6
        }
      }, presenciaInfo.length > 0 && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
        style: {
          color: '#991b1b',
          fontWeight: 700
        }
      }, "Presente en (", presenciaInfo.length, "):"), " ", /*#__PURE__*/React.createElement("span", {
        style: {
          color: '#6b7280'
        }
      }, presenciaInfo.join(', '))), ausenciaInfo.length > 0 && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
        style: {
          color: '#6b7280',
          fontWeight: 700
        }
      }, "Ausente en (", ausenciaInfo.length, "):"), " ", /*#__PURE__*/React.createElement("span", {
        style: {
          color: '#9ca3af'
        }
      }, ausenciaInfo.join(', ')))));
    })()))), /*#__PURE__*/React.createElement("div", {
      className: "nav-buttons",
      style: {
        marginTop: '1rem',
        borderTop: '2px solid var(--border)',
        paddingTop: '1.5rem'
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      onClick: () => setShowMappingModal(false)
    }, "Cancelar"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: applyMappingAndMerge,
      disabled: mappingRules.length > 0 && mappingRules.some(r => r.type === 'rename' && (!r.sourceColumn || !r.targetColumn))
    }, "\u26A1 Aplicar Reglas y Procesar Archivos")))));
  }

  // Step 2: Preview (Componente sin cambios)
  function Step2Preview({
    appData,
    updateAppData,
    nextStep,
    prevStep
  }) {
    const previewRows = appData.data.slice(0, 10);
    return /*#__PURE__*/React.createElement("div", {
      className: "card"
    }, /*#__PURE__*/React.createElement("h2", {
      className: "card-title"
    }, "\u2713 Paso 2: Vista Previa de Datos"), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle"
    }, "Primeras 10 filas de tus datos"), /*#__PURE__*/React.createElement("div", {
      className: "stats-grid"
    }, /*#__PURE__*/React.createElement("div", {
      className: "stat-card"
    }, /*#__PURE__*/React.createElement("div", {
      className: "stat-value"
    }, appData.data.length.toLocaleString()), /*#__PURE__*/React.createElement("div", {
      className: "stat-label"
    }, "Filas Totales")), /*#__PURE__*/React.createElement("div", {
      className: "stat-card"
    }, /*#__PURE__*/React.createElement("div", {
      className: "stat-value"
    }, appData.columns.length), /*#__PURE__*/React.createElement("div", {
      className: "stat-label"
    }, "Columnas")), /*#__PURE__*/React.createElement("div", {
      className: "stat-card"
    }, /*#__PURE__*/React.createElement("div", {
      className: "stat-value"
    }, appData.files.length), /*#__PURE__*/React.createElement("div", {
      className: "stat-label"
    }, "Archivos"))), /*#__PURE__*/React.createElement("div", {
      className: "table-container"
    }, /*#__PURE__*/React.createElement("table", {
      className: "table"
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, appData.columns.map(col => /*#__PURE__*/React.createElement("th", {
      key: col
    }, col)))), /*#__PURE__*/React.createElement("tbody", null, previewRows.map((row, idx) => /*#__PURE__*/React.createElement("tr", {
      key: idx
    }, appData.columns.map(col => /*#__PURE__*/React.createElement("td", {
      key: col
    }, row[col]))))))), /*#__PURE__*/React.createElement("div", {
      className: "nav-buttons"
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      onClick: prevStep
    }, "\u2190 Atr\xE1s"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: nextStep
    }, "Continuar \u2192")));
  }

  // Step 3: Pivot Field (Modificado para incluir Normalización de RUT)
  function Step3PivotField({
    appData,
    updateAppData,
    nextStep,
    prevStep,
    goToStep
  }) {
    const [pivotField, setPivotField] = useState(appData.pivotField || '');
    const [analyzed, setAnalyzed] = useState(appData.hasDuplicates);
    const [uniqueCount, setUniqueCount] = useState(appData.data.length - appData.duplicateCount || 0);
    const [duplicateCount, setDuplicateCount] = useState(appData.duplicateCount || 0);

    // --- NUEVO ESTADO PARA RUT ---
    const [applyRutNormalization, setApplyRutNormalization] = useState(appData.applyRutNormalization || false);
    const [dvField, setDvField] = useState(appData.dvField || '');
    // Guardamos los datos procesados localmente en este paso si se normaliza
    const [normalizedData, setNormalizedData] = useState(appData.processedData.length > 0 ? appData.processedData : appData.data);
    const [isProcessing, setIsProcessing] = useState(false);
    useEffect(() => {
      if (!appData.pivotField) {
        const detected = detectPivotField(appData.columns, appData.data);
        setPivotField(detected);
      }
    }, []);
    const detectPivotField = (columns, data) => {
      const scores = {};
      columns.forEach(col => {
        let score = 0;
        const colUpper = col.toUpperCase();
        if (colUpper === 'RUT') score += 100;else if (colUpper === 'ID') score += 90;else if (colUpper === 'ID_CLIENTE') score += 85;else if (colUpper === 'ROW_ID') score += 80;else if (colUpper === 'DDAS_NRT_PPAL') score += 75;else if (colUpper.endsWith('_ID')) score += 60;
        const values = data.map(row => row[col]);
        const unique = new Set(values);
        const cardinality = unique.size / values.length * 100;
        if (cardinality >= 80) score += 50;
        scores[col] = score;
      });
      const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
      return sorted[0]?.[0] || columns[0];
    };

    // --- LÓGICA DE ANÁLISIS MODIFICADA ---
    const analyzeData = () => {
      if (!pivotField) return;
      setIsProcessing(true);

      // Usar un setTimeout para que el spinner de "isProcessing" se muestre
      setTimeout(() => {
        let dataToAnalyze = [...appData.data];
        let pivotKey = pivotField;
        if (applyRutNormalization) {
          const normalized = appData.data.map(row => {
            const newRow = {
              ...row
            };
            const rutInput = String(row[pivotField] || '');
            const dvInput = String(row[dvField] || '').toUpperCase();
            let rutNumero = '';
            let dvFinal = '';
            let rutStatus = 'No Aplicable';
            if (dvField && dvInput) {
              // Escenario: RUT y DV en campos separados
              rutNumero = cleanRut(rutInput).replace(/[kK]/g, ''); // Limpiar y quitar K si la hubiera
              dvFinal = cleanRut(dvInput); // Usar el DV provisto
              const dvCalculado = calculateDV(rutNumero);
              rutStatus = dvFinal === dvCalculado ? 'Válido (Provisto)' : 'Inválido (Provisto vs Calc)';
            } else if (rutInput) {
              // Escenario: RUT en un solo campo (o solo número)
              const rutLimpioCompleto = cleanRut(rutInput);
              if (rutLimpioCompleto.length > 1) {
                const dvOriginal = rutLimpioCompleto.slice(-1);
                if (isNaN(dvOriginal) || dvOriginal === 'K') {
                  // Tiene DV (ej. 'K')
                  rutNumero = rutLimpioCompleto.slice(0, -1);
                  const dvCalculado = calculateDV(rutNumero);
                  dvFinal = dvOriginal; // Usamos el original
                  rutStatus = dvFinal === dvCalculado ? 'Válido (Original)' : 'Inválido (Original vs Calc)';
                } else {
                  // No tiene DV (solo número)
                  rutNumero = rutLimpioCompleto;
                  dvFinal = calculateDV(rutNumero);
                  rutStatus = 'Calculado (Sin DV Original)';
                }
              }
            }

            // Crear nuevas columnas
            newRow['RUT_NUMERO'] = rutNumero;
            newRow['DV_CALCULADO'] = dvFinal;
            newRow['RUT_CON_DV'] = rutNumero ? `${rutNumero}-${dvFinal}` : '';
            newRow['RUT_PIVOTE_LIMPIO'] = rutNumero; // Usamos el NÚMERO como pivote limpio
            newRow['RUT_STATUS'] = rutStatus;
            return newRow;
          });
          dataToAnalyze = normalized;
          pivotKey = 'RUT_PIVOTE_LIMPIO'; // El nuevo pivote para el análisis
          setNormalizedData(normalized); // Guardar datos procesados localmente
        } else {
          // Si no se normaliza, aseguramos que los datos locales sean los originales
          setNormalizedData(appData.data);
        }
        const values = dataToAnalyze.map(row => String(row[pivotKey] || '').trim());
        const validValues = values.filter(v => v); // Ignorar vacíos en el conteo
        const unique = new Set(validValues);
        const uniqueCount = unique.size;
        // FIX: El total de duplicados es el total de filas analizadas MENOS los únicos.
        // (El 'values.length' original era correcto aquí)
        const duplicateCount = values.length - uniqueCount;
        setUniqueCount(uniqueCount);
        setDuplicateCount(duplicateCount);
        setAnalyzed(true);
        setIsProcessing(false);
      }, 50); // 50ms de espera para permitir la renderización del spinner
    };

    // --- LÓGICA DE CONTINUAR MODIFICADA (FIX v6.5.1) ---
    const handleContinue = () => {
      let dataToPass = appData.data;
      let pivotToPass = pivotField;
      const hasDups = duplicateCount > 0; // Capturar el estado actual

      if (applyRutNormalization) {
        dataToPass = normalizedData;
        pivotToPass = 'RUT_PIVOTE_LIMPIO';
      }
      updateAppData({
        pivotField: pivotToPass,
        processedData: dataToPass,
        hasDuplicates: hasDups,
        // Usar la variable capturada
        duplicateCount,
        uniqueCount: uniqueCount,
        // <-- LÍNEA AÑADIDA
        applyRutNormalization,
        dvField
      });

      // --- FIX: Lógica de salto manual ---
      // En lugar de llamar a nextStep(), usamos goToStep()
      // para evitar el problema de asincronía de React.
      if (hasDups) {
        goToStep(4); // Ir al Paso 4 (Modo de Procesamiento)
      } else {
        goToStep(6); // Saltar al Paso 6 (Teléfonos)
      }
    };
    return /*#__PURE__*/React.createElement("div", {
      className: "card"
    }, /*#__PURE__*/React.createElement("h2", {
      className: "card-title"
    }, "\uD83D\uDD11 Paso 3: Selecci\xF3n de Campo Pivote (y Normalizaci\xF3n de RUT)"), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle"
    }, "El campo pivote identifica registros \xFAnicos en tu base de datos"), /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "Campo Pivote (detectado autom\xE1ticamente)"), /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      value: pivotField,
      onChange: e => {
        setPivotField(e.target.value);
        setAnalyzed(false);
      }
    }, appData.columns.map(col => /*#__PURE__*/React.createElement("option", {
      key: col,
      value: col
    }, col)))), /*#__PURE__*/React.createElement("div", {
      className: "checkbox-group",
      style: {
        borderTop: '1px solid var(--border)',
        paddingTop: '1rem',
        marginTop: '1.5rem'
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "checkbox",
      id: "cb-rut-normalize",
      className: "checkbox",
      checked: applyRutNormalization,
      onChange: e => {
        setApplyRutNormalization(e.target.checked);
        setAnalyzed(false);
      }
    }), /*#__PURE__*/React.createElement("label", {
      htmlFor: "cb-rut-normalize",
      style: {
        cursor: 'pointer'
      }
    }, /*#__PURE__*/React.createElement("strong", null, "\u2699\uFE0F Aplicar Normalizaci\xF3n y C\xE1lculo de DV (para RUT)"))), applyRutNormalization && /*#__PURE__*/React.createElement("div", {
      className: "card",
      style: {
        background: 'var(--background)',
        marginTop: '1rem',
        border: '1px solid var(--border)'
      }
    }, /*#__PURE__*/React.createElement("h4", {
      style: {
        marginTop: 0,
        color: 'var(--primary)'
      }
    }, "Opciones de Normalizaci\xF3n de RUT"), /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "Columna de DV (Opcional, si est\xE1 separado)"), /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      value: dvField,
      onChange: e => {
        setDvField(e.target.value);
        setAnalyzed(false);
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "-- Sin Columna de DV Separada --"), appData.columns.filter(c => c !== pivotField).map(col => /*#__PURE__*/React.createElement("option", {
      key: col,
      value: col
    }, col)))), /*#__PURE__*/React.createElement("div", {
      className: "alert alert-info",
      style: {
        fontSize: '0.9rem'
      }
    }, /*#__PURE__*/React.createElement("strong", null, "Se crear\xE1n nuevas columnas:"), /*#__PURE__*/React.createElement("br", null), "\u2022 `RUT_NUMERO` (Pivote limpio)", /*#__PURE__*/React.createElement("br", null), "\u2022 `DV_CALCULADO` (DV final)", /*#__PURE__*/React.createElement("br", null), "\u2022 `RUT_CON_DV` (Formato 12345678-K)", /*#__PURE__*/React.createElement("br", null), "\u2022 `RUT_STATUS` (V\xE1lido, Inv\xE1lido, Calculado)")), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: '1.5rem'
      }
    }, !analyzed ? /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: analyzeData,
      disabled: !pivotField || isProcessing
    }, isProcessing ? 'Procesando...' : 'Analizar Duplicados') : /*#__PURE__*/React.createElement("div", null, duplicateCount === 0 ? /*#__PURE__*/React.createElement("div", {
      className: "alert alert-success"
    }, "\u2705 Base con registros 100% \xFAnicos (", uniqueCount.toLocaleString(), " registros)") : /*#__PURE__*/React.createElement("div", {
      className: "alert alert-warning"
    }, "\u26A0\uFE0F Base con ", duplicateCount.toLocaleString(), " duplicados detectados", /*#__PURE__*/React.createElement("br", null), "Registros \xFAnicos: ", uniqueCount.toLocaleString(), " | Total: ", appData.data.length.toLocaleString())), isProcessing && /*#__PURE__*/React.createElement("div", {
      className: "spinner"
    })), /*#__PURE__*/React.createElement("div", {
      className: "nav-buttons"
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      onClick: prevStep
    }, "\u2190 Atr\xE1s"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: handleContinue,
      disabled: !analyzed || isProcessing
    }, "Continuar \u2192")));
  }

  // Step 4: Processing Mode (Modificado para usar processedData)
  function Step4ProcessingMode({
    appData,
    updateAppData,
    nextStep,
    prevStep
  }) {
    const [mode, setMode] = useState(appData.processingMode || '');

    // Usar los datos procesados del Paso 3 como base
    const sourceData = appData.processedData.length > 0 ? appData.processedData : appData.data;
    const handleModeSelect = selectedMode => {
      setMode(selectedMode);
      let dataToProcess = sourceData; // <-- FIX: Usar sourceData (processedData)

      if (selectedMode === 'remove') {
        // El appData.pivotField ya fue seteado en el Paso 3 (ej. RUT_PIVOTE_LIMPIO)
        dataToProcess = eliminateDuplicatesReal(sourceData, appData.pivotField); // <-- FIX: Usar sourceData
      }

      // Actualizar el estado global con los datos procesados (o filtrados)
      updateAppData({
        processingMode: selectedMode,
        processedData: dataToProcess
      });
    };

    // Calcular los registros únicos para la alerta (FIX v6.5.1)
    const uniqueRecordsCount = () => {
      // El número de únicos (ej. 1,237) se calcula en el Paso 3.
      // Lo leemos directamente de appData.
      return appData.uniqueCount || sourceData.length - appData.duplicateCount;
    };
    return /*#__PURE__*/React.createElement("div", {
      className: "card"
    }, /*#__PURE__*/React.createElement("h2", {
      className: "card-title"
    }, "\u26A0 Paso 4: Modo de Procesamiento"), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle"
    }, "Selecciona c\xF3mo deseas manejar los ", appData.duplicateCount.toLocaleString(), " duplicados detectados"), /*#__PURE__*/React.createElement("div", {
      className: "option-cards"
    }, /*#__PURE__*/React.createElement("div", {
      className: `option-card ${mode === 'keep' ? 'selected' : ''}`,
      onClick: () => handleModeSelect('keep')
    }, /*#__PURE__*/React.createElement("div", {
      className: "option-card-title"
    }, "\uD83D\uDCCB Mantener Duplicados"), /*#__PURE__*/React.createElement("div", {
      className: "option-card-description"
    }, "Conserva todos los registros tal como est\xE1n, sin modificaciones.")), /*#__PURE__*/React.createElement("div", {
      className: `option-card ${mode === 'normalize' ? 'selected' : ''}`,
      onClick: () => handleModeSelect('normalize')
    }, /*#__PURE__*/React.createElement("div", {
      className: "option-card-title"
    }, "\uD83D\uDD04 Duplicados a \xDAnicos"), /*#__PURE__*/React.createElement("div", {
      className: "option-card-description"
    }, "Normaliza horizontalmente campos repetibles (recomendado).")), /*#__PURE__*/React.createElement("div", {
      className: `option-card ${mode === 'remove' ? 'selected' : ''}`,
      onClick: () => handleModeSelect('remove')
    }, /*#__PURE__*/React.createElement("div", {
      className: "option-card-title"
    }, "\uD83D\uDDD1\uFE0F Eliminar Duplicados"), /*#__PURE__*/React.createElement("div", {
      className: "option-card-description"
    }, "Mantiene solo el primer registro por cada valor pivote."))), mode === 'remove' && /*#__PURE__*/React.createElement("div", {
      className: "alert alert-info",
      style: {
        marginTop: '1.5rem'
      }
    }, "Se mantendr\xE1n ", uniqueRecordsCount().toLocaleString(), " registros \xFAnicos."), /*#__PURE__*/React.createElement("div", {
      className: "nav-buttons"
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      onClick: prevStep
    }, "\u2190 Atr\xE1s"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: nextStep,
      disabled: !mode
    }, "Continuar \u2192")));
  }

  // Step 5: Normalization (Modificado para usar processedData)
  function Step5Normalization({
    appData,
    updateAppData,
    nextStep,
    prevStep
  }) {
    const [uniqueFields, setUniqueFields] = useState(appData.uniqueFields.length > 0 ? appData.uniqueFields : [appData.pivotField]);
    const [normalizedFields, setNormalizedFields] = useState(appData.normalizedFields || []);

    // Usar los datos procesados del paso anterior como base
    const sourceData = appData.processedData.length > 0 ? appData.processedData : appData.data;
    // Usar las columnas de los datos procesados (que incluyen RUT_NUMERO, etc.)
    const sourceColumns = sourceData.length > 0 ? Object.keys(sourceData[0]) : appData.columns;
    useEffect(() => {
      if (appData.normalizedFields.length > 0 || appData.uniqueFields.length > 1) return;

      // --- FIX: Usar sourceData ---
      const grouped = {};
      sourceData.forEach(row => {
        const pv = String(row[appData.pivotField] || '').trim();
        if (!grouped[pv]) grouped[pv] = [];
        grouped[pv].push(row);
      });
      // --- FIN FIX ---

      // Sugerir campos únicos y normalizables
      const suggested_unique = [appData.pivotField];
      // Añadir automáticamente las nuevas columnas de RUT como 'únicas' si existen
      const rutCols = ['RUT_NUMERO', 'DV_CALCULADO', 'RUT_CON_DV', 'RUT_STATUS'];
      rutCols.forEach(rutCol => {
        if (sourceColumns.includes(rutCol) && !suggested_unique.includes(rutCol)) {
          suggested_unique.push(rutCol);
        }
      });
      const suggested_normalized = [];

      // --- FIX: Usar sourceColumns ---
      sourceColumns.forEach(col => {
        if (suggested_unique.includes(col)) return; // Ya está en únicos (Pivote o RUTs)

        let isRepeated = false;
        for (const group of Object.values(grouped)) {
          if (group.length > 1) {
            const vals = new Set(group.map(r => r[col]).filter(v => v));
            if (vals.size > 1) {
              isRepeated = true;
              break;
            }
          }
        }
        if (isRepeated) suggested_normalized.push(col);else suggested_unique.push(col);
      });
      setUniqueFields(suggested_unique);
      setNormalizedFields(suggested_normalized);
    }, []); // Depender de las fuentes de datos correctas

    const moveToUnique = field => {
      setNormalizedFields(prev => prev.filter(f => f !== field));
      if (!uniqueFields.includes(field)) {
        setUniqueFields(prev => [...prev, field]);
      }
    };
    const moveToNormalized = field => {
      // Prevenir mover el pivote o las columnas RUT generadas
      const protectedCols = [appData.pivotField, 'RUT_NUMERO', 'DV_CALCULADO', 'RUT_CON_DV', 'RUT_STATUS'];
      if (protectedCols.includes(field)) return;
      setUniqueFields(prev => prev.filter(f => f !== field));
      if (!normalizedFields.includes(field)) {
        setNormalizedFields(prev => [...prev, field]);
      }
    };
    const handleApplyNormalization = () => {
      const grouped = {};
      // --- FIX: Usar sourceData ---
      sourceData.forEach(row => {
        const pv = String(row[appData.pivotField] || '').trim();
        if (!grouped[pv]) grouped[pv] = [];
        grouped[pv].push(row);
      });
      // --- FIN FIX ---

      const normalizedData = [];
      const maxCount = Math.max(1, ...Object.values(grouped).map(g => g.length));
      Object.keys(grouped).forEach(pv => {
        const group = grouped[pv];
        const result = {};
        uniqueFields.forEach(field => {
          result[field] = group[0][field] || '';
        });
        normalizedFields.forEach(field => {
          for (let i = 1; i <= maxCount; i++) {
            result[`${field}_${i}`] = (group[i - 1] ? group[i - 1][field] : '') || '';
          }
        });
        normalizedData.push(result);
      });
      const newCols = [...uniqueFields];
      normalizedFields.forEach(field => {
        for (let i = 1; i <= maxCount; i++) {
          newCols.push(`${field}_${i}`);
        }
      });

      // Guardar los datos normalizados en el estado global
      updateAppData({
        processedData: normalizedData,
        columns: newCols,
        uniqueFields,
        normalizedFields
      });
      nextStep();
    };

    // Columnas protegidas (Pivote y RUTs generados)
    const protectedCols = [appData.pivotField, 'RUT_NUMERO', 'DV_CALCULADO', 'RUT_CON_DV', 'RUT_STATUS'];
    return /*#__PURE__*/React.createElement("div", {
      className: "card"
    }, /*#__PURE__*/React.createElement("h2", {
      className: "card-title"
    }, "\uD83D\uDD04 Paso 5: Normalizaci\xF3n (Duplicados a Columnas)"), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle"
    }, /*#__PURE__*/React.createElement("strong", null, "Campos \xDAnicos:"), " Conservan 1 valor por pivote (ej: RUT, Nombre).", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("strong", null, "Campos Normalizables:"), " Se expanden a CAMPO_1, CAMPO_2... (ej: Fono, Direcci\xF3n)."), /*#__PURE__*/React.createElement("div", {
      className: "grid grid-2",
      style: {
        marginTop: '2rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "card",
      style: {
        background: 'rgba(32, 178, 170, 0.05)',
        border: '2px solid var(--success)'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        color: 'var(--success)',
        marginTop: 0,
        marginBottom: '1rem'
      }
    }, "\u2713 Campos \xDAnicos"), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle",
      style: {
        marginTop: '-1rem'
      }
    }, "Click para mover a Normalizables \u2192"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxHeight: '400px',
        overflowY: 'auto'
      }
    }, uniqueFields.map(field => /*#__PURE__*/React.createElement("div", {
      key: field,
      onClick: () => moveToNormalized(field),
      className: "btn",
      style: {
        background: protectedCols.includes(field) ? 'var(--success)' : 'var(--background)',
        color: protectedCols.includes(field) ? 'white' : 'var(--text-dark)',
        cursor: protectedCols.includes(field) ? 'not-allowed' : 'pointer',
        justifyContent: 'flex-start',
        width: '100%',
        border: '1px solid var(--border)'
      }
    }, protectedCols.includes(field) && '🔑 ', field)))), /*#__PURE__*/React.createElement("div", {
      className: "card",
      style: {
        background: 'rgba(255, 140, 0, 0.05)',
        border: '2px solid var(--warning)'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        color: 'var(--warning)',
        marginTop: 0,
        marginBottom: '1rem'
      }
    }, "\u2194 Campos Normalizables"), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle",
      style: {
        marginTop: '-1rem'
      }
    }, "\u2190 Click para mover a \xDAnicos"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        maxHeight: '400px',
        overflowY: 'auto'
      }
    }, normalizedFields.map(field => /*#__PURE__*/React.createElement("div", {
      key: field,
      onClick: () => moveToUnique(field),
      className: "btn",
      style: {
        background: 'var(--background)',
        color: 'var(--text-dark)',
        cursor: 'pointer',
        justifyContent: 'flex-start',
        width: '100%',
        border: '1px solid var(--border)'
      }
    }, field))))), /*#__PURE__*/React.createElement("div", {
      className: "nav-buttons"
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      onClick: prevStep
    }, "\u2190 Atr\xE1s"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-success",
      onClick: handleApplyNormalization
    }, "\u2713 Aplicar Normalizaci\xF3n \u2192")));
  }

  // Step 6: Phones (Componente reescrito v4)
  function Step6Phones({
    appData,
    updateAppData,
    nextStep,
    prevStep
  }) {
    // --- INICIO ESTADO (FASE 1) ---
    const [telefonosUnicos, setTelefonosUnicos] = useState([]);
    const [paresVinculados, setParesVinculados] = useState([]);
    const [prioritizeCellphones, setPrioritizeCellphones] = useState(appData.prioritizeCellphones || false);
    const sourceData = appData.processedData.length > 0 ? appData.processedData : appData.data;
    const sourceColumns = sourceData.length > 0 ? Object.keys(sourceData[0]) : appData.columns || [];
    // --- FIN ESTADO (FASE 1) ---

    // --- INICIO FUNCIONES UI (FASE 2) ---
    const addTelefonoUnico = () => {
      if (telefonosUnicos.length + paresVinculados.length >= 10) return;
      setTelefonosUnicos(prev => [...prev, {
        id: Date.now(),
        col: ''
      }]);
    };
    const removeTelefonoUnico = id => {
      setTelefonosUnicos(prev => prev.filter(item => item.id !== id));
    };
    const updateTelefonoUnico = (id, newColumn) => {
      setTelefonosUnicos(prev => prev.map(item => item.id === id ? {
        ...item,
        col: newColumn
      } : item));
    };
    const addParVinculado = () => {
      if (telefonosUnicos.length + paresVinculados.length >= 10) return;
      setParesVinculados(prev => [...prev, {
        id: Date.now(),
        area: '',
        fono: ''
      }]);
    };
    const removeParVinculado = id => {
      setParesVinculados(prev => prev.filter(item => item.id !== id));
    };
    const updateParVinculado = (id, field, newColumn) => {
      setParesVinculados(prev => prev.map(item => item.id === id ? {
        ...item,
        [field]: newColumn
      } : item));
    };
    // --- FIN FUNCIONES UI (FASE 2) ---

    // --- INICIO LÓGICA PREDICTIVA (FASE 3) ---
    useEffect(() => {
      if (appData.phoneFields?.unicos || appData.phoneFields?.pares) {
        setTelefonosUnicos(appData.phoneFields.unicos || []);
        setParesVinculados(appData.phoneFields.pares || []);
        return;
      }
      if (telefonosUnicos.length > 0 || paresVinculados.length > 0) return;
      const columnas = [...sourceColumns];
      const unicosDetectados = [];
      const paresDetectados = [];
      const patronesUnicos = /CELULAR|MOVIL|WSP|WHATSAPP/i;
      columnas.forEach(col => {
        if (patronesUnicos.test(col)) {
          unicosDetectados.push({
            id: Date.now() + Math.random(),
            col: col
          });
        }
      });
      const patronesArea = /AREA|CODIGO|PREFIJO/i;
      const patronesFono = /FONO|TELEFONO/i;
      const areas = columnas.filter(col => patronesArea.test(col));
      const fonos = columnas.filter(col => patronesFono.test(col) && !patronesUnicos.test(col));
      const maxPares = Math.min(areas.length, fonos.length);
      for (let i = 0; i < maxPares; i++) {
        if (areas[i] && fonos[i]) {
          paresDetectados.push({
            id: Date.now() + Math.random(),
            area: areas[i],
            fono: fonos[i]
          });
        }
      }
      const patronesFijoSolos = /FONO|TELEFONO|FIJO/i;
      columnas.forEach(col => {
        if (patronesFijoSolos.test(col) && !patronesUnicos.test(col) && !paresDetectados.some(p => p.fono === col)) {
          paresDetectados.push({
            id: Date.now() + Math.random(),
            area: '',
            fono: col
          });
        }
      });
      setTelefonosUnicos(unicosDetectados.slice(0, 10));
      const paresLim = Math.max(0, 10 - unicosDetectados.length);
      setParesVinculados(paresDetectados.slice(0, paresLim));
    }, [sourceColumns]);
    // --- FIN LÓGICA PREDICTIVA (FASE 3) ---

    // --- INICIO LÓGICA DE LIMPIEZA (FASE 4) ---
    const cleanPreJoin = phone => {
      if (!phone) return '';
      return String(phone).replace(/[^0-9]/g, '');
    };
    const cleanPostJoin = phone => {
      if (!phone) return '';

      // 1. Limpieza base
      let cleaned = String(phone).replace(/[^0-9]/g, '');

      // 2. BLINDAJE DE PREFIJOS (Ajuste Solicitado)
      // Solo quitamos '56' si el total son 11 dígitos (formato completo internacional).
      // Si son 8 dígitos (tu caso 56954348), NO se quita, se preserva.
      if (cleaned.length === 11 && cleaned.startsWith('56')) {
        cleaned = cleaned.substring(2);
      }
      // Solo quitamos el '0' si el total son 10 dígitos.
      else if (cleaned.length === 10 && cleaned.startsWith('0')) {
        cleaned = cleaned.substring(1);
      }

      // 3. Estandarización a 9 dígitos
      // Si quedaron 8 dígitos (sea fijo o celular sin 9), agregamos 9 al inicio.
      if (cleaned.length === 8) {
        cleaned = '9' + cleaned;
      }
      // Si tiene más de 9 (basura al inicio), tomamos los últimos 9.
      else if (cleaned.length > 9) {
        cleaned = cleaned.slice(-9);
      }

      // 4. Validación final
      // Si después de todo tiene menos de 8 dígitos, es inválido.
      if (cleaned.length < 8) {
        return '';
      }
      return cleaned;
    };

    // ESTA FUNCIÓN SE MANTIENE EXACTAMENTE IGUAL (Preserva la inteligencia de iteración)
    const processRowPhones = row => {
      const phones = [];
      const seen = new Set();
      let duplicateCount = 0;
      let originalCount = 0;

      // Procesar Teléfonos Únicos
      telefonosUnicos.forEach(unico => {
        if (!unico.col) return;
        const val = row[unico.col];
        // Usamos la nueva lógica cleanPostJoin
        const cleaned = cleanPostJoin(cleanPreJoin(val));
        if (cleaned) {
          originalCount++;
          if (!seen.has(cleaned)) {
            phones.push(cleaned);
            seen.add(cleaned);
          } else {
            duplicateCount++;
          }
        }
      });

      // Procesar Pares Vinculados (Área + Fono)
      paresVinculados.forEach(par => {
        if (!par.fono) return;
        const areaLimpia = cleanPreJoin(row[par.area] || '');
        const fonoLimpio = cleanPreJoin(row[par.fono] || '');
        if (fonoLimpio) {
          originalCount++;
          const concatenated = areaLimpia + fonoLimpio;
          // Usamos la nueva lógica cleanPostJoin
          const cleaned = cleanPostJoin(concatenated);
          if (cleaned && !seen.has(cleaned)) {
            phones.push(cleaned);
            seen.add(cleaned);
          } else if (cleaned) {
            duplicateCount++;
          }
        }
      });
      return {
        phones,
        duplicateCount
      };
    };
    // --- FIN LÓGICA DE LIMPIEZA (FASE 4) ---

    // --- INICIO HANDLE CONTINUE (FASE 4) ---

    const handleContinue = () => {
      let totalHorizontalDuplicates = 0;
      let maxPhonesFound = 0;

      // Fase 1: Procesar teléfonos y calcular máximo
      const tempProcessed = sourceData.map(row => {
        const {
          phones: allPhones,
          duplicateCount
        } = processRowPhones(row);
        totalHorizontalDuplicates += duplicateCount;
        if (prioritizeCellphones) {
          const cellphones = allPhones.filter(p => p.startsWith('9'));
          const landlines = allPhones.filter(p => !p.startsWith('9'));
          allPhones.length = 0;
          allPhones.push(...cellphones, ...landlines);
        }

        // Si está vacío, asignamos el default (como string temporalmente)
        if (allPhones.length === 0) {
          allPhones.push('999999999');
        }

        // Actualizar el máximo global para crear columnas dinámicas
        if (allPhones.length > maxPhonesFound) {
          maxPhonesFound = allPhones.length;
        }
        return {
          row,
          allPhones
        };
      });

      // Fase 2: Asignar columnas dinámicas y formato número
      const processedData = tempProcessed.map(({
        row,
        allPhones
      }) => {
        const newRow = {
          ...row
        };

        // Iterar solo hasta el máximo encontrado en toda la base (Dinámico)
        for (let i = 0; i < maxPhonesFound; i++) {
          const phoneStr = allPhones[i];
          // MEJORA C: Formato Número
          // Si existe valor, convertir a Number. Si no, dejar string vacío.
          newRow[`TEL_${i + 1}`] = phoneStr ? Number(phoneStr) : '';
        }
        return newRow;
      });
      updateAppData({
        phoneFields: {
          unicos: telefonosUnicos,
          pares: paresVinculados
        },
        prioritizeCellphones,
        processedData: processedData,
        horizontalDuplicateCount: totalHorizontalDuplicates
      });
      nextStep();
    };

    // --- FIN HANDLE CONTINUE (FASE 4) ---

    return /*#__PURE__*/React.createElement("div", {
      className: "card"
    }, /*#__PURE__*/React.createElement("h2", {
      className: "card-title"
    }, "\uD83D\uDCDE Paso 6: Depuraci\xF3n de Tel\xE9fonos"), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle"
    }, "Define c\xF3mo agrupar y limpiar los tel\xE9fonos. Elige entre tel\xE9fonos \xFAnicos o pares (\xC1rea + Fono). L\xEDmite de 10 tel\xE9fonos finales."), /*#__PURE__*/React.createElement("div", {
      className: "grid grid-2"
    }, /*#__PURE__*/React.createElement("div", {
      className: "card",
      style: {
        background: 'rgba(0, 168, 232, 0.05)'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      className: "card-title",
      style: {
        fontSize: '1.1rem',
        color: 'var(--accent)'
      }
    }, "1. Tel\xE9fonos \xDAnicos"), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle",
      style: {
        marginTop: '-1rem'
      }
    }, "Columnas que ya son un tel\xE9fono completo (ej: CELULAR, MOVIL)."), telefonosUnicos.map((unico, index) => /*#__PURE__*/React.createElement("div", {
      key: unico.id,
      className: "grid grid-3",
      style: {
        gap: '0.5rem',
        alignItems: 'center',
        marginBottom: '0.5rem'
      }
    }, /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      style: {
        gridColumn: 'span 2'
      },
      value: unico.col,
      onChange: e => updateTelefonoUnico(unico.id, e.target.value)
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "-- Seleccionar Columna --"), sourceColumns.map(col => /*#__PURE__*/React.createElement("option", {
      key: col,
      value: col
    }, col))), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-error",
      style: {
        padding: '0.5rem',
        background: 'var(--error)'
      },
      onClick: () => removeTelefonoUnico(unico.id)
    }, "\u2715"))), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-secondary",
      style: {
        width: '100%',
        marginTop: '1rem',
        background: 'var(--accent)'
      },
      onClick: addTelefonoUnico,
      disabled: telefonosUnicos.length + paresVinculados.length >= 10
    }, "+ A\xF1adir Tel\xE9fono \xDAnico")), /*#__PURE__*/React.createElement("div", {
      className: "card",
      style: {
        background: 'rgba(255, 140, 0, 0.05)'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      className: "card-title",
      style: {
        fontSize: '1.1rem',
        color: 'var(--warning)'
      }
    }, "2. Pares Vinculados"), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle",
      style: {
        marginTop: '-1rem'
      }
    }, "Columnas que deben unirse (ej: AREA + FONO_FIJO)."), paresVinculados.map((par, index) => /*#__PURE__*/React.createElement("div", {
      key: par.id,
      style: {
        borderBottom: '2px solid var(--border)',
        paddingBottom: '1rem',
        marginBottom: '1rem'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "grid grid-2",
      style: {
        gap: '0.5rem',
        alignItems: 'center',
        marginBottom: '0.5rem'
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label",
      style: {
        marginBottom: 0
      }
    }, "C\xF3d. \xC1rea"), /*#__PURE__*/React.createElement("label", {
      className: "form-label",
      style: {
        marginBottom: 0
      }
    }, "N\xB0 Tel\xE9fono"), /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      value: par.area,
      onChange: e => updateParVinculado(par.id, 'area', e.target.value)
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "-- Col. \xC1rea (Opcional) --"), sourceColumns.map(col => /*#__PURE__*/React.createElement("option", {
      key: col,
      value: col
    }, col))), /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      value: par.fono,
      onChange: e => updateParVinculado(par.id, 'fono', e.target.value)
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "-- Col. Fono (Requerido) --"), sourceColumns.map(col => /*#__PURE__*/React.createElement("option", {
      key: col,
      value: col
    }, col)))), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-error",
      style: {
        width: '100%',
        marginTop: '0.5rem',
        background: 'var(--error)',
        padding: '0.25rem'
      },
      onClick: () => removeParVinculado(par.id)
    }, "\u2715 Quitar Par ", index + 1))), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-secondary",
      style: {
        width: '100%',
        marginTop: '1rem',
        background: 'var(--warning)',
        color: 'var(--text-dark)'
      },
      onClick: addParVinculado,
      disabled: telefonosUnicos.length + paresVinculados.length >= 10
    }, "+ A\xF1adir Par (\xC1rea + Fono)"))), /*#__PURE__*/React.createElement("div", {
      className: "checkbox-group",
      style: {
        marginTop: '2rem',
        borderTop: '1px solid var(--border)',
        paddingTop: '1rem'
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "checkbox",
      id: "cb-prioritize",
      className: "checkbox",
      checked: prioritizeCellphones,
      onChange: e => setPrioritizeCellphones(e.target.checked)
    }), /*#__PURE__*/React.createElement("label", {
      htmlFor: "cb-prioritize",
      style: {
        cursor: 'pointer'
      }
    }, /*#__PURE__*/React.createElement("strong", null, "\uD83D\uDD04 Priorizar Celulares"), " (n\xFAmeros que empiezan con 9)")), /*#__PURE__*/React.createElement("div", {
      className: "nav-buttons"
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      onClick: prevStep
    }, "\u2190 Atr\xE1s"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: handleContinue,
      disabled: telefonosUnicos.length === 0 && paresVinculados.length === 0
    }, "Aplicar y Continuar \u2192")));
  }

  // Step 6.6: Junk Phones (Modificado v4 para mostrar reporte)
  function Step6p6JunkPhones({
    appData,
    updateAppData,
    nextStep,
    prevStep
  }) {
    const [previewData, setPreviewData] = useState([]);
    const [junkFoundCount, setJunkFoundCount] = useState(0);
    const [didRun, setDidRun] = useState(false);
    const [processedData, setProcessedData] = useState(appData.processedData);
    const [horizontalDuplicates, setHorizontalDuplicates] = useState(0);
    useEffect(() => {
      if (appData.horizontalDuplicateCount > 0) {
        setHorizontalDuplicates(appData.horizontalDuplicateCount);
      }
    }, [appData.horizontalDuplicateCount]);
    const isJunkPhone = phone => {
      if (!phone) return false;
      const tel = String(phone).trim();
      if (tel.length < 8) return true;
      if (tel.length > 9) return true;
      if (/[^0-9]/.test(tel)) return true;
      if (new Set(tel.split('')).size === 1) return true;
      if (tel.startsWith('9')) {
        const resto = tel.substring(1);
        if (new Set(resto.split('')).size === 1) return true;
      }
      const digits = tel.split('').map(Number);
      let isSequential = true;
      for (let i = 1; i < digits.length; i++) {
        if (digits[i] !== digits[i - 1] + 1) {
          isSequential = false;
          break;
        }
      }
      if (isSequential && digits.length >= 8) return true;
      return false;
    };
    const handleRunCleanup = () => {
      let modifiedCount = 0;
      const preview = [];
      const newData = appData.processedData.map(row => {
        const telColumns = Object.keys(row).filter(col => col.match(/^TEL_\d+$/)).sort((a, b) => {
          const numA = parseInt(a.split('_')[1]);
          const numB = parseInt(b.split('_')[1]);
          return numA - numB;
        });
        if (telColumns.length === 0) return row;
        const originalTels = telColumns.map(col => row[col] || '').filter(Boolean);
        const validTels = [];
        for (const tel of originalTels) {
          if (!isJunkPhone(tel)) {
            validTels.push(tel);
          }
        }
        if (validTels.length < originalTels.length) {
          modifiedCount++;
          if (preview.length < 100) {
            preview.push({
              before: originalTels,
              after: validTels
            });
          }
          const newRow = {
            ...row
          };
          for (let i = 0; i < telColumns.length; i++) {
            newRow[telColumns[i]] = validTels[i] || '';
          }
          return newRow;
        }
        return row;
      });
      setJunkFoundCount(modifiedCount);
      setPreviewData(preview);
      setProcessedData(newData);
      setDidRun(true);
    };

    // Función auxiliar para asegurar TEL_1
    const ensureTel1 = data => {
      let emptyTelCount = 0;
      const fixedData = data.map(row => {
        // Si TEL_1 no existe o está vacío (falsy), asignar 999999999
        if (!row.TEL_1) {
          emptyTelCount++;
          return {
            ...row,
            TEL_1: 999999999
          };
        }
        return row;
      });
      return {
        fixedData,
        emptyTelCount
      };
    };
    const handleContinue = () => {
      const {
        fixedData,
        emptyTelCount
      } = ensureTel1(processedData);
      updateAppData({
        processedData: fixedData,
        emptyTelFixedCount: emptyTelCount,
        // Guardamos dato para reporte
        junkPhonesRemovedCount: junkFoundCount // Guardamos dato para reporte
      });
      nextStep();
    };
    const handleSkip = () => {
      // Incluso si salta la limpieza, validamos TEL_1
      const {
        fixedData,
        emptyTelCount
      } = ensureTel1(appData.processedData);
      updateAppData({
        processedData: fixedData,
        emptyTelFixedCount: emptyTelCount,
        junkPhonesRemovedCount: 0
      });
      nextStep();
    };
    const renderPhoneList = phones => /*#__PURE__*/React.createElement("div", {
      className: "phone-list"
    }, phones.map((phone, idx) => /*#__PURE__*/React.createElement("span", {
      key: idx,
      style: isJunkPhone(phone) ? {
        textDecoration: 'line-through',
        background: 'var(--error)',
        color: 'white'
      } : {}
    }, phone)), phones.length === 0 && /*#__PURE__*/React.createElement("span", null, "(vac\xEDo)"));
    return /*#__PURE__*/React.createElement("div", {
      className: "card"
    }, /*#__PURE__*/React.createElement("h2", {
      className: "card-title"
    }, "\uD83D\uDDD1\uFE0F Paso 6.6: Limpieza de Tel\xE9fonos Basura (Opcional)"), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle"
    }, "Detecta y elimina n\xFAmeros inv\xE1lidos (ej: '1111111', '123456', o con letras)."), horizontalDuplicates > 0 && /*#__PURE__*/React.createElement("div", {
      className: "alert alert-info"
    }, "\u2139\uFE0F Reporte del Paso 6: Se eliminaron ", /*#__PURE__*/React.createElement("strong", null, horizontalDuplicates.toLocaleString()), " tel\xE9fonos duplicados horizontalmente (dentro de las mismas filas)."), !didRun ? /*#__PURE__*/React.createElement("div", {
      className: "nav-buttons",
      style: {
        borderTop: 'none',
        padding: 0
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      onClick: handleSkip
    }, "\u23ED\uFE0F Saltar este paso"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: handleRunCleanup
    }, "\uD83D\uDD0D Ejecutar Limpieza de Basura")) : /*#__PURE__*/React.createElement(React.Fragment, null, junkFoundCount > 0 ? /*#__PURE__*/React.createElement("div", {
      className: "alert alert-success"
    }, "\u2705 Se encontraron y eliminaron tel\xE9fonos basura en ", /*#__PURE__*/React.createElement("strong", null, junkFoundCount.toLocaleString()), " filas.") : /*#__PURE__*/React.createElement("div", {
      className: "alert alert-info"
    }, "\u2705 No se encontraron tel\xE9fonos basura en la base."), previewData.length > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("p", null, "Mostrando las primeras ", previewData.length, " filas modificadas:"), /*#__PURE__*/React.createElement("div", {
      className: "table-container"
    }, /*#__PURE__*/React.createElement("table", {
      className: "table"
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Antes"), /*#__PURE__*/React.createElement("th", null, "Despu\xE9s"))), /*#__PURE__*/React.createElement("tbody", null, previewData.map((item, idx) => /*#__PURE__*/React.createElement("tr", {
      key: idx
    }, /*#__PURE__*/React.createElement("td", null, renderPhoneList(item.before)), /*#__PURE__*/React.createElement("td", null, renderPhoneList(item.after)))))))), /*#__PURE__*/React.createElement("div", {
      className: "nav-buttons"
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      onClick: prevStep
    }, "\u2190 Atr\xE1s"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: handleContinue
    }, "Continuar \u2192"))), !didRun && /*#__PURE__*/React.createElement("div", {
      className: "nav-buttons",
      style: {
        marginTop: '2rem'
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      onClick: prevStep
    }, "\u2190 Atr\xE1s"), /*#__PURE__*/React.createElement("div", null)));
  }

  // Step 7: Campaign Selection (Modificado v6.4 con Mantenedor)
  // Step 7: Campaign Selection (Limpieza Final: Solo Selector Nexus)
  function Step7Campaign({
    appData,
    updateAppData,
    nextStep,
    prevStep
  }) {
    const [campaign, setCampaign] = useState(appData.campaign || '');
    const [baseSuffix, setBaseSuffix] = useState(appData.baseSuffix || '');
    const [baseDate, setBaseDate] = useState(new Date().toISOString().split('T')[0]);
    const generateBaseName = () => {
      const [year, month, day] = baseDate.split('-');
      return `BASE_${day}_${month}_${year}${baseSuffix ? '_' + baseSuffix : ''}`;
    };
    const generateMonthName = () => {
      const date = new Date(baseDate + 'T12:00:00');
      const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      const year = String(date.getFullYear()).slice(-2);
      return `${months[date.getMonth()]}_${year}`;
    };
    const handleContinue = () => {
      updateAppData({
        campaign,
        baseName: generateBaseName(),
        baseMonth: generateMonthName(),
        baseSuffix
      });
      nextStep();
    };
    return /*#__PURE__*/React.createElement("div", {
      className: "card"
    }, /*#__PURE__*/React.createElement("h2", {
      className: "card-title"
    }, "\uD83C\uDFF7\uFE0F Paso 7: Campa\xF1a y Base"), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle"
    }, "Configura la campa\xF1a y nombres de la base. (Las campa\xF1as se gestionan desde el men\xFA Admin de Nexus)."), /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "Seleccionar Campa\xF1a (Desde Nexus)"), /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      value: campaign,
      onChange: e => setCampaign(e.target.value)
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "-- Selecciona una campa\xF1a --"), appData.campaigns.map(camp => /*#__PURE__*/React.createElement("option", {
      key: camp.name,
      value: camp.name
    }, camp.name))), appData.campaigns.length === 0 && /*#__PURE__*/React.createElement("div", {
      className: "alert alert-error",
      style: {
        marginTop: '0.5rem'
      }
    }, "\u26A0\uFE0F No se encontraron campa\xF1as. Por favor crea campa\xF1as en el m\xF3dulo \"Administrador\" de Nexus.")), /*#__PURE__*/React.createElement("div", {
      className: "grid grid-2"
    }, /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "Fecha de Base"), /*#__PURE__*/React.createElement("input", {
      type: "date",
      className: "form-input",
      value: baseDate,
      onChange: e => setBaseDate(e.target.value)
    })), /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "Sufijo (Opcional)"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      className: "form-input",
      placeholder: "ej: FINAL, TEST",
      value: baseSuffix,
      onChange: e => setBaseSuffix(e.target.value.toUpperCase())
    }))), campaign && /*#__PURE__*/React.createElement("div", {
      className: "alert alert-info"
    }, /*#__PURE__*/React.createElement("strong", null, "Vista Previa:"), /*#__PURE__*/React.createElement("br", null), "Base: ", generateBaseName(), /*#__PURE__*/React.createElement("br", null), "Mes de Carga: ", generateMonthName(), /*#__PURE__*/React.createElement("br", null), "Campa\xF1a: ", campaign), /*#__PURE__*/React.createElement("div", {
      className: "nav-buttons"
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      onClick: prevStep
    }, "\u2190 Atr\xE1s"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: handleContinue,
      disabled: !campaign
    }, "Continuar \u2192")));
  }

  // --- MODIFICADO v6.7.3: Step 8 Exclusions (Fix Foco y Lógica) ---

  // --- LÓGICA DE PARSEO DE ARCHIVOS (Movida afuera v6.7.3) ---
  const parseFile_Step8 = file => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const data = e.target.result;
          if (file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
            Papa.parse(data, {
              header: true,
              skipEmptyLines: true,
              complete: results => resolve(results.data),
              error: err => reject(err)
            });
          } else {
            const workbook = XLSX.read(data, {
              type: 'binary'
            });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, {
              defval: '',
              blankrows: false
            });
            resolve(jsonData);
          }
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Error al leer archivo'));
      if (file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
        reader.readAsText(file);
      } else {
        reader.readAsBinaryString(file);
      }
    });
  };

  // --- COMPONENTE HIJO: Tarjeta de Regla (Movido afuera v6.7.3) ---
  function RuleCard_Step8({
    rule,
    mainDataColumns,
    removeRule,
    updateRule,
    updateCriteria
  }) {
    const [isLoadingFile, setIsLoadingFile] = useState(false);
    const [sqlModeRule, setSqlModeRule] = useState(false);
    const [sqlQueryRule, setSqlQueryRule] = useState('');

    // Opciones de valores únicos para los selectores de criterios
    const [exclusionValues, setExclusionValues] = useState([]);
    const [priorityValues, setPriorityValues] = useState([]);
    const handleFileLoad = async file => {
      if (!file) return;
      setIsLoadingFile(true);
      try {
        const data = await parseFile_Step8(file); // Usar la función externa
        if (data.length === 0) throw new Error("El archivo está vacío");
        const columns = Object.keys(data[0] || {});
        const detectedPivot = columns.includes('RUT') ? 'RUT' : columns[0];
        updateRule(rule.id, 'file', file);
        updateRule(rule.id, 'fileName', file.name);
        updateRule(rule.id, 'data', data);
        updateRule(rule.id, 'columns', columns);
        updateRule(rule.id, 'rulePivot', detectedPivot);
      } catch (err) {
        alert(`Error cargando el archivo "${file.name}": ${err.message}`);
      }
      setIsLoadingFile(false);
    };

    // Helper para actualizar valores únicos de los selectores
    const updateUniqueValues = (criteriaType, column) => {
      if (!column || rule.data.length === 0) {
        if (criteriaType === 'exclusionCriteria') setExclusionValues([]);
        if (criteriaType === 'priorityCriteria') setPriorityValues([]);
        return;
      }
      const uniqueSet = new Set();
      rule.data.forEach(row => {
        const val = String(row[column] || '');
        if (val) uniqueSet.add(val);
      });
      const unique = [...uniqueSet].sort();
      if (criteriaType === 'exclusionCriteria') setExclusionValues(unique);
      if (criteriaType === 'priorityCriteria') setPriorityValues(unique);
    };
    useEffect(() => {
      if (rule.data.length > 0) {
        if (rule.exclusionCriteria.column) {
          updateUniqueValues('exclusionCriteria', rule.exclusionCriteria.column);
        }
        if (rule.priorityCriteria.column) {
          updateUniqueValues('priorityCriteria', rule.priorityCriteria.column);
        }
      }
    }, [rule.data]);

    // --- RENDERIZADO DEL CRITERIO (Movido a su propio componente v6.7.3) ---
    const renderCriteriaInputs = criteriaType => {
      const isExclusion = criteriaType === 'exclusionCriteria';
      // FIX: Referenciar la regla correcta (exclusionCriteria o priorityCriteria)
      const criteriaData = isExclusion ? rule.exclusionCriteria : rule.priorityCriteria;
      const uniqueValues = isExclusion ? exclusionValues : priorityValues;
      const {
        column,
        operator,
        values,
        value
      } = criteriaData;
      const handleOperatorChange = e => {
        const newOperator = e.target.value;
        updateCriteria(rule.id, criteriaType, 'operator', newOperator);
        updateCriteria(rule.id, criteriaType, 'values', []);
        updateCriteria(rule.id, criteriaType, 'value', '');
        if (newOperator === 'es_uno_de' || newOperator === 'no_es_uno_de') {
          updateUniqueValues(criteriaType, criteriaData.column);
        }
      };
      const handleColumnChange = e => {
        const newCol = e.target.value;
        updateCriteria(rule.id, criteriaType, 'column', newCol);
        updateCriteria(rule.id, criteriaType, 'values', []);
        updateCriteria(rule.id, criteriaType, 'value', '');
        const currentOperator = criteriaData.operator;
        if (currentOperator === 'es_uno_de' || currentOperator === 'no_es_uno_de') {
          updateUniqueValues(criteriaType, newCol);
        }
      };
      const currentOperator = criteriaData.operator;
      const showMultiSelect = currentOperator === 'es_uno_de' || currentOperator === 'no_es_uno_de';
      return /*#__PURE__*/React.createElement("div", {
        className: "grid grid-3"
      }, /*#__PURE__*/React.createElement("div", {
        className: "form-group",
        style: {
          marginBottom: 0
        }
      }, /*#__PURE__*/React.createElement("label", {
        className: "form-label",
        style: {
          fontSize: '0.9rem'
        }
      }, "Columna"), /*#__PURE__*/React.createElement("select", {
        className: "form-select",
        value: column,
        onChange: handleColumnChange,
        disabled: rule.columns.length === 0
      }, /*#__PURE__*/React.createElement("option", {
        value: ""
      }, isExclusion ? '-- Sin Criterio (Excluir Todo) --' : '-- Sin Criterio --'), rule.columns.map(col => /*#__PURE__*/React.createElement("option", {
        key: col,
        value: col
      }, col)))), /*#__PURE__*/React.createElement("div", {
        className: "form-group",
        style: {
          marginBottom: 0
        }
      }, /*#__PURE__*/React.createElement("label", {
        className: "form-label",
        style: {
          fontSize: '0.9rem'
        }
      }, "Operador"), /*#__PURE__*/React.createElement("select", {
        className: "form-select",
        value: operator,
        onChange: handleOperatorChange,
        disabled: !column
      }, /*#__PURE__*/React.createElement("optgroup", {
        label: "Selecci\xF3n M\xFAltiple"
      }, /*#__PURE__*/React.createElement("option", {
        value: "es_uno_de"
      }, "Es uno de..."), /*#__PURE__*/React.createElement("option", {
        value: "no_es_uno_de"
      }, "No es uno de...")), /*#__PURE__*/React.createElement("optgroup", {
        label: "Texto"
      }, /*#__PURE__*/React.createElement("option", {
        value: "es_igual_a"
      }, "Es igual a"), /*#__PURE__*/React.createElement("option", {
        value: "no_es_igual_a"
      }, "No es igual a"), /*#__PURE__*/React.createElement("option", {
        value: "contiene"
      }, "Contiene"), /*#__PURE__*/React.createElement("option", {
        value: "no_contiene"
      }, "No contiene"), /*#__PURE__*/React.createElement("option", {
        value: "empieza_con"
      }, "Empieza con"), /*#__PURE__*/React.createElement("option", {
        value: "termina_con"
      }, "Termina con")), /*#__PURE__*/React.createElement("optgroup", {
        label: "Num\xE9rico (ej: RUT > 15M)"
      }, /*#__PURE__*/React.createElement("option", {
        value: "mayor_que"
      }, ">"), /*#__PURE__*/React.createElement("option", {
        value: "menor_que"
      }, "<"), /*#__PURE__*/React.createElement("option", {
        value: "mayor_igual_que"
      }, ">="), /*#__PURE__*/React.createElement("option", {
        value: "menor_igual_que"
      }, "<=")))), /*#__PURE__*/React.createElement("div", {
        className: "form-group",
        style: {
          marginBottom: 0
        }
      }, /*#__PURE__*/React.createElement("label", {
        className: "form-label",
        style: {
          fontSize: '0.9rem'
        }
      }, showMultiSelect ? "Valores (Múltiple)" : "Valor"), showMultiSelect ? /*#__PURE__*/React.createElement("select", {
        className: "form-select",
        multiple: true,
        size: "3",
        value: values,
        onChange: e => {
          const selected = Array.from(e.target.selectedOptions, option => option.value);
          // FIX: Usar 'criteriaType' variable
          updateCriteria(rule.id, criteriaType, 'values', selected);
        },
        disabled: !column
      }, uniqueValues.map(val => /*#__PURE__*/React.createElement("option", {
        key: val,
        value: val
      }, val))) : /*#__PURE__*/React.createElement("input", {
        type: "text",
        className: "form-input",
        placeholder: "Escribe un valor",
        value: value,
        onChange: e => updateCriteria(rule.id, criteriaType, 'value', e.target.value),
        disabled: !column
      })));
    };
    return /*#__PURE__*/React.createElement("div", {
      className: "card",
      style: {
        background: 'var(--background)',
        border: '2px solid var(--accent)'
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
        color: 'var(--primary)'
      }
    }, rule.fileName || `Regla ${rule.id}`), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-error",
      style: {
        padding: '0.25rem 0.75rem'
      },
      onClick: () => removeRule(rule.id)
    }, "\u2715 Eliminar Regla")), /*#__PURE__*/React.createElement("div", {
      className: "grid grid-3"
    }, /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "1. Cargar Exclusi\xF3n"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '6px',
        marginBottom: '0.5rem'
      }
    }, /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => setSqlModeRule(false),
      style: {
        padding: '4px 12px',
        borderRadius: '6px',
        fontWeight: 'bold',
        fontSize: '0.75rem',
        border: '2px solid var(--primary)',
        background: !sqlModeRule ? 'var(--primary)' : 'white',
        color: !sqlModeRule ? 'white' : 'var(--primary)',
        cursor: 'pointer'
      }
    }, "\uD83D\uDCC2 Archivo"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => setSqlModeRule(true),
      style: {
        padding: '4px 12px',
        borderRadius: '6px',
        fontWeight: 'bold',
        fontSize: '0.75rem',
        border: '2px solid #3b82f6',
        background: sqlModeRule ? '#3b82f6' : 'white',
        color: sqlModeRule ? 'white' : '#3b82f6',
        cursor: 'pointer'
      }
    }, "\u26A1 SQL")), !sqlModeRule ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("input", {
      type: "file",
      className: "form-input",
      accept: ".xls,.xlsx,.csv,.txt",
      onChange: e => handleFileLoad(e.target.files[0])
    }), isLoadingFile && /*#__PURE__*/React.createElement("div", {
      className: "spinner",
      style: {
        width: '20px',
        height: '20px',
        margin: '0.5rem 0 0 0'
      }
    })) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("textarea", {
      style: {
        width: '100%',
        minHeight: '70px',
        padding: '0.5rem',
        border: '2px solid #3b82f6',
        borderRadius: '6px',
        fontFamily: 'monospace',
        fontSize: '0.8rem',
        resize: 'vertical',
        boxSizing: 'border-box'
      },
      value: sqlQueryRule,
      onChange: e => setSqlQueryRule(e.target.value),
      placeholder: "SELECT col FROM tabla..."
    }), /*#__PURE__*/React.createElement("button", {
      type: "button",
      style: {
        marginTop: '0.4rem',
        padding: '4px 12px',
        borderRadius: '6px',
        fontWeight: 'bold',
        fontSize: '0.8rem',
        background: '#3b82f6',
        color: 'white',
        border: 'none',
        cursor: 'pointer'
      },
      onClick: async () => {
        if (!sqlQueryRule.trim()) return;
        setIsLoadingFile(true);
        try {
          const result = await window.nexusAPI.executeSQL(sqlQueryRule);
          if (!result.success) throw new Error(result.error);
          if (!result.data || result.data.length === 0) throw new Error('Sin resultados.');
          const columns = Object.keys(result.data[0]);
          const detectedPivot = columns.includes('RUT') ? 'RUT' : columns[0];
          updateRule(rule.id, 'fileName', '⚡ SQL');
          updateRule(rule.id, 'data', result.data);
          updateRule(rule.id, 'columns', columns);
          updateRule(rule.id, 'rulePivot', detectedPivot);
        } catch (err) {
          alert('Error SQL: ' + err.message);
        }
        setIsLoadingFile(false);
      }
    }, "\u26A1 Ejecutar"), isLoadingFile && /*#__PURE__*/React.createElement("div", {
      className: "spinner",
      style: {
        width: '20px',
        height: '20px',
        margin: '0.5rem 0 0 0'
      }
    }))), /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "2. Cruce (Base Principal)"), /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      value: rule.mainPivot,
      onChange: e => updateRule(rule.id, 'mainPivot', e.target.value)
    }, mainDataColumns.map(col => /*#__PURE__*/React.createElement("option", {
      key: col,
      value: col
    }, col)))), /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "3. Cruce (Archivo Exclusi\xF3n)"), /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      value: rule.rulePivot,
      onChange: e => updateRule(rule.id, 'rulePivot', e.target.value),
      disabled: rule.columns.length === 0
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, rule.columns.length ? '-- Seleccionar --' : '(Carga un archivo)'), rule.columns.map(col => /*#__PURE__*/React.createElement("option", {
      key: col,
      value: col
    }, col))))), /*#__PURE__*/React.createElement("div", {
      className: "card",
      style: {
        border: '1px solid var(--error)',
        background: 'rgba(220, 20, 60, 0.02)'
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label",
      style: {
        color: 'var(--error)',
        fontWeight: 600
      }
    }, "(Opcional) Criterio de EXCLUSI\xD3N (Ej: ESTADO es BAJA)"), renderCriteriaInputs('exclusionCriteria')), /*#__PURE__*/React.createElement("div", {
      className: "card",
      style: {
        border: '1px solid var(--success)',
        background: 'rgba(32, 178, 170, 0.02)',
        marginTop: '1rem'
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label",
      style: {
        color: 'var(--success)',
        fontWeight: 600
      }
    }, "(Opcional) Criterio de PRIORIDAD (Ej: ESTADO es ALTA)"), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle",
      style: {
        fontSize: '0.85rem',
        marginTop: '-1rem'
      }
    }, "Esto \"salva\" a un registro, incluso si cumple el criterio de exclusi\xF3n."), renderCriteriaInputs('priorityCriteria')));
  }
  ;
  function Step8Exclusions({
    appData,
    updateAppData,
    nextStep,
    prevStep
  }) {
    // --- ESTADO ---
    // FIX v6.7.3: Leer appData.exclusionRules, pero manejar el estado localmente
    const [rules, setRules] = useState(appData.exclusionRules || []);
    const [loading, setLoading] = useState(false);
    const mainDataColumns = appData.processedData.length > 0 ? Object.keys(appData.processedData[0]) : appData.columns;

    // --- MANEJO DE REGLAS ---
    const addRule = () => {
      if (rules.length >= 3) {
        alert("Puedes añadir un máximo de 3 reglas de exclusión.");
        return;
      }
      setRules(prev => [...prev, {
        id: Date.now(),
        file: null,
        fileName: '',
        data: [],
        columns: [],
        mainPivot: appData.pivotField,
        rulePivot: '',
        exclusionCriteria: {
          column: '',
          operator: 'es_uno_de',
          values: [],
          value: ''
        },
        priorityCriteria: {
          column: '',
          operator: 'es_uno_de',
          values: [],
          value: ''
        }
      }]);
    };
    const removeRule = id => {
      if (window.confirm("¿Seguro que quieres eliminar esta regla de exclusión?")) {
        setRules(prev => prev.filter(r => r.id !== id));
      }
    };

    // Estas funciones ahora actualizan el estado 'rules' local
    const updateRule = (id, field, value) => {
      setRules(prev => prev.map(r => r.id === id ? {
        ...r,
        [field]: value
      } : r));
    };
    const updateCriteria = (id, criteriaType, field, value) => {
      setRules(prev => prev.map(r => {
        if (r.id !== id) return r;
        return {
          ...r,
          [criteriaType]: {
            ...r[criteriaType],
            [field]: value
          }
        };
      }));
    };

    // --- LÓGICA DE PROCESAMIENTO (HANDLE CONTINUE) ---
    const handleContinue = () => {
      setLoading(true);
      setTimeout(() => {
        let finalData = [...appData.processedData];

        // 0. Validar Reglas
        for (const rule of rules) {
          if (rule.data.length === 0) {
            alert(`Error: La Regla ${rule.id} no tiene datos. Carga un archivo o elimínala.`);
            setLoading(false);
            return;
          }
          if (!rule.mainPivot || !rule.rulePivot) {
            alert(`Error: La Regla para "${rule.fileName || rule.id}" no tiene los campos pivote seleccionados.`);
            setLoading(false);
            return;
          }
        }
        const masterSaveSet = new Set();
        const masterExcludeSet = new Set();

        // 1. Recorrer cada regla
        for (const rule of rules) {
          const ruleData = rule.data;

          // 2. Construir el "Set de Prioridad" (Salvar)
          if (rule.priorityCriteria.column) {
            ruleData.forEach(row => {
              const pivotValue = String(row[rule.rulePivot] || '').trim();
              if (!pivotValue) return;
              const cellValue = row[rule.priorityCriteria.column];
              if (checkCriteria(cellValue, rule.priorityCriteria)) {
                masterSaveSet.add(pivotValue);
              }
            });
          }

          // 3. Construir el "Set de Exclusión"
          if (!rule.exclusionCriteria.column) {
            ruleData.forEach(row => {
              const pivotValue = String(row[rule.rulePivot] || '').trim();
              if (pivotValue) masterExcludeSet.add(pivotValue);
            });
          } else {
            ruleData.forEach(row => {
              const pivotValue = String(row[rule.rulePivot] || '').trim();
              if (!pivotValue) return;
              const cellValue = row[rule.exclusionCriteria.column];
              if (checkCriteria(cellValue, rule.exclusionCriteria)) {
                masterExcludeSet.add(pivotValue);
              }
            });
          }
        }

        // 4. Reconciliación (Salvar > Excluir)
        masterSaveSet.forEach(pivotToSave => {
          masterExcludeSet.delete(pivotToSave);
        });

        // 5. Aplicar Filtro Final
        if (masterExcludeSet.size > 0) {
          finalData = finalData.filter(row => {
            let shouldExclude = false;
            for (const rule of rules) {
              const mainPivotValue = String(row[rule.mainPivot] || '').trim();
              if (masterExcludeSet.has(mainPivotValue)) {
                shouldExclude = true;
                break;
              }
            }
            return !shouldExclude;
          });
        }

        // 6. Guardar y Continuar
        updateAppData({
          // Guardar el estado local 'rules' en el estado global
          exclusionRules: rules,
          processedData: finalData
        });
        setLoading(false);
        nextStep();
      }, 50);
    };

    // --- RENDERIZADO DEL COMPONENTE PRINCIPAL ---
    return /*#__PURE__*/React.createElement("div", {
      className: "card"
    }, /*#__PURE__*/React.createElement("h2", {
      className: "card-title"
    }, "\uD83D\uDEAB Paso 8: Exclusiones Avanzadas (Opcional)"), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle"
    }, "A\xF1ade hasta 3 reglas de exclusi\xF3n. Puedes cargar m\xFAltiples archivos o aplicar criterios de filtro a cada uno."), rules.map(rule => /*#__PURE__*/React.createElement(RuleCard_Step8, {
      key: rule.id,
      rule: rule,
      mainDataColumns: mainDataColumns,
      removeRule: removeRule,
      updateRule: updateRule,
      updateCriteria: updateCriteria
    })), rules.length < 3 && /*#__PURE__*/React.createElement("button", {
      className: "btn btn-secondary",
      onClick: addRule,
      style: {
        marginTop: '1rem'
      },
      disabled: loading
    }, "+ A\xF1adir Regla de Exclusi\xF3n"), loading && /*#__PURE__*/React.createElement("div", {
      className: "spinner"
    }), /*#__PURE__*/React.createElement("div", {
      className: "nav-buttons"
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      onClick: prevStep,
      disabled: loading
    }, "\u2190 Atr\xE1s"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: handleContinue,
      disabled: loading
    }, loading ? 'Procesando Exclusiones...' : rules.length > 0 ? 'Aplicar y Continuar →' : 'Continuar sin Exclusiones →')));
  }
  {/* --- MODIFICADO v6.3 (Antes v5) --- */}
  function Step9ColumnBuilder({
    appData,
    updateAppData,
    nextStep,
    prevStep
  }) {
    // Estado para reglas de CONCATENACIÓN (existente)
    const [reglas, setReglas] = useState(appData.columnRules || []);

    // --- NUEVO v6.3: Estado para reglas de TRANSFORMACIÓN ---
    const [transformRules, setTransformRules] = useState(appData.transformRules || []);

    // Usar las columnas de processedData, que es el set de datos actual
    const dataColumns = appData.processedData.length > 0 ? Object.keys(appData.processedData[0]) : appData.columns;

    // --- Lógica para REGLAS DE CONCATENACIÓN (Sin cambios) ---
    const addRegla = () => {
      if (reglas.length >= 5) {
        alert("Puedes crear un máximo de 5 columnas de concatenación.");
        return;
      }
      setReglas(prev => [...prev, {
        id: Date.now(),
        type: 'CONCAT',
        // Identificador
        nombre: '',
        separador: ' ',
        cols: ['', '']
      }]);
    };
    const removeRegla = id => {
      setReglas(prev => prev.filter(r => r.id !== id));
    };
    const updateRegla = (id, field, value) => {
      setReglas(prev => prev.map(r => r.id === id ? {
        ...r,
        [field]: value
      } : r));
    };
    const updateReglaColumna = (id, colIndex, value) => {
      setReglas(prev => prev.map(r => {
        if (r.id !== id) return r;
        const newCols = [...r.cols];
        newCols[colIndex] = value;
        if (colIndex === r.cols.length - 1 && value !== '' && r.cols.length < 4) newCols.push('');
        if (value === '' && colIndex >= 2 && colIndex === r.cols.length - 1) newCols.pop();
        return {
          ...r,
          cols: newCols
        };
      }));
    };
    // --- FIN Lógica CONCATENACIÓN ---

    // --- NUEVO v6.3: Lógica para REGLAS DE TRANSFORMACIÓN ---
    const addTransformRule = () => {
      if (transformRules.length >= 3) {
        // Límite de 3
        alert("Puedes crear un máximo de 3 columnas de transformación.");
        return;
      }
      setTransformRules(prev => [...prev, {
        id: Date.now(),
        type: 'TRANSFORM',
        // Identificador
        nombre: '',
        sourceColumn: '',
        transformType: 'extract_number',
        // Tipo por defecto
        staticValue: '',
        subStart: 0,
        subLength: '',
        char: ''
      }]);
    };
    const removeTransformRule = id => {
      setTransformRules(prev => prev.filter(r => r.id !== id));
    };
    const updateTransformRule = (id, field, value) => {
      setTransformRules(prev => prev.map(r => r.id === id ? {
        ...r,
        [field]: value
      } : r));
    };
    // --- FIN Lógica TRANSFORMACIÓN ---

    // --- Lógica de PROCESAMIENTO MODIFICADA v6.3 ---
    const handleContinue = () => {
      let newData = [...appData.processedData];
      let newColumns = [...dataColumns]; // Empezar con las columnas existentes
      let allNewNames = new Set();

      // 1. Validar TODAS las reglas primero (ambos tipos)
      try {
        // Validar Concatenación
        for (const r of reglas) {
          if (!r.nombre) throw new Error("Dale un nombre a todas las columnas de Concatenación.");
          if (newColumns.includes(r.nombre) || allNewNames.has(r.nombre)) {
            throw new Error(`La columna "${r.nombre}" ya existe o está duplicada.`);
          }
          if (r.cols.filter(c => c).length < 2) {
            throw new Error(`La regla para "${r.nombre}" debe tener al menos 2 columnas.`);
          }
          allNewNames.add(r.nombre);
        }

        // Validar Transformación
        for (const r of transformRules) {
          if (!r.nombre) throw new Error("Dale un nombre a todas las columnas de Transformación.");
          if (newColumns.includes(r.nombre) || allNewNames.has(r.nombre)) {
            throw new Error(`La columna "${r.nombre}" ya existe o está duplicada.`);
          }
          if (!r.sourceColumn && r.transformType !== 'static') {
            throw new Error(`Selecciona una columna de origen para "${r.nombre}".`);
          }
          allNewNames.add(r.nombre);
        }
      } catch (err) {
        alert(err.message);
        return; // Detener si hay error
      }

      // 2. Procesar Concatenación
      if (reglas.length > 0) {
        newData = newData.map(row => {
          const newRow = {
            ...row
          };
          reglas.forEach(r => {
            const valores = r.cols.map(colName => String(row[colName] || '').trim()).filter(val => val); // Filtrar vacíos
            newRow[r.nombre] = valores.join(r.separador);
          });
          return newRow;
        });
      }

      // 3. Procesar Transformación (sobre los datos ya concatenados)
      if (transformRules.length > 0) {
        newData = newData.map(row => {
          const newRow = {
            ...row
          };
          transformRules.forEach(r => {
            const sourceValue = row[r.sourceColumn];
            // Usar la nueva función de ayuda
            newRow[r.nombre] = applyTransform(sourceValue, r);
          });
          return newRow;
        });
      }

      // 4. Guardar y continuar
      updateAppData({
        processedData: newData,
        columnRules: reglas,
        transformRules: transformRules // Guardar estado
      });
      nextStep();
    };
    const handleSkip = () => {
      updateAppData({
        columnRules: [],
        transformRules: [] // Limpiar ambas reglas
      });
      nextStep();
    };

    // --- UI (Renderizado) ---

    const renderConcatRule = (regla, index) => /*#__PURE__*/React.createElement("div", {
      key: regla.id,
      className: "column-builder-rule",
      style: {
        border: '2px solid var(--warning)',
        padding: '1.5rem',
        borderRadius: '8px',
        marginBottom: '1.5rem',
        background: '#fffbeb'
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
        color: 'var(--warning)'
      }
    }, "\uD83D\uDD17 Regla de Concatenaci\xF3n ", index + 1), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-error",
      style: {
        padding: '0.25rem 0.75rem'
      },
      onClick: () => removeRegla(regla.id)
    }, "\u2715 Eliminar Regla")), /*#__PURE__*/React.createElement("div", {
      className: "grid grid-2",
      style: {
        gap: '1rem',
        background: 'white',
        padding: '1rem',
        borderRadius: '8px',
        border: '1px solid #fcd34d'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "form-group",
      style: {
        marginBottom: 0
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label",
      style: {
        color: '#92400e'
      }
    }, "1. Nombre de la Nueva Columna"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      className: "form-input",
      placeholder: "Ej: NOMBRE_COMPLETO",
      value: regla.nombre,
      onChange: e => updateRegla(regla.id, 'nombre', e.target.value.toUpperCase()),
      style: {
        borderColor: '#fcd34d'
      }
    })), /*#__PURE__*/React.createElement("div", {
      className: "form-group",
      style: {
        marginBottom: 0
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label",
      style: {
        color: '#92400e'
      }
    }, "2. Separador entre textos"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      className: "form-input",
      placeholder: "Ej: un espacio, o un gui\xF3n -",
      value: regla.separador,
      onChange: e => updateRegla(regla.id, 'separador', e.target.value),
      style: {
        borderColor: '#fcd34d'
      }
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: '1.5rem'
      }
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label",
      style: {
        color: '#92400e'
      }
    }, "3. Selecciona las Columnas a Unir (de izquierda a derecha)"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.5rem',
        alignItems: 'center',
        background: 'white',
        padding: '1rem',
        borderRadius: '8px',
        border: '1px solid #fcd34d'
      }
    }, regla.cols.map((col, colIndex) => /*#__PURE__*/React.createElement(React.Fragment, {
      key: colIndex
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: '1 1 200px'
      }
    }, /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      value: col,
      onChange: e => updateReglaColumna(regla.id, colIndex, e.target.value),
      style: {
        borderColor: col ? '#10b981' : '#fcd34d',
        borderWidth: col ? '2px' : '1px'
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, colIndex < 2 ? `1️⃣ Columna ${colIndex + 1} (Requerida)` : `➕ Columna ${colIndex + 1} (Opcional)`), dataColumns.map(c => /*#__PURE__*/React.createElement("option", {
      key: c,
      value: c
    }, c)))), colIndex < regla.cols.length - 1 && /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 'bold',
        color: 'var(--warning)',
        fontSize: '1.5rem'
      }
    }, "+")))), /*#__PURE__*/React.createElement("p", {
      style: {
        fontSize: '0.8rem',
        color: '#92400e',
        marginTop: '0.5rem'
      }
    }, "* La l\xF3gica es din\xE1mica: al seleccionar la \xFAltima columna mostrada, aparecer\xE1 una nueva casilla autom\xE1ticamente (hasta un m\xE1ximo de 4 columnas).")));
    const renderTransformRule = (regla, index) => /*#__PURE__*/React.createElement("div", {
      key: regla.id,
      className: "column-builder-rule",
      style: {
        border: '2px solid var(--accent)'
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
        color: 'var(--primary)'
      }
    }, "Regla de Transformaci\xF3n ", index + 1), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-error",
      style: {
        padding: '0.25rem 0.75rem'
      },
      onClick: () => removeTransformRule(regla.id)
    }, "\u2715")), /*#__PURE__*/React.createElement("div", {
      className: "grid grid-3"
    }, /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "Nombre Nueva Columna"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      className: "form-input",
      placeholder: "Ej: PASO_2",
      value: regla.nombre,
      onChange: e => updateTransformRule(regla.id, 'nombre', e.target.value.toUpperCase())
    })), /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "Tipo de Transformaci\xF3n"), /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      value: regla.transformType,
      onChange: e => updateTransformRule(regla.id, 'transformType', e.target.value)
    }, /*#__PURE__*/React.createElement("option", {
      value: "extract_number"
    }, "Extraer Primer N\xFAmero"), /*#__PURE__*/React.createElement("option", {
      value: "substring"
    }, "Extraer Substring"), /*#__PURE__*/React.createElement("option", {
      value: "before_char"
    }, "Extraer ANTES de..."), /*#__PURE__*/React.createElement("option", {
      value: "after_char"
    }, "Extraer DESPU\xC9S de..."), /*#__PURE__*/React.createElement("option", {
      value: "static"
    }, "Valor Est\xE1tico"), /*#__PURE__*/React.createElement("option", {
      value: "copy"
    }, "Copiar Valor"))), /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "Columna de Origen"), /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      value: regla.sourceColumn,
      onChange: e => updateTransformRule(regla.id, 'sourceColumn', e.target.value),
      disabled: regla.transformType === 'static'
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, regla.transformType === 'static' ? '(No aplica)' : '-- Seleccionar --'), dataColumns.map(c => /*#__PURE__*/React.createElement("option", {
      key: c,
      value: c
    }, c))))), regla.transformType === 'extract_number' && /*#__PURE__*/React.createElement("div", {
      className: "form-group",
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        marginTop: '-0.5rem'
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "checkbox",
      id: `conv-num-${regla.id}`,
      checked: regla.convertToNumber !== false // True por defecto
      ,
      onChange: e => updateTransformRule(regla.id, 'convertToNumber', e.target.checked),
      style: {
        cursor: 'pointer'
      }
    }), /*#__PURE__*/React.createElement("label", {
      htmlFor: `conv-num-${regla.id}`,
      style: {
        fontSize: '0.85rem',
        color: 'var(--text-dark)',
        cursor: 'pointer',
        margin: 0
      }
    }, "Convertir a valor num\xE9rico (ej: \"02\" se convierte en \"2\")")), regla.transformType === 'static' && /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "Valor Est\xE1tico"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      className: "form-input",
      placeholder: "El valor a poner en cada fila",
      value: regla.staticValue,
      onChange: e => updateTransformRule(regla.id, 'staticValue', e.target.value)
    })), regla.transformType === 'substring' && /*#__PURE__*/React.createElement("div", {
      className: "grid grid-2"
    }, /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "Inicio (posici\xF3n)"), /*#__PURE__*/React.createElement("input", {
      type: "number",
      className: "form-input",
      placeholder: "Ej: 0",
      value: regla.subStart,
      onChange: e => updateTransformRule(regla.id, 'subStart', e.target.value)
    })), /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "Largo (opcional)"), /*#__PURE__*/React.createElement("input", {
      type: "number",
      className: "form-input",
      placeholder: "Ej: 4",
      value: regla.subLength,
      onChange: e => updateTransformRule(regla.id, 'subLength', e.target.value)
    }))), (regla.transformType === 'before_char' || regla.transformType === 'after_char') && /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "Car\xE1cter o Texto"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      className: "form-input",
      placeholder: "Ej: ':' o 'RESUMEN'",
      value: regla.char,
      onChange: e => updateTransformRule(regla.id, 'char', e.target.value)
    })));
    return /*#__PURE__*/React.createElement("div", {
      className: "card"
    }, /*#__PURE__*/React.createElement("h2", {
      className: "card-title"
    }, "\u2728 Paso 9: Creador de Columnas (Opcional)"), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle"
    }, "Concatena (unir) o Transforma (extraer) columnas para crear nuevas."), transformRules.map(renderTransformRule), reglas.map(renderConcatRule), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '1rem',
        marginTop: '1rem',
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-warning",
      onClick: addRegla,
      disabled: reglas.length >= 5,
      style: {
        color: 'var(--text-dark)'
      }
    }, "+ A\xF1adir Regla de Concatenaci\xF3n (Unir)"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-secondary" // Botón azul
      ,
      onClick: addTransformRule,
      disabled: transformRules.length >= 3
    }, "+ A\xF1adir Regla de Transformaci\xF3n (Extraer)")), /*#__PURE__*/React.createElement("div", {
      className: "nav-buttons"
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      onClick: prevStep
    }, "\u2190 Atr\xE1s"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: handleContinue
    }, reglas.length + transformRules.length > 0 ? 'Aplicar y Continuar →' : 'Continuar sin Crear →')));
  }
  {/* --- Re-numerado v5 --- */}
  // Step 10: Filters (Mejorado: Lista Visual Siempre)
  function Step10Filters({
    appData,
    updateAppData,
    nextStep,
    prevStep
  }) {
    const [filters, setFilters] = useState(appData.filters || []);
    const dataColumns = appData.processedData.length > 0 ? Object.keys(appData.processedData[0]) : appData.columns;
    const [matchingRecords, setMatchingRecords] = useState(appData.processedData.length);
    const addFilter = () => {
      if (filters.length < 4) {
        // Por defecto iniciamos en modo lista ('string') para ver los valores
        setFilters([...filters, {
          id: Date.now(),
          column: '',
          type: 'string',
          operator: 'in',
          value: [],
          values: []
        }]);
      }
    };
    const removeFilter = id => {
      const newFilters = filters.filter(f => f.id !== id);
      setFilters(newFilters);
      applyFilters(newFilters);
    };
    const updateFilter = (id, field, value) => {
      const newFilters = filters.map(f => f.id === id ? {
        ...f,
        [field]: value
      } : f);
      const filter = newFilters.find(f => f.id === id);
      if (field === 'column' && value) {
        // 1. Obtener valores únicos para mostrar la lista
        const sampleValues = appData.processedData.map(row => row[value]);
        const uniqueValues = [...new Set(sampleValues)].filter(v => v !== null && v !== undefined && v !== '').sort();

        // 2. Guardar los primeros 200 valores para el dropdown
        filter.values = uniqueValues.slice(0, 200);

        // 3. POR DEFECTO: Usar modo lista (string) para que el usuario vea los datos
        filter.type = 'string';
        filter.value = [];
      }

      // Permitir cambio manual de tipo (Lista vs Numérico)
      if (field === 'type') {
        filter.value = value === 'numeric' ? '' : [];
        filter.operator = value === 'numeric' ? '=' : 'in';
      }
      setFilters(newFilters);
      applyFilters(newFilters);
    };
    useEffect(() => {
      applyFilters(filters);
    }, [appData.processedData, dataColumns]);
    const applyFilters = filterList => {
      let filtered = appData.processedData;
      filterList.forEach(filter => {
        if (!filter.column) return;
        if (filter.type === 'numeric' && filter.value !== '') {
          const filterValue = parseFloat(filter.value);
          if (isNaN(filterValue)) return;
          filtered = filtered.filter(row => {
            const cellValue = parseFloat(row[filter.column]);
            if (isNaN(cellValue)) return false;
            switch (filter.operator) {
              case '=':
                return cellValue === filterValue;
              case '<>':
                return cellValue !== filterValue;
              case '<':
                return cellValue < filterValue;
              case '>':
                return cellValue > filterValue;
              case '<=':
                return cellValue <= filterValue;
              case '>=':
                return cellValue >= filterValue;
              default:
                return true;
            }
          });
        } else if (filter.type === 'string' && Array.isArray(filter.value) && filter.value.length > 0) {
          // Modo Lista: "Es uno de..."
          const selectedValues = new Set(filter.value.map(String));
          // Operador 'in' (Incluir) o 'not_in' (Excluir)
          if (filter.operator === 'not_in') {
            filtered = filtered.filter(row => !selectedValues.has(String(row[filter.column])));
          } else {
            filtered = filtered.filter(row => selectedValues.has(String(row[filter.column])));
          }
        }
      });
      setMatchingRecords(filtered.length);
    };
    const handleContinue = () => {
      // Aplicar filtro final al set de datos global
      applyFilters(filters); // Recalcular para asegurar

      // Filtrar realmente los datos para el siguiente paso
      let finalData = appData.processedData;
      // (Reutilizamos la lógica de filtrado local para generar el dataset final)
      // ... [Lógica duplicada brevemente para asegurar consistencia en el commit]
      filters.forEach(filter => {
        if (!filter.column) return;
        if (filter.type === 'numeric' && filter.value !== '') {
          const fv = parseFloat(filter.value);
          finalData = finalData.filter(r => {
            const cv = parseFloat(r[filter.column]);
            if (isNaN(cv)) return false;
            if (filter.operator === '=') return cv === fv;
            if (filter.operator === '<>') return cv !== fv;
            if (filter.operator === '>') return cv > fv;
            if (filter.operator === '<') return cv < fv;
            return true;
          });
        } else if (filter.type === 'string' && filter.value.length > 0) {
          const sv = new Set(filter.value.map(String));
          if (filter.operator === 'not_in') finalData = finalData.filter(r => !sv.has(String(r[filter.column])));else finalData = finalData.filter(r => sv.has(String(r[filter.column])));
        }
      });
      updateAppData({
        filters,
        processedData: finalData
      });
      nextStep();
    };
    return /*#__PURE__*/React.createElement("div", {
      className: "card"
    }, /*#__PURE__*/React.createElement("h2", {
      className: "card-title"
    }, "\u2699\uFE0F Paso 10: Filtros (Modo Lista)"), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle"
    }, "Filtra registros seleccionando valores de la lista."), /*#__PURE__*/React.createElement("div", {
      className: "alert alert-info"
    }, "\uD83D\uDCCA Registros que coinciden: ", /*#__PURE__*/React.createElement("strong", null, matchingRecords.toLocaleString()), " de ", appData.processedData.length.toLocaleString()), filters.map((filter, index) => /*#__PURE__*/React.createElement("div", {
      key: filter.id,
      className: "card",
      style: {
        background: 'var(--background)',
        marginBottom: '1rem'
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
        margin: 0
      }
    }, "Filtro ", index + 1), /*#__PURE__*/React.createElement("button", {
      className: "btn",
      style: {
        padding: '0.25rem 0.75rem',
        background: 'var(--error)',
        color: 'white'
      },
      onClick: () => removeFilter(filter.id)
    }, "\u2715")), /*#__PURE__*/React.createElement("div", {
      className: "grid grid-3"
    }, /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "1. Columna"), /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      value: filter.column,
      onChange: e => updateFilter(filter.id, 'column', e.target.value)
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "-- Seleccionar --"), dataColumns.map(col => /*#__PURE__*/React.createElement("option", {
      key: col,
      value: col
    }, col)))), filter.column && /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "2. Modo"), /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      value: filter.type,
      onChange: e => updateFilter(filter.id, 'type', e.target.value)
    }, /*#__PURE__*/React.createElement("option", {
      value: "string"
    }, "Lista de Valores"), /*#__PURE__*/React.createElement("option", {
      value: "numeric"
    }, "Rango Num\xE9rico"))), filter.column && filter.type === 'numeric' && /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "3. Regla Num\xE9rica"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '0.5rem'
      }
    }, /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      style: {
        width: '40%'
      },
      value: filter.operator,
      onChange: e => updateFilter(filter.id, 'operator', e.target.value)
    }, /*#__PURE__*/React.createElement("option", {
      value: "="
    }, "="), /*#__PURE__*/React.createElement("option", {
      value: ">"
    }, ">"), /*#__PURE__*/React.createElement("option", {
      value: "<"
    }, "<"), /*#__PURE__*/React.createElement("option", {
      value: "<>"
    }, "\u2260")), /*#__PURE__*/React.createElement("input", {
      type: "number",
      className: "form-input",
      placeholder: "Valor...",
      value: filter.value,
      onChange: e => updateFilter(filter.id, 'value', e.target.value)
    }))), filter.column && filter.type === 'string' && /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "3. Acci\xF3n"), /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      value: filter.operator,
      onChange: e => updateFilter(filter.id, 'operator', e.target.value)
    }, /*#__PURE__*/React.createElement("option", {
      value: "in"
    }, "Mantener Seleccionados"), /*#__PURE__*/React.createElement("option", {
      value: "not_in"
    }, "Eliminar Seleccionados")))), filter.column && filter.type === 'string' && /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "Selecciona valores (Ctrl+Click o Arrastrar)"), /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      multiple: true,
      size: "6",
      value: filter.value,
      onChange: e => {
        const selected = Array.from(e.target.selectedOptions, option => option.value);
        updateFilter(filter.id, 'value', selected);
      },
      style: {
        fontFamily: 'monospace',
        fontSize: '0.85rem'
      }
    }, filter.values.map(val => /*#__PURE__*/React.createElement("option", {
      key: val,
      value: val
    }, val))), /*#__PURE__*/React.createElement("small", {
      className: "text-gray-500"
    }, "Mostrando primeros ", filter.values.length, " valores \xFAnicos.")))), filters.length < 4 && /*#__PURE__*/React.createElement("button", {
      className: "btn btn-secondary",
      onClick: addFilter
    }, "\u2795 Agregar Filtro"), /*#__PURE__*/React.createElement("div", {
      className: "nav-buttons"
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      onClick: prevStep
    }, "\u2190 Atr\xE1s"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: handleContinue
    }, filters.length > 0 ? 'Aplicar Filtros y Continuar →' : 'Continuar sin Filtros →')));
  }
  {/* --- ¡NUEVO COMPONENTE v7! --- */}
  function Step11Sorting({
    appData,
    updateAppData,
    nextStep,
    prevStep
  }) {
    const [sortRules, setSortRules] = useState(appData.sortRules || []);

    // Columnas disponibles (incluye las creadas en Paso 9)
    const dataColumns = appData.processedData.length > 0 ? Object.keys(appData.processedData[0]) : appData.columns;

    // --- Lógica para manejar las Reglas de Orden ---
    const addRule = () => {
      if (sortRules.length >= 4) {
        // Límite de 4 niveles de orden
        alert("Puedes añadir un máximo de 4 niveles de orden.");
        return;
      }
      setSortRules(prev => [...prev, {
        id: Date.now(),
        column: '',
        type: 'asc',
        // asc, desc, custom
        customList: '' // 'N1,V,A,R'
      }]);
    };
    const removeRule = id => {
      setSortRules(prev => prev.filter(r => r.id !== id));
    };
    const updateRule = (id, field, value) => {
      setSortRules(prev => prev.map(r => r.id === id ? {
        ...r,
        [field]: value
      } : r));
    };

    // --- Lógica para Ordenar ---

    // Helper para crear mapas de listas personalizadas
    const createCustomSortMap = listString => {
      const map = new Map();
      listString.split(',').map(item => item.trim()).forEach((item, index) => {
        if (item) map.set(item, index); // Asigna un índice numérico
      });
      return map;
    };

    // Helper para comparar valores
    const compareValues = (a, b, type, customMap) => {
      let valA = a;
      let valB = b;
      switch (type) {
        case 'asc':
          // Alfabético A-Z
          return String(valA).localeCompare(String(valB));
        case 'desc':
          // Alfabético Z-A
          return String(valB).localeCompare(String(valA));
        case 'num_asc':
          // Numérico Menor a Mayor
          return Number(valA) - Number(valB);
        case 'num_desc':
          // Numérico Mayor a Menor
          return Number(valB) - Number(valA);
        case 'custom':
          // Asignar el índice del mapa. Si no existe, ponerlo al final (índice alto).
          const indexA = customMap.has(String(valA)) ? customMap.get(String(valA)) : Infinity;
          const indexB = customMap.has(String(valB)) ? customMap.get(String(valB)) : Infinity;
          return indexA - indexB;
        default:
          return 0;
      }
    };
    const handleContinue = () => {
      // Validar reglas
      for (const r of sortRules) {
        if (!r.column) {
          alert("Por favor, selecciona una columna para todas las reglas de orden.");
          return;
        }
        if (r.type === 'custom' && !r.customList) {
          alert(`Por favor, provee una lista personalizada para la regla de la columna "${r.column}".`);
          return;
        }
      }

      // Crear mapas de orden personalizado ANTES de ordenar
      const customMaps = new Map();
      sortRules.forEach(r => {
        if (r.type === 'custom') {
          customMaps.set(r.id, createCustomSortMap(r.customList));
        }
      });

      // Crear una copia de los datos para ordenar
      let sortedData = [...appData.processedData];
      sortedData.sort((rowA, rowB) => {
        for (const rule of sortRules) {
          const valA = rowA[rule.column];
          const valB = rowB[rule.column];
          const customMap = rule.type === 'custom' ? customMaps.get(rule.id) : null;
          const result = compareValues(valA, valB, rule.type, customMap);

          // Si los valores no son iguales, hemos encontrado el orden.
          if (result !== 0) {
            return result;
          }
        }
        // Si todos los niveles son iguales, no cambiar el orden.
        return 0;
      });
      updateAppData({
        processedData: sortedData,
        sortRules: sortRules
      });
      nextStep();
    };
    return /*#__PURE__*/React.createElement("div", {
      className: "card"
    }, /*#__PURE__*/React.createElement("h2", {
      className: "card-title"
    }, "\u2195\uFE0F Paso 11: Ordenar Base de Datos (Opcional)"), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle"
    }, "Define hasta 4 niveles para ordenar tu base de datos final."), sortRules.map((regla, index) => /*#__PURE__*/React.createElement("div", {
      key: regla.id,
      className: "column-builder-rule"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1rem'
      }
    }, /*#__PURE__*/React.createElement("h4", {
      style: {
        margin: 0
      }
    }, "Nivel de Orden ", index + 1), /*#__PURE__*/React.createElement("button", {
      className: "btn",
      style: {
        padding: '0.25rem 0.75rem',
        background: 'var(--error)',
        color: 'white'
      },
      onClick: () => removeRule(regla.id)
    }, "\u2715")), /*#__PURE__*/React.createElement("div", {
      className: "grid grid-2"
    }, /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "Ordenar por Columna"), /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      value: regla.column,
      onChange: e => updateRule(regla.id, 'column', e.target.value)
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "-- Seleccionar Columna --"), dataColumns.map(c => /*#__PURE__*/React.createElement("option", {
      key: c,
      value: c
    }, c)))), /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "Tipo de Orden"), /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      value: regla.type,
      onChange: e => updateRule(regla.id, 'type', e.target.value)
    }, /*#__PURE__*/React.createElement("option", {
      value: "asc"
    }, "Alfab\xE9tico (A-Z)"), /*#__PURE__*/React.createElement("option", {
      value: "desc"
    }, "Alfab\xE9tico (Z-A)"), /*#__PURE__*/React.createElement("option", {
      value: "num_asc"
    }, "Num\xE9rico (Menor a Mayor)"), /*#__PURE__*/React.createElement("option", {
      value: "num_desc"
    }, "Num\xE9rico (Mayor a Menor)"), /*#__PURE__*/React.createElement("option", {
      value: "custom"
    }, "Lista Personalizada")))), regla.type === 'custom' && /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "Orden Personalizado (separado por comas)"), /*#__PURE__*/React.createElement("textarea", {
      className: "form-textarea",
      placeholder: "Ej: N1, V, A, R, M",
      value: regla.customList,
      onChange: e => updateRule(regla.id, 'customList', e.target.value)
    }), /*#__PURE__*/React.createElement("small", {
      style: {
        color: 'var(--text-light)'
      }
    }, "Los valores que no est\xE9n en esta lista se ir\xE1n al final.")))), /*#__PURE__*/React.createElement("button", {
      className: "btn",
      onClick: addRule,
      disabled: sortRules.length >= 4,
      style: {
        background: 'var(--success)'
      }
    }, "+ A\xF1adir Nivel de Orden"), /*#__PURE__*/React.createElement("div", {
      className: "nav-buttons"
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      onClick: prevStep
    }, "\u2190 Atr\xE1s"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: handleContinue
    }, sortRules.length > 0 ? 'Aplicar Orden y Continuar →' : 'Continuar sin Ordenar →')));
  }
  {/* --- Re-numerado v7 --- */}
  function Step12Reports({
    appData,
    updateAppData,
    nextStep,
    prevStep
  }) {
    const generateGeneralReport = () => {
      const receivedRecords = appData.data.length;
      const finalRecords = appData.processedData.length;
      const duplicateRecords = appData.duplicateCount || 0;
      const mode = appData.processingMode || 'keep'; // keep, remove, normalize

      // 1. Calcular pérdida por Deduplicación
      let recordsLostByDedup = 0;
      let dedupLabel = "Duplicados Detectados";
      let dedupColor = "#0284c7"; // Azul por defecto

      if (mode === 'remove') {
        recordsLostByDedup = duplicateRecords;
        dedupLabel = "Eliminados por Duplicidad";
        dedupColor = "#d97706"; // Naranja
      } else if (mode === 'normalize') {
        recordsLostByDedup = duplicateRecords;
        dedupLabel = "Fusionados (Normalizados)";
        dedupColor = "#8b5cf6"; // Violeta
      } else {
        // Mode 'keep'
        recordsLostByDedup = 0;
        dedupLabel = "Duplicados (Mantenidos)";
        dedupColor = "#64748b"; // Gris
      }

      // 2. Calcular Exclusiones Reales (Reglas Paso 8 + Filtros Paso 10)
      // La diferencia total real menos lo que se "perdió" por gestionar duplicados
      const totalDiff = receivedRecords - finalRecords;
      // Aseguramos que no de negativo por algún error de redondeo
      const realExclusions = Math.max(0, totalDiff - recordsLostByDedup);

      // Métricas de Teléfonos
      const horizontalDups = appData.horizontalDuplicateCount || 0;
      const junkRemoved = appData.junkPhonesRemovedCount || 0;
      const emptyFixed = appData.emptyTelFixedCount || 0;

      // Teléfonos válidos
      const validPhones = appData.processedData.filter(row => String(row.TEL_1) !== '999999999').length;
      const phoneRate = finalRecords > 0 ? (validPhones / finalRecords * 100).toFixed(2) : '0.00';
      const now = new Date();
      const dateStr = now.toLocaleString('es-CL');
      return {
        receivedRecords,
        duplicateRecords,
        recordsLostByDedup,
        realExclusions,
        finalRecords,
        phoneRate,
        campaign: appData.campaign,
        baseName: appData.baseName,
        baseMonth: appData.baseMonth,
        processDate: dateStr,
        horizontalDups,
        junkRemoved,
        emptyFixed,
        dedupLabel,
        dedupColor,
        mode
      };
    };
    const report = generateGeneralReport();

    // Estilos
    const reportCardStyle = {
      marginTop: '1.5rem',
      padding: '1.5rem',
      background: '#f0f9ff',
      borderRadius: '12px',
      borderLeft: '5px solid #0284c7',
      boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
    };
    const reportTitleStyle = {
      marginTop: 0,
      marginBottom: '1rem',
      color: '#0369a1',
      fontWeight: '700',
      fontSize: '1.1rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem'
    };
    const listStyle = {
      margin: 0,
      paddingLeft: '1.2rem',
      color: '#334155',
      lineHeight: '1.6'
    };
    return /*#__PURE__*/React.createElement("div", {
      className: "card"
    }, /*#__PURE__*/React.createElement("h2", {
      className: "card-title"
    }, "\uD83D\uDCCA Paso 12: Reporter\xEDa Ejecutiva"), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle"
    }, "Resumen final del procesamiento de datos"), /*#__PURE__*/React.createElement("div", {
      style: reportCardStyle
    }, /*#__PURE__*/React.createElement("h3", {
      style: reportTitleStyle
    }, "\uD83D\uDCCB Flujo de Registros"), /*#__PURE__*/React.createElement("div", {
      className: "stats-grid"
    }, /*#__PURE__*/React.createElement("div", {
      className: "stat-card",
      style: {
        borderColor: '#bae6fd'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "stat-value",
      style: {
        color: '#0284c7'
      }
    }, report.receivedRecords.toLocaleString()), /*#__PURE__*/React.createElement("div", {
      className: "stat-label"
    }, "Recibidos")), /*#__PURE__*/React.createElement("div", {
      className: "stat-card",
      style: {
        borderColor: report.dedupColor + '40'
      }
    }, " ", /*#__PURE__*/React.createElement("div", {
      className: "stat-value",
      style: {
        color: report.dedupColor
      }
    }, report.mode === 'keep' ? report.duplicateRecords.toLocaleString() : report.recordsLostByDedup.toLocaleString()), /*#__PURE__*/React.createElement("div", {
      className: "stat-label"
    }, report.dedupLabel)), /*#__PURE__*/React.createElement("div", {
      className: "stat-card",
      style: {
        borderColor: '#fca5a5'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "stat-value",
      style: {
        color: '#dc2626'
      }
    }, report.realExclusions.toLocaleString()), /*#__PURE__*/React.createElement("div", {
      className: "stat-label"
    }, "Excluidos (Reglas/Filtros)")), /*#__PURE__*/React.createElement("div", {
      className: "stat-card",
      style: {
        borderColor: '#059669',
        background: '#ecfdf5'
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "stat-value",
      style: {
        color: '#059669'
      }
    }, report.finalRecords.toLocaleString()), /*#__PURE__*/React.createElement("div", {
      className: "stat-label"
    }, "Finales")))), /*#__PURE__*/React.createElement("div", {
      style: reportCardStyle
    }, /*#__PURE__*/React.createElement("h4", {
      style: reportTitleStyle
    }, "\uD83D\uDCDE Auditor\xEDa de Contactabilidad"), /*#__PURE__*/React.createElement("ul", {
      style: listStyle
    }, /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("strong", null, "Duplicados Internos:"), " ", report.horizontalDups.toLocaleString(), " tel\xE9fonos repetidos en la misma fila (unificados)."), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("strong", null, "Limpieza de Basura:"), " ", report.junkRemoved.toLocaleString(), " registros conten\xEDan n\xFAmeros inv\xE1lidos (en columnas TEL 1-10) que fueron limpiados."), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("strong", null, "Relleno de Vac\xEDos:"), " ", report.emptyFixed.toLocaleString(), " registros quedaron sin ", /*#__PURE__*/React.createElement("code", null, "TEL_1"), " y se asign\xF3 \"999999999\"."), /*#__PURE__*/React.createElement("li", {
      style: {
        marginTop: '0.5rem',
        color: '#059669'
      }
    }, /*#__PURE__*/React.createElement("strong", null, "Tasa de Contactabilidad (Excluyendo 999...):"), " ", report.phoneRate, "%"))), /*#__PURE__*/React.createElement("div", {
      style: reportCardStyle
    }, /*#__PURE__*/React.createElement("h4", {
      style: reportTitleStyle
    }, "\uD83D\uDE80 Datos de la Operaci\xF3n"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '1rem',
        fontSize: '0.95rem',
        color: '#334155'
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("strong", null, "Campa\xF1a:"), " ", report.campaign || 'N/A'), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("strong", null, "Base Generada:"), " ", report.baseName), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("strong", null, "Mes de Carga:"), " ", report.baseMonth), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("strong", null, "Fecha Proceso:"), " ", report.processDate), /*#__PURE__*/React.createElement("div", {
      style: {
        gridColumn: 'span 2',
        borderTop: '1px solid #bae6fd',
        paddingTop: '0.5rem',
        marginTop: '0.5rem',
        color: '#64748b',
        fontSize: '0.85rem'
      }
    }, "Generado por M\xF3dulo Depurador de Bases \u2022 Nexus"))), /*#__PURE__*/React.createElement("div", {
      className: "nav-buttons"
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      onClick: prevStep
    }, "\u2190 Atr\xE1s"), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary",
      onClick: nextStep
    }, "Continuar a Exportaci\xF3n \u2192")));
  }

  // Regex para detectar columnas de teléfono TEL_1, TEL_2 ... TEL_n
  const TEL_COL_REGEX = /^TEL_\d+$/i;
  const crearSheetLimpio = (dataArray, headersOverride) => {
    if (!dataArray || dataArray.length === 0) return {
      ws: null,
      headers: [],
      cleanData: []
    };
    const allCols = headersOverride || Object.keys(dataArray[0]).filter(k => !k.startsWith('__EMPTY'));

    // Detectar última fila con algún valor real
    let lastRow = -1;
    for (let i = dataArray.length - 1; i >= 0; i--) {
      if (Object.values(dataArray[i]).some(v => v !== "" && v !== null && v !== undefined)) {
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

    // Eliminar columnas completamente vacías en todo el dataset
    const headers = allCols.filter(col => trimmedRows.some(r => r[col] !== "" && r[col] !== null && r[col] !== undefined));

    // Construir filas sin propiedades vacías (celda inexistente = cero bytes en XML)
    // Excepción: columnas TEL_n SIEMPRE se fuerzan a número para garantizar tipo numérico en Excel
    const cleanData = trimmedRows.map(r => {
      const n = {};
      headers.forEach(h => {
        const val = r[h];
        if (val !== "" && val !== null && val !== undefined) {
          // Forzar numérico en columnas TEL_1..TEL_n
          if (TEL_COL_REGEX.test(h)) {
            const num = Number(String(val).replace(/\D/g, ''));
            n[h] = isNaN(num) ? val : num;
          } else {
            n[h] = val;
          }
        } else if (TEL_COL_REGEX.test(h)) {
          // Para TEL vacío: omitir la celda igual que los demás (no poner 0 ni string)
          // SheetJS lo dejará como celda vacía, Excel lo leerá como vacío numérico
        }
      });
      return n;
    });
    const ws = XLSX.utils.json_to_sheet(cleanData, {
      header: headers
    });

    // Anotar formato numérico explícito en todas las celdas de columnas TEL_n
    // para que Excel no interprete los números largos como texto al abrir
    headers.forEach((h, colIdx) => {
      if (!TEL_COL_REGEX.test(h)) return;
      const colLetter = XLSX.utils.encode_col(colIdx);
      for (let rowIdx = 1; rowIdx <= cleanData.length; rowIdx++) {
        const cellAddr = `${colLetter}${rowIdx + 1}`;
        if (ws[cellAddr] && ws[cellAddr].t === 'n') {
          ws[cellAddr].z = '0'; // Formato numérico sin decimales
        }
      }
    });

    // Fijar rango explícito para que Excel no lea más allá de los datos
    if (cleanData.length > 0) {
      const endCol = XLSX.utils.encode_col(headers.length - 1);
      ws['!ref'] = `A1:${endCol}${cleanData.length + 1}`;
    }
    return {
      ws,
      headers,
      cleanData
    };
  };
  {/* --- Re-numerado v7 (MEJORADO v6.8) --- */}
  function Step13Export({
    appData,
    prevStep,
    onReset
  }) {
    // Añadido onReset
    const [exportFormat, setExportFormat] = useState('xlsx');
    const [exporting, setExporting] = useState(false);
    const generateAbbreviation = campaignName => {
      if (!campaignName) return 'BASE';
      const words = campaignName.split('_');
      if (words.length === 1) {
        return campaignName.substring(0, 3).toUpperCase();
      }
      return words.map(w => w[0]).join('').substring(0, 5).toUpperCase();
    };
    const generateFileName = () => {
      const abbr = generateAbbreviation(appData.campaign);
      const base = appData.baseName || 'BASE_EXPORT';
      return `${base}_${abbr}.${exportFormat}`;
    };
    const doExport = () => {
      try {
        const dataToExport = appData.processedData.map(row => ({
          ...row,
          CAMPANA: appData.campaign,
          BASE: appData.baseName,
          MES_CARGA: appData.baseMonth
        }));
        const {
          ws
        } = crearSheetLimpio(dataToExport);
        if (!ws) throw new Error('No hay datos para exportar');
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Datos');
        const fileName = generateFileName();
        XLSX.writeFile(wb, fileName, {
          bookType: exportFormat
        });
        return true; // Éxito
      } catch (err) {
        alert('Error al exportar: ' + err.message);
        return false; // Fracaso
      }
    };
    const handleExportOnly = () => {
      setExporting(true);
      setTimeout(() => {
        doExport();
        setExporting(false);
      }, 50);
    };
    const handleExportAndReset = () => {
      setExporting(true);
      setTimeout(() => {
        const success = doExport();
        setExporting(false);
        if (success) {
          // Llamar a la función de reset (sin confirmación)
          onReset();
        }
      }, 50);
    };
    return /*#__PURE__*/React.createElement("div", {
      className: "card"
    }, /*#__PURE__*/React.createElement("h2", {
      className: "card-title"
    }, "\u2B07\uFE0F Paso 13: Exportaci\xF3n"), /*#__PURE__*/React.createElement("p", {
      className: "card-subtitle"
    }, "Descarga tu base de datos depurada"), /*#__PURE__*/React.createElement("div", {
      className: "alert alert-success"
    }, "\u2705 Base lista para exportar: ", /*#__PURE__*/React.createElement("strong", null, appData.processedData.length.toLocaleString()), " registros"), /*#__PURE__*/React.createElement("div", {
      className: "form-group"
    }, /*#__PURE__*/React.createElement("label", {
      className: "form-label"
    }, "Formato de Exportaci\xF3n"), /*#__PURE__*/React.createElement("select", {
      className: "form-select",
      value: exportFormat,
      onChange: e => setExportFormat(e.target.value)
    }, /*#__PURE__*/React.createElement("option", {
      value: "xlsx"
    }, "Excel (.xlsx)"), /*#__PURE__*/React.createElement("option", {
      value: "xls"
    }, "Excel 97-2003 (.xls)"))), /*#__PURE__*/React.createElement("div", {
      className: "alert alert-info"
    }, "\uD83D\uDCC1 Nombre del archivo: ", /*#__PURE__*/React.createElement("strong", null, generateFileName())), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '1rem',
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-success",
      onClick: handleExportOnly,
      disabled: exporting,
      style: {
        fontSize: '1.1rem',
        padding: '1rem 2rem'
      }
    }, exporting ? /*#__PURE__*/React.createElement("div", {
      className: "spinner",
      style: {
        width: '20px',
        height: '20px',
        margin: 0,
        borderColor: 'white',
        borderTopColor: 'transparent'
      }
    }) : '⬇️', exporting ? ' Exportando...' : ' Descargar Base'), /*#__PURE__*/React.createElement("button", {
      className: "btn btn-primary" // Botón azul
      ,
      onClick: handleExportAndReset,
      disabled: exporting,
      style: {
        fontSize: '1.1rem',
        padding: '1rem 2rem'
      }
    }, exporting ? /*#__PURE__*/React.createElement("div", {
      className: "spinner",
      style: {
        width: '20px',
        height: '20px',
        margin: 0,
        borderColor: 'white',
        borderTopColor: 'transparent'
      }
    }) : '🚀', exporting ? ' Exportando...' : ' Descargar y Reiniciar')), /*#__PURE__*/React.createElement("div", {
      className: "nav-buttons"
    }, /*#__PURE__*/React.createElement("button", {
      className: "btn btn-outline",
      onClick: prevStep
    }, "\u2190 Atr\xE1s"), /*#__PURE__*/React.createElement("div", null)));
  }

  // 3. Retorno del Componente al Host Nexus
  return () => {
    return /*#__PURE__*/React.createElement("div", {
      className: "min-h-screen bg-emerald-50 p-6 pb-32 slide-up"
    }, /*#__PURE__*/React.createElement("style", null, cssStyles), /*#__PURE__*/React.createElement(App, null));
  };
};