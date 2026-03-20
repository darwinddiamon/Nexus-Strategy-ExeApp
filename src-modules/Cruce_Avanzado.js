window.NexusActiveModule = ({ React, useState, useEffect, ui, utils, db, goHome }) => {

    const { Icon } = ui;
    const { addToast, readFile } = utils;

    // ========================================================================
    // UTILIDAD: Descifrado Excel ECMA-376 Agile (AES-256) - Versión Corregida
    // Usa Web Crypto API + SheetJS CFB. No requiere librerías externas.
    // Recibe ArrayBuffer cifrado + contraseña, devuelve Uint8Array descifrado.
    // ========================================================================
    const aesCbcNoPadding = async (key, iv, data) => {
        const crypto = window.crypto.subtle;
        const bs = 16;
        let input = data;
        if (data.length % bs !== 0) { input = new Uint8Array(Math.ceil(data.length / bs) * bs); input.set(data); }
        const lastBlock = input.slice(input.length - bs);
        const paddingBlock = new Uint8Array(bs); paddingBlock.fill(bs);
        const imported = await crypto.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
        const encPad = new Uint8Array(await crypto.encrypt({ name: 'AES-CBC', iv: lastBlock }, imported, paddingBlock));
        const combined = new Uint8Array(input.length + bs);
        combined.set(input); combined.set(encPad.slice(0, bs), input.length);
        const decrypted = new Uint8Array(await crypto.decrypt({ name: 'AES-CBC', iv: iv }, imported, combined));
        return decrypted.slice(0, input.length);
    };

    const decryptExcelBuffer = async (buffer, password) => {
        const crypto = window.crypto.subtle;
        const uint8 = new Uint8Array(buffer);
        const cc = (a, b) => { const r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; };
        const ccAll = (bufs) => { const t = bufs.reduce((s, b) => s + b.length, 0); const r = new Uint8Array(t); let o = 0; bufs.forEach(b => { r.set(b, o); o += b.length; }); return r; };

        const cfb = window.XLSX.CFB.read(uint8, { type: 'array' });
        const encInfo = window.XLSX.CFB.find(cfb, '/EncryptionInfo');
        const encPkg = window.XLSX.CFB.find(cfb, '/EncryptedPackage');
        if (!encInfo || !encPkg) throw new Error('Archivo no contiene streams de cifrado');

        const infoBytes = new Uint8Array(encInfo.content);
        const pkgBytes = new Uint8Array(encPkg.content);
        const vMajor = new DataView(infoBytes.buffer, infoBytes.byteOffset).getUint16(0, true);
        if (vMajor !== 4) throw new Error('Solo se soporta cifrado Agile (v4). Este archivo usa v' + vMajor);

        const doc = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(infoBytes.slice(8)), 'text/xml');
        let pNode = null, kNode = null;
        doc.querySelectorAll('*').forEach(el => {
            if (el.getAttribute('spinCount') && el.getAttribute('encryptedKeyValue')) pNode = el;
            if (el.getAttribute('saltValue') && !el.getAttribute('spinCount') && el.getAttribute('blockSize')) kNode = el;
        });
        if (!pNode || !kNode) throw new Error('XML de cifrado incompleto');

        const b64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
        const spinCount = parseInt(pNode.getAttribute('spinCount'));
        const keyBits = parseInt(pNode.getAttribute('keyBits'));
        const blockSize = parseInt(pNode.getAttribute('blockSize'));
        const saltValue = b64(pNode.getAttribute('saltValue'));
        const encKeyValue = b64(pNode.getAttribute('encryptedKeyValue'));
        const dataSaltValue = b64(kNode.getAttribute('saltValue'));
        const dataBlockSize = parseInt(kNode.getAttribute('blockSize'));
        const dataKeyBits = parseInt(kNode.getAttribute('keyBits'));

        const utf16 = new Uint8Array(password.length * 2);
        for (let i = 0; i < password.length; i++) { utf16[i * 2] = password.charCodeAt(i) & 0xFF; utf16[i * 2 + 1] = (password.charCodeAt(i) >> 8) & 0xFF; }

        let h = new Uint8Array(await crypto.digest('SHA-512', cc(saltValue, utf16)));
        for (let i = 0; i < spinCount; i++) { const ib = new Uint8Array(4); new DataView(ib.buffer).setUint32(0, i, true); h = new Uint8Array(await crypto.digest('SHA-512', cc(ib, h))); }

        const dh = new Uint8Array(await crypto.digest('SHA-512', cc(h, new Uint8Array([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]))));
        const derivedKey = dh.slice(0, keyBits / 8);

        const decKeyRaw = await aesCbcNoPadding(derivedKey, saltValue.slice(0, blockSize), encKeyValue);
        const secretKey = decKeyRaw.slice(0, dataKeyBits / 8);

        const totalSize = new DataView(pkgBytes.buffer, pkgBytes.byteOffset).getUint32(0, true) + new DataView(pkgBytes.buffer, pkgBytes.byteOffset).getUint32(4, true) * 0x100000000;
        const encContent = pkgBytes.slice(8);
        const segments = []; let offset = 0; let segIdx = 0;
        while (offset < encContent.length) {
            const seg = encContent.slice(offset, Math.min(offset + 4096, encContent.length));
            const sb = new Uint8Array(4); new DataView(sb.buffer).setUint32(0, segIdx, true);
            const ivH = new Uint8Array(await crypto.digest('SHA-512', cc(dataSaltValue, sb)));
            segments.push(await aesCbcNoPadding(secretKey, ivH.slice(0, dataBlockSize), seg));
            offset += 4096; segIdx++;
        }

        return ccAll(segments).slice(0, Math.min(totalSize, ccAll(segments).length));
    };

    // ========================================================================
    // UTILIDAD: Selector de Hojas
    // ========================================================================
    const SelectorHojas = ({ pendientes, onConfirm, onCancel }) => {
        const [selecciones, setSelecciones] = useState(() => {
            const init = {};
            pendientes.forEach(p => { init[p.name] = p.sheetNames[0]; });
            return init;
        });
        return (
            <div style={{ background: '#fffbeb', border: '2px solid #f59e0b', borderRadius: 12, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="layers" size={20} className="text-amber-600" />
                    <div>
                        <strong style={{ color: '#92400e', fontSize: '0.9rem' }}>Múltiples hojas detectadas</strong>
                        <p style={{ color: '#a16207', fontSize: '0.75rem', margin: '4px 0 0' }}>Selecciona cuál hoja procesar en cada archivo.</p>
                    </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                    {pendientes.map((p, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'white', padding: 10, borderRadius: 8, border: '1px solid #fbbf24' }}>
                            <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                            <select style={{ border: '1px solid #fbbf24', borderRadius: 6, padding: '4px 8px', fontSize: '0.75rem', fontWeight: 600, background: '#fffbeb', minWidth: 140 }} value={selecciones[p.name]} onChange={(e) => setSelecciones(prev => ({ ...prev, [p.name]: e.target.value }))}>
                                {p.sheetNames.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                    {onCancel && <button onClick={onCancel} style={{ padding: '8px 16px', fontSize: '0.75rem', fontWeight: 700, color: '#6b7280', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}>Cancelar</button>}
                    <button onClick={() => onConfirm(selecciones)} style={{ padding: '8px 16px', fontSize: '0.75rem', fontWeight: 700, color: 'white', background: '#d97706', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Confirmar</button>
                </div>
            </div>
        );
    };


    const cssStyles = `
        :root { --primary: #7c3aed; --accent: #8b5cf6; --bg-soft: #f5f3ff; --border: #ddd6fe; --text-main: #4c1d95; --white: #ffffff; }
        .app-container { font-family: system-ui, sans-serif; color: var(--text-main); display: flex; flex-direction: column; gap: 1.5rem; }
        .header { background: linear-gradient(135deg, var(--primary), var(--accent)); color: white; padding: 1.5rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(124, 58, 237, 0.2); display: flex; justify-content: space-between; align-items: center; }
        .header h1 { font-size: 1.5rem; font-weight: 800; margin: 0; }
        .card { background: var(--white); border-radius: 12px; padding: 2rem; border: 1px solid var(--border); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); position: relative; z-index: 1; }
        .bipolar-container { display: grid; grid-template-columns: 1fr 1fr; gap: 3rem; margin-top: 1rem; position: relative; }
        .drop-zone { border: 3px dashed var(--border); border-radius: 12px; padding: 2rem 1rem; text-align: center; background: var(--bg-soft); transition: all 0.2s; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; min-height: 200px; }
        .drop-zone:hover { border-color: var(--primary); background: #ede9fe; transform: translateY(-2px); }
        .drop-zone.has-data { border-style: solid; border-color: #10b981; background: #f0fdf4; border-width: 2px; }
        .vs-badge { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); background: var(--white); padding: 0.5rem 1rem; border-radius: 999px; font-weight: 900; color: var(--primary); box-shadow: 0 4px 15px rgba(124, 58, 237, 0.2); z-index: 50; border: 4px solid var(--bg-soft); font-size: 1.2rem; }
        .files-detail { margin-top: 1rem; text-align: left; width: 100%; }
        .file-row { display: flex; justify-content: space-between; font-size: 0.85rem; padding: 0.4rem; border-bottom: 1px solid #f3f4f6; color: #6b7280; }
        .btn { padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 600; cursor: pointer; border: none; transition: 0.2s; display: inline-flex; gap: 0.5rem; align-items: center; }
        .btn-primary { background: var(--primary); color: white; width: 100%; justify-content: center; font-size: 1.1rem; box-shadow: 0 4px 6px -1px rgba(124, 58, 237, 0.3); }
        .btn-primary:hover { background: #6d28d9; transform: translateY(-1px); }
        .btn-outline { background: transparent; border: 2px solid var(--primary); color: var(--primary); }
        .btn-sm { padding: 0.4rem 0.8rem; font-size: 0.8rem; border-radius: 6px; }
        .btn-dedup { background: #fff1f2; color: #e11d48; border: 1px solid #fecdd3; width: 100%; justify-content: center; margin-top: 0.5rem; }
        .file-count { font-size: 0.9rem; color: #059669; font-weight: 700; background: #d1fae5; padding: 0.25rem 0.75rem; border-radius: 99px; }
        .key-selector { width: 100%; padding: 0.75rem; border: 2px solid var(--border); border-radius: 8px; font-size: 1rem; outline: none; background: white; }
        .key-selector:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1); }
        .match-stats { background: #fef3c7; border: 2px solid #f59e0b; color: #92400e; padding: 1rem; border-radius: 8px; text-align: center; margin-top: 1rem; animation: fadeIn 0.3s; }
        
        /* VENN CARDS */
        .venn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 2rem; }
        .venn-card { border: 2px solid var(--border); border-radius: 12px; padding: 1.5rem; cursor: pointer; transition: all 0.2s; background: white; position: relative; overflow: hidden; }
        .venn-card:hover { border-color: var(--accent); transform: translateY(-4px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }
        .venn-card.selected { border-color: var(--primary); background: #f5f3ff; ring: 2px solid var(--primary); }
        .venn-visual { height: 60px; margin-bottom: 1rem; display: flex; justify-content: center; align-items: center; position: relative; }
        .circle { width: 40px; height: 40px; border-radius: 50%; opacity: 0.6; position: absolute; }
        .circle-left { background: #8b5cf6; left: 50%; transform: translateX(-80%); }
        .circle-right { background: #ec4899; left: 50%; transform: translateX(-20%); }
        
        /* Estados Visuales */
        .venn-inner .circle-left, .venn-inner .circle-right { background: #ddd; } 
        .venn-inner .intersection { position: absolute; width: 20px; height: 40px; background: #7c3aed; z-index: 10; left: 50%; transform: translateX(-50%); border-radius: 50%; }
        .venn-left .circle-left { background: #7c3aed; opacity: 1; z-index: 10; }
        .venn-left .circle-right { background: #ddd; opacity: 0.3; }
        .venn-right .circle-left { background: #ddd; opacity: 0.3; }
        .venn-right .circle-right { background: #ec4899; opacity: 1; z-index: 10; }
        .venn-outer .circle-left { background: #7c3aed; opacity: 0.8; }
        .venn-outer .circle-right { background: #ec4899; opacity: 0.8; }
        
        /* NUEVO: XOR Visual */
        .venn-xor .circle-left { background: #7c3aed; opacity: 1; }
        .venn-xor .circle-right { background: #ec4899; opacity: 1; }
        .venn-xor .intersection { position: absolute; width: 20px; height: 40px; background: #fff; z-index: 20; left: 50%; transform: translateX(-50%); border-radius: 50%; }

        /* Acordeón Avanzado */
        .advanced-section { margin-top: 2rem; border-top: 1px solid var(--border); padding-top: 1rem; }
        .advanced-summary { cursor: pointer; font-weight: bold; color: var(--text-main); display: flex; align-items: center; gap: 0.5rem; }
        .advanced-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 1rem; }
        /* FASE 4: OUTPUT STYLES */
        .output-tabs { display: flex; border-bottom: 2px solid var(--border); margin-bottom: 1.5rem; }
        .tab { padding: 1rem 1.5rem; cursor: pointer; font-weight: 600; color: #6b7280; border-bottom: 3px solid transparent; margin-bottom: -2px; }
        .tab.active { color: var(--primary); border-bottom-color: var(--primary); background: var(--bg-soft); border-radius: 8px 8px 0 0; }        
        .preview-box { background: #1e1e1e; color: #a5f3fc; padding: 1rem; border-radius: 8px; font-family: monospace; font-size: 0.85rem; height: 200px; overflow-y: auto; white-space: pre; margin: 1rem 0; border: 1px solid #333; }
        /* FASE 4: SUPER EXPORT STYLES */
        .columns-selector { display: grid; grid-template-columns: 1fr 50px 1fr; gap: 1rem; align-items: center; height: 300px; }
        .col-list { border: 1px solid var(--border); border-radius: 8px; height: 100%; overflow-y: auto; background: #f9fafb; }
        .col-item { padding: 0.5rem; cursor: pointer; font-size: 0.85rem; display: flex; justify-content: space-between; border-bottom: 1px solid #eee; }
        .col-item:hover { background: #eef2ff; color: var(--primary); }
        .col-item.selected { background: var(--primary); color: white; }
        .col-source-a { border-left: 4px solid var(--primary); }
        .col-source-b { border-left: 4px solid #ec4899; }
        .col-actions { display: flex; flex-direction: column; gap: 0.5rem; align-items: center; }
        
        .sql-builder-row { display: grid; grid-template-columns: 150px 1fr 50px; gap: 0.5rem; margin-bottom: 0.5rem; align-items: center; }
        .sql-badge { font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; background: #eee; color: #666; }
        .badge-warning { background: #fef3c7; color: #b45309; font-size: 0.7rem; padding: 2px 4px; border-radius: 4px; }

        .config-row { display: flex; gap: 1rem; margin-bottom: 1rem; align-items: center; }
        .label-sm { font-size: 0.8rem; font-weight: bold; color: #6b7280; text-transform: uppercase; }        
        .advanced-card { border: 1px solid var(--border); padding: 1rem; border-radius: 8px; cursor: pointer; text-align: center; transition: 0.2s; font-size: 0.9rem; }
        .advanced-card:hover { background: var(--bg-soft); border-color: var(--primary); }
        .advanced-card.selected { background: var(--primary); color: white; border-color: var(--primary); }

        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    `;

    return () => {
        const [step, setStep] = useState(1);
        const [loading, setLoading] = useState(false);
        const [baseA, setBaseA] = useState({ filesMeta: [], data: [], columns: [], key: '' });
        const [baseB, setBaseB] = useState({ filesMeta: [], data: [], columns: [], key: '' });

        // --- NUEVO: ESTADOS PARA MODO HÍBRIDO (SQL vs Archivo) ---
        const [inputModeA, setInputModeA] = useState('file'); // 'file' o 'sql'
        const [inputModeB, setInputModeB] = useState('file');
        const [sqlQueryA, setSqlQueryA] = useState('');
        const [sqlQueryB, setSqlQueryB] = useState('');
        // ---------------------------------------------------------

        const [analysis, setAnalysis] = useState(null);
        const [strategy, setStrategy] = useState('');
        const [finalResult, setFinalResult] = useState([]);

        // FASE 5: CONDICIONES DE CRUCE (Pre-Filtros)
        const [preFilters, setPreFilters] = useState([]); // <--- CAMBIO DE NOMBRE AQUÍ
        // Estructura: { id: 1, side: 'B', col: 'ESTADO', op: '=', val: 'BAJA' }

        // FASE 5: ESTADO DE CONDICIONES AVANZADAS
        const [joinConditions, setJoinConditions] = useState([]);
        // Estructura: { id: 1, type: 'column'|'static', colA: '', operator: '=', colB: '', staticVal: '' }

        // FASE 4 STATES
        // FASE 4: SUPER EXPORT STATES
        const [outputTab, setOutputTab] = useState('full');
        const [exportExt, setExportExt] = useState('txt'); // NUEVO: Control de extensión
        // full, custom, list, query

        // Configuración Base Compuesta
        const [customCols, setCustomCols] = useState([]); // [{source: 'A'|'B', name: 'RUT'}]
        const [xorMode, setXorMode] = useState('sheets'); // sheets, stack

        // Configuración Lista SQL
        const [listConfig, setListConfig] = useState({ col: '', quote: "'", sep: ',', trim: true, noZeros: false });

        // Estados para multi-hojas y archivos protegidos
        const [pendientesHojas, setPendientesHojas] = useState([]);
        const [sheetSelections, setSheetSelections] = useState({});
        const [protectedFilesA, setProtectedFilesA] = useState([]);
        const [protectedFilesB, setProtectedFilesB] = useState([]);
        const [passwordsA, setPasswordsA] = useState({});
        const [passwordsB, setPasswordsB] = useState({});
        const [pendingTarget, setPendingTarget] = useState(null);

        // Configuración SQL Query Builder Pro
        const [queryConfig, setQueryConfig] = useState({
            table: 'TABLA_DESTINO',
            tableCol: '',
            type: 'UPDATE',
            grouped: false, // Nueva bandera para modo agrupado
            sets: [],
            wheres: []
        });


        // --- AUTO-CORRECCIÓN VISUAL (ICONO LINK) ---
        useEffect(() => {
            const fixIcon = async () => {
                if (!db) return;
                try {
                    const modules = await db.getAll('modules');
                    const me = modules.find(m => m.title === 'Nexus Cruce Avanzado' || m.title === 'Cruce Avanzado');
                    if (me && me.icon !== 'link') {
                        me.icon = 'link';
                        await db.addOrUpdate('modules', [me]);
                    }
                } catch (e) { console.error("Error actualizando ícono:", e); }
            };
            fixIcon();
        }, []);

        // INTELIGENCIA: Detectar redundancia
        const checkRedundancy = (colA, colB) => {
            // Muestreo rápido de 50 filas
            if (!baseA.data.length || !baseB.data.length) return false;
            let matches = 0, tests = 0;
            for (let i = 0; i < Math.min(50, finalResult.length); i++) {
                const r = finalResult[i];
                if (String(r[colA] || '') === String(r[colB] || '')) matches++;
                tests++;
            }
            return tests > 0 && (matches / tests) > 0.9; // 90% idéntico
        };

        // GENERADORES
        const generateSQLQuery = () => {
            if (!queryConfig.sets.length || !queryConfig.wheres.length) return "-- Configura SET y WHERE";

            // Filtro de seguridad: Omitir filas con WHERE vacíos
            const validRows = finalResult.filter(r => queryConfig.wheres.every(w => String(r[w.value] || '').trim() !== ''));

            if (queryConfig.grouped && queryConfig.wheres.length > 0) {
                // MODO AGRUPADO
                const groups = new Map();
                const keyWhere = queryConfig.wheres[0]; // Usamos la primera condición para el IN

                // Tomamos una muestra de 20 para que se note la agrupación en la preview
                validRows.slice(0, 20).forEach(row => {
                    const table = queryConfig.tableCol ? `${queryConfig.table}${row[queryConfig.tableCol] || ''}` : queryConfig.table;

                    const sets = queryConfig.sets.map(s => {
                        const val = (s.type === 'manual' || s.mode === 'fixed') ? s.value : (row[s.value] || '');
                        return `${s.target}='${String(val).replace(/'/g, "''")}'`;
                    }).join(', ');

                    // Las condiciones secundarias (AND...)
                    const others = queryConfig.wheres.slice(1).map(w => `${w.logic} ${w.target} = '${String(row[w.value] || '').replace(/'/g, "''")}'`).join(' ');

                    const signature = `${table}|${sets}|${others}`;
                    if (!groups.has(signature)) groups.set(signature, { table, sets, others, ids: [] });
                    groups.get(signature).ids.push(String(row[keyWhere.value] || '').replace(/'/g, "''"));
                });

                return Array.from(groups.values()).map(g =>
                    `-- Grupo ${g.table} (${g.ids.length} registros)\n${queryConfig.type} ${g.table} SET ${g.sets} WHERE ${keyWhere.target} IN ('${g.ids.join("','")}') ${g.others};`
                ).join('\n\n');

            } else {
                // MODO LINEAL (Original)
                return validRows.slice(0, 5).map(row => {
                    const dTable = queryConfig.tableCol ? `${queryConfig.table}${row[queryConfig.tableCol] || ''}` : queryConfig.table;
                    const sets = queryConfig.sets.map(s => {
                        const val = (s.type === 'manual' || s.mode === 'fixed') ? s.value : (row[s.value] || '');
                        return `${s.target} = '${String(val).replace(/'/g, "''")}'`;
                    }).join(', ');
                    const wheres = queryConfig.wheres.map((w, i) => `${i > 0 ? ` ${w.logic} ` : ''}${w.target} = '${String(row[w.value] || '').replace(/'/g, "''")}'`).join('');
                    return `${queryConfig.type} ${dTable} SET ${sets} WHERE ${wheres};`;
                }).join('\n');
            }
        };

        const generateListPreview = () => {
            if (!listConfig.col) return "Selecciona columna";
            return finalResult.slice(0, 10).map(r => {
                let val = String(r[listConfig.col] || '');
                if (listConfig.trim) val = val.trim();
                if (listConfig.noZeros) val = val.replace(/^0+/, '');
                return `${listConfig.quote}${val}${listConfig.quote}`;
            }).join(listConfig.sep === '\\n' ? '\n' : `${listConfig.sep} `) + (finalResult.length > 10 ? '...' : '');
        };

        const downloadOutput = () => {
            const fName = `Nexus_${strategy}_${new Date().getTime()}`;

            // 1. EXPORTAR TABLA (Full o Custom)
            if (outputTab === 'full' || outputTab === 'custom') {
                const wb = XLSX.utils.book_new();

                if (strategy === 'xor' && xorMode === 'sheets') {
                    // Caso Especial XOR: 2 Hojas
                    const dataA = finalResult.filter(r => r._ORIGIN === 'SOLO_A');
                    const dataB = finalResult.filter(r => r._ORIGIN === 'SOLO_B');
                    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dataA), "Solo A");
                    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dataB), "Solo B");
                } else {
                    // Caso Normal o Stacked
                    let dataToExport = finalResult;
                    if (outputTab === 'custom' && customCols.length > 0) {
                        dataToExport = finalResult.map(row => {
                            const newRow = {};
                            customCols.forEach(c => newRow[c.name] = row[c.name]);
                            // Siempre incluir origen para trazabilidad
                            newRow['_ORIGIN'] = row['_ORIGIN'];
                            return newRow;
                        });
                    }
                    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dataToExport), "Data");
                }
                XLSX.writeFile(wb, `${fName}.xlsx`);
            }
            // 2. EXPORTAR TEXTO (Lista o Query)
            else {
                let content = "";
                if (outputTab === 'list') {
                    content = finalResult.map(r => {
                        let val = String(r[listConfig.col] || '');
                        if (listConfig.trim) val = val.trim();
                        if (listConfig.noZeros) val = val.replace(/^0+/, '');
                        return `${listConfig.quote}${val}${listConfig.quote}`;
                    }).join(listConfig.sep === '\\n' ? '\n' : listConfig.sep);
                } else {
                    // Validar vacíos primero
                    const validRows = finalResult.filter(r => queryConfig.wheres.every(w => String(r[w.value] || '').trim() !== ''));

                    if (queryConfig.grouped && queryConfig.wheres.length > 0) {
                        // EXPORTACIÓN AGRUPADA (IN)
                        const groups = new Map();
                        const keyCol = queryConfig.wheres[0]; // Pivote para el IN

                        validRows.forEach(row => {
                            // Firma del Grupo: Tabla + Sets + Where secundarios
                            const dTable = queryConfig.tableCol ? `${queryConfig.table}${row[queryConfig.tableCol] || ''}` : queryConfig.table;

                            const sets = queryConfig.sets.map(s => {
                                const val = (s.type === 'manual' || s.mode === 'fixed') ? s.value : (row[s.value] || '');
                                return `${s.target}='${String(val).replace(/'/g, "''")}'`;
                            }).join(', ');

                            const otherWheres = queryConfig.wheres.slice(1).map(w => {
                                return `${w.logic} ${w.target} = '${String(row[w.value] || '').replace(/'/g, "''")}'`;
                            }).join(' ');

                            const sig = `${dTable}|${sets}|${otherWheres}`;
                            if (!groups.has(sig)) groups.set(sig, { table: dTable, sets, others: otherWheres, ids: [] });

                            // Agregar ID al grupo
                            groups.get(sig).ids.push(String(row[keyCol.value] || '').replace(/'/g, "''"));
                        });

                        content = Array.from(groups.values()).map(g =>
                            `-- Grupo ${g.table}: ${g.ids.length} registros\n${queryConfig.type} ${g.table} SET ${g.sets} WHERE ${keyCol.target} IN ('${g.ids.join("','")}') ${g.others};`
                        ).join('\n\n');

                    } else {
                        // EXPORTACIÓN LINEAL (Original)
                        content = validRows.map(row => {
                            const sets = queryConfig.sets.map(s => {
                                const val = (s.type === 'manual' || s.mode === 'fixed') ? s.value : (row[s.value] || '');
                                return `${s.target} = '${String(val).replace(/'/g, "''")}'`;
                            }).join(', ');

                            const wheres = queryConfig.wheres.map((w, i) => `${i > 0 ? ` ${w.logic} ` : ''}${w.target} = '${String(row[w.value] || '').replace(/'/g, "''")}'`).join('');
                            const dynamicTable = queryConfig.tableCol ? `${queryConfig.table}${row[queryConfig.tableCol] || ''}` : queryConfig.table;

                            return `${queryConfig.type} ${dynamicTable} SET ${sets} WHERE ${wheres};`;
                        }).join('\n');
                    }
                }
                const mimeType = exportExt === 'sql' ? 'application/sql' : 'text/plain';
                const blob = new Blob([content], { type: mimeType });
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${fName}.${exportExt}`; a.click();
            }
            addToast("Descarga iniciada", "success");
        };

        // NUEVO: Lógica para pasar columnas masivamente
        const addAllFromSide = (side) => {
            const sourceCols = side === 'A' ? baseA.columns : baseB.columns;
            // Identificar qué ya tenemos para no duplicar internamente
            const currentNames = new Set(customCols.filter(c => c.src === side).map(c => c.name));
            // Crear objetos solo para las columnas que faltan
            const newCols = sourceCols
                .filter(c => !currentNames.has(c))
                .map(c => ({ name: c, src: side }));

            if (newCols.length === 0) {
                addToast(`Ya están todas las columnas de ${side}`, 'info');
                return;
            }
            setCustomCols(prev => [...prev, ...newCols]);
            addToast(`Agregadas todas las columnas de Base ${side}`, 'success');
        };

        const removeAllCols = () => {
            setCustomCols([]);
            addToast("Lista de exportación limpiada", 'info');
        };


        // NUEVO: Funciones de limpieza
        const removeFile = (side, fileName) => {
            const setBase = side === 'A' ? setBaseA : setBaseB;
            setBase(prev => ({
                ...prev,
                filesMeta: prev.filesMeta.filter(f => f.name !== fileName),
                data: prev.data.filter(row => row.__file !== fileName)
            }));
            addToast(`Archivo ${fileName} eliminado`, 'info');
        };

        const clearSide = (side) => {
            const setBase = side === 'A' ? setBaseA : setBaseB;
            setBase({ filesMeta: [], data: [], columns: [], key: '' });
            addToast(`Base ${side} vaciada completamente`, 'info');
        };


        useEffect(() => {
            const fixCard = async () => {
                try {
                    const mods = await db.getAll('modules');
                    const me = mods.find(m => m.title === 'Cruce Avanzado');
                    if (me && me.color !== 'bg-violet-600') {
                        me.color = 'bg-violet-600'; me.icon = 'link'; await db.addOrUpdate('modules', [me]);
                    }
                } catch (e) { }
            };
            fixCard();
        }, []);

        // ====================================================================
        // UTILIDAD: Leer Excel con soporte multi-hojas y contraseña
        // ====================================================================
        const leerExcelConHojas = (file, sheetName, password) => {
            return new Promise((resolve, reject) => {
                if (file.name.toLowerCase().match(/\.(csv|txt)$/)) {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const wb = XLSX.read(e.target.result, { type: 'binary', cellDates: true });
                        const ws = wb.Sheets[wb.SheetNames[0]];
                        const headers = XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || [];
                        const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
                        resolve({ multiSheet: false, data, columns: headers });
                    };
                    reader.onerror = () => reject(new Error('Error al leer CSV'));
                    reader.readAsBinaryString(file);
                    return;
                }
                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        let buffer = e.target.result;
                        const isCfb = file.name.toLowerCase().match(/\.(xls|xlsb)$/) === null;
                        if (password && isCfb) buffer = await decryptExcelBuffer(buffer, password);
                        const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
                        if (wb.SheetNames.length > 1 && !sheetName) {
                            resolve({ multiSheet: true, sheetNames: wb.SheetNames, wb, decrypted: !!password });
                            return;
                        }
                        const targetSheet = sheetName || wb.SheetNames[0];
                        const ws = wb.Sheets[targetSheet];
                        const headers = XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || [];
                        const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
                        resolve({ multiSheet: false, data, columns: headers });
                    } catch (err) { reject(err); }
                };
                reader.onerror = () => reject(new Error('Error al leer archivo'));
                reader.readAsArrayBuffer(file);
            });
        };

        // ====================================================================
        // HANDLE UPLOAD: Con soporte multi-hojas y archivos protegidos
        // ====================================================================
        const handleUpload = async (e, targetSet) => {
            const files = e.target.files ? Array.from(e.target.files) : e.files || [];
            if (!files.length) return;

            setPendingTarget(targetSet);
            setLoading(true);

            const setProtected = targetSet === 'A' ? setProtectedFilesA : setProtectedFilesB;
            const currentPasswords = targetSet === 'A' ? passwordsA : passwordsB;
            const currentSheetSelections = sheetSelections;

            try {
                let allData = [], cols = [], meta = [];
                let blocked = [], multiSheetPending = [];

                for (const f of files) {
                    try {
                        const result = await leerExcelConHojas(
                            f,
                            currentSheetSelections[f.name] || null,
                            currentPasswords[f.name] || null
                        );

                        if (result.multiSheet) {
                            multiSheetPending.push({ name: f.name, file: f, sheetNames: result.sheetNames, wb: result.wb });
                            continue;
                        }

                        if (result.data && result.data.length > 0) {
                            const clean = result.data.map(r => ({ __file: f.name, ...r }));
                            if (cols.length === 0) cols = Object.keys(clean[0]).filter(k => k !== '__file');
                            allData = [...allData, ...clean];
                            meta.push({ name: f.name, count: clean.length });
                        }
                    } catch (err) {
                        blocked.push({ name: f.name, file: f });
                    }
                }

                // Si hay archivos con múltiples hojas, pausar para selección
                if (multiSheetPending.length > 0) {
                    setPendientesHojas(multiSheetPending);
                    if (targetSet === 'A') {
                        setBaseA(prev => ({ ...prev, _pendingFiles: files, _partialData: allData, _partialCols: cols, _partialMeta: meta, _pendingMultiSheet: multiSheetPending }));
                    } else {
                        setBaseB(prev => ({ ...prev, _pendingFiles: files, _partialData: allData, _partialCols: cols, _partialMeta: meta, _pendingMultiSheet: multiSheetPending }));
                    }
                    setLoading(false);
                    if (e.target && e.target.value) e.target.value = '';
                    return;
                }

                // Si hay archivos protegidos, mostrar UI de contraseña
                if (blocked.length > 0) {
                    setProtected(blocked);
                    if (targetSet === 'A') {
                        setBaseA(prev => ({ ...prev, _pendingFiles: files, _partialData: allData, _partialCols: cols, _partialMeta: meta }));
                    } else {
                        setBaseB(prev => ({ ...prev, _pendingFiles: files, _partialData: allData, _partialCols: cols, _partialMeta: meta }));
                    }
                    addToast(`${blocked.length} archivo(s) protegido(s). Ingresa contraseña.`, 'warning');
                    setLoading(false);
                    if (e.target && e.target.value) e.target.value = '';
                    return;
                }

                if (allData.length === 0) throw new Error("Archivos vacíos o sin datos");

                const newState = { filesMeta: meta, data: allData, columns: cols, key: '' };
                if (targetSet === 'A') setBaseA(newState); else setBaseB(newState);
                addToast(`${targetSet === 'A' ? 'Base A' : 'Base B'} cargada (${allData.length} registros)`, 'success');

            } catch (err) {
                addToast(err.message, 'error');
            } finally {
                setLoading(false);
                if (e.target && e.target.value) e.target.value = '';
            }
        };

        // ====================================================================
        // NUEVO: CARGAR DATOS DESDE SQL (CON ESCUDOS DE SEGURIDAD)
        // ====================================================================
        const handleSqlLoad = async (side) => {
            const query = side === 'A' ? sqlQueryA : sqlQueryB;
            const setBase = side === 'A' ? setBaseA : setBaseB;

            if (!query || query.trim() === '') {
                addToast("La consulta SQL está vacía.", "warning");
                return;
            }

            const executeQuery = async () => {
                setLoading(true);
                try {
                    // 1. Viaje al motor Node.js
                    const result = await window.nexusAPI.executeSQL(query);

                    if (!result.success) throw new Error(result.error);

                    // 2. Escudo contra abismo vacío
                    if (!result.data || result.data.length === 0) {
                        addToast("La consulta se ejecutó con éxito, pero devolvió 0 resultados.", "warning");
                        setLoading(false);
                        return;
                    }

                    // 3. Transformación transparente (Para que el módulo crea que es un archivo)
                    const cols = Object.keys(result.data[0]);
                    const metaName = `⚡ SQL_Consulta_${side}`;

                    const cleanData = result.data.map(r => ({ __file: metaName, ...r }));

                    setBase({
                        filesMeta: [{ name: metaName, count: cleanData.length }],
                        data: cleanData,
                        columns: cols,
                        key: ''
                    });

                    addToast(`Base ${side} cargada desde SQL (${cleanData.length} registros)`, 'success');

                } catch (err) {
                    addToast(`Error SQL: ${err.message}`, 'error');
                } finally {
                    setLoading(false);
                }
            };

            // ESCUDO PRINCIPAL: Prevención de Congelamiento
            const upperQuery = query.toUpperCase();
            if (!upperQuery.includes('WHERE') && !upperQuery.includes('TOP')) {
                utils.confirmAction({
                    title: '⚠️ Consulta sin Filtros Detectada',
                    message: 'Tu consulta no tiene cláusula WHERE ni límite TOP.\n\nEsto podría descargar millones de registros, saturar la memoria RAM y congelar la aplicación.\n\n¿Estás completamente seguro de continuar?',
                    type: 'danger',
                    confirmText: 'Ejecutar bajo mi riesgo',
                    onConfirm: executeQuery
                });
            } else {
                executeQuery(); // Si tiene filtros, pasa directo
            }
        };

        // ====================================================================
        // CONFIRMAR SELECCIÓN DE HOJAS Y REPROCESAR
        // ====================================================================
        const confirmarHojas = (selecciones) => {
            const targetSet = pendingTarget;
            const base = targetSet === 'A' ? baseA : baseB;
            const files = base._pendingFiles || [];

            // Actualizar selecciones y limpiar pendientes
            setSheetSelections(prev => ({ ...prev, ...selecciones }));
            setPendientesHojas([]);

            if (files.length === 0) return;

            // Reprocesar con las nuevas selecciones
            setLoading(true);

            setTimeout(async () => {
                const newSelections = { ...sheetSelections, ...selecciones };
                const currentPasswords = targetSet === 'A' ? passwordsA : passwordsB;

                let allData = base._partialData || [];
                let cols = base._partialCols || [];
                let meta = base._partialMeta || [];

                for (const f of files) {
                    // Solo procesar archivos que no se hayan procesado aún
                    if (meta.some(m => m.name === f.name)) continue;

                    try {
                        const pending = (base._pendingMultiSheet || []).find(p => p.name === f.name);
                        let result;
                        if (pending && pending.wb) {
                            const targetSheet = newSelections[f.name] || pending.wb.SheetNames[0];
                            const ws = pending.wb.Sheets[targetSheet];
                            const headers = XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || [];
                            const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
                            result = { multiSheet: false, data, columns: headers };
                        } else {
                            result = await leerExcelConHojas(
                                f,
                                newSelections[f.name] || null,
                                currentPasswords[f.name] || null
                            );
                        }

                        if (result.data && result.data.length > 0) {
                            const clean = result.data.map(r => ({ __file: f.name, ...r }));
                            if (cols.length === 0) cols = result.columns || Object.keys(clean[0]).filter(k => k !== '__file');
                            allData = [...allData, ...clean];
                            meta.push({ name: f.name, count: clean.length });
                        }
                    } catch (err) {
                        console.error(`Error procesando ${f.name}:`, err);
                    }
                }

                if (allData.length > 0) {
                    const newState = { filesMeta: meta, data: allData, columns: cols, key: '' };
                    if (targetSet === 'A') setBaseA(newState); else setBaseB(newState);
                    addToast(`Base ${targetSet} cargada (${allData.length} registros)`, 'success');
                } else {
                    addToast('No se pudieron cargar datos', 'warning');
                }

                setLoading(false);
            }, 50);
        };

        // ====================================================================
        // DESBLOQUEAR ARCHIVOS PROTEGIDOS Y REPROCESAR
        // ====================================================================
        const desbloquearArchivos = async (targetSet, passwordsFromUI) => {
            setLoading(true);
            const base = targetSet === 'A' ? baseA : baseB;
            const protectedFiles = targetSet === 'A' ? protectedFilesA : protectedFilesB;
            const setProtected = targetSet === 'A' ? setProtectedFilesA : setProtectedFilesB;
            const setBase = targetSet === 'A' ? setBaseA : setBaseB;

            // Usar contraseñas pasadas directamente desde UI
            const passwords = passwordsFromUI;

            let allData = base._partialData || [];
            let cols = base._partialCols || [];
            let meta = base._partialMeta || [];
            let stillBlocked = [];

            for (const pf of protectedFiles) {
                const pass = passwords[pf.name];
                if (!pass) {
                    stillBlocked.push(pf);
                    continue;
                }

                try {
                    const result = await leerExcelConHojas(pf.file, sheetSelections[pf.name] || null, pass);
                    if (result.multiSheet) {
                        setPendientesHojas(prev => [...prev, { name: pf.name, file: pf.file, sheetNames: result.sheetNames }]);
                        continue;
                    }
                    if (result.data && result.data.length > 0) {
                        const clean = result.data.map(r => ({ __file: pf.name, ...r }));
                        if (cols.length === 0) cols = Object.keys(clean[0]).filter(k => k !== '__file');
                        allData = [...allData, ...clean];
                        meta.push({ name: pf.name, count: clean.length });
                    }
                } catch (err) {
                    console.error(`Error descifrando ${pf.name}:`, err.message);
                    stillBlocked.push(pf);
                }
            }

            if (stillBlocked.length > 0) {
                setProtected(stillBlocked);
                addToast(`${stillBlocked.length} archivo(s) con contraseña incorrecta`, 'error');
                setLoading(false);
                return;
            }

            setProtected([]);

            if (allData.length === 0) {
                addToast("No hay datos para cargar", 'warning');
                setLoading(false);
                return;
            }

            const newState = { filesMeta: meta, data: allData, columns: cols, key: '' };
            setBase(newState);
            addToast(`Base ${targetSet} cargada (${allData.length} registros)`, 'success');
            setLoading(false);
        };

        const unifyDuplicates = (side) => {
            setLoading(true);
            setTimeout(() => {
                const base = side === 'A' ? baseA : baseB;
                const setBase = side === 'A' ? setBaseA : setBaseB;
                const keywords = ['RUT', 'ID', 'CEDULA', 'EMAIL', 'CORREO', 'TELEFONO', 'CODIGO'];
                let pivot = base.columns[0];
                for (const k of keywords) { const match = base.columns.find(c => c.toUpperCase().includes(k)); if (match) { pivot = match; break; } }
                const seen = new Set(); const cleanData = [];
                base.data.forEach(row => {
                    const key = String(row[pivot] || '').toUpperCase().trim();
                    if (key && !seen.has(key)) { seen.add(key); cleanData.push(row); }
                });
                const removed = base.data.length - cleanData.length;
                if (removed > 0) {
                    setBase(prev => ({ ...prev, data: cleanData }));
                    addToast(`Se eliminaron ${removed} duplicados en Base ${side}`, 'success');
                } else { addToast(`Base ${side} limpia`, 'info'); }
                setLoading(false);
            }, 100);
        };

        useEffect(() => {
            if (step === 2) {
                const findBestKey = (cols) => {
                    const keywords = ['RUT', 'ID', 'CEDULA', 'EMAIL', 'CORREO', 'TELEFONO'];
                    for (const k of keywords) { const match = cols.find(c => c.toUpperCase().includes(k)); if (match) return match; }
                    return cols[0] || '';
                };
                if (!baseA.key) setBaseA(prev => ({ ...prev, key: findBestKey(baseA.columns) }));
                if (!baseB.key) setBaseB(prev => ({ ...prev, key: findBestKey(baseB.columns) }));
            }
        }, [step]);

        // LÓGICA CENTRAL: Validador de Condiciones
        const checkConditions = (rowA, rowB) => {
            if (joinConditions.length === 0) return true; // Si no hay condiciones, pasa directo

            return joinConditions.every(cond => {
                const valA = String(rowA[cond.colA] || '').toUpperCase().trim();

                // Contra qué comparamos? Columna de B o Valor Estático
                let valB;
                if (cond.type === 'column') {
                    valB = String(rowB[cond.colB] || '').toUpperCase().trim();
                } else {
                    valB = String(cond.staticVal || '').toUpperCase().trim();
                    // Si es estático, revisamos si la condición es sobre A o sobre B?
                    // Simplificación: Asumimos comparación A vs B o A vs Static.
                    // CORRECCIÓN: Tu pediste "que en B el campo X sea TAL".
                    // Entonces: Si type es static, comparamos rowB[colB] vs Static.
                    const valTarget = String(rowB[cond.colB] || '').toUpperCase().trim();
                    return compareValues(valTarget, valB, cond.operator);
                }

                return compareValues(valA, valB, cond.operator);
            });
        };

        const compareValues = (a, b, op) => {
            switch (op) {
                case '=': return a === b;
                case '<>': return a !== b;
                case '>': return parseFloat(a) > parseFloat(b);
                case '<': return parseFloat(a) < parseFloat(b);
                case 'contains': return a.includes(b);
                default: return false;
            }
        };

        // 3. ANALIZAR (Vitaminado)
        // HELPER: Validar si una fila cumple las condiciones
        // HELPER: Validar condiciones (Soporte Multi-valor y Numérico)
        const rowPassesConditions = (row, side) => {
            const relevant = preFilters.filter(c => c.side === side);
            if (!relevant.length) return true;
            return relevant.every(c => {
                const cell = String(row[c.col] || '').toUpperCase().trim();

                // 1. Lógica de Lista (Multi-Select)
                if (Array.isArray(c.val) && (c.op === 'in' || c.op === 'not_in')) {
                    const setVals = new Set(c.val.map(v => String(v).toUpperCase().trim()));
                    return c.op === 'in' ? setVals.has(cell) : !setVals.has(cell);
                }

                // 2. Lógica Simple / Numérica
                const val = String(c.val || '').toUpperCase().trim();
                const numCell = parseFloat(cell.replace(',', '.'));
                const numVal = parseFloat(val.replace(',', '.'));
                const isNum = !isNaN(numCell) && !isNaN(numVal) && c.op !== 'contains' && c.op !== '=';

                switch (c.op) {
                    case '=': return cell === val;
                    case '<>': return cell !== val;
                    case 'contains': return cell.includes(val);
                    case '>': return isNum ? numCell > numVal : false;
                    case '<': return isNum ? numCell < numVal : false;
                    case '>=': return isNum ? numCell >= numVal : false;
                    case '<=': return isNum ? numCell <= numVal : false;
                    default: return true;
                }
            });
        };

        // HELPER: Obtener valores únicos para UI
        const getUniqueOptions = (side, col) => {
            const data = side === 'A' ? baseA.data : baseB.data;
            if (!col || !data.length) return [];
            const distinct = new Set(data.map(r => String(r[col] || '').trim()).filter(v => v !== ''));
            return Array.from(distinct).sort((a, b) => {
                const na = parseFloat(a), nb = parseFloat(b);
                return (!isNaN(na) && !isNaN(nb)) ? na - nb : a.localeCompare(b);
            }).slice(0, 200); // Top 200 valores
        };

        const analyzeKeys = () => {
            setLoading(true);
            setTimeout(() => {
                // 1. Filtrar B antes de indexar
                const setB = new Set();
                baseB.data.forEach(row => {
                    if (rowPassesConditions(row, 'B')) {
                        setB.add(String(row[baseB.key] || '').trim().toUpperCase());
                    }
                });

                // 2. Filtrar A antes de cruzar (opcional, si agregas filtros para A)
                let matches = 0;
                let validA = 0;
                baseA.data.forEach(row => {
                    if (rowPassesConditions(row, 'A')) {
                        validA++;
                        const valA = String(row[baseA.key] || '').trim().toUpperCase();
                        if (setB.has(valA)) matches++;
                    }
                });

                const percentage = validA > 0 ? ((matches / validA) * 100).toFixed(2) : '0.00';
                setAnalysis({ matches, percentage, totalA: validA, totalB: setB.size });
                setLoading(false);
            }, 200);
        };

        // 4. EJECUTAR CRUCE (Vitaminado)
        // 4. EJECUTAR CRUCE (CORREGIDO: Aplica Filtros Físicos Primero)
        const executeJoin = (selStrat) => {
            setLoading(true);
            setStrategy(selStrat);

            setTimeout(() => {
                // PASO CRÍTICO 1: Filtrar las bases ANTES de cruzar
                // Esto asegura que lo que fue excluido en el Paso 2, NO exista para el cruce
                const validDataA = baseA.data.filter(row => rowPassesConditions(row, 'A'));
                const validDataB = baseB.data.filter(row => rowPassesConditions(row, 'B'));

                // PASO 2: Indexar SOLO la Base B válida
                // Usamos un Multi-Mapa para soportar duplicados en la llave si es necesario
                // (Aunque para este caso simple, el último gana o usamos array de filas)
                const indexB = new Map();
                validDataB.forEach(row => {
                    const key = String(row[baseB.key] || '').trim().toUpperCase();
                    if (!indexB.has(key)) indexB.set(key, []);
                    indexB.get(key).push(row);
                });

                let result = [];
                const keysProcessedA = new Set();

                // PASO 3: Barrido Principal (Usando SOLO A Válida)
                validDataA.forEach(rowA => {
                    const keyA = String(rowA[baseA.key] || '').trim().toUpperCase();
                    keysProcessedA.add(keyA);

                    const candidates = indexB.get(keyA); // Busca en B filtrada
                    let matchFound = false;

                    if (candidates) {
                        // Nota: Los candidatos ya pasaron rowPassesConditions('B') arriba
                        matchFound = true;

                        if (['inner', 'outer', 'left_join', 'right_join'].includes(selStrat)) {
                            candidates.forEach(m => {
                                result.push({ ...m, ...rowA, _ORIGIN: 'AMBOS' });
                            });
                        }
                    }

                    // Si no hubo match (o el match fue filtrado), es SOLO A
                    if (!matchFound) {
                        if (['left_anti', 'outer', 'xor', 'left_join'].includes(selStrat)) {
                            result.push({ ...rowA, _ORIGIN: 'SOLO_A' });
                        }
                    }
                });

                // PASO 4: Barrido Secundario (Usando SOLO B Válida)
                if (['right_anti', 'outer', 'xor', 'right_join'].includes(selStrat)) {
                    // Para optimizar Right Join/Anti, necesitamos saber qué de B ya se usó.
                    // Como indexB.get(keyA) ya se usó arriba, podemos inferirlo,
                    // pero para Outer estricto, recorremos B y vemos si su llave estaba en A.

                    // Indexamos A válida para búsqueda rápida inversa
                    const setA = new Set();
                    validDataA.forEach(r => setA.add(String(r[baseA.key] || '').toUpperCase().trim()));

                    validDataB.forEach(rowB => {
                        const keyB = String(rowB[baseB.key] || '').trim().toUpperCase();

                        // Si la llave de B NO está en el set de A...
                        if (!setA.has(keyB)) {
                            // Es un registro huérfano de B (Solo Derecha)
                            if (selStrat !== 'right_join') {
                                // En Outer, XOR y Right Anti, lo queremos.
                                result.push({ ...rowB, _ORIGIN: 'SOLO_B' });
                            } else {
                                // En Right Join puro, también queremos los huérfanos de B
                                result.push({ ...rowB, _ORIGIN: 'SOLO_B' });
                            }
                        }
                    });
                }

                setFinalResult(result);
                setLoading(false);
                setStep(4); // Avanzar al Paso 4 (Salida)
            }, 200);
        };



        const renderUploadPanel = (side, baseState, handleUploadFn) => {
            const protectedFiles = side === 'A' ? protectedFilesA : protectedFilesB;
            const passwords = side === 'A' ? passwordsA : passwordsB;
            const setPasswords = side === 'A' ? setPasswordsA : setPasswordsB;
            const mostrarSelectorHojas = pendientesHojas.length > 0 && pendingTarget === side;
            const currentMode = side === 'A' ? inputModeA : inputModeB;
            const setMode = side === 'A' ? setInputModeA : setInputModeB;
            const currentQuery = side === 'A' ? sqlQueryA : sqlQueryB;
            const setQuery = side === 'A' ? setSqlQueryA : setSqlQueryB;

            return (
                <div style={{ position: 'relative' }}>
                    <h3 style={{ fontWeight: 'bold', color: 'var(--text-main)', marginBottom: '0.5rem', textAlign: 'center' }}>{side === 'A' ? '🅰️ Base Principal' : '🅱️ Base Cruce'}</h3>

                    <div style={{ display: 'flex', gap: '4px', marginBottom: '1rem', justifyContent: 'center' }}>
                        <button className={`btn btn-sm ${currentMode === 'file' ? 'bg-indigo-600 text-white' : 'bg-gray-200'}`} onClick={() => setMode('file')}>📂 Archivo</button>
                        <button
                            className={`btn btn-sm ${currentMode === 'sql' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
                            onClick={() => {
                                setMode('sql');
                                // Limpieza de residuos de archivos físicos
                                setPendientesHojas([]);
                                if (side === 'A') setProtectedFilesA([]);
                                else setProtectedFilesB([]);
                            }}
                        >
                            ⚡ SQL
                        </button>
                    </div>

                    {/* Renderizado Condicional: Selector de Origen de Datos (Archivo / SQL) */}
                    {currentMode === 'file' ? (
                        <>
                            {/* SELECTOR DE HOJAS */}
                            {mostrarSelectorHojas && (
                                <SelectorHojas
                                    pendientes={pendientesHojas}
                                    onConfirm={confirmarHojas}
                                    onCancel={() => { setPendientesHojas([]); setPendingTarget(null); }}
                                />
                            )}

                            {/* PANEL DE CONTRASEÑAS */}
                            {protectedFiles.length > 0 && (
                                <div style={{ background: '#fffbeb', border: '2px solid #f59e0b', borderRadius: 12, padding: '1rem', marginBottom: '1rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.75rem' }}>
                                        <Icon name="lock" size={18} className="text-amber-600" />
                                        <strong style={{ color: '#92400e', fontSize: '0.85rem' }}>Archivos Protegidos ({protectedFiles.length})</strong>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 150, overflowY: 'auto' }}>
                                        {protectedFiles.map((pf, idx) => (
                                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'white', padding: 8, borderRadius: 6, border: '1px solid #fbbf24' }}>
                                                <span style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pf.name}</span>
                                                <input
                                                    type="text"
                                                    placeholder="Contraseña"
                                                    style={{ width: 100, border: '1px solid #fbbf24', borderRadius: 4, padding: '4px 6px', fontSize: '0.7rem', fontFamily: 'monospace' }}
                                                    value={passwords[pf.name] || ''}
                                                    onChange={(e) => setPasswords(prev => ({ ...prev, [pf.name]: e.target.value }))}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                    <button
                                        onClick={() => desbloquearArchivos(side, passwords)}
                                        style={{ marginTop: '0.75rem', width: '100%', padding: '8px', fontSize: '0.8rem', fontWeight: 700, color: 'white', background: '#d97706', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                                    >
                                        🔓 Desbloquear y Cargar
                                    </button>
                                </div>
                            )}

                            <label className={`drop-zone ${baseState.data.length > 0 ? 'has-data' : ''}`}>
                                <input type="file" multiple hidden accept=".xlsx,.xls,.csv,.txt" onChange={(e) => handleUploadFn(e, side)} />
                                <Icon name={baseState.data.length ? "check-circle" : "upload-cloud"} size={48} style={{ color: baseState.data.length ? '#10b981' : '#ddd6fe' }} />
                                <div style={{ fontWeight: 'bold', color: baseState.data.length ? '#065f46' : '#6b7280' }}>{baseState.data.length > 0 ? 'Archivos Cargados' : `Clic para cargar`}</div>
                                {baseState.data.length > 0 && <div className="file-count">{baseState.data.length.toLocaleString()} filas</div>}
                            </label>
                            {baseState.data.length > 0 && (
                                <div className="files-detail">
                                    {/* Cabecera con acción de limpiar todo */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                        <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#6b7280' }}>Archivos:</span>
                                        <button className="btn btn-sm" style={{ color: '#ef4444', padding: '2px 6px', fontSize: '0.75rem' }} onClick={(e) => { e.preventDefault(); clearSide(side); }}>
                                            🗑️ Vaciar Todo
                                        </button>
                                    </div>

                                    {/* Lista de archivos con borrado individual */}
                                    {baseState.filesMeta.map((f, i) => (
                                        <div key={i} className="file-row" style={{ alignItems: 'center' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden' }}>
                                                <button
                                                    onClick={(e) => { e.preventDefault(); removeFile(side, f.name); }}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '0 4px' }}
                                                    title="Eliminar este archivo"
                                                >✕</button>
                                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>
                                                    📄 {f.name}
                                                </span>
                                            </div>
                                            <strong>{f.count.toLocaleString()}</strong>
                                        </div>
                                    ))}

                                    <button className="btn btn-sm btn-dedup" onClick={() => unifyDuplicates(side)}>🧹 Unificar Duplicados</button>
                                </div>
                            )}
                        </>
                        /* Fin del Modo Archivo e Inicio del Modo SQL */
                    ) : (
                        <div className="fade-in flex flex-col gap-3">
                            <textarea
                                className="preview-box w-full h-40"
                                style={{ marginBottom: 0 }}
                                value={currentQuery}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="SELECT * FROM..."
                            />
                            <button className="btn btn-primary" onClick={() => handleSqlLoad(side)}>Ejecutar Consulta</button>
                            {baseState.data.length > 0 && (
                                <div className="match-stats" style={{ marginTop: 0, background: '#ecfdf5', borderColor: '#10b981', color: '#065f46' }}>
                                    <strong>{baseState.data.length.toLocaleString()}</strong> filas cargadas desde SQL
                                </div>
                            )}
                        </div>
                    )}
                </div>
            );
        };

        return (
            <div className="min-h-screen bg-violet-50 p-6 pb-32 slide-up">
                <style>{cssStyles}</style>
                <div className="header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ background: 'rgba(255,255,255,0.2)', padding: '0.5rem', borderRadius: '8px' }}><Icon name="link" size={28} /></div>
                        <div><h1>Nexus Data Linker</h1><div style={{ opacity: 0.8, fontSize: '0.9rem' }}>Cruce Avanzado</div></div>
                    </div>
                    <button className="btn" style={{ background: 'rgba(0,0,0,0.2)', color: 'white' }} onClick={goHome}><Icon name="x" size={18} /> Salir</button>
                </div>

                {step === 1 && (
                    <div className="card">
                        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                            <h2 style={{ fontSize: '1.8rem', fontWeight: '800', color: 'var(--primary)' }}>Paso 1: Carga de Bases</h2>
                            <p style={{ color: '#6b7280' }}>Sube tus archivos para comparar.</p>
                        </div>
                        <div className="bipolar-container">
                            {renderUploadPanel('A', baseA, handleUpload)}
                            <div className="vs-badge">VS</div>
                            {renderUploadPanel('B', baseB, handleUpload)}
                        </div>
                        {loading && <div style={{ textAlign: 'center', margin: '1rem', fontWeight: 'bold' }}>Procesando...</div>}
                        <div style={{ marginTop: '2rem' }}>
                            <button className="btn btn-primary" disabled={baseA.data.length === 0 || baseB.data.length === 0} onClick={() => setStep(2)}>Definir Llaves <Icon name="arrow-right" /></button>
                        </div>
                    </div>
                )}

                {/* PASO 2: DEFINIR LLAVES Y CONDICIONES */}
                {step === 2 && (
                    <div className="card">
                        <h2 style={{ textAlign: 'center', color: 'var(--primary)', marginBottom: '1rem' }}>Paso 2: Lógica de Cruce</h2>

                        {/* LLAVE PRINCIPAL (INDEX) */}
                        <div style={{ background: '#f5f3ff', padding: '1.5rem', borderRadius: '12px', border: '1px solid #ddd6fe', marginBottom: '2rem' }}>
                            <h3 style={{ fontWeight: 'bold', color: 'var(--primary)', marginBottom: '1rem', textAlign: 'center' }}>🔑 Llave Principal (Index)</h3>
                            <div className="bipolar-container" style={{ alignItems: 'center', marginTop: 0, gap: '1rem' }}>
                                <select className="key-selector" value={baseA.key} onChange={e => { setBaseA({ ...baseA, key: e.target.value }); setAnalysis(null); }}>
                                    {baseA.columns.map(c => <option key={c} value={c}>[A] {c}</option>)}
                                </select>
                                <div style={{ textAlign: 'center' }}><Icon name="link" size={24} color="var(--primary)" /></div>
                                <select className="key-selector" value={baseB.key} onChange={e => { setBaseB({ ...baseB, key: e.target.value }); setAnalysis(null); }}>
                                    {baseB.columns.map(c => <option key={c} value={c}>[B] {c}</option>)}
                                </select>
                            </div>
                        </div>

                        {/* CONDICIONES DE FILTRO INTELIGENTE */}
                        <div style={{ marginBottom: '2rem', padding: '1rem', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                            <div style={{ fontWeight: 'bold', color: '#4b5563', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                🛠️ Filtros de Pre-Procesamiento (WHERE)
                                <span style={{ fontSize: '0.7rem', background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px', fontWeight: 'normal' }}>Limpia las bases A o B antes del cruce</span>
                            </div>

                            {preFilters.filter(c => c.side).map((c, i) => {
                                const isListMode = c.op === 'in' || c.op === 'not_in';
                                const uniqueOpts = isListMode ? getUniqueOptions(c.side, c.col) : [];

                                return (
                                    <div key={c.id} style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px dashed #eee' }}>
                                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                                            {/* MOD: Selector de Lado (A o B) */}
                                            <select
                                                className="sql-badge"
                                                style={{ cursor: 'pointer', border: '1px solid #ddd', outline: 'none', fontWeight: 'bold', color: c.side === 'A' ? 'var(--primary)' : '#ec4899' }}
                                                value={c.side}
                                                onChange={e => {
                                                    const n = [...preFilters];
                                                    n[i].side = e.target.value;
                                                    n[i].col = ''; // Reset columna al cambiar lado
                                                    n[i].val = (n[i].op === 'in' || n[i].op === 'not_in') ? [] : '';
                                                    setPreFilters(n);
                                                }}
                                            >
                                                <option value="A">Base A</option>
                                                <option value="B">Base B</option>
                                            </select>

                                            {/* MOD: Lista de Columnas Dinámica (Depende de c.side) */}
                                            <select className="key-selector" value={c.col} onChange={e => {
                                                const n = [...preFilters]; n[i].col = e.target.value;
                                                n[i].val = (n[i].op === 'in' || n[i].op === 'not_in') ? [] : '';
                                                setPreFilters(n);
                                            }}>
                                                <option value="">- Columna -</option>
                                                {(c.side === 'A' ? baseA.columns : baseB.columns).map(col => <option key={col} value={col}>{col}</option>)}
                                            </select>
                                            <select className="key-selector" style={{ width: '140px' }} value={c.op} onChange={e => {
                                                const n = [...preFilters]; const newOp = e.target.value; n[i].op = newOp;
                                                // Reset val type según operador
                                                const isMulti = newOp === 'in' || newOp === 'not_in';
                                                n[i].val = isMulti ? [] : '';
                                                setPreFilters(n);
                                            }}>
                                                <optgroup label="Lista">
                                                    <option value="in">Es uno de...</option>
                                                    <option value="not_in">NO es uno de...</option>
                                                </optgroup>
                                                <optgroup label="Valor / Numérico">
                                                    <option value="=">Igual a</option>
                                                    <option value="<>">Distinto de</option>
                                                    <option value=">">Mayor que</option>
                                                    <option value="<">Menor que</option>
                                                    <option value="contains">Contiene</option>
                                                </optgroup>
                                            </select>
                                            <button className="btn btn-sm" style={{ color: 'red' }} onClick={() => setPreFilters(preFilters.filter(x => x.id !== c.id))}>✕</button>
                                        </div>

                                        {/* INPUT DINÁMICO */}
                                        <div style={{ paddingLeft: '2.5rem' }}>
                                            {isListMode ? (
                                                c.col ? (
                                                    <select
                                                        className="key-selector"
                                                        multiple
                                                        size="4"
                                                        value={c.val}
                                                        onChange={e => {
                                                            const selected = Array.from(e.target.selectedOptions, o => o.value);
                                                            const n = [...preFilters]; n[i].val = selected; setPreFilters(n);
                                                        }}
                                                        style={{ fontSize: '0.85rem', height: '100px' }}
                                                    >
                                                        {uniqueOpts.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                                    </select>
                                                ) : <div style={{ fontSize: '0.8rem', color: '#999', fontStyle: 'italic' }}>Selecciona una columna para ver valores...</div>
                                            ) : (
                                                <input
                                                    type={['>', '<', '>=', '<='].includes(c.op) ? "number" : "text"}
                                                    className="key-selector"
                                                    placeholder={['>', '<'].includes(c.op) ? "Valor numérico..." : "Escribe valor exacto..."}
                                                    value={c.val}
                                                    onChange={e => { const n = [...preFilters]; n[i].val = e.target.value; setPreFilters(n) }}
                                                />
                                            )}
                                            {isListMode && c.val.length > 0 && <div style={{ fontSize: '0.75rem', color: '#059669', marginTop: '4px' }}>{c.val.length} valores seleccionados</div>}
                                        </div>
                                    </div>
                                );
                            })}
                            <button className="btn btn-sm btn-outline" onClick={() => setPreFilters([...preFilters, { id: Date.now(), side: 'A', col: '', op: 'in', val: [] }])}>+ Agregar Filtro (A/B)</button>
                        </div>

                        {/* CONDICIONES ADICIONALES */}
                        <div style={{ marginBottom: '2rem' }}>
                            <h3 style={{ fontWeight: 'bold', color: '#4b5563', marginBottom: '0.5rem', fontSize: '1rem' }}>🛠️ Condiciones Adicionales (Opcional)</h3>
                            <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '1rem' }}>Agrega filtros o llaves secundarias. Ej: <code>RUT = RUT</code> (Arriba) <strong>Y</strong> <code>FECHA_A = FECHA_B</code> (Abajo).</p>

                            {joinConditions.map((cond, idx) => (
                                <div key={idx} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 60px 1fr 40px', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem', animation: 'fadeIn 0.3s' }}>
                                    <span className="sql-badge" style={{ justifySelf: 'center' }}>AND</span>

                                    {/* LADO A (Siempre columna por ahora) */}
                                    <select className="key-selector" style={{ padding: '0.4rem', fontSize: '0.9rem' }} value={cond.colA} onChange={e => {
                                        const n = [...joinConditions]; n[idx].colA = e.target.value; setJoinConditions(n); setAnalysis(null);
                                    }}>
                                        <option value="">(Columna A)</option>
                                        {baseA.columns.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>

                                    {/* OPERADOR */}
                                    <select className="key-selector" style={{ padding: '0.4rem', textAlign: 'center' }} value={cond.operator} onChange={e => {
                                        const n = [...joinConditions]; n[idx].operator = e.target.value; setJoinConditions(n); setAnalysis(null);
                                    }}>
                                        <option value="=">=</option><option value="<>">≠</option><option value=">">&gt;</option><option value="<">&lt;</option>
                                    </select>

                                    {/* LADO B (Columna o Estático) */}
                                    <div style={{ display: 'flex', gap: '2px' }}>
                                        <select className="key-selector" style={{ padding: '0.4rem', width: '40px', background: '#eee' }} value={cond.type} onChange={e => {
                                            const n = [...joinConditions]; n[idx].type = e.target.value; setJoinConditions(n); setAnalysis(null);
                                        }}>
                                            <option value="column">B</option><option value="static">txt</option>
                                        </select>
                                        {cond.type === 'column' ? (
                                            <select className="key-selector" style={{ padding: '0.4rem', fontSize: '0.9rem' }} value={cond.colB} onChange={e => {
                                                const n = [...joinConditions]; n[idx].colB = e.target.value; setJoinConditions(n); setAnalysis(null);
                                            }}>
                                                <option value="">(Columna B)</option>
                                                {baseB.columns.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                        ) : (
                                            <input type="text" className="key-selector" style={{ padding: '0.4rem', fontSize: '0.9rem' }} placeholder="Valor fijo..." value={cond.staticVal} onChange={e => {
                                                const n = [...joinConditions]; n[idx].staticVal = e.target.value; setJoinConditions(n); setAnalysis(null);
                                            }} />
                                        )}
                                    </div>

                                    <button className="btn btn-sm" style={{ color: 'red' }} onClick={() => {
                                        setJoinConditions(joinConditions.filter((_, i) => i !== idx)); setAnalysis(null);
                                    }}>✕</button>
                                </div>
                            ))}

                            <button className="btn btn-sm btn-outline" onClick={() => setJoinConditions([...joinConditions, { colA: baseA.columns[0], operator: '=', type: 'column', colB: baseB.columns[0], staticVal: '' }])}>
                                + Agregar Condición
                            </button>
                        </div>

                        {/* ANALIZAR */}
                        <div style={{ marginTop: '2rem', textAlign: 'center', borderTop: '1px solid #eee', paddingTop: '1.5rem' }}>
                            {!analysis ? (
                                <button className="btn btn-primary" style={{ width: 'auto', padding: '0.8rem 3rem' }} onClick={analyzeKeys} disabled={loading}>
                                    {loading ? 'Analizando Lógica...' : '🔍 Analizar Coincidencias'}
                                </button>
                            ) : (
                                <div className="match-stats">
                                    <div style={{ fontSize: '1.5rem', fontWeight: '800' }}>{analysis.matches.toLocaleString()} coincidencias</div>
                                    <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>({analysis.percentage}% de cobertura)</div>
                                    <button className="btn btn-primary" style={{ marginTop: '1rem', background: '#d97706' }} onClick={() => setStep(3)}>Definir Estrategia <Icon name="arrow-right" /></button>
                                </div>
                            )}
                        </div>
                        <div style={{ marginTop: '1rem' }}><button className="btn btn-outline" onClick={() => { setStep(1); setAnalysis(null); }}>← Atrás</button></div>
                    </div>
                )}

                {step === 3 && (
                    <div className="card">
                        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                            <h2 style={{ fontSize: '1.8rem', fontWeight: '800', color: 'var(--primary)' }}>Paso 3: Estrategia de Cruce</h2>
                            <p style={{ color: '#6b7280' }}>Selecciona qué conjunto de datos deseas obtener.</p>
                        </div>

                        <div className="venn-grid">
                            <div className={`venn-card venn-inner ${strategy === 'inner' ? 'selected' : ''}`} onClick={() => executeJoin('inner')}>
                                <div className="venn-visual"><div className="circle circle-left"></div><div className="circle circle-right"></div><div className="intersection"></div></div>
                                <div style={{ textAlign: 'center' }}><h4 style={{ fontWeight: 'bold', color: 'var(--primary)' }}>Coincidencias</h4><p style={{ fontSize: '0.8rem', color: '#6b7280' }}>Están en A y B.</p></div>
                            </div>
                            <div className={`venn-card venn-left ${strategy === 'left_anti' ? 'selected' : ''}`} onClick={() => executeJoin('left_anti')}>
                                <div className="venn-visual"><div className="circle circle-left"></div><div className="circle circle-right"></div></div>
                                <div style={{ textAlign: 'center' }}><h4 style={{ fontWeight: 'bold', color: 'var(--primary)' }}>Solo Izquierda (A)</h4><p style={{ fontSize: '0.8rem', color: '#6b7280' }}>Están en A pero NO en B.</p></div>
                            </div>
                            <div className={`venn-card venn-right ${strategy === 'right_anti' ? 'selected' : ''}`} onClick={() => executeJoin('right_anti')}>
                                <div className="venn-visual"><div className="circle circle-left"></div><div className="circle circle-right"></div></div>
                                <div style={{ textAlign: 'center' }}><h4 style={{ fontWeight: 'bold', color: '#ec4899' }}>Solo Derecha (B)</h4><p style={{ fontSize: '0.8rem', color: '#6b7280' }}>Están en B pero NO en A.</p></div>
                            </div>
                            <div className={`venn-card venn-outer ${strategy === 'outer' ? 'selected' : ''}`} onClick={() => executeJoin('outer')}>
                                <div className="venn-visual"><div className="circle circle-left"></div><div className="circle circle-right"></div></div>
                                <div style={{ textAlign: 'center' }}><h4 style={{ fontWeight: 'bold', color: '#8b5cf6' }}>Todo (Unificado)</h4><p style={{ fontSize: '0.8rem', color: '#6b7280' }}>Unión de ambas bases.</p></div>
                            </div>
                        </div>

                        <details className="advanced-section">
                            <summary className="advanced-summary">🛠️ Opciones Especiales (XOR, Enriquecer)</summary>
                            <div className="advanced-grid">
                                <div className={`advanced-card ${strategy === 'xor' ? 'selected' : ''}`} onClick={() => executeJoin('xor')}>
                                    <strong>🔀 Diferencia Simétrica (XOR)</strong>
                                    <div className="venn-visual venn-xor" style={{ height: '40px', marginTop: '0.5rem' }}><div className="circle circle-left"></div><div className="circle circle-right"></div><div className="intersection"></div></div>
                                    <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>A + B excluyendo coincidencias</div>
                                </div>
                                <div className={`advanced-card ${strategy === 'left_join' ? 'selected' : ''}`} onClick={() => executeJoin('left_join')}>
                                    <strong>⬅️ Enriquecer A (Left Join)</strong>
                                    <div style={{ fontSize: '0.8rem', opacity: 0.8, marginTop: '0.5rem' }}>Mantener todo A y pegar datos de B si existen.</div>
                                </div>
                                <div className={`advanced-card ${strategy === 'right_join' ? 'selected' : ''}`} onClick={() => executeJoin('right_join')}>
                                    <strong>➡️ Enriquecer B (Right Join)</strong>
                                    <div style={{ fontSize: '0.8rem', opacity: 0.8, marginTop: '0.5rem' }}>Mantener todo B y pegar datos de A si existen.</div>
                                </div>
                            </div>
                        </details>

                        {strategy && !loading && (
                            <div style={{ marginTop: '2rem', padding: '1.5rem', background: '#f0fdf4', borderRadius: '12px', border: '2px solid #10b981', textAlign: 'center', animation: 'fadeIn 0.3s' }}>
                                <h3 style={{ fontWeight: '800', color: '#065f46', fontSize: '1.5rem' }}>{finalResult.length.toLocaleString()} registros</h3>
                                <p style={{ color: '#047857' }}>Listos para exportar según la estrategia <strong>{strategy.toUpperCase().replace('_', ' ')}</strong>.</p>
                                <button className="btn btn-primary" style={{ marginTop: '1rem', width: 'auto', background: '#059669' }} onClick={() => setStep(4)}>
                                    Configurar Salida <Icon name="settings" />
                                </button>
                            </div>
                        )}
                        {loading && <div style={{ textAlign: 'center', marginTop: '2rem', fontWeight: 'bold', color: 'var(--primary)' }}>Procesando Cruce...</div>}
                        <div style={{ marginTop: '2rem' }}><button className="btn btn-outline" onClick={() => setStep(2)}>← Atrás</button></div>
                    </div>
                )}

                {step === 4 && (
                    <div className="card">
                        <h2 style={{ textAlign: 'center', color: 'var(--primary)', marginBottom: '1rem' }}>Paso 4: Exportación Avanzada</h2>

                        {/* TABS */}
                        <div className="output-tabs">
                            <div className={`tab ${outputTab === 'full' ? 'active' : ''}`} onClick={() => setOutputTab('full')}>📦 Base Completa</div>
                            <div className={`tab ${outputTab === 'custom' ? 'active' : ''}`} onClick={() => setOutputTab('custom')}>🎨 Base Compuesta</div>
                            <div className={`tab ${outputTab === 'list' ? 'active' : ''}`} onClick={() => setOutputTab('list')}>📝 Lista Normalizada</div>
                            <div className={`tab ${outputTab === 'query' ? 'active' : ''}`} onClick={() => setOutputTab('query')}>⚡ SQL Pro</div>
                        </div>

                        {/* 1. BASE COMPLETA */}
                        {outputTab === 'full' && (
                            <div style={{ textAlign: 'center', padding: '2rem' }}>
                                <Icon name="package" size={48} color="#ddd6fe" />
                                <p>Se exportarán <strong>{finalResult.length.toLocaleString()}</strong> filas con todas las columnas disponibles de ambas bases.</p>
                                {strategy === 'xor' && (
                                    <div style={{ marginTop: '1rem', padding: '1rem', background: '#fdf2f8', border: '1px solid #fbcfe8', borderRadius: '8px' }}>
                                        <label style={{ fontWeight: 'bold', color: '#db2777' }}>Modo Discrepancia (XOR):</label>
                                        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '0.5rem' }}>
                                            <label><input type="radio" checked={xorMode === 'sheets'} onChange={() => setXorMode('sheets')} /> 2 Hojas Separadas</label>
                                            <label><input type="radio" checked={xorMode === 'stack'} onChange={() => setXorMode('stack')} /> Una Hoja Apilada</label>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* 2. BASE COMPUESTA (MEJORADO) */}
                        {outputTab === 'custom' && (
                            <div className="columns-selector">
                                {/* Columna Izquierda: Disponibles */}
                                <div className="col-list">
                                    <div style={{ padding: '0.5rem', background: '#eee', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span>Disponibles</span>
                                        <div style={{ display: 'flex', gap: '4px' }}>
                                            <button className="btn btn-sm" style={{ padding: '2px 6px', fontSize: '0.7rem', height: 'auto' }} onClick={() => addAllFromSide('A')}>+ Todo A</button>
                                            <button className="btn btn-sm" style={{ padding: '2px 6px', fontSize: '0.7rem', height: 'auto', background: '#fdf2f8', color: '#db2777', border: '1px solid #fbcfe8' }} onClick={() => addAllFromSide('B')}>+ Todo B</button>
                                        </div>
                                    </div>

                                    {/* Renderizado con FILTRO: Si está seleccionada, no se muestra aquí */}
                                    {[...baseA.columns.map(c => ({ src: 'A', n: c })), ...baseB.columns.map(c => ({ src: 'B', n: c }))]
                                        .filter(c => !customCols.find(sel => sel.name === c.n && sel.src === c.src))
                                        .map((c, i) => (
                                            <div key={i} className={`col-item col-source-${c.src.toLowerCase()}`} onClick={() => setCustomCols([...customCols, { name: c.n, src: c.src }])}>
                                                <span>{c.n}</span> <span className="sql-badge">{c.src}</span>
                                            </div>
                                        ))}

                                    {/* Mensaje si no queda nada */}
                                    {[...baseA.columns, ...baseB.columns].length === customCols.length && (
                                        <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontStyle: 'italic' }}>
                                            Todo seleccionado
                                        </div>
                                    )}
                                </div>

                                {/* Centro: Flecha */}
                                <div className="col-actions"><Icon name="arrow-right" /></div>

                                {/* Columna Derecha: A Exportar */}
                                <div className="col-list" style={{ borderColor: 'var(--primary)' }}>
                                    <div style={{ padding: '0.5rem', background: '#f5f3ff', fontWeight: 'bold', color: 'var(--primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span>A Exportar ({customCols.length})</span>
                                        {customCols.length > 0 && <button className="btn btn-sm" style={{ padding: '2px 6px', fontSize: '0.7rem', background: '#fee2e2', color: '#ef4444', border: '1px solid #fecaca' }} onClick={removeAllCols}>Limpiar</button>}
                                    </div>

                                    {customCols.map((c, i) => (
                                        <div key={i} className="col-item" onClick={() => setCustomCols(customCols.filter((_, idx) => idx !== i))}>
                                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                <span className={`sql-badge ${c.src === 'A' ? '' : 'badge-warning'}`} style={{ background: c.src === 'A' ? '#ddd6fe' : '#fce7f3', color: c.src === 'A' ? 'var(--primary)' : '#db2777' }}>{c.src}</span>
                                                <span>{c.name}</span>
                                            </div>

                                            {/* Inteligencia: Avisar si hay col igual en el otro lado ya seleccionada */}
                                            {customCols.some(other => other.name === c.name && other.src !== c.src) && (
                                                <span className="badge-warning" style={{ fontSize: '0.65rem' }} title="Posible dato duplicado">Dup</span>
                                            )}
                                            <span style={{ color: '#ef4444' }}>✕</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* 3. LISTA NORMALIZADA */}
                        {outputTab === 'list' && (
                            <div>
                                <div className="config-row">
                                    <div className="label-sm">Campo:</div>
                                    <select className="key-selector" onChange={e => setListConfig({ ...listConfig, col: e.target.value })}>
                                        <option value="">-- Seleccionar --</option>
                                        {Object.keys(finalResult[0] || {}).map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div className="config-row">
                                    <label className="label-sm"><input type="checkbox" checked={listConfig.trim} onChange={e => setListConfig({ ...listConfig, trim: e.target.checked })} /> Trim Espacios</label>
                                    <label className="label-sm"><input type="checkbox" checked={listConfig.noZeros} onChange={e => setListConfig({ ...listConfig, noZeros: e.target.checked })} /> Quitar ceros izq.</label>
                                    <select className="key-selector" style={{ width: '100px' }} value={listConfig.quote} onChange={e => setListConfig({ ...listConfig, quote: e.target.value })}>
                                        <option value="'">Simple (')</option><option value='"'>Doble (")</option><option value="">Nada</option>
                                    </select>
                                    <select className="key-selector" style={{ width: '100px' }} value={listConfig.sep} onChange={e => setListConfig({ ...listConfig, sep: e.target.value })}>
                                        <option value=",">Coma</option><option value="\n">Enter</option>
                                    </select>
                                </div>
                                <div className="preview-box">{generateListPreview()}</div>
                            </div>
                        )}

                        {/* 4. SQL PRO */}
                        {outputTab === 'query' && (
                            <div>
                                <div className="config-row">
                                    <div style={{ flex: 1 }}>
                                        <div className="label-sm">Tabla (Prefijo)</div>
                                        <input type="text" className="key-selector" placeholder="Nombre tabla..." value={queryConfig.table} onChange={e => setQueryConfig({ ...queryConfig, table: e.target.value })} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div className="label-sm">+ Columna (Opcional)</div>
                                        <select className="key-selector" value={queryConfig.tableCol} onChange={e => setQueryConfig({ ...queryConfig, tableCol: e.target.value })}>
                                            <option value="">(Ninguna)</option>
                                            {Object.keys(finalResult[0] || {}).map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <div className="label-sm">Tipo / Optimización</div>
                                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                            <select className="key-selector" style={{ width: '120px' }} value={queryConfig.type} onChange={e => setQueryConfig({ ...queryConfig, type: e.target.value })}>
                                                <option>UPDATE</option><option>INSERT INTO</option>
                                            </select>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', padding: '6px', border: '1px solid #ddd', borderRadius: '4px', background: queryConfig.grouped ? '#ecfdf5' : 'white', cursor: 'pointer', userSelect: 'none' }}>
                                                <input type="checkbox" checked={queryConfig.grouped} onChange={e => setQueryConfig({ ...queryConfig, grouped: e.target.checked })} />
                                                Agrupar (IN)
                                            </label>
                                        </div>
                                    </div>
                                </div>

                                {/* SET Builder */}
                                <div style={{ background: '#f9fafb', padding: '1rem', borderRadius: '8px', marginBottom: '1rem' }}>
                                    <div className="label-sm" style={{ marginBottom: '0.5rem' }}>SETS (Campos a actualizar)</div>
                                    {queryConfig.sets.map((s, i) => (
                                        <div key={i} className="sql-builder-row" style={{ gridTemplateColumns: '1fr 100px 1.2fr 40px', gap: '8px' }}>
                                            <input type="text" className="key-selector" placeholder="Campo BD" value={s.target} onChange={e => { const n = [...queryConfig.sets]; n[i].target = e.target.value; setQueryConfig({ ...queryConfig, sets: n }) }} />

                                            <select className="key-selector" style={{ fontSize: '0.75rem', background: '#f3f4f6', padding: '4px' }} value={s.mode || 'col'} onChange={e => { const n = [...queryConfig.sets]; n[i].mode = e.target.value; n[i].value = ''; setQueryConfig({ ...queryConfig, sets: n }) }}>
                                                <option value="col">Columna</option>
                                                <option value="fixed">Fijo</option>
                                            </select>

                                            {s.mode === 'fixed' ? (
                                                <input type="text" className="key-selector" placeholder="Valor manual..." value={s.value} onChange={e => { const n = [...queryConfig.sets]; n[i].value = e.target.value; setQueryConfig({ ...queryConfig, sets: n }) }} />
                                            ) : (
                                                <select className="key-selector" value={s.value} onChange={e => { const n = [...queryConfig.sets]; n[i].value = e.target.value; setQueryConfig({ ...queryConfig, sets: n }) }}>
                                                    <option value="">-- Columna --</option>
                                                    {Object.keys(finalResult[0] || {}).map(c => <option key={c} value={c}>{c}</option>)}
                                                </select>
                                            )}

                                            <button className="btn btn-sm" style={{ color: 'red' }} onClick={() => { const n = queryConfig.sets.filter((_, idx) => idx !== i); setQueryConfig({ ...queryConfig, sets: n }) }}>✕</button>
                                        </div>
                                    ))}
                                    <button className="btn btn-sm btn-outline" onClick={() => setQueryConfig({ ...queryConfig, sets: [...queryConfig.sets, { target: '', type: 'col', value: '' }] })}>+ Agregar Campo SET</button>
                                </div>

                                {/* WHERE Builder */}
                                <div style={{ background: '#f9fafb', padding: '1rem', borderRadius: '8px' }}>
                                    <div className="label-sm" style={{ marginBottom: '0.5rem' }}>WHERE (Condiciones)</div>
                                    {queryConfig.wheres.map((w, i) => (
                                        <div key={i} className="sql-builder-row">
                                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                {i > 0 && <span className="sql-badge">AND</span>}
                                                <input type="text" className="key-selector" placeholder="Campo BD" value={w.target} onChange={e => { const n = [...queryConfig.wheres]; n[i].target = e.target.value; setQueryConfig({ ...queryConfig, wheres: n }) }} />
                                            </div>
                                            <select className="key-selector" value={w.value} onChange={e => { const n = [...queryConfig.wheres]; n[i].value = e.target.value; setQueryConfig({ ...queryConfig, wheres: n }) }}>
                                                <option value="">-- Columna Excel --</option>
                                                {Object.keys(finalResult[0] || {}).map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                            <button className="btn btn-sm" style={{ color: 'red' }} onClick={() => { const n = queryConfig.wheres.filter((_, idx) => idx !== i); setQueryConfig({ ...queryConfig, wheres: n }) }}>✕</button>
                                        </div>
                                    ))}
                                    <button className="btn btn-sm btn-outline" onClick={() => setQueryConfig({ ...queryConfig, wheres: [...queryConfig.wheres, { target: '', value: '', logic: 'AND' }] })}>+ Agregar Condición</button>
                                </div>

                                <div className="label-sm" style={{ marginTop: '1rem' }}>Vista Previa Query:</div>
                                <div className="preview-box">{generateSQLQuery()}</div>
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem', justifyContent: 'space-between', alignItems: 'center' }}>
                            <button className="btn btn-outline" onClick={() => setStep(3)}>← Cambiar Estrategia</button>

                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                {/* MOD: Selector de formato visible solo para Lista o Query */}
                                {(outputTab === 'list' || outputTab === 'query') && (
                                    <select
                                        className="key-selector"
                                        style={{ width: 'auto', padding: '0.6rem', fontWeight: 'bold', cursor: 'pointer' }}
                                        value={exportExt}
                                        onChange={e => setExportExt(e.target.value)}
                                        title="Formato del archivo"
                                    >
                                        <option value="txt">.txt (Texto)</option>
                                        <option value="sql">.sql (Script)</option>
                                    </select>
                                )}

                                <button className="btn btn-primary" onClick={downloadOutput} style={{ width: 'auto', padding: '0.8rem 2rem' }}>
                                    <Icon name="download" /> Descargar {(outputTab === 'full' || outputTab === 'custom') ? 'Excel' : ''}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

            </div>
        );
    };
}