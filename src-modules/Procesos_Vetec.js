window.NexusModuleMeta = { icon: 'cpu', color: 'bg-slate-700', title: 'Procesos Vetec' };
window.NexusActiveModule = ({ React, useState, useEffect, ui, utils, db, goHome }) => {

    // Herramientas de Nexus
    const { Icon } = ui;
    const { addToast } = utils;

    // ========================================================================
    // UTILIDAD: Exportación Excel Limpia (Cero falsos vacíos)
    // Al exportar, la última línea antes de book_new() debe ser crearSheetLimpio.
    // No altera orden ni estructura. Solo garantiza que celdas sin valor queden
    // realmente vacías en el archivo (sin peso en el XML).
    // Recibe el array ya procesado y opcionalmente headers si el orden es manual.
    // ========================================================================
    const crearSheetLimpio = (dataArray, headersOverride) => {
        if (!dataArray || dataArray.length === 0) return { ws: null, headers: [], cleanData: [] };

        const allCols = headersOverride
            || Object.keys(dataArray[0]).filter(k => !k.startsWith('__EMPTY'));

        let lastRow = -1;
        for (let i = dataArray.length - 1; i >= 0; i--) {
            if (Object.values(dataArray[i]).some(v => v !== "" && v !== null && v !== undefined)) {
                lastRow = i;
                break;
            }
        }
        if (lastRow === -1) return { ws: null, headers: [], cleanData: [] };

        const trimmedRows = dataArray.slice(0, lastRow + 1);

        const headers = allCols.filter(col =>
            trimmedRows.some(r => r[col] !== "" && r[col] !== null && r[col] !== undefined)
        );

        const cleanData = trimmedRows.map(r => {
            const n = {};
            headers.forEach(h => {
                if (r[h] !== "" && r[h] !== null && r[h] !== undefined) n[h] = r[h];
            });
            return n;
        });

        const ws = window.XLSX.utils.json_to_sheet(cleanData, { header: headers });
        if (cleanData.length > 0) {
            const endCol = window.XLSX.utils.encode_col(headers.length - 1);
            ws['!ref'] = `A1:${endCol}${cleanData.length + 1}`;
        }

        return { ws, headers, cleanData };
    };

    // ========================================================================
    // UTILIDAD: Depuración de Teléfonos
    // Limpieza, deduplicación horizontal, priorización opcional de celulares.
    // Cada tarea decide qué columnas son teléfono y cómo se nombran los campos.
    // ========================================================================
    const limpiarTelefono = (phone) => {
        if (!phone) return '';
        let cleaned = String(phone).replace(/[^0-9]/g, '');
        if (cleaned.length === 11 && cleaned.startsWith('56')) cleaned = cleaned.substring(2);
        else if (cleaned.length === 10 && cleaned.startsWith('0')) cleaned = cleaned.substring(1);
        if (cleaned.length === 8) cleaned = '9' + cleaned;
        else if (cleaned.length > 9) cleaned = cleaned.slice(-9);
        if (cleaned.length < 8) return '';
        return cleaned;
    };

    const esTelefonoBasura = (tel) => {
        if (!tel || tel.length < 8 || tel.length > 9) return true;
        if (new Set(tel.split('')).size === 1) return true;
        if (tel.startsWith('9') && new Set(tel.substring(1).split('')).size === 1) return true;
        const digits = tel.split('').map(Number);
        let isSeq = true;
        for (let i = 1; i < digits.length; i++) { if (digits[i] !== digits[i - 1] + 1) { isSeq = false; break; } }
        if (isSeq) return true;
        return false;
    };

    const depurarTelefonos = (valoresCrudos, priorizarCelulares = true) => {
        const seen = new Set();
        const phones = [];
        valoresCrudos.forEach(val => {
            const cleaned = limpiarTelefono(val);
            if (cleaned && !esTelefonoBasura(cleaned) && !seen.has(cleaned)) {
                phones.push(cleaned);
                seen.add(cleaned);
            }
        });
        if (priorizarCelulares) {
            const cel = phones.filter(p => p.startsWith('9'));
            const fij = phones.filter(p => !p.startsWith('9'));
            return [...cel, ...fij];
        }
        return phones;
    };

    // ========================================================================
    // UTILIDAD: Lectura Excel con detección de múltiples hojas
    // ========================================================================
    const leerExcelBuffer = (buffer, sheetName) => {
        const wb = window.XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
        if (wb.SheetNames.length > 1 && !sheetName) {
            return { multiSheet: true, sheetNames: wb.SheetNames, wb };
        }
        const targetSheet = sheetName || wb.SheetNames[0];
        return { multiSheet: false, data: window.XLSX.utils.sheet_to_json(wb.Sheets[targetSheet], { defval: "" }) };
    };

    const leerExcelConHojas = (file, sheetName, password) => {
        return new Promise((resolve, reject) => {
            if (file.name.toLowerCase().endsWith('.csv') || file.name.toLowerCase().endsWith('.txt')) {
                window.Papa.parse(file, { header: true, skipEmptyLines: true, complete: (res) => resolve({ multiSheet: false, data: res.data }), error: reject });
                return;
            }
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    let buffer = e.target.result;
                    if (password) buffer = await decryptExcelBuffer(buffer, password);
                    const result = leerExcelBuffer(buffer, sheetName);
                    resolve(result);
                } catch (err) { reject(err); }
            };
            reader.onerror = () => reject(new Error('Error al leer archivo'));
            reader.readAsArrayBuffer(file);
        });
    };

    // ========================================================================
    // COMPONENTE: Botón de copiar con feedback visual (check + verde 2s)
    // ========================================================================
    const CopyButton = ({ text, onSuccess, onError, label = 'Copiar', className = '', style = 'dark' }) => {
        const [copied, setCopied] = useState(false);
        const handleClick = async (e) => {
            e.preventDefault(); e.stopPropagation();
            try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
                if (onSuccess) onSuccess();
            } catch (err) {
                if (onError) onError();
            }
        };
        const base = 'rounded text-xs font-bold flex items-center gap-1 shadow-sm transition-all ';
        const styles = {
            dark: copied ? 'bg-green-600 text-white px-3 py-1.5' : 'bg-slate-800 text-white px-3 py-1.5 hover:bg-slate-900 hover:scale-105',
            light: copied ? 'bg-green-100 border border-green-400 text-green-700 px-3 py-1.5' : 'bg-white border border-slate-300 text-slate-700 px-3 py-1.5 hover:bg-slate-100',
            lightSm: copied ? 'bg-green-100 border border-green-400 text-green-700 px-3 py-1' : 'bg-white border border-slate-300 text-slate-700 px-3 py-1 hover:bg-slate-100',
        };
        return (
            <button type="button" onClick={handleClick} className={base + (styles[style] || styles.light) + ' ' + className}>
                <Icon name={copied ? 'check' : 'clipboard'} size={14} />
                {copied ? '¡Copiado!' : label}
            </button>
        );
    };

    // Componente: Selector de hojas para archivos con múltiples hojas
    const SelectorHojas = ({ pendientes, onConfirm, onCancel, Icon }) => {
        const [selecciones, setSelecciones] = useState(() => {
            const init = {};
            pendientes.forEach(p => { init[p.name] = p.sheetNames[0]; });
            return init;
        });

        return (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 flex flex-col gap-4 animate-fade-in">
                <div className="flex items-start gap-3">
                    <Icon name="layers" size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                        <h4 className="text-sm font-bold text-amber-800">Múltiples hojas detectadas</h4>
                        <p className="text-xs text-amber-700 mt-1">Los siguientes archivos tienen más de una hoja. Selecciona cuál procesar en cada uno.</p>
                    </div>
                </div>
                <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                    {pendientes.map((p, idx) => (
                        <div key={idx} className="flex items-center gap-3 bg-white p-3 rounded border border-amber-200">
                            <span className="text-xs font-mono text-gray-700 truncate flex-1" title={p.name}>{p.name}</span>
                            <select
                                className="border border-amber-300 rounded p-1.5 text-xs outline-none font-medium bg-amber-50 min-w-[140px]"
                                value={selecciones[p.name]}
                                onChange={(e) => setSelecciones(prev => ({ ...prev, [p.name]: e.target.value }))}
                            >
                                {p.sheetNames.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                    ))}
                </div>
                <div className="flex gap-3 justify-end">
                    {onCancel && <button onClick={onCancel} className="px-4 py-2 text-xs font-bold text-gray-600 bg-gray-100 rounded hover:bg-gray-200 border border-gray-200">Cancelar</button>}
                    <button onClick={() => onConfirm(selecciones)} className="px-4 py-2 text-xs font-bold text-white bg-amber-600 rounded hover:bg-amber-700 shadow-sm">Confirmar y Continuar</button>
                </div>
            </div>
        );
    };

    // ========================================================================
    // UTILIDAD: Descifrado Excel ECMA-376 Agile (AES-256)
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
    // UTILIDAD: Limpieza de Nombres
    // ========================================================================
    const cleanNames = (str) => {
        if (!str) return "";
        return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-zA-Z\s]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
    };

    const formatNombreCompleto = (nombres, paterno, materno) => {
        return [cleanNames(nombres), cleanNames(paterno), cleanNames(materno)].filter(Boolean).join(" ");
    };

    // ========================================================================
    // ZONA 1: CONTENEDORES DE TAREAS MODULARES
    // ========================================================================
    // Instrucción: Pega aquí abajo el código de cada tarea nueva.
    const TaskCargaRdrWeb = ({ Icon, addToast, utils }) => {
        const [loadType, setLoadType] = useState('masivo');
        const [mainFiles, setMainFiles] = useState([]);
        const [inputText, setInputText] = useState('');
        const [manualRows, setManualRows] = useState([{ rut: '', nom_completo: '', fono1: '', deuda: '' }]);
        const [excludeList, setExcludeList] = useState(true);
        const [exclusionFile, setExclusionFile] = useState(null);
        const [exclusionSqlMode, setExclusionSqlMode] = useState(false);
        const [exclusionSqlQuery, setExclusionSqlQuery] = useState('');
        const [exclusionSqlData, setExclusionSqlData] = useState(null);
        const [outputFormat, setOutputFormat] = useState('xlsx');
        const [isProcessing, setIsProcessing] = useState(false);
        const [processReport, setProcessReport] = useState(null);
        const [priorizarCel, setPriorizarCel] = useState(true);
        const [pendientesHojas, setPendientesHojas] = useState([]);
        const [sheetSelections, setSheetSelections] = useState({});

        // --- MOTOR DE LIMPIEZA INTERNO ---
        const cleanRut = (str) => { if (!str) return ''; return String(str).toUpperCase().split('-')[0].replace(/[^0-9]/g, ''); };
        const calculateDV = (rutStr) => {
            let num = String(rutStr).replace(/[^0-9]/g, ''); if (!num) return '';
            let t = parseInt(num), m = 0, s = 1;
            for (; t; t = Math.floor(t / 10)) s = (s + t % 10 * (9 - m++ % 6)) % 11;
            return s ? String(s - 1) : 'K';
        };
        const cleanText = (str) => {
            if (!str) return '';
            return String(str).replace(/\u00C3[\u0091\u00C1\u2018\u00B1]/g, 'N').replace(/\u00C3\u00A1/g, 'A').replace(/\u00C3\u00A9/g, 'E').replace(/\u00C3\u00AD/g, 'I').replace(/\u00C3\u00B3/g, 'O').replace(/\u00C3\u00BA/g, 'U').replace(/[ñÑ]/g, 'N').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
        };


        const handleProcess = async () => {
            if (excludeList && !exclusionFile && !exclusionSqlData) { addToast('Acción denegada: Carga la lista de exclusión.', 'error'); return; }
            setIsProcessing(true);

            try {
                const date = new Date();
                const day = String(date.getDate()).padStart(2, '0');
                const monthNum = String(date.getMonth() + 1).padStart(2, '0');
                const fullYear = date.getFullYear();
                const shortYear = String(fullYear).slice(-2);
                const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
                const monthName = monthNames[date.getMonth()];

                const fecAsi = `${day}-${monthNum}-${fullYear}`;
                const baseStr = `Base_${day}_${monthNum}_${fullYear}`;
                const mesCargaStr = `${monthName}_${shortYear}`;
                const horaSim = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

                let unifiedData = [];
                const getFullData = async (file) => {
                    const result = await leerExcelConHojas(file, sheetSelections[file.name] || null);
                    if (result.multiSheet) {
                        throw new Error(`MULTI_SHEET:${file.name}:${result.sheetNames.join(',')}`);
                    }
                    return result.data;
                };

                // --- 0. DETECCIÓN DE HOJAS MÚLTIPLES ---
                const pendientes = [];
                for (const f of mainFiles) {
                    if (f.name.toLowerCase().endsWith('.csv') || f.name.toLowerCase().endsWith('.txt')) continue;
                    if (sheetSelections[f.name]) continue;
                    try {
                        const result = await leerExcelConHojas(f);
                        if (result.multiSheet) pendientes.push({ name: f.name, sheetNames: result.sheetNames });
                    } catch (e) { /* se manejará después */ }
                }
                if (pendientes.length > 0) {
                    setPendientesHojas(pendientes);
                    setIsProcessing(false);
                    return;
                }

                // --- 1. CARGA Y FILTRADO ---
                if (loadType === 'masivo') {
                    for (let f of mainFiles) { const d = await getFullData(f); unifiedData = unifiedData.concat(d); }
                } else if (['referido_sae_web', 'referido_sae', 'referido_cc'].includes(loadType)) {
                    const targetRuts = new Set(inputText.split(/[\n,; \t]+/).map(r => cleanRut(r)).filter(r => r.length >= 6));
                    if (targetRuts.size === 0) throw new Error("No hay RUTs válidos para buscar.");
                    const baseData = await getFullData(mainFiles[0]);
                    unifiedData = baseData.filter(row => targetRuts.has(cleanRut(row.RUT || row.rut || row.vendor_lead_code || row.postal_code || '')));
                } else if (loadType === 'manual') {
                    unifiedData = manualRows.filter(r => r.rut.trim() !== '');
                }

                if (unifiedData.length === 0) throw new Error("No hay datos para procesar.");

                // --- 2. EXCLUSIÓN ---
                const excludedRuts = new Set();
                if (excludeList) {
                    let exData = [];
                    if (exclusionSqlMode && exclusionSqlData) {
                        exData = exclusionSqlData;
                    } else if (exclusionFile) {
                        exData = await getFullData(exclusionFile);
                    }
                    exData.forEach(row => { let r = cleanRut(row.RUT || row.rut || row.vendor_lead_code || ''); if (r.length >= 6) excludedRuts.add(r); });
                }

                let stats = { leidos: unifiedData.length, excluidos: 0, duplicados: 0, validos: 0 };
                let processedData = [];

                // --- 3. PROCESAMIENTO ---
                unifiedData.forEach(row => {
                    // RUT estricto según matriz [cite: 358]
                    let rCrudo = "";
                    if (['masivo', 'manual', 'referido_sae_web'].includes(loadType)) rCrudo = row.RUT || row.rut || row.vendor_lead_code;
                    else if (loadType === 'referido_sae') rCrudo = row.vendor_lead_code || row.rut || row.postal_code;
                    else if (loadType === 'referido_cc') rCrudo = row.postal_code || row.rut;

                    let rLimpio = cleanRut(rCrudo);
                    if (!rLimpio) return;
                    if (excludedRuts.has(rLimpio)) { stats.excluidos++; return; }

                    // Lógica de Nombres (Masivo = Concatenar | Referidos = Segmentar)
                    let nom = "", pat = "", mat = "", nc_final = "";
                    if (loadType === 'masivo') {
                        nom = cleanText(row.NOMBRES || row.nombres);
                        pat = cleanText(row.PATERNO || row.paterno);
                        mat = cleanText(row.MATERNO || row.materno);
                        nc_final = `${nom} ${pat} ${mat}`.trim();
                    } else {
                        let nc_fuente = String(row.nom_completo || row.NOMBRE_COMPLETO || row.nombres || "").trim();
                        if (!nc_fuente && (row.first_name || row.last_name)) nc_fuente = `${row.first_name || ""} ${row.last_name || ""}`.trim();
                        let palabras = nc_fuente.split(/\s+/).filter(p => p.length > 0);
                        const conectores = ["DE", "DEL", "LA", "LAS", "LOS", "Y"];
                        let grupos = [], temp = "";
                        palabras.forEach((p, idx) => {
                            if (conectores.includes(p.toUpperCase()) && idx < palabras.length - 1) temp += (temp ? " " : "") + p;
                            else { temp += (temp ? " " : "") + p; grupos.push(temp); temp = ""; }
                        });
                        if (grupos.length >= 3) { mat = cleanText(grupos.pop()); pat = cleanText(grupos.pop()); nom = cleanText(grupos.join(" ")); }
                        else if (grupos.length === 2) { nom = cleanText(grupos[0]); pat = cleanText(grupos[1]); }
                        else { nom = cleanText(nc_fuente); }
                        if (row.PATERNO || row.paterno) pat = cleanText(row.PATERNO || row.paterno);
                        if (row.MATERNO || row.materno) mat = cleanText(row.MATERNO || row.materno);
                        nc_final = `${nom} ${pat} ${mat}`.trim();
                    }

                    // Teléfonos y Deuda según origen [cite: 360, 362]
                    let t1, t2, t3, t4, d = 0, pStr = "";
                    if (['masivo', 'manual'].includes(loadType)) {
                        t1 = row.FONO1 || row.fono1; t2 = row.FONO2 || row.fono2; t3 = row.FONO3 || row.fono3; t4 = row.FONO4 || row.fono4;
                        d = Number(row.DEUDA || row.deuda || 0); pStr = String(row.PASOS || row.pasos || "");
                    } else if (loadType === 'referido_sae_web') {
                        t1 = row.phone_number; t2 = row.alt_phone; t3 = row.address3; t4 = row.email;
                        d = Number(row.oferta_sae || row.OFERTA_SAE || 0); pStr = String(row.paso || row.PASO || "");
                    } else if (loadType === 'referido_sae') {
                        t1 = row.phone_number; t2 = row.alt_phone; t3 = row.address3; t4 = row.email;
                        d = Number(row.oferta_tot || row.OFERTA_TOT || 0); pStr = "";
                    } else if (loadType === 'referido_cc') {
                        t1 = row.phone_number; t2 = row.alt_phone; t3 = row.address3; t4 = row.email;
                        d = Number(row.disponible_cc || 0); pStr = "";
                    }
                    let cP = depurarTelefonos([t1, t2, t3, t4], priorizarCel);
                    while (cP.length < 4) cP.push('');
                    let p2Match = pStr.match(/\d+/);
                    let p2 = p2Match ? Number(p2Match[0]) : "";

                    // CONSTRUCCIÓN DE OBJETO (TODAS las columnas [cite: 358-364])
                    let baseObj = {
                        PRODUCTO: row.PRODUCTO || row.producto || "RDR",
                        FECHA_SIM: fecAsi,
                        ID_CLIENTE: row.ID_CLIENTE || row.vendor_lead_code || "",
                        PASOS: pStr,
                        RUT: Number(rLimpio),
                        DV: String(row.dv || row.DV || calculateDV(rLimpio)).toUpperCase(),
                        CANAL: row.CANAL || row.canal || "REF",
                        TIPO_TARJETA: row.TIPO_TARJETA || "",
                        DEUDA: d,
                        FECHA_VENC: row.FECHA_VENC || "",
                        TRAMO: row.TRAMO || "",
                        DIASMORAREAL: row.DIASMORAREAL || "0",
                        NOMBRES: nom,
                        PATERNO: pat,
                        MATERNO: mat,
                        SIMULA_SEGURO: "",
                        FONO1: cP[0] ? Number(cP[0]) : "",
                        FONO2: cP[1] ? Number(cP[1]) : "",
                        FONO3: cP[2] ? Number(cP[2]) : "",
                        FONO4: cP[3] ? Number(cP[3]) : "",
                        CALL_CENTER: "VETEC",
                        FECHA_ENVIO: fecAsi,
                        HORA: horaSim,
                        TEL_1: cP[0] ? Number(cP[0]) : (loadType === 'manual' ? "" : 999999999),
                        TEL_2: cP[1] ? Number(cP[1]) : "",
                        TEL_3: cP[2] ? Number(cP[2]) : "",
                        TEL_4: cP[3] ? Number(cP[3]) : "",
                        NOMBRE_COMPLETO: nc_final,
                        PASO_2: p2,
                        CAMPANA: "CENCOSUD RDR WEB",
                        BASE: baseStr,
                        MES_CARGA: mesCargaStr
                    };

                    if (loadType === 'masivo') {
                        // 1. Conservar orden original del Excel
                        let objMasivo = { ...row };

                        // 2. Inyectar columnas que falten de nuestra base (al final de las originales)
                        Object.keys(baseObj).forEach(key => {
                            if (!(key in objMasivo) && key !== 'BASE' && key !== 'MES_CARGA') {
                                objMasivo[key] = baseObj[key];
                            }
                        });

                        // 3. Forzar valores limpios/calculados
                        Object.assign(objMasivo, {
                            RUT: baseObj.RUT, DV: baseObj.DV,
                            NOMBRES: baseObj.NOMBRES, PATERNO: baseObj.PATERNO, MATERNO: baseObj.MATERNO, NOMBRE_COMPLETO: baseObj.NOMBRE_COMPLETO,
                            FONO1: baseObj.FONO1, FONO2: baseObj.FONO2, FONO3: baseObj.FONO3, FONO4: baseObj.FONO4,
                            TEL_1: baseObj.TEL_1, TEL_2: baseObj.TEL_2, TEL_3: baseObj.TEL_3, TEL_4: baseObj.TEL_4,
                            DEUDA: baseObj.DEUDA, PASOS: baseObj.PASOS, PASO_2: baseObj.PASO_2
                        });

                        // 4. Cerrar siempre con BASE y MES_CARGA
                        delete objMasivo.BASE; delete objMasivo.MES_CARGA;
                        objMasivo.BASE = baseObj.BASE;
                        objMasivo.MES_CARGA = baseObj.MES_CARGA;

                        processedData.push(objMasivo);
                    } else {
                        processedData.push(baseObj);
                    }
                });

                // Deduplicación por mayor Deuda
                processedData.sort((a, b) => b.DEUDA - a.DEUDA);
                const finalMap = new Map();
                processedData.forEach(row => {
                    if (!finalMap.has(row.RUT)) finalMap.set(row.RUT, row);
                    else stats.duplicados++;
                });

                let finalArray = Array.from(finalMap.values());

                // 6. EXPORTACIÓN LIMPIA
                const { ws, cleanData } = crearSheetLimpio(finalArray);
                stats.validos = cleanData.length;
                setProcessReport({ totalLeidos: stats.leidos, totalValidos: stats.validos, duplicadosRUT: stats.duplicados, excluidos: stats.excluidos });

                if (stats.validos === 0) {
                    addToast('No hay registros para exportar.', 'warning');
                    setIsProcessing(false);
                    return;
                }

                const wb = window.XLSX.utils.book_new();
                window.XLSX.utils.book_append_sheet(wb, ws, "Rdr_Web");
                window.XLSX.writeFile(wb, `${baseStr}.${outputFormat}`);

                addToast(`Proceso exitoso: ${stats.validos} registros.`, 'success');

            } catch (error) {
                addToast('Error: ' + error.message, 'error');
            }
            setIsProcessing(false);
        };

        const isProcessDisabled = () => {
            if (loadType === 'masivo') return mainFiles.length === 0;
            if (loadType === 'manual') return !manualRows.some(row => row.rut.trim() !== '');
            return mainFiles.length === 0 || inputText.trim() === '';
        };

        return (
            <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full animate-fade-in">
                <div className="border-b border-gray-200 pb-3">
                    <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><Icon name="credit-card" className="text-blue-600" /> Carga Cencosud RDR WEB</h2>
                    <p className="text-gray-500 text-sm mt-1">Unificación, extracción de referidos, depuración de teléfonos y cruce RDR.</p>
                </div>
                <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm flex flex-col gap-4">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">1. Tipo de Carga y Origen</label>
                        <select className="w-full p-2.5 border border-gray-300 rounded-md bg-gray-50 text-sm outline-none focus:border-blue-500 font-medium text-gray-700" value={loadType} onChange={(e) => { setLoadType(e.target.value); setMainFiles([]); setInputText(''); }}>
                            <option value="masivo">Carga Masiva (Múltiples Archivos)</option>
                            <option value="referido_sae_web">Referidos: CENCOSUD SAE WEB</option>
                            <option value="referido_sae">Referidos: CENCOSUD SAE</option>
                            <option value="referido_cc">Referidos: COMPRA CARTERA (RDR)</option>
                            <option value="manual">Ingreso Manual (RUTs o Texto)</option>
                        </select>
                    </div>
                    {loadType !== 'manual' && (
                        <div className="border-2 border-dashed border-blue-300 rounded-lg p-8 text-center bg-blue-50 hover:bg-blue-100 transition-colors relative animate-fade-in">
                            <input type="file" multiple={loadType === 'masivo'} accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={(e) => setMainFiles(Array.from(e.target.files))} />
                            <Icon name="upload-cloud" size={32} className="mx-auto text-blue-500 mb-2" />
                            <p className="text-sm font-medium text-blue-800">{mainFiles.length > 0 ? `${mainFiles.length} archivo(s) listo(s)` : 'Haz clic o arrastra los archivos aquí'}</p>
                        </div>
                    )}
                    {['referido_sae_web', 'referido_sae', 'referido_cc'].includes(loadType) && (
                        <div className="flex flex-col gap-4 animate-fade-in">
                            <div className="border border-purple-200 rounded-lg p-4 bg-purple-50">
                                <label className="block text-sm font-bold text-purple-800 mb-2">Pega los RUTs a buscar:</label>
                                <textarea className="w-full h-24 p-3 border border-purple-300 rounded focus:border-purple-500 outline-none text-sm font-mono resize-none bg-white" placeholder="Ej: 12345678" value={inputText} onChange={(e) => setInputText(e.target.value)}></textarea>
                            </div>
                        </div>
                    )}
                    {loadType === 'manual' && (
                        <div className="border border-gray-300 rounded-lg p-4 bg-gray-50 animate-fade-in overflow-x-auto">
                            <div className="flex items-center gap-2 mb-3">
                                <Icon name="keyboard" size={20} className="text-gray-500" />
                                <span className="text-sm font-bold text-gray-700">Ingreso Manual (Mini Grilla)</span>
                            </div>
                            <table className="w-full text-sm text-left mb-3">
                                <thead className="text-xs text-gray-700 uppercase bg-gray-200">
                                    <tr>
                                        <th className="px-2 py-2">RUT</th>
                                        <th className="px-2 py-2">Nombre Completo</th>
                                        <th className="px-2 py-2">Teléfono</th>
                                        <th className="px-2 py-2">Deuda</th>
                                        <th className="px-2 py-2"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {manualRows.map((row, idx) => (
                                        <tr key={idx} className="bg-white border-b align-top">
                                            <td className="p-1"><input type="text" className="w-full p-1 border rounded outline-none focus:border-blue-500" placeholder="12345678-9" value={row.rut} onChange={e => { const newRows = [...manualRows]; newRows[idx].rut = e.target.value; setManualRows(newRows); }} /></td>
                                            <td className="p-1"><input type="text" className="w-full p-1 border rounded outline-none focus:border-blue-500" placeholder="Juan Perez" value={row.nom_completo} onChange={e => { const newRows = [...manualRows]; newRows[idx].nom_completo = e.target.value; setManualRows(newRows); }} /></td>
                                            <td className="p-1">
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-center gap-1">
                                                        <input type="text" className="w-full p-1 border rounded outline-none focus:border-blue-500" placeholder="Fono 1" value={row.fono1 || ''} onChange={e => { const newRows = [...manualRows]; newRows[idx].fono1 = e.target.value; setManualRows(newRows); }} />
                                                        {(row.phoneCount || 1) === 1 && (
                                                            <button title="Agregar fono" onClick={() => { const newRows = [...manualRows]; newRows[idx].phoneCount = 2; setManualRows(newRows); }} className="text-blue-500 hover:text-blue-700 font-bold px-1">+</button>
                                                        )}
                                                    </div>
                                                    {(row.phoneCount || 1) >= 2 && (
                                                        <div className="flex items-center gap-1">
                                                            <input type="text" className="w-full p-1 border rounded outline-none focus:border-blue-500" placeholder="Fono 2" value={row.fono2 || ''} onChange={e => { const newRows = [...manualRows]; newRows[idx].fono2 = e.target.value; setManualRows(newRows); }} />
                                                            {(row.phoneCount || 1) === 2 && (
                                                                <>
                                                                    <button title="Agregar fono" onClick={() => { const newRows = [...manualRows]; newRows[idx].phoneCount = 3; setManualRows(newRows); }} className="text-blue-500 hover:text-blue-700 font-bold px-1">+</button>
                                                                    <button title="Quitar fono" onClick={() => { const newRows = [...manualRows]; newRows[idx].phoneCount = 1; newRows[idx].fono2 = ''; setManualRows(newRows); }} className="text-red-500 hover:text-red-700 font-bold px-1">-</button>
                                                                </>
                                                            )}
                                                        </div>
                                                    )}
                                                    {(row.phoneCount || 1) >= 3 && (
                                                        <div className="flex items-center gap-1">
                                                            <input type="text" className="w-full p-1 border rounded outline-none focus:border-blue-500" placeholder="Fono 3" value={row.fono3 || ''} onChange={e => { const newRows = [...manualRows]; newRows[idx].fono3 = e.target.value; setManualRows(newRows); }} />
                                                            {(row.phoneCount || 1) === 3 && (
                                                                <>
                                                                    <button title="Agregar fono" onClick={() => { const newRows = [...manualRows]; newRows[idx].phoneCount = 4; setManualRows(newRows); }} className="text-blue-500 hover:text-blue-700 font-bold px-1">+</button>
                                                                    <button title="Quitar fono" onClick={() => { const newRows = [...manualRows]; newRows[idx].phoneCount = 2; newRows[idx].fono3 = ''; setManualRows(newRows); }} className="text-red-500 hover:text-red-700 font-bold px-1">-</button>
                                                                </>
                                                            )}
                                                        </div>
                                                    )}
                                                    {(row.phoneCount || 1) >= 4 && (
                                                        <div className="flex items-center gap-1">
                                                            <input type="text" className="w-full p-1 border rounded outline-none focus:border-blue-500" placeholder="Fono 4" value={row.fono4 || ''} onChange={e => { const newRows = [...manualRows]; newRows[idx].fono4 = e.target.value; setManualRows(newRows); }} />
                                                            <button title="Quitar fono" onClick={() => { const newRows = [...manualRows]; newRows[idx].phoneCount = 3; newRows[idx].fono4 = ''; setManualRows(newRows); }} className="text-red-500 hover:text-red-700 font-bold px-1">-</button>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-1"><input type="number" className="w-full p-1 border rounded outline-none focus:border-blue-500" placeholder="0" value={row.deuda} onChange={e => { const newRows = [...manualRows]; newRows[idx].deuda = e.target.value; setManualRows(newRows); }} /></td>
                                            <td className="p-1 text-center pt-2">
                                                {manualRows.length > 1 && (
                                                    <button onClick={() => setManualRows(manualRows.filter((_, i) => i !== idx))} className="text-red-500 hover:text-red-700"><Icon name="trash-2" size={16} /></button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <button onClick={() => setManualRows([...manualRows, { rut: '', nom_completo: '', fono1: '', deuda: '' }])} className="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded hover:bg-blue-200 font-bold flex items-center gap-1"><Icon name="plus" size={14} /> Agregar Fila</button>
                        </div>
                    )}
                </div>
                {pendientesHojas.length > 0 && (
                    <SelectorHojas
                        pendientes={pendientesHojas}
                        Icon={Icon}
                        onConfirm={(sel) => { setSheetSelections(prev => ({ ...prev, ...sel })); setPendientesHojas([]); }}
                        onCancel={() => setPendientesHojas([])}
                    />
                )}
                <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <label className="text-sm font-bold text-gray-700">2. Lista Vigente (Cruce y Exclusión)</label>
                        <label className="flex items-center cursor-pointer">
                            <div className="relative">
                                <input type="checkbox" className="sr-only" checked={excludeList} onChange={() => setExcludeList(!excludeList)} />
                                <div className={`block w-10 h-6 rounded-full transition-colors ${excludeList ? 'bg-blue-600' : 'bg-gray-300'}`}></div>
                                <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${excludeList ? 'transform translate-x-4' : ''}`}></div>
                            </div>
                            <div className="ml-3 text-sm font-medium text-gray-600">{excludeList ? 'Activado' : 'Desactivado'}</div>
                        </label>
                    </div>
                    {excludeList && (
                        <div className="flex flex-col gap-2 mt-2 animate-fade-in">
                            <div style={{ display: 'flex', gap: '6px' }}>
                                <button type="button" onClick={() => { setExclusionSqlMode(false); setExclusionSqlData(null); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #6366f1', background: !exclusionSqlMode ? '#6366f1' : 'white', color: !exclusionSqlMode ? 'white' : '#6366f1', cursor: 'pointer' }}>📂 Archivo</button>
                                <button type="button" onClick={() => { setExclusionSqlMode(true); setExclusionFile(null); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #3b82f6', background: exclusionSqlMode ? '#3b82f6' : 'white', color: exclusionSqlMode ? 'white' : '#3b82f6', cursor: 'pointer' }}>⚡ SQL</button>
                            </div>
                            {!exclusionSqlMode ? (
                                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center bg-gray-50 hover:bg-gray-100 relative">
                                    <input type="file" accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={(e) => setExclusionFile(e.target.files[0])} />
                                    <Icon name="file-search" size={24} className="mx-auto text-gray-400 mb-2" />
                                    <p className="text-sm font-medium text-gray-600">{exclusionFile ? <span className="text-emerald-600 font-bold">{exclusionFile.name}</span> : 'Cargar rutero o lista vigente para excluir'}</p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    <textarea style={{ width: '100%', minHeight: '80px', padding: '0.5rem', border: '2px solid #3b82f6', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical', boxSizing: 'border-box' }} value={exclusionSqlQuery} onChange={e => setExclusionSqlQuery(e.target.value)} placeholder="SELECT RUT FROM tabla WHERE..." />
                                    <button type="button" style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.8rem', background: '#3b82f6', color: 'white', border: 'none', cursor: 'pointer', alignSelf: 'flex-start' }} onClick={async () => {
                                        if (!exclusionSqlQuery.trim()) return;
                                        const r = await window.nexusAPI.executeSQL(exclusionSqlQuery);
                                        if (!r.success) { addToast('Error SQL: ' + r.error, 'error'); return; }
                                        setExclusionSqlData(r.data);
                                        addToast(`${r.data.length} registros cargados desde SQL.`, 'success');
                                    }}>⚡ Ejecutar</button>
                                    {exclusionSqlData && <p className="text-xs text-emerald-600 font-bold">✓ {exclusionSqlData.length} registros cargados desde SQL</p>}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <div className="flex flex-col md:flex-row items-center justify-between bg-gray-50 p-4 rounded-lg border border-gray-200 gap-4">
                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <label className="text-sm font-bold text-gray-700 whitespace-nowrap">Formato de Salida:</label>
                        <select className="p-2 border border-gray-300 rounded bg-white text-sm outline-none focus:border-blue-500 font-medium" value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)}>
                            <option value="xlsx">Excel Moderno (.xlsx)</option>
                            <option value="csv">CSV (.csv)</option>
                        </select>
                        <div className="flex items-center gap-2 ml-4">
                            <div className={`w-10 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-colors ${priorizarCel ? 'bg-blue-600' : 'bg-gray-300'}`} onClick={() => setPriorizarCel(!priorizarCel)}>
                                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${priorizarCel ? 'translate-x-5' : ''}`}></div>
                            </div>
                            <span className="text-xs font-bold text-gray-600 whitespace-nowrap">Priorizar Cel.</span>
                        </div>
                    </div>
                    <button className={`w-full md:w-auto px-8 py-3 rounded-lg font-bold text-white shadow-md transition-all flex items-center justify-center gap-2 ${isProcessDisabled() || isProcessing ? 'bg-gray-400 cursor-not-allowed opacity-70' : 'bg-emerald-600 hover:bg-emerald-700 hover:scale-[1.02]'}`} disabled={isProcessDisabled() || isProcessing} onClick={handleProcess}>
                        {isProcessing ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Icon name="play-circle" size={20} />}
                        {isProcessing ? 'Procesando...' : 'Procesar Carga RDR'}
                    </button>
                </div>
                {processReport && (
                    <div className="bg-white p-5 rounded-lg border border-emerald-200 shadow-sm mt-2 animate-fade-in border-l-4 border-l-emerald-500">
                        <h3 className="text-lg font-bold text-emerald-800 mb-3 flex items-center gap-2"><Icon name="check-circle" className="text-emerald-600" /> Reporte de Procesamiento</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                            <div className="bg-gray-50 p-3 rounded border border-gray-200"><div className="text-2xl font-black text-gray-700">{processReport.totalLeidos}</div><div className="text-xs text-gray-500 uppercase font-bold">Leídos</div></div>
                            <div className="bg-blue-50 p-3 rounded border border-blue-200"><div className="text-2xl font-black text-blue-700">{processReport.totalValidos}</div><div className="text-xs text-blue-500 uppercase font-bold">Cargados</div></div>
                            <div className="bg-amber-50 p-3 rounded border border-amber-200"><div className="text-2xl font-black text-amber-700">{processReport.duplicadosRUT}</div><div className="text-xs text-amber-500 uppercase font-bold">Duplicados</div></div>
                            <div className="bg-purple-50 p-3 rounded border border-purple-200"><div className="text-2xl font-black text-purple-700">{processReport.excluidos}</div><div className="text-xs text-purple-500 uppercase font-bold">Excluidos</div></div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const TaskCargaSaeWeb = ({ Icon, addToast, utils }) => {
        // --- ESTADOS DE LA INTERFAZ ---
        const [loadType, setLoadType] = useState('masivo');
        const [mainFiles, setMainFiles] = useState([]);
        const [inputText, setInputText] = useState(''); // Estado unificado para RUTs referidos o carga manual
        const [manualRows, setManualRows] = useState([{ rut: '', nom_completo: '', telefono1: '', monto: '' }]);
        const [excludeList, setExcludeList] = useState(true);
        const [exclusionFile, setExclusionFile] = useState(null);
        const [exclusionSqlMode, setExclusionSqlMode] = useState(false);
        const [exclusionSqlQuery, setExclusionSqlQuery] = useState('');
        const [exclusionSqlData, setExclusionSqlData] = useState(null);
        const [outputFormat, setOutputFormat] = useState('xlsx');
        const [isProcessing, setIsProcessing] = useState(false);
        const [processReport, setProcessReport] = useState(null);
        const [priorizarCel, setPriorizarCel] = useState(true);
        const [pendientesHojas, setPendientesHojas] = useState([]);
        const [sheetSelections, setSheetSelections] = useState({});

        // --- MANEJADORES VISUALES ---
        const handleMainFiles = async (e) => {
            const allFiles = Array.from(e.target.files);
            const files = allFiles.filter(f => f.size > 0);

            if (files.length < allFiles.length) {
                addToast('Se descartaron archivos en blanco (0 KB).', 'warning');
            }

            if (files.length === 0) {
                e.target.value = '';
                return;
            }

            // Lector interno seguro para extraer columnas (Soporta Excel, CSV y TXT)
            const getHeaders = (file) => {
                return new Promise((resolve) => {
                    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                            const workbook = window.XLSX.read(event.target.result, { type: 'array' });
                            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                            const json = window.XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                            resolve(json[0] ? json[0].join('|') : '');
                        };
                        reader.readAsArrayBuffer(file);
                    } else {
                        window.Papa.parse(file, {
                            header: true,
                            preview: 1, // Solo lee la fila 1 para ser instantáneo
                            complete: (results) => resolve(results.meta.fields ? results.meta.fields.join('|') : '')
                        });
                    }
                });
            };

            // Validación Proactiva para Carga Masiva
            if (loadType === 'masivo' && files.length > 1) {
                addToast('Validando estructura de archivos...', 'info');

                try {
                    const baseHeaders = await getHeaders(files[0]);

                    for (let i = 1; i < files.length; i++) {
                        const currentHeaders = await getHeaders(files[i]);

                        if (currentHeaders !== baseHeaders) {
                            addToast(`Carga rechazada: "${files[i].name}" tiene columnas distintas.`, 'error');
                            e.target.value = ''; // Resetea visualmente el input
                            setMainFiles([]); // Vacía la memoria
                            return; // Bloquea el flujo
                        }
                    }
                    addToast(`Estructura correcta: ${files.length} archivos validados.`, 'success');
                } catch (error) {
                    addToast('Error al leer los archivos para su validación.', 'error');
                    e.target.value = '';
                    setMainFiles([]);
                    return;
                }
            }

            // Si pasa la validación, se guardan y se muestran en la interfaz
            setMainFiles(files);
        };

        const handleExclusionFile = (e) => {
            if (e.target.files.length > 0) {
                setExclusionFile(e.target.files[0]);
            }
        };

        // ====================================================================
        // --- HERRAMIENTAS DE LIMPIEZA Y TRANSFORMACIÓN (MOTOR CORE) ---
        // ====================================================================

        // 1. Calculadora de Dígito Verificador (Módulo 11)
        const calculateDV = (rutStr) => {
            let num = String(rutStr).replace(/[^0-9]/g, '');
            if (!num) return '';
            let t = parseInt(num);
            let m = 0, s = 1;
            for (; t; t = Math.floor(t / 10)) {
                s = (s + t % 10 * (9 - m++ % 6)) % 11;
            }
            return s ? String(s - 1) : 'K';
        };

        // 2. Limpiador de Textos (Cero acentos, cero caracteres raros, unifica espacios)
        // 2. Limpiador de Textos con reparación de codificación (Ñ y acentos)
        // 2. Limpiador de Textos con reparación de Mojibake (Ñ y acentos corruptos)
        const cleanText = (str) => {
            if (!str) return '';
            return String(str)
                // 1. REPARACIÓN QUIRÚRGICA: Captura Ñ/ñ antes de que normalize la rompa en "AA"
                // Cubre variaciones de codificación: Ã‘ (Win-1252), ÃÁ (CP1250), Ã± (Latin1)
                .replace(/\u00C3\u0091/g, 'N').replace(/\u00C3\u00C1/g, 'N')
                .replace(/\u00C3\u2018/g, 'N').replace(/\u00C3\u00B1/g, 'N')

                // 2. Reparación de acentos corruptos comunes
                .replace(/\u00C3\u00A1/g, 'A').replace(/\u00C3\u00A9/g, 'E')
                .replace(/\u00C3\u00AD/g, 'I').replace(/\u00C3\u00B3/g, 'O').replace(/\u00C3\u00BA/g, 'U')

                // 3. Limpieza estándar y normalización
                .replace(/ñ/g, 'N').replace(/Ñ/g, 'N')
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toUpperCase()

                // 4. Limpieza de seguridad final
                .replace(/[^A-Z0-9 ]/g, " ")
                .replace(/\s+/g, " ")
                .trim();
        };


        // 4. Extractor de RUT (Limpia formato 12.345.678-9 a 12345678)
        const cleanRut = (str) => {
            if (!str) return '';
            let raw = String(str).toUpperCase().split('-')[0]; // Tomar todo antes del guion si lo hay
            return raw.replace(/[^0-9]/g, ''); // Dejar solo números
        };



        // --- LÓGICA DE VALIDACIÓN DEL BOTÓN ---
        const isProcessDisabled = () => {
            if (loadType === 'masivo') return mainFiles.length === 0;
            if (loadType === 'manual') return !manualRows.some(row => row.rut.trim() !== '');
            // Si es referido (cualquier otro), necesita TANTO el archivo COMO los RUTs
            return mainFiles.length === 0 || inputText.trim() === '';
        };

        const handleProcess = async () => {
            // 1. VALIDACIÓN DURA: Exclusión
            if (excludeList && !exclusionFile && !exclusionSqlData) {
                addToast('Acción denegada: Carga la lista de exclusión o apaga el interruptor.', 'error');
                return;
            }

            setIsProcessing(true);
            setProcessReport(null);

            // --- BLOQUE DE FECHAS (Movido al inicio) ---
            const date = new Date();
            const day = String(date.getDate()).padStart(2, '0');
            const monthNum = String(date.getMonth() + 1).padStart(2, '0');
            const fullYear = date.getFullYear();
            const shortYear = String(fullYear).slice(-2);
            const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
            const monthName = monthNames[date.getMonth()];
            const fecAsi = `${day}-${monthNum}-${fullYear}`; // Variable requerida por la matriz
            const baseStr = `Base_${day}_${monthNum}_${fullYear}`;
            const mesCargaStr = `${monthName}_${shortYear}`;

            try {
                let unifiedData = [];
                let baseHeaders = null;
                let headerError = false;

                const getFullData = async (file) => {
                    const result = await leerExcelConHojas(file, sheetSelections[file.name] || null);
                    if (result.multiSheet) {
                        throw new Error(`MULTI_SHEET:${file.name}:${result.sheetNames.join(',')}`);
                    }
                    return result.data;
                };

                // --- 0. DETECCIÓN DE HOJAS MÚLTIPLES ---
                const pendientes = [];
                for (const f of mainFiles) {
                    if (f.name.toLowerCase().endsWith('.csv') || f.name.toLowerCase().endsWith('.txt')) continue;
                    if (sheetSelections[f.name]) continue;
                    try {
                        const result = await leerExcelConHojas(f);
                        if (result.multiSheet) pendientes.push({ name: f.name, sheetNames: result.sheetNames });
                    } catch (e) { /* se manejará después */ }
                }
                if (pendientes.length > 0) {
                    setPendientesHojas(pendientes);
                    setIsProcessing(false);
                    return;
                }

                // 2. LECTURA DE ARCHIVOS MASIVOS
                if (loadType === 'masivo') {
                    for (let i = 0; i < mainFiles.length; i++) {
                        const data = await getFullData(mainFiles[i]);
                        if (!data || data.length === 0) continue;

                        const currentHeaders = Object.keys(data[0] || {}).join('|');

                        if (!baseHeaders) {
                            baseHeaders = currentHeaders;
                        } else if (currentHeaders !== baseHeaders) {
                            addToast(`Error Crítico: El archivo "${mainFiles[i].name}" tiene columnas distintas.`, 'error');
                            headerError = true;
                            break;
                        }

                        unifiedData = unifiedData.concat(data);
                    }

                    if (headerError) {
                        setIsProcessing(false);
                        return;
                    }

                    if (unifiedData.length === 0) {
                        addToast('Operación cancelada: Todos los archivos subidos estaban vacíos.', 'warning');
                        setIsProcessing(false);
                        return;
                    }
                }

                // 2.1 LECTURA PARA REFERIDOS (EXTRACCIÓN)
                if (['referido_cc', 'referido_sae', 'referido_rdr_web'].includes(loadType)) {
                    // Extraemos los RUTs que pegaste en el cuadro de texto
                    const targetRuts = new Set(
                        inputText.split(/[\n,; \t]+/)
                            .map(r => cleanRut(r))
                            .filter(r => r.length >= 6)
                    );

                    if (targetRuts.size === 0) {
                        addToast('Error: No has pegado ningún RUT para buscar.', 'error');
                        setIsProcessing(false); return;
                    }

                    // Leemos el archivo base único
                    const baseData = await getFullData(mainFiles[0]);

                    // Filtramos: Solo nos quedamos con las filas cuyos RUTs coincidan con tu lista
                    unifiedData = baseData.filter(row => {
                        const r = cleanRut(row.RUT || row.rut || '');
                        return targetRuts.has(r);
                    });

                    if (unifiedData.length === 0) {
                        addToast('No se encontró ninguno de los RUTs buscados en el archivo base.', 'warning');
                        setIsProcessing(false); return;
                    }
                }

                // 2.2 LECTURA PARA INGRESO MANUAL
                if (loadType === 'manual') {
                    unifiedData = manualRows.filter(r => r.rut.trim() !== '');

                    if (unifiedData.length === 0) {
                        addToast('Error: No hay datos en la grilla manual.', 'error');
                        setIsProcessing(false); return;
                    }
                }

                // 3. LECTURA DE LISTA VIGENTE (EXCLUSIÓN)
                const excludedRuts = new Set();
                if (excludeList) {
                    let exData = [];
                    if (exclusionSqlMode && exclusionSqlData) {
                        exData = exclusionSqlData;
                    } else if (exclusionFile) {
                        exData = await getFullData(exclusionFile);
                    }
                    exData.forEach(row => {
                        let rCrudo = row.vendor_lead_code || row.RUT || row.Rut || row.rut || row.rutcliente || '';
                        let rLimpio = cleanRut(rCrudo);
                        if (rLimpio && rLimpio.length >= 6) {
                            excludedRuts.add(rLimpio);
                        }
                    });
                }

                // 4. HOMOLOGACIÓN Y CRUCE
                let stats = {
                    leidos: unifiedData.length,
                    excluidos: 0,
                    duplicados: 0,
                    validos: 0
                };

                let processedData = [];

                unifiedData.forEach(row => {
                    // 1. EXTRACCIÓN DE RUT (Fila 0 del CSV)
                    let rCrudo = "";
                    if (loadType === 'masivo') rCrudo = row.RUT || row.rut || row.vendor_lead_code;
                    else if (loadType === 'manual') rCrudo = row.rut || row.RUT;
                    else if (loadType === 'referido_cc') rCrudo = row.rut || row.postal_code; // Estricto para CC
                    else if (loadType === 'referido_rdr_web') rCrudo = row.vendor_lead_code; // Estricto para RDR WEB
                    else rCrudo = row.vendor_lead_code || row.rut || row.postal_code; // Para referido_sae

                    let rLimpio = cleanRut(rCrudo);
                    if (!rLimpio) return;
                    if (excludedRuts.has(rLimpio)) { stats.excluidos++; return; }

                    // 2. INTELIGENCIA DE NOMBRES UNIFICADA (Para Masivo, Referidos y Manual)
                    let nom = cleanText(row.NOMBRES || row.nombres || "");
                    let pat = cleanText(row.PATERNO || row.paterno || "");
                    let mat = cleanText(row.MATERNO || row.materno || "");
                    let nc_fuente = String(row.nom_completo || row.NOMBRE_COMPLETO || "").trim();

                    // Solo segmentamos si no vinieron columnas de Nombres y Apellidos separadas
                    if (!nom && !pat && !mat) {
                        if (!nc_fuente && (row.first_name || row.last_name)) {
                            nc_fuente = `${row.first_name || ""} ${row.last_name || ""}`.trim();
                        }
                        let palabras = nc_fuente.split(/\s+/).filter(p => p.length > 0);
                        const conectores = ["DE", "DEL", "LA", "LAS", "LOS", "Y"];
                        let grupos = [], temp = "";
                        palabras.forEach((p, idx) => {
                            if (conectores.includes(p.toUpperCase()) && idx < palabras.length - 1) temp += (temp ? " " : "") + p;
                            else { temp += (temp ? " " : "") + p; grupos.push(temp); temp = ""; }
                        });
                        if (grupos.length >= 3) { mat = cleanText(grupos.pop()); pat = cleanText(grupos.pop()); nom = cleanText(grupos.join(" ")); }
                        else if (grupos.length === 2) { nom = cleanText(grupos[0]); pat = cleanText(grupos[1]); }
                        else { nom = cleanText(nc_fuente); }
                    } else {
                        // Si vienen explícitos (Masivo), garantizamos que nc_fuente exista para la columna de NOMBRE_COMPLETO
                        if (!nc_fuente) nc_fuente = `${nom} ${pat} ${mat}`.trim();
                    }

                    // 3. HOMOLOGACIÓN DE TELÉFONOS (Filas 4-7 y 15-18 del CSV)
                    let t1, t2, t3, t4;
                    if (loadType === 'masivo') {
                        let phS = depurarTelefonos([row.AREAFONO1, row.TEL_1, row.CELULAR, row.TELEFONO, row.FONO, row.AREAFONO2, row.TEL_2, row.AREAFONO3, row.TEL_3, row.AREAFONO4, row.TEL_4], priorizarCel);
                        while (phS.length < 4) phS.push('');
                        t1 = phS[0]; t2 = phS[1]; t3 = phS[2]; t4 = phS[3];
                    } else if (loadType === 'referido_cc' || loadType === 'referido_rdr_web') {
                        t1 = row.phone_number; t2 = row.alt_phone; t3 = row.address3; t4 = row.email;
                    } else if (loadType === 'referido_sae') {
                        t1 = row.phone_number; t2 = row.alt_phone; t3 = ""; t4 = "";
                    } else {
                        t1 = row.telefono1; t2 = row.telefono2; t3 = row.telefono3; t4 = row.telefono4;
                    }
                    let cleanP = depurarTelefonos([t1, t2, t3, t4], priorizarCel);
                    while (cleanP.length < 4) cleanP.push('');

                    // 4. OFERTA Y PASOS (Fila 12, 13 y 20 del CSV)
                    let o = 0;
                    if (loadType === 'referido_cc') o = row.disponible_cc;
                    else if (loadType === 'referido_rdr_web') o = row.deuda;
                    else if (loadType === 'referido_sae') o = row.oferta_tot;
                    else o = row.OFERTA_SAE ||
                        row.monto || row.oferta || 0;

                    let paso = row.paso || row.PASO || "";
                    let pM = String(paso).match(/\d+/);
                    let paso2 = (loadType === 'referido_cc' && row.paso2) ? Number(row.paso2) : (pM ? Number(pM[0]) : "");

                    // 5. CONSTRUCCIÓN QUIRÚRGICA: ORDEN ESTRICTO DE 24 COLUMNAS
                    let finalRow = {
                        RUT: Number(rLimpio),
                        NOMBRES: nom,
                        PATERNO: pat,
                        MATERNO: mat,
                        AREAFONO1: cleanP[0] ? Number(cleanP[0]) : "",
                        AREAFONO2: cleanP[1] ? Number(cleanP[1]) : "",
                        AREAFONO3: cleanP[2] ? Number(cleanP[2]) : "",
                        AREAFONO4: cleanP[3] ? Number(cleanP[3]) : "",
                        FEC_ASI: fecAsi,
                        PROV: "VET",
                        PRODUCTO: "SAE",
                        CAMP: "SIMULACION WEB",
                        OFERTA_SAE: Number(o) || 0,
                        PASO: paso,
                        DV: (row.dv || row.DV || "") ? String(row.dv || row.DV).toUpperCase() : calculateDV(rLimpio),
                        TEL_1: cleanP[0] ? Number(cleanP[0]) : (loadType === 'manual' ? "" : 999999999),
                        TEL_2: cleanP[1] ? Number(cleanP[1]) : "",
                        TEL_3: cleanP[2] ? Number(cleanP[2]) : "",
                        TEL_4: cleanP[3] ? Number(cleanP[3]) : "",
                        NOMBRE_COMPLETO: cleanText(nc_fuente || `${nom} ${pat} ${mat}`),
                        PASO_2: paso2,
                        CAMPANA: "CENCOSUD SAE WEB",
                        BASE: baseStr,
                        MES_CARGA: mesCargaStr
                    };

                    if (loadType === 'masivo') {
                        // 1. Conservar orden original del Excel
                        let objMasivo = { ...row };

                        // 2. Inyectar columnas que falten de nuestra base (al final de las originales)
                        Object.keys(finalRow).forEach(key => {
                            if (!(key in objMasivo) && key !== 'BASE' && key !== 'MES_CARGA') {
                                objMasivo[key] = finalRow[key];
                            }
                        });

                        // 3. Forzar valores limpios/calculados
                        Object.assign(objMasivo, {
                            RUT: finalRow.RUT, DV: finalRow.DV,
                            NOMBRES: finalRow.NOMBRES, PATERNO: finalRow.PATERNO, MATERNO: finalRow.MATERNO, NOMBRE_COMPLETO: finalRow.NOMBRE_COMPLETO,
                            AREAFONO1: finalRow.AREAFONO1, AREAFONO2: finalRow.AREAFONO2, AREAFONO3: finalRow.AREAFONO3, AREAFONO4: finalRow.AREAFONO4,
                            TEL_1: finalRow.TEL_1, TEL_2: finalRow.TEL_2, TEL_3: finalRow.TEL_3, TEL_4: finalRow.TEL_4,
                            OFERTA_SAE: finalRow.OFERTA_SAE, PASO: finalRow.PASO, PASO_2: finalRow.PASO_2
                        });

                        // 4. Cerrar siempre con BASE y MES_CARGA
                        delete objMasivo.BASE; delete objMasivo.MES_CARGA;
                        objMasivo.BASE = finalRow.BASE;
                        objMasivo.MES_CARGA = finalRow.MES_CARGA;

                        processedData.push(objMasivo);
                    } else {
                        processedData.push(finalRow);
                    }
                });

                // 5. DEDUPLICACIÓN
                processedData.sort((a, b) => b.OFERTA_SAE - a.OFERTA_SAE);

                const finalMap = new Map();
                processedData.forEach(row => {
                    if (!finalMap.has(row.RUT)) {
                        finalMap.set(row.RUT, row);
                    } else {
                        stats.duplicados++;
                    }
                });

                let finalArray = Array.from(finalMap.values());

                // 6. EXPORTAR EXCEL FINAL
                const { ws, cleanData } = crearSheetLimpio(finalArray);
                stats.validos = cleanData.length;

                setProcessReport({
                    totalLeidos: stats.leidos,
                    totalValidos: stats.validos,
                    duplicadosRUT: stats.duplicados,
                    excluidos: stats.excluidos
                });

                if (stats.validos === 0) {
                    addToast('No hay registros para exportar.', 'warning');
                    setIsProcessing(false);
                    return;
                }

                const wb = window.XLSX.utils.book_new();
                window.XLSX.utils.book_append_sheet(wb, ws, "Sae_Web");
                window.XLSX.writeFile(wb, `${baseStr}.${outputFormat}`);

                // Único mensaje de éxito al finalizar todo
                addToast(`Proceso exitoso: ${stats.validos} registros exportados.`, 'success');

            } catch (error) {
                console.error("Error en lectura:", error);
                addToast('Error inesperado al procesar.', 'error');
            }

            setIsProcessing(false);
        };

        return (
            <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full animate-fade-in">

                {/* ENCABEZADO DE TAREA */}
                <div className="border-b border-gray-200 pb-3">
                    <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                        <Icon name="database" className="text-blue-600" />
                        Carga Cencosud SAE Web
                    </h2>
                    <p className="text-gray-500 text-sm mt-1">Unificación, extracción de referidos, depuración de teléfonos y cruce.</p>
                </div>

                {/* 1. SELECCIÓN DE TIPO DE CARGA Y ZONA DE ENTRADA */}
                <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm flex flex-col gap-4">

                    {/* SELECTOR DE BIFURCACIÓN */}
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">1. Tipo de Carga y Origen</label>
                        <select
                            className="w-full p-2.5 border border-gray-300 rounded-md bg-gray-50 text-sm outline-none focus:border-blue-500 focus:bg-white transition-colors font-medium text-gray-700"
                            value={loadType}
                            onChange={(e) => {
                                setLoadType(e.target.value);
                                setMainFiles([]);
                                setInputText(''); // Limpiamos todo al cambiar de modo
                            }}
                        >
                            <option value="masivo">Carga Masiva (Múltiples Archivos)</option>
                            <option value="referido_rdr_web">Referidos: CENCOSUD RDR WEB</option>
                            <option value="referido_cc">Referidos: COMPRA CARTERA</option>
                            <option value="referido_sae">Referidos: CENCOSUD SAE</option>
                            <option value="manual">Ingreso Manual (RUTs o Texto)</option>
                        </select>
                    </div>

                    {/* VISTA A: CARGA MASIVA */}
                    {loadType === 'masivo' && (
                        <div className="border-2 border-dashed border-blue-300 rounded-lg p-8 text-center bg-blue-50 hover:bg-blue-100 transition-colors cursor-pointer relative animate-fade-in">
                            <input
                                type="file"
                                multiple
                                accept=".csv,.txt,.xlsx,.xls"
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                onChange={handleMainFiles}
                            />
                            <Icon name="upload-cloud" size={32} className="mx-auto text-blue-500 mb-2" />
                            <p className="text-sm font-medium text-blue-800">
                                {mainFiles.length > 0
                                    ? `${mainFiles.length} archivo(s) masivo(s) listo(s)`
                                    : 'Haz clic o arrastra los archivos masivos aquí (Soporta múltiples)'}
                            </p>
                            {mainFiles.length > 0 && (
                                <p className="text-xs text-blue-600 mt-2 font-mono bg-blue-100 inline-block px-2 py-1 rounded">
                                    {mainFiles[0].name} {mainFiles.length > 1 ? `y ${mainFiles.length - 1} más...` : ''}
                                </p>
                            )}
                        </div>
                    )}

                    {/* VISTA B: REFERIDOS - Requiere Archivo + RUTs */}
                    {(['referido_cc', 'referido_sae', 'referido_rdr_web'].includes(loadType)) && (
                        <div className="flex flex-col gap-4 animate-fade-in">
                            <div className="border border-purple-200 rounded-lg p-4 bg-purple-50">
                                <label className="block text-sm font-bold text-purple-800 mb-2">A. Pega los RUTs a buscar y extraer:</label>
                                <textarea
                                    className="w-full h-24 p-3 border border-purple-300 rounded focus:border-purple-500 outline-none text-sm font-mono resize-none bg-white"
                                    placeholder="Ejemplo:&#10;12345678&#10;87654321"
                                    value={inputText}
                                    onChange={(e) => setInputText(e.target.value)}
                                ></textarea>
                            </div>

                            <div className="border-2 border-dashed border-purple-300 rounded-lg p-6 text-center bg-white hover:bg-purple-50 transition-colors cursor-pointer relative">
                                <input
                                    type="file"
                                    accept=".csv,.txt,.xlsx,.xls"
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    onChange={handleMainFiles}
                                />
                                <Icon name="file-search" size={24} className="mx-auto text-purple-500 mb-2" />
                                <p className="text-sm font-medium text-purple-800">
                                    {mainFiles.length > 0
                                        ? <span className="font-bold">B. Archivo base listo: {mainFiles[0].name}</span>
                                        : 'B. Sube el archivo de donde se extraerán estos referidos'}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* VISTA C: INGRESO MANUAL */}
                    {loadType === 'manual' && (
                        <div className="border border-gray-300 rounded-lg p-4 bg-gray-50 animate-fade-in overflow-x-auto">
                            <div className="flex items-center gap-2 mb-3">
                                <Icon name="keyboard" size={20} className="text-gray-500" />
                                <span className="text-sm font-bold text-gray-700">Ingreso Manual (Mini Grilla)</span>
                            </div>
                            <table className="w-full text-sm text-left mb-3">
                                <thead className="text-xs text-gray-700 uppercase bg-gray-200">
                                    <tr>
                                        <th className="px-2 py-2">RUT</th>
                                        <th className="px-2 py-2">Nombre Completo</th>
                                        <th className="px-2 py-2">Teléfono</th>
                                        <th className="px-2 py-2">Monto/Oferta</th>
                                        <th className="px-2 py-2"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {manualRows.map((row, idx) => (
                                        <tr key={idx} className="bg-white border-b align-top">
                                            <td className="p-1"><input type="text" className="w-full p-1 border rounded outline-none focus:border-blue-500" placeholder="12345678-9" value={row.rut} onChange={e => { const newRows = [...manualRows]; newRows[idx].rut = e.target.value; setManualRows(newRows); }} /></td>
                                            <td className="p-1"><input type="text" className="w-full p-1 border rounded outline-none focus:border-blue-500" placeholder="Juan Perez" value={row.nom_completo} onChange={e => { const newRows = [...manualRows]; newRows[idx].nom_completo = e.target.value; setManualRows(newRows); }} /></td>
                                            <td className="p-1">
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-center gap-1">
                                                        <input type="text" className="w-full p-1 border rounded outline-none focus:border-blue-500" placeholder="Fono 1" value={row.telefono1 || ''} onChange={e => { const newRows = [...manualRows]; newRows[idx].telefono1 = e.target.value; setManualRows(newRows); }} />
                                                        {(row.phoneCount || 1) === 1 && (
                                                            <button title="Agregar fono" onClick={() => { const newRows = [...manualRows]; newRows[idx].phoneCount = 2; setManualRows(newRows); }} className="text-blue-500 hover:text-blue-700 font-bold px-1">+</button>
                                                        )}
                                                    </div>
                                                    {(row.phoneCount || 1) >= 2 && (
                                                        <div className="flex items-center gap-1">
                                                            <input type="text" className="w-full p-1 border rounded outline-none focus:border-blue-500" placeholder="Fono 2" value={row.telefono2 || ''} onChange={e => { const newRows = [...manualRows]; newRows[idx].telefono2 = e.target.value; setManualRows(newRows); }} />
                                                            {(row.phoneCount || 1) === 2 && (
                                                                <>
                                                                    <button title="Agregar fono" onClick={() => { const newRows = [...manualRows]; newRows[idx].phoneCount = 3; setManualRows(newRows); }} className="text-blue-500 hover:text-blue-700 font-bold px-1">+</button>
                                                                    <button title="Quitar fono" onClick={() => { const newRows = [...manualRows]; newRows[idx].phoneCount = 1; newRows[idx].telefono2 = ''; setManualRows(newRows); }} className="text-red-500 hover:text-red-700 font-bold px-1">-</button>
                                                                </>
                                                            )}
                                                        </div>
                                                    )}
                                                    {(row.phoneCount || 1) >= 3 && (
                                                        <div className="flex items-center gap-1">
                                                            <input type="text" className="w-full p-1 border rounded outline-none focus:border-blue-500" placeholder="Fono 3" value={row.telefono3 || ''} onChange={e => { const newRows = [...manualRows]; newRows[idx].telefono3 = e.target.value; setManualRows(newRows); }} />
                                                            {(row.phoneCount || 1) === 3 && (
                                                                <>
                                                                    <button title="Agregar fono" onClick={() => { const newRows = [...manualRows]; newRows[idx].phoneCount = 4; setManualRows(newRows); }} className="text-blue-500 hover:text-blue-700 font-bold px-1">+</button>
                                                                    <button title="Quitar fono" onClick={() => { const newRows = [...manualRows]; newRows[idx].phoneCount = 2; newRows[idx].telefono3 = ''; setManualRows(newRows); }} className="text-red-500 hover:text-red-700 font-bold px-1">-</button>
                                                                </>
                                                            )}
                                                        </div>
                                                    )}
                                                    {(row.phoneCount || 1) >= 4 && (
                                                        <div className="flex items-center gap-1">
                                                            <input type="text" className="w-full p-1 border rounded outline-none focus:border-blue-500" placeholder="Fono 4" value={row.telefono4 || ''} onChange={e => { const newRows = [...manualRows]; newRows[idx].telefono4 = e.target.value; setManualRows(newRows); }} />
                                                            <button title="Quitar fono" onClick={() => { const newRows = [...manualRows]; newRows[idx].phoneCount = 3; newRows[idx].telefono4 = ''; setManualRows(newRows); }} className="text-red-500 hover:text-red-700 font-bold px-1">-</button>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-1"><input type="number" className="w-full p-1 border rounded outline-none focus:border-blue-500" placeholder="0" value={row.monto} onChange={e => { const newRows = [...manualRows]; newRows[idx].monto = e.target.value; setManualRows(newRows); }} /></td>
                                            <td className="p-1 text-center pt-2">
                                                {manualRows.length > 1 && (
                                                    <button onClick={() => setManualRows(manualRows.filter((_, i) => i !== idx))} className="text-red-500 hover:text-red-700"><Icon name="trash-2" size={16} /></button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <button onClick={() => setManualRows([...manualRows, { rut: '', nom_completo: '', telefono1: '', monto: '' }])} className="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded hover:bg-blue-200 font-bold flex items-center gap-1"><Icon name="plus" size={14} /> Agregar Fila</button>
                        </div>
                    )}
                </div>

                {pendientesHojas.length > 0 && (
                    <SelectorHojas
                        pendientes={pendientesHojas}
                        Icon={Icon}
                        onConfirm={(sel) => { setSheetSelections(prev => ({ ...prev, ...sel })); setPendientesHojas([]); }}
                        onCancel={() => setPendientesHojas([])}
                    />
                )}

                {/* 2. EXCLUSIÓN (SWITCH Y CARGA SECUNDARIA) */}
                <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <label className="text-sm font-bold text-gray-700">2. Lista Vigente (Cruce y Exclusión)</label>
                        <label className="flex items-center cursor-pointer">
                            <div className="relative">
                                <input
                                    type="checkbox"
                                    className="sr-only"
                                    checked={excludeList}
                                    onChange={() => setExcludeList(!excludeList)}
                                />
                                <div className={`block w-10 h-6 rounded-full transition-colors ${excludeList ? 'bg-blue-600' : 'bg-gray-300'}`}></div>
                                <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${excludeList ? 'transform translate-x-4' : ''}`}></div>
                            </div>
                            <div className="ml-3 text-sm font-medium text-gray-600">
                                {excludeList ? 'Activado' : 'Desactivado'}
                            </div>
                        </label>
                    </div>

                    {excludeList && (
                        <div className="flex flex-col gap-2 mt-2 animate-fade-in">
                            <div style={{ display: 'flex', gap: '6px' }}>
                                <button type="button" onClick={() => { setExclusionSqlMode(false); setExclusionSqlData(null); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #6366f1', background: !exclusionSqlMode ? '#6366f1' : 'white', color: !exclusionSqlMode ? 'white' : '#6366f1', cursor: 'pointer' }}>📂 Archivo</button>
                                <button type="button" onClick={() => { setExclusionSqlMode(true); setExclusionFile(null); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #3b82f6', background: exclusionSqlMode ? '#3b82f6' : 'white', color: exclusionSqlMode ? 'white' : '#3b82f6', cursor: 'pointer' }}>⚡ SQL</button>
                            </div>
                            {!exclusionSqlMode ? (
                                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer relative">
                                    <input type="file" accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={handleExclusionFile} />
                                    <Icon name="file-search" size={24} className="mx-auto text-gray-400 mb-2" />
                                    <p className="text-sm font-medium text-gray-600">{exclusionFile ? <span className="text-emerald-600 font-bold">{exclusionFile.name}</span> : 'Cargar rutero o lista vigente para excluir'}</p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    <textarea style={{ width: '100%', minHeight: '80px', padding: '0.5rem', border: '2px solid #3b82f6', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical', boxSizing: 'border-box' }} value={exclusionSqlQuery} onChange={e => setExclusionSqlQuery(e.target.value)} placeholder="SELECT RUT FROM tabla WHERE..." />
                                    <button type="button" style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.8rem', background: '#3b82f6', color: 'white', border: 'none', cursor: 'pointer', alignSelf: 'flex-start' }} onClick={async () => {
                                        if (!exclusionSqlQuery.trim()) return;
                                        const r = await window.nexusAPI.executeSQL(exclusionSqlQuery);
                                        if (!r.success) { addToast('Error SQL: ' + r.error, 'error'); return; }
                                        setExclusionSqlData(r.data);
                                        addToast(`${r.data.length} registros cargados desde SQL.`, 'success');
                                    }}>⚡ Ejecutar</button>
                                    {exclusionSqlData && <p className="text-xs text-emerald-600 font-bold">✓ {exclusionSqlData.length} registros cargados desde SQL</p>}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* AVISO VISUAL DE EXCLUSIÓN FALTANTE */}
                {excludeList && !exclusionFile && !exclusionSqlData && (
                    <div className="bg-amber-50 border-l-4 border-amber-500 p-4 shadow-sm flex items-start gap-3 animate-fade-in rounded-r-lg">
                        <Icon name="alert-triangle" size={24} className="text-amber-500 flex-shrink-0 mt-0.5" />
                        <div>
                            <h4 className="text-sm font-bold text-amber-800">Falta la lista de exclusión</h4>
                            <p className="text-xs text-amber-700 mt-1">
                                Tienes la opción de exclusión activada, pero no has cargado el rutero. <strong>Debes cargar el archivo</strong> o apagar el interruptor para poder procesar la carga.
                            </p>
                        </div>
                    </div>
                )}

                {/* 3. OPCIONES Y BOTÓN DE PROCESO */}
                <div className="flex flex-col md:flex-row items-center justify-between bg-gray-50 p-4 rounded-lg border border-gray-200 gap-4">
                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <label className="text-sm font-bold text-gray-700 whitespace-nowrap">Formato de Salida:</label>
                        <select
                            className="p-2 border border-gray-300 rounded bg-white text-sm outline-none focus:border-blue-500 font-medium"
                            value={outputFormat}
                            onChange={(e) => setOutputFormat(e.target.value)}
                        >
                            <option value="xlsx">Excel Moderno (.xlsx)</option>
                            <option value="xls">Excel 97-2003 (.xls)</option>
                        </select>
                        <div className="flex items-center gap-2 ml-4">
                            <div className={`w-10 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-colors ${priorizarCel ? 'bg-blue-600' : 'bg-gray-300'}`} onClick={() => setPriorizarCel(!priorizarCel)}>
                                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${priorizarCel ? 'translate-x-5' : ''}`}></div>
                            </div>
                            <span className="text-xs font-bold text-gray-600 whitespace-nowrap">Priorizar Cel.</span>
                        </div>
                    </div>

                    <button
                        className={`w-full md:w-auto px-8 py-3 rounded-lg font-bold text-white shadow-md transition-all flex items-center justify-center gap-2 ${isProcessDisabled() || isProcessing
                            ? 'bg-gray-400 cursor-not-allowed opacity-70'
                            : 'bg-emerald-600 hover:bg-emerald-700 hover:scale-[1.02]'
                            }`}
                        disabled={isProcessDisabled() || isProcessing}
                        onClick={handleProcess}
                    >
                        {isProcessing ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Icon name="play-circle" size={20} />}
                        {isProcessing ? 'Procesando...' : 'Procesar Carga'}
                    </button>
                </div>

                {/* 4. PANEL DE REPORTE FINAL */}
                {processReport && (
                    <div className="bg-white p-5 rounded-lg border border-emerald-200 shadow-sm mt-2 animate-fade-in border-l-4 border-l-emerald-500">
                        <h3 className="text-lg font-bold text-emerald-800 mb-3 flex items-center gap-2">
                            <Icon name="check-circle" className="text-emerald-600" />
                            Reporte de Procesamiento
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                            <div className="bg-gray-50 p-3 rounded border border-gray-200 text-center">
                                <div className="text-2xl font-black text-gray-700">{processReport.totalLeidos}</div>
                                <div className="text-xs text-gray-500 uppercase font-bold">Leídos</div>
                            </div>
                            <div className="bg-blue-50 p-3 rounded border border-blue-200 text-center">
                                <div className="text-2xl font-black text-blue-700">{processReport.totalValidos}</div>
                                <div className="text-xs text-blue-500 uppercase font-bold">Cargados</div>
                            </div>
                            <div className="bg-amber-50 p-3 rounded border border-amber-200 text-center">
                                <div className="text-2xl font-black text-amber-700">{processReport.duplicadosRUT}</div>
                                <div className="text-xs text-amber-500 uppercase font-bold">Duplicados (Peor Oferta)</div>
                            </div>
                            <div className="bg-purple-50 p-3 rounded border border-purple-200 text-center">
                                <div className="text-2xl font-black text-purple-700">{processReport.excluidos}</div>
                                <div className="text-xs text-purple-500 uppercase font-bold">Excluidos (Lista)</div>
                            </div>
                        </div>

                        {/* Detalles de referidos excluidos o errores */}
                        {processReport.detalles && processReport.detalles.length > 0 && (
                            <div className="mt-4">
                                <p className="text-xs font-bold text-gray-600 mb-2">Detalle de registros:</p>
                                <div className="max-h-32 overflow-y-auto bg-gray-50 border border-gray-200 rounded p-2 text-xs font-mono text-gray-600 space-y-1">
                                    {processReport.detalles.map((det, idx) => (
                                        <div key={idx} className="border-b border-gray-200 last:border-0 pb-1">{det}</div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

            </div>
        );
    };

    // ========================================================================
    // ⬇️ PEGAR AQUÍ ABAJO EL CÓDIGO DE LA SIGUIENTE TAREA ⬇️
    // ========================================================================

    // ==========================================
    // TAREA 3: Carga Cencosud SAE
    // ==========================================
    const TaskCargaSae = ({ Icon, addToast, utils }) => {
        const getTodayYMD = () => {
            const d = new Date();
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        };
        const [baseFiles, setBaseFiles] = useState([]);
        const [fechaProceso, setFechaProceso] = useState(getTodayYMD());
        const [cruceFile, setCruceFile] = useState(null);
        const [usarCruce, setUsarCruce] = useState(true);
        const [cruceSqlMode, setCruceSqlMode] = useState(false);
        const [cruceSqlQuery, setCruceSqlQuery] = useState('');
        const [cruceSqlData, setCruceSqlData] = useState(null);
        const [formatoExportacion, setFormatoExportacion] = useState('xlsx');
        const [isProcessing, setIsProcessing] = useState(false);
        const [processReport, setProcessReport] = useState(null);
        const [priorizarCel, setPriorizarCel] = useState(false);
        const [pendientesHojas, setPendientesHojas] = useState([]);
        const [sheetSelections, setSheetSelections] = useState({});

        const handleProcess = async () => {
            setProcessReport(null);
            if (!baseFiles || baseFiles.length === 0) {
                addToast('Por favor, carga al menos un archivo base.', 'error');
                return;
            }
            if (usarCruce && !cruceFile && !cruceSqlData) {
                addToast('Has activado el cruce. Por favor carga la lista de exclusión.', 'error');
                return;
            }

            setIsProcessing(true);
            try {
                // 1. LECTURA Y PARAMETRIZACIÓN DEL ARCHIVO DE EXCLUSIÓN
                let exclusionSet = new Set();
                if (usarCruce && cruceSqlMode && cruceSqlData) {
                    cruceSqlData.forEach(row => {
                        const rutKey = Object.keys(row).find(k => ['vendor_lead_code', 'rut', 'rut_cliente', 'rutero'].includes(k.toLowerCase()));
                        if (rutKey && row[rutKey]) { let rLimpio = String(row[rutKey]).split('-')[0].replace(/\D/g, ''); if (rLimpio) exclusionSet.add(rLimpio); }
                    });
                } else if (usarCruce && cruceFile) {
                    const cruceData = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            try {
                                const data = new Uint8Array(e.target.result);
                                const workbook = window.XLSX.read(data, { type: 'array' });

                                // 1. Leemos sin 'defval' para que las celdas vacías no creen claves (Ataca Z+1)
                                const cruceSheetName = sheetSelections[cruceFile.name] || workbook.SheetNames[0];
                                const jsonData = window.XLSX.utils.sheet_to_json(workbook.Sheets[cruceSheetName]);

                                // 2. Filtrado quirúrgico de filas (Ataca Y+1)
                                // Solo se resuelve la fila si al menos una columna real tiene texto no vacío
                                resolve(jsonData.filter(r =>
                                    Object.keys(r).some(k =>
                                        !k.startsWith('__EMPTY') && String(r[k] || "").trim() !== ""
                                    )
                                ));
                            } catch (err) { reject(err); }
                        };
                        reader.readAsArrayBuffer(cruceFile);
                    });

                    cruceData.forEach(row => {
                        const rutKey = Object.keys(row).find(k => ['vendor_lead_code', 'rut', 'rut_cliente', 'rutero'].includes(k.toLowerCase()));
                        if (rutKey && row[rutKey]) {
                            let rLimpio = String(row[rutKey]).split('-')[0].replace(/\D/g, '');
                            if (rLimpio) exclusionSet.add(rLimpio);
                        }
                    });
                }

                // --- 0. DETECCIÓN DE HOJAS MÚLTIPLES ---
                const pendientes = [];
                for (const f of baseFiles) {
                    if (f.name.toLowerCase().endsWith('.csv') || f.name.toLowerCase().endsWith('.txt')) continue;
                    if (sheetSelections[f.name]) continue;
                    try {
                        const result = await leerExcelConHojas(f);
                        if (result.multiSheet) pendientes.push({ name: f.name, sheetNames: result.sheetNames });
                    } catch (e) { /* se manejará después */ }
                }
                if (pendientes.length > 0) {
                    setPendientesHojas(pendientes);
                    setIsProcessing(false);
                    return;
                }

                // 2. LECTURA DE ARCHIVOS BASE MÚLTIPLES
                let combinedData = [];
                for (const file of baseFiles) {
                    const fileData = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            try {
                                const data = new Uint8Array(e.target.result);
                                const workbook = window.XLSX.read(data, { type: 'array' });
                                const sheetName = sheetSelections[file.name] || workbook.SheetNames[0];
                                const jsonData = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
                                // Solo pasan filas que tengan contenido real en columnas que no sean basura
                                resolve(jsonData.filter(r => Object.keys(r).some(k => !k.startsWith('__EMPTY') && String(r[k] || "").trim() !== "")));
                            } catch (err) { reject(err); }
                        };
                        reader.readAsArrayBuffer(file);
                    });
                    combinedData = combinedData.concat(fileData);
                }

                // 3. FECHAS (Construcción dinámica según calendario)
                const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
                const [selYear, selMonth, selDay] = fechaProceso.split('-');
                const dateObj = new Date(selYear, selMonth - 1, selDay);

                const day = String(dateObj.getDate()).padStart(2, '0');
                const monthNum = String(dateObj.getMonth() + 1).padStart(2, '0');
                const fullYear = dateObj.getFullYear();
                const shortYear = String(fullYear).slice(-2);
                const monthName = monthNames[dateObj.getMonth()];

                const baseStr = `Base_${day}_${monthNum}_${fullYear}`;
                const mesCargaStr = `${monthName}_${shortYear}`;

                // 4. PROCESAMIENTO
                let processedData = []; let excluidosCount = 0;
                combinedData.forEach(row => {
                    let rCrudo = row.vendor_lead_code || row.VENDOR_LEAD_CODE || row.RUT || row.rut || row.Rut || "";
                    let baseRut = String(rCrudo).split('-')[0].replace(/\D/g, '');

                    if (usarCruce && exclusionSet.has(baseRut)) { excluidosCount++; return; }

                    let objSae = { ...row };

                    // Limpiamos posiciones previas para que las columnas nuevas se agrupen al final del archivo
                    const targetCols = ['NOMBRE_COMPLETO', 'TEL_1', 'TEL_2', 'TEL_3', 'TEL_4', 'BASE', 'MES_CARGA'];
                    targetCols.forEach(k => delete objSae[k]);

                    const saePhones = depurarTelefonos([row.fono_01 || row.FONO_01, row.fono_02 || row.FONO_02, row.fono_03 || row.FONO_03, row.fono_04 || row.FONO_04], priorizarCel);
                    while (saePhones.length < 4) saePhones.push('');

                    Object.assign(objSae, {
                        NOMBRE_COMPLETO: formatNombreCompleto(row.NOMBRES || row.Nombres, row.PATERNO || row.Paterno, row.MATERNO || row.Materno),
                        TEL_1: saePhones[0] ? Number(saePhones[0]) : 999999999,
                        TEL_2: saePhones[1] ? Number(saePhones[1]) : "",
                        TEL_3: saePhones[2] ? Number(saePhones[2]) : "",
                        TEL_4: saePhones[3] ? Number(saePhones[3]) : "",
                        BASE: baseStr,
                        MES_CARGA: mesCargaStr
                    });

                    processedData.push(objSae);
                });

                // 5. ORDENAMIENTO DE 3 NIVELES
                const colorOrder = { "N1": 1, "V": 2, "A": 3, "R": 4, "M": 5 };

                processedData.sort((a, b) => {
                    let cA = String(a.CCSAE_COLOR || "").trim().toUpperCase();
                    let cB = String(b.CCSAE_COLOR || "").trim().toUpperCase();
                    let valA = colorOrder[cA] || 99;
                    let valB = colorOrder[cB] || 99;
                    if (valA !== valB) return valA - valB;

                    let rankA = Number(String(a.RANKING || "0").replace(/\D/g, ''));
                    let rankB = Number(String(b.RANKING || "0").replace(/\D/g, ''));
                    if (rankA !== rankB) return rankA - rankB;

                    let ofA = Number(String(a.Oferta_Total || "0").replace(/\D/g, ''));
                    let ofB = Number(String(b.Oferta_Total || "0").replace(/\D/g, ''));
                    return ofB - ofA;
                });

                const deduplicatedMap = new Map(); let duplicadosCount = 0;
                processedData.forEach(row => {
                    const r = String(row.vendor_lead_code || row.VENDOR_LEAD_CODE || row.RUT || row.rut || row.Rut || "").split('-')[0].replace(/\D/g, '');
                    if (!deduplicatedMap.has(r)) deduplicatedMap.set(r, row); else duplicadosCount++;
                });

                const finalArray = Array.from(deduplicatedMap.values());

                // 6. EXPORTACIÓN LIMPIA
                const { ws, cleanData } = crearSheetLimpio(finalArray);

                setProcessReport({ totalLeidos: combinedData.length, totalValidos: cleanData.length, duplicadosRUT: duplicadosCount, excluidos: excluidosCount });

                if (cleanData.length === 0) {
                    addToast('No hay registros para exportar.', 'warning');
                    setIsProcessing(false);
                    return;
                }

                const wb = window.XLSX.utils.book_new();
                window.XLSX.utils.book_append_sheet(wb, ws, "Base_Sae");
                window.XLSX.writeFile(wb, `Base_Cencosud_SAE.${formatoExportacion}`);

                addToast(`Proceso exitoso: ${cleanData.length} registros exportados.`, 'success');
            } catch (error) {
                console.error(error);
                addToast('Ocurrió un error en el procesamiento: ' + error.message, 'error');
            } finally {
                setIsProcessing(false);
            }
        };

        return (
            <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full animate-fade-in">
                <div className="border-b border-gray-200 pb-3">
                    <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                        <Icon name="database" className="text-blue-600" />
                        Carga Cencosud SAE
                    </h2>
                    <p className="text-gray-500 text-sm mt-1">Módulo de extracción masiva y cruce de base.</p>
                </div>

                <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm flex flex-col gap-4">
                    <label className="block text-sm font-bold text-gray-700 mb-2">1. Archivos Base (Obligatorio)</label>

                    <div className="border-2 border-dashed border-blue-300 rounded-lg p-8 text-center bg-blue-50 hover:bg-blue-100 transition-colors relative animate-fade-in">
                        <input type="file" multiple accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={(e) => {
                            const allFiles = Array.from(e.target.files);
                            const validFiles = allFiles.filter(f => f.size > 0);
                            if (validFiles.length < allFiles.length) {
                                addToast('Se descartaron archivos en blanco (0 KB).', 'warning');
                            }
                            if (validFiles.length === 0) e.target.value = '';
                            setBaseFiles(validFiles);
                        }} />
                        <Icon name="upload-cloud" size={32} className="mx-auto text-blue-500 mb-2" />
                        <p className="text-sm font-medium text-blue-800">{baseFiles.length > 0 ? `${baseFiles.length} archivo(s) listo(s)` : 'Haz clic o arrastra los archivos aquí'}</p>
                    </div>
                </div>

                {pendientesHojas.length > 0 && (
                    <SelectorHojas
                        pendientes={pendientesHojas}
                        Icon={Icon}
                        onConfirm={(sel) => { setSheetSelections(prev => ({ ...prev, ...sel })); setPendientesHojas([]); }}
                        onCancel={() => setPendientesHojas([])}
                    />
                )}

                <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <label className="text-sm font-bold text-gray-700">2. Lista Vigente (Cruce y Exclusión)</label>
                        <label className="flex items-center cursor-pointer">
                            <div className="relative">
                                <input type="checkbox" className="sr-only" checked={usarCruce} onChange={() => setUsarCruce(!usarCruce)} />
                                <div className={`block w-10 h-6 rounded-full transition-colors ${usarCruce ? 'bg-blue-600' : 'bg-gray-300'}`}></div>
                                <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${usarCruce ? 'transform translate-x-4' : ''}`}></div>
                            </div>
                            <div className="ml-3 text-sm font-medium text-gray-600">{usarCruce ? 'Activado' : 'Desactivado'}</div>
                        </label>
                    </div>
                    {usarCruce && (
                        <div className="flex flex-col gap-2 mt-2 animate-fade-in">
                            <div style={{ display: 'flex', gap: '6px' }}>
                                <button type="button" onClick={() => { setCruceSqlMode(false); setCruceSqlData(null); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #6366f1', background: !cruceSqlMode ? '#6366f1' : 'white', color: !cruceSqlMode ? 'white' : '#6366f1', cursor: 'pointer' }}>📂 Archivo</button>
                                <button type="button" onClick={() => { setCruceSqlMode(true); setCruceFile(null); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #3b82f6', background: cruceSqlMode ? '#3b82f6' : 'white', color: cruceSqlMode ? 'white' : '#3b82f6', cursor: 'pointer' }}>⚡ SQL</button>
                            </div>
                            {!cruceSqlMode ? (
                                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center bg-gray-50 hover:bg-gray-100 relative">
                                    <input type="file" accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={(e) => setCruceFile(e.target.files[0])} />
                                    <Icon name="file-search" size={24} className="mx-auto text-gray-400 mb-2" />
                                    <p className="text-sm font-medium text-gray-600">{cruceFile ? <span className="text-emerald-600 font-bold">{cruceFile.name}</span> : 'Cargar rutero o lista vigente para excluir'}</p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    <textarea style={{ width: '100%', minHeight: '80px', padding: '0.5rem', border: '2px solid #3b82f6', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical', boxSizing: 'border-box' }} value={cruceSqlQuery} onChange={e => setCruceSqlQuery(e.target.value)} placeholder="SELECT RUT FROM tabla WHERE..." />
                                    <button type="button" style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.8rem', background: '#3b82f6', color: 'white', border: 'none', cursor: 'pointer', alignSelf: 'flex-start' }} onClick={async () => {
                                        if (!cruceSqlQuery.trim()) return;
                                        const r = await window.nexusAPI.executeSQL(cruceSqlQuery);
                                        if (!r.success) { addToast('Error SQL: ' + r.error, 'error'); return; }
                                        setCruceSqlData(r.data);
                                        addToast(`${r.data.length} registros cargados desde SQL.`, 'success');
                                    }}>⚡ Ejecutar</button>
                                    {cruceSqlData && <p className="text-xs text-emerald-600 font-bold">✓ {cruceSqlData.length} registros cargados desde SQL</p>}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* AVISO VISUAL DE EXCLUSIÓN FALTANTE */}
                {usarCruce && !cruceFile && !cruceSqlData && (
                    <div className="bg-amber-50 border-l-4 border-amber-500 p-4 shadow-sm flex items-start gap-3 animate-fade-in rounded-r-lg">
                        <Icon name="alert-triangle" size={24} className="text-amber-500 flex-shrink-0 mt-0.5" />
                        <div>
                            <h4 className="text-sm font-bold text-amber-800">Falta la lista de exclusión</h4>
                            <p className="text-xs text-amber-700 mt-1">Tienes la opción de exclusión activada, pero no has cargado el rutero. <strong>Debes cargar el archivo</strong> o apagar el interruptor para poder procesar la carga.</p>
                        </div>
                    </div>
                )}

                <div className="flex flex-col md:flex-row items-center justify-between bg-gray-50 p-4 rounded-lg border border-gray-200 gap-4">
                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <label className="text-sm font-bold text-gray-700 whitespace-nowrap">Fecha de Proceso:</label>
                        <input type="date" className="p-2 border border-gray-300 rounded bg-white text-sm outline-none focus:border-blue-500 font-medium" value={fechaProceso} onChange={(e) => setFechaProceso(e.target.value)} />
                        <label className="text-sm font-bold text-gray-700 whitespace-nowrap ml-2">Salida:</label>
                        <select className="p-2 border border-gray-300 rounded bg-white text-sm outline-none focus:border-blue-500 font-medium" value={formatoExportacion} onChange={(e) => setFormatoExportacion(e.target.value)}>
                            <option value="xlsx">Excel Moderno (.xlsx)</option>
                            <option value="xls">Excel 97-2003 (.xls)</option>
                        </select>
                        <div className="flex items-center gap-2 ml-4">
                            <div className={`w-10 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-colors ${priorizarCel ? 'bg-blue-600' : 'bg-gray-300'}`} onClick={() => setPriorizarCel(!priorizarCel)}>
                                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${priorizarCel ? 'translate-x-5' : ''}`}></div>
                            </div>
                            <span className="text-xs font-bold text-gray-600 whitespace-nowrap">Priorizar Cel.</span>
                        </div>
                    </div>
                    <button className={`w-full md:w-auto px-8 py-3 rounded-lg font-bold text-white shadow-md transition-all flex items-center justify-center gap-2 ${(baseFiles.length === 0 || isProcessing || (usarCruce && !cruceFile && !cruceSqlData)) ? 'bg-gray-400 cursor-not-allowed opacity-70' : 'bg-emerald-600 hover:bg-emerald-700 hover:scale-[1.02]'}`} disabled={baseFiles.length === 0 || isProcessing || (usarCruce && !cruceFile && !cruceSqlData)} onClick={handleProcess}>
                        {isProcessing ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Icon name="play-circle" size={20} />}
                        {isProcessing ? 'Procesando...' : 'Ejecutar Proceso SAE'}
                    </button>
                </div>

                {processReport && (
                    <div className="bg-white p-5 rounded-lg border border-emerald-200 shadow-sm mt-2 animate-fade-in border-l-4 border-l-emerald-500">
                        <h3 className="text-lg font-bold text-emerald-800 mb-3 flex items-center gap-2"><Icon name="check-circle" className="text-emerald-600" /> Reporte de Procesamiento</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                            <div className="bg-gray-50 p-3 rounded border border-gray-200"><div className="text-2xl font-black text-gray-700">{processReport.totalLeidos}</div><div className="text-xs text-gray-500 uppercase font-bold">Leídos</div></div>
                            <div className="bg-blue-50 p-3 rounded border border-blue-200"><div className="text-2xl font-black text-blue-700">{processReport.totalValidos}</div><div className="text-xs text-blue-500 uppercase font-bold">Cargados</div></div>
                            <div className="bg-amber-50 p-3 rounded border border-amber-200"><div className="text-2xl font-black text-amber-700">{processReport.duplicadosRUT}</div><div className="text-xs text-amber-500 uppercase font-bold">Duplicados</div></div>
                            <div className="bg-purple-50 p-3 rounded border border-purple-200"><div className="text-2xl font-black text-purple-700">{processReport.excluidos}</div><div className="text-xs text-purple-500 uppercase font-bold">Excluidos</div></div>
                        </div>
                    </div>
                )}
            </div>
        );
    };


    // ========================================================================
    // ⬇️ PEGAR AQUÍ ABAJO EL CÓDIGO DE LA SIGUIENTE TAREA ⬇️
    // ========================================================================


    // ==========================================
    // TAREA 4: Carga Cencosud CC (Masiva y Referidos)
    // ==========================================
    const TaskCargaCompraCartera = ({ Icon, addToast, utils }) => {
        const getTodayYMD = () => {
            const d = new Date();
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        };

        // Estados Generales
        const [fechaProceso, setFechaProceso] = useState(getTodayYMD());
        const [formatoExportacion, setFormatoExportacion] = useState('xlsx');
        const [isProcessing, setIsProcessing] = useState(false);
        const [modo, setModo] = useState('masivo'); // 'masivo' | 'manual' | 'lista'

        // Estados Carga Masiva
        const [baseFiles, setBaseFiles] = useState([]);
        const [cruceFile, setCruceFile] = useState(null);
        const [usarCruce, setUsarCruce] = useState(true);
        const [cruceSqlMode, setCruceSqlMode] = useState(false);
        const [cruceSqlQuery, setCruceSqlQuery] = useState('');
        const [cruceSqlData, setCruceSqlData] = useState(null);
        const [processReport, setProcessReport] = useState(null);

        // Estados Grilla Referidos
        const [gridReferidos, setGridReferidos] = useState([
            { RUT: '', NOMBRE_COMPLETO: '', DISPONIBLE_COMPRACARTERA: '', FONO_01: '', FONO_02: '', FONO_03: '', FONO_04: '' }
        ]);
        const [showExtraFonos, setShowExtraFonos] = useState(false);

        // Estados Referidos desde Lista
        const [refInputRuts, setRefInputRuts] = useState('');
        const [refListaFile, setRefListaFile] = useState(null);
        const [pendientesHojas, setPendientesHojas] = useState([]);
        const [sheetSelections, setSheetSelections] = useState({});

        const calculateDV = (rutStr) => {
            let num = String(rutStr).replace(/[^0-9]/g, '');
            if (!num) return '';
            let t = parseInt(num), m = 0, s = 1;
            for (; t; t = Math.floor(t / 10)) s = (s + t % 10 * (9 - m++ % 6)) % 11;
            return s ? String(s - 1) : 'K';
        };

        // ================= LÓGICAS COMPARTIDAS =================
        const [priorizarCel, setPriorizarCel] = useState(false);

        const generarFechasCarga = () => {
            const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
            const [selYear, selMonth, selDay] = fechaProceso.split('-');
            const dateObj = new Date(selYear, selMonth - 1, selDay);

            const day = String(dateObj.getDate()).padStart(2, '0');
            const monthNum = String(dateObj.getMonth() + 1).padStart(2, '0');
            const fullYear = dateObj.getFullYear();
            const shortYear = String(fullYear).slice(-2);
            const monthName = monthNames[dateObj.getMonth()];

            return {
                baseStr: `Base_${day}_${monthNum}_${fullYear}`,
                mesCargaStr: `${monthName}_${shortYear}`
            };
        };

        const procesarArchivoExtraido = async (file) => {
            const result = await leerExcelConHojas(file, sheetSelections[file.name] || null);
            if (result.multiSheet) {
                throw new Error(`MULTI_SHEET:${file.name}:${result.sheetNames.join(',')}`);
            }
            return result.data;
        };

        // ================= LÓGICA MODO MASIVO =================
        const handleProcessMasivo = async () => {
            setProcessReport(null);
            if (!baseFiles || baseFiles.length === 0) {
                addToast('Por favor, carga al menos un archivo base.', 'error'); return;
            }
            if (usarCruce && !cruceFile && !cruceSqlData) {
                addToast('Falta cargar la lista de exclusión.', 'error'); return;
            }

            setIsProcessing(true);
            try {
                // --- 0. DETECCIÓN DE HOJAS MÚLTIPLES ---
                const pendientes = [];
                for (const f of baseFiles) {
                    if (f.name.toLowerCase().endsWith('.csv') || f.name.toLowerCase().endsWith('.txt')) continue;
                    if (sheetSelections[f.name]) continue;
                    try {
                        const result = await leerExcelConHojas(f);
                        if (result.multiSheet) pendientes.push({ name: f.name, sheetNames: result.sheetNames });
                    } catch (e) { /* se manejará después */ }
                }
                if (pendientes.length > 0) {
                    setPendientesHojas(pendientes);
                    setIsProcessing(false);
                    return;
                }

                let exclusionSet = new Set();
                if (usarCruce && cruceSqlMode && cruceSqlData) {
                    cruceSqlData.forEach(row => {
                        const rutKey = Object.keys(row).find(k => ['vendor_lead_code', 'rut', 'rut_cliente', 'rutero'].includes(k.toLowerCase()));
                        if (rutKey && row[rutKey]) { let rLimpio = String(row[rutKey]).split('-')[0].replace(/\D/g, ''); if (rLimpio) exclusionSet.add(rLimpio); }
                    });
                } else if (usarCruce && cruceFile) {
                    const cruceData = await procesarArchivoExtraido(cruceFile);
                    cruceData.forEach(row => {
                        const rutKey = Object.keys(row).find(k => ['vendor_lead_code', 'rut', 'rut_cliente', 'rutero'].includes(k.toLowerCase()));
                        if (rutKey && row[rutKey]) {
                            let rLimpio = String(row[rutKey]).split('-')[0].replace(/\D/g, '');
                            if (rLimpio) exclusionSet.add(rLimpio);
                        }
                    });
                }

                let combinedData = [];
                for (const file of baseFiles) {
                    const fileData = await procesarArchivoExtraido(file);
                    combinedData = combinedData.concat(fileData);
                }

                const { baseStr, mesCargaStr } = generarFechasCarga();
                let processedData = [];
                let excluidosCount = 0;

                combinedData.forEach(row => {
                    let rCrudo = row.RUT || row.rut || row.Rut || row.vendor_lead_code || "";
                    let baseRut = String(rCrudo).split('-')[0].replace(/\D/g, '');
                    if (usarCruce && exclusionSet.has(baseRut)) { excluidosCount++; return; }

                    let objCC = { ...row };

                    // INTELIGENCIA: Swap de COLOR y ORDEN_CALL
                    let colorVal = String(objCC.COLOR || "").trim();
                    let ordenVal = String(objCC.ORDEN_CALL || "").trim();
                    if (/^\d+$/.test(colorVal) || /^[A-Za-z]+$/.test(ordenVal)) {
                        objCC.COLOR = ordenVal;
                        objCC.ORDEN_CALL = colorVal;
                    }

                    const targetCols = ['NOMBRE_COMPLETO', 'TEL_1', 'TEL_2', 'TEL_3', 'TEL_4', 'BASE', 'MES_CARGA'];
                    targetCols.forEach(k => delete objCC[k]);

                    const ccPhones = depurarTelefonos([objCC.FONO_01 || objCC.fono_01 || objCC.FONO_1 || objCC.fono_1, objCC.FONO_02 || objCC.fono_02 || objCC.FONO_2 || objCC.fono_2, objCC.FONO_03 || objCC.fono_03 || objCC.FONO_3 || objCC.fono_3, objCC.FONO_04 || objCC.fono_04 || objCC.FONO_4 || objCC.fono_4], priorizarCel);
                    while (ccPhones.length < 4) ccPhones.push('');

                    const rutNumerico = String(objCC.RUT || objCC.rut || '').split('-')[0].replace(/\D/g, '');
                    const dispNumerico = String(objCC.DISPONIBLE_COMPRACARTERA || '').replace(/[^0-9.-]/g, '');
                    Object.assign(objCC, {
                        RUT: rutNumerico ? Number(rutNumerico) : '',
                        DISPONIBLE_COMPRACARTERA: dispNumerico !== '' ? Number(dispNumerico) : '',
                        NOMBRE_COMPLETO: formatNombreCompleto(objCC.NOMBRES || objCC.Nombres, objCC.PATERNO || objCC.Paterno, objCC.MATERNO || objCC.Materno),
                        TEL_1: ccPhones[0] ? Number(ccPhones[0]) : 999999999,
                        TEL_2: ccPhones[1] ? Number(ccPhones[1]) : "",
                        TEL_3: ccPhones[2] ? Number(ccPhones[2]) : "",
                        TEL_4: ccPhones[3] ? Number(ccPhones[3]) : "",
                        BASE: baseStr,
                        MES_CARGA: mesCargaStr
                    });
                    processedData.push(objCC);
                });

                // ORDENAMIENTO DE MASIVA
                processedData.sort((a, b) => {
                    let rankA = a.RANKING ? Number(String(a.RANKING).replace(/\D/g, '')) : 999999;
                    let rankB = b.RANKING ? Number(String(b.RANKING).replace(/\D/g, '')) : 999999;
                    if (rankA !== rankB) return rankA - rankB;
                    let dispA = Number(String(a.DISPONIBLE_COMPRACARTERA || "0").replace(/\D/g, ''));
                    let dispB = Number(String(b.DISPONIBLE_COMPRACARTERA || "0").replace(/\D/g, ''));
                    return dispB - dispA;
                });

                const deduplicatedMap = new Map();
                let duplicadosCount = 0;
                processedData.forEach(row => {
                    const r = String(row.RUT || row.rut || "").split('-')[0].replace(/\D/g, '');
                    if (!deduplicatedMap.has(r)) deduplicatedMap.set(r, row);
                    else duplicadosCount++;
                });

                const finalRows = Array.from(deduplicatedMap.values());

                // EXPORTACIÓN LIMPIA
                const { ws, cleanData } = crearSheetLimpio(finalRows);

                setProcessReport({
                    totalLeidos: combinedData.length,
                    totalValidos: cleanData.length,
                    duplicadosRUT: duplicadosCount,
                    excluidos: excluidosCount
                });

                if (cleanData.length === 0) {
                    addToast('No hay registros para exportar.', 'warning');
                    setIsProcessing(false);
                    return;
                }

                const wb = window.XLSX.utils.book_new();
                window.XLSX.utils.book_append_sheet(wb, ws, "Base_CompraCartera");
                window.XLSX.writeFile(wb, `Base_Cencosud_CC.${formatoExportacion}`);

                addToast(`Proceso masivo exitoso: ${cleanData.length} registros.`, 'success');

            } catch (error) {
                addToast('Error en proceso masivo: ' + error.message, 'error');
            } finally { setIsProcessing(false); }
        };

        // ================= LÓGICA MODO REFERIDOS =================
        const handleAddReferido = () => setGridReferidos([...gridReferidos, { RUT: '', NOMBRE_COMPLETO: '', DISPONIBLE_COMPRACARTERA: '', FONO_01: '', FONO_02: '', FONO_03: '', FONO_04: '' }]);
        const handleRemoveReferido = (idx) => { if (gridReferidos.length > 1) setGridReferidos(gridReferidos.filter((_, i) => i !== idx)); };
        const handleGridChange = (idx, field, val) => {
            const newGrid = [...gridReferidos];
            newGrid[idx][field] = val;
            setGridReferidos(newGrid);
        };

        // ================= LÓGICA MODO REFERIDOS DESDE LISTA =================
        const handleProcessRefLista = async () => {
            if (!refInputRuts.trim()) { addToast('Pega al menos un RUT para buscar.', 'error'); return; }
            if (!refListaFile) { addToast('Carga el archivo de la lista de origen.', 'error'); return; }

            setIsProcessing(true);
            try {
                const { baseStr, mesCargaStr } = generarFechasCarga();
                const cleanRutLocal = (str) => { if (!str) return ''; return String(str).toUpperCase().split('-')[0].replace(/[^0-9]/g, ''); };
                const toNumSafe = (val) => { const n = Number(val); return (!isNaN(n) && val !== '' && val !== null) ? n : val; };

                const targetRuts = new Set(refInputRuts.split(/[\n,; \t]+/).map(r => cleanRutLocal(r)).filter(r => r.length >= 6));
                if (targetRuts.size === 0) throw new Error("No hay RUTs válidos.");

                const baseData = await procesarArchivoExtraido(refListaFile);
                const matched = baseData.filter(row => {
                    const rutKey = Object.keys(row).find(k => /^(vendor_lead_code|postal_code|rut|rut_cliente)$/i.test(k));
                    const r = rutKey ? cleanRutLocal(row[rutKey]) : '';
                    return r && targetRuts.has(r);
                });

                if (matched.length === 0) { addToast('No se encontraron coincidencias en la lista.', 'warning'); setIsProcessing(false); return; }

                // Mapeo de monto según origen
                const montoField = {
                    'referido_sae_web': (r) => Number(r.oferta_sae || r.OFERTA_SAE || 0),
                    'referido_sae': (r) => Number(r.oferta_tot || r.OFERTA_TOT || 0),
                    'referido_rdr_web': (r) => Number(r.deuda || r.DEUDA || 0)
                };
                const getMonto = montoField[modo] || (() => 0);

                const exportData = matched.map(row => {
                    // RUT según origen (SAE/RDR usan vendor_lead_code, CC usa postal_code)
                    const rutKey = Object.keys(row).find(k => /^(vendor_lead_code|postal_code|rut|rut_cliente)$/i.test(k));
                    const rCrudo = rutKey ? row[rutKey] : '';
                    const rLimpio = cleanRutLocal(rCrudo);
                    const dv = row.dv || row.DV || calculateDV(rLimpio);

                    // Nombres
                    let nc_fuente = String(row.nom_completo || row.NOMBRE_COMPLETO || '').trim();
                    if (!nc_fuente && (row.first_name || row.last_name)) nc_fuente = `${row.first_name || ''} ${row.last_name || ''}`.trim();
                    const cleanFull = cleanNames(nc_fuente);

                    let nombres = "", paterno = "", materno = "";
                    if (cleanFull) {
                        const parts = cleanFull.split(' ').filter(Boolean);
                        if (parts.length === 1) nombres = parts[0];
                        else if (parts.length === 2) { nombres = parts[0]; paterno = parts[1]; }
                        else if (parts.length === 3) { nombres = parts[0]; paterno = parts[1]; materno = parts[2]; }
                        else if (parts.length >= 4) { materno = parts.pop(); paterno = parts.pop(); nombres = parts.join(' '); }
                    }

                    // Teléfonos
                    const phones = depurarTelefonos([row.phone_number, row.alt_phone, row.address3, row.email], priorizarCel);
                    while (phones.length < 4) phones.push('');

                    return {
                        "RUT": rLimpio ? Number(rLimpio) : "",
                        "DV": dv ? (String(dv).toUpperCase() === 'K' ? 'K' : Number(String(dv).replace(/\D/g, '')) || String(dv).toUpperCase()) : '',
                        "PATERNO": paterno,
                        "MATERNO": materno,
                        "NOMBRES": nombres,
                        "DISPONIBLE_COMPRACARTERA": (() => { const m = Number(String(getMonto(row) || '0').replace(/\D/g, '')); return m > 0 ? m : ""; })(),
                        "FONO_01": phones[0] || "",
                        "FONO_02": phones[1] || "",
                        "FONO_03": phones[2] || "",
                        "FONO_04": phones[3] || "",
                        "CANAL_COMPRA_CARTERA": "REF",
                        "COLOR": "R",
                        "SEGMENTO_2": "REF",
                        "ORDEN_CALL": 1,
                        "RANKING": 1,
                        "TEL_1": phones[0] ? Number(phones[0]) : "",
                        "TEL_2": phones[1] ? Number(phones[1]) : "",
                        "TEL_3": phones[2] ? Number(phones[2]) : "",
                        "TEL_4": phones[3] ? Number(phones[3]) : "",
                        "NOMBRE_COMPLETO": cleanFull,
                        "CAMPANA": "CENCOSUD COMPRA CARTERA",
                        "BASE": `${baseStr}_REF`,
                        "MES_CARGA": mesCargaStr
                    };
                });

                exportData.forEach(row => {
                    if (row.RUT !== "") row.RUT = Number(row.RUT);
                    if (row.DISPONIBLE_COMPRACARTERA !== "") row.DISPONIBLE_COMPRACARTERA = Number(row.DISPONIBLE_COMPRACARTERA);
                });
                const { ws } = crearSheetLimpio(exportData);
                const wb = window.XLSX.utils.book_new();
                window.XLSX.utils.book_append_sheet(wb, ws, "Referidos");
                window.XLSX.writeFile(wb, `Referidos_CC_Lista_${fechaProceso.replace(/-/g, '')}.${formatoExportacion}`);
                addToast(`Referidos desde lista: ${exportData.length} registros exportados.`, 'success');
            } catch (error) { addToast('Error: ' + error.message, 'error'); }
            finally { setIsProcessing(false); }
        };

        const handleProcessReferidos = () => {
            const validRows = gridReferidos.filter(r => r.RUT && String(r.RUT).trim() !== '');
            if (validRows.length === 0) { addToast('Debe ingresar al menos un referido con RUT válido.', 'error'); return; }

            setIsProcessing(true);
            try {
                const { baseStr, mesCargaStr } = generarFechasCarga();

                const exportData = validRows.map(row => {
                    // Extraer RUT y DV
                    const rutLimpio = String(row.RUT).replace(/[^0-9kK]/g, '');
                    const rutSinDv = rutLimpio.slice(0, -1);
                    const dv = rutLimpio.slice(-1).toUpperCase();

                    // Motor de Disgregación de Nombre Completo
                    const cleanFull = cleanNames(row.NOMBRE_COMPLETO);
                    let nombres = "", paterno = "", materno = "";
                    if (cleanFull) {
                        const parts = cleanFull.split(' ').filter(Boolean);
                        if (parts.length === 1) nombres = parts[0];
                        else if (parts.length === 2) { nombres = parts[0]; paterno = parts[1]; }
                        else if (parts.length === 3) { nombres = parts[0]; paterno = parts[1]; materno = parts[2]; }
                        else if (parts.length >= 4) {
                            materno = parts.pop();
                            paterno = parts.pop();
                            nombres = parts.join(' ');
                        }
                    }

                    // Construcción estricta según COLMIN_REF_CC.csv
                    return {
                        "RUT": rutSinDv,
                        "DV": dv,
                        "PATERNO": paterno,
                        "MATERNO": materno,
                        "NOMBRES": nombres,
                        "DISPONIBLE_COMPRACARTERA": String(row.DISPONIBLE_COMPRACARTERA || "").replace(/\D/g, ""),
                        "FONO_01": row.FONO_01 || "",
                        "FONO_02": row.FONO_02 || "",
                        "FONO_03": row.FONO_03 || "",
                        "FONO_04": row.FONO_04 || "",
                        "CANAL_COMPRA_CARTERA": "REF",
                        "COLOR": "R",
                        "SEGMENTO_2": "REF",
                        "ORDEN_CALL": 1,
                        "RANKING": 1,
                        "TEL_1": limpiarTelefono(row.FONO_01) ? Number(limpiarTelefono(row.FONO_01)) : "",
                        "TEL_2": limpiarTelefono(row.FONO_02) ? Number(limpiarTelefono(row.FONO_02)) : "",
                        "TEL_3": limpiarTelefono(row.FONO_03) ? Number(limpiarTelefono(row.FONO_03)) : "",
                        "TEL_4": limpiarTelefono(row.FONO_04) ? Number(limpiarTelefono(row.FONO_04)) : "",
                        "NOMBRE_COMPLETO": cleanFull,
                        "CAMPANA": "CENCOSUD COMPRA CARTERA",
                        "BASE": `${baseStr}_REF`,
                        "MES_CARGA": mesCargaStr
                    };
                });

                // Exportación limpia de referidos
                const { ws } = crearSheetLimpio(exportData);
                const wb = window.XLSX.utils.book_new();
                window.XLSX.utils.book_append_sheet(wb, ws, "Referidos");
                window.XLSX.writeFile(wb, `Referidos_CC_${fechaProceso.replace(/-/g, '')}.${formatoExportacion}`);

                addToast(`Referidos generados exitosamente (${exportData.length} registros).`, 'success');
                setGridReferidos([{ RUT: '', NOMBRE_COMPLETO: '', DISPONIBLE_COMPRACARTERA: '', FONO_01: '', FONO_02: '', FONO_03: '', FONO_04: '' }]);
            } catch (error) { addToast('Error al generar referidos: ' + error.message, 'error'); }
            finally { setIsProcessing(false); }
        };

        return (
            <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full animate-fade-in">
                <div className="border-b border-gray-200 pb-3">
                    <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                        <Icon name="briefcase" className="text-blue-600" />
                        Cencosud CC
                    </h2>
                    <p className="text-gray-500 text-sm mt-1">Extracción masiva, referidos desde lista y captura manual.</p>
                </div>
                {pendientesHojas.length > 0 && (
                    <SelectorHojas
                        pendientes={pendientesHojas}
                        Icon={Icon}
                        onConfirm={(sel) => { setSheetSelections(prev => ({ ...prev, ...sel })); setPendientesHojas([]); }}
                        onCancel={() => setPendientesHojas([])}
                    />
                )}
                <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm flex flex-col gap-4">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">1. Tipo de Carga y Origen</label>
                        <select className="w-full p-2.5 border border-gray-300 rounded-md bg-gray-50 text-sm outline-none focus:border-blue-500 font-medium text-gray-700" value={modo} onChange={(e) => { setModo(e.target.value); setBaseFiles([]); setRefInputRuts(''); setRefListaFile(null); setProcessReport(null); }}>
                            <option value="masivo">Carga Masiva (Múltiples Archivos)</option>
                            <option value="referido_sae_web">Referidos: CENCOSUD SAE WEB</option>
                            <option value="referido_sae">Referidos: CENCOSUD SAE</option>
                            <option value="referido_rdr_web">Referidos: CENCOSUD RDR WEB</option>
                            <option value="manual">Ingreso Manual (Referidos)</option>
                        </select>
                    </div>

                    {modo === 'masivo' && (
                        <div className="border-2 border-dashed border-blue-300 rounded-lg p-8 text-center bg-blue-50 hover:bg-blue-100 transition-colors relative animate-fade-in">
                            <input type="file" multiple accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={(e) => setBaseFiles(Array.from(e.target.files))} />
                            <Icon name="upload-cloud" size={32} className="mx-auto text-blue-500 mb-2" />
                            <p className="text-sm font-medium text-blue-800">{baseFiles.length > 0 ? `${baseFiles.length} archivo(s) listo(s)` : 'Haz clic o arrastra los archivos aquí'}</p>
                        </div>
                    )}
                    {['referido_sae_web', 'referido_sae', 'referido_rdr_web'].includes(modo) && (
                        <div className="flex flex-col gap-4 animate-fade-in">
                            <div className="border border-purple-200 rounded-lg p-4 bg-purple-50">
                                <label className="block text-sm font-bold text-purple-800 mb-2">Pega los RUTs a buscar:</label>
                                <textarea className="w-full h-24 p-3 border border-purple-300 rounded focus:border-purple-500 outline-none text-sm font-mono resize-none bg-white" placeholder="Ej: 12345678" value={refInputRuts} onChange={(e) => setRefInputRuts(e.target.value)}></textarea>
                            </div>
                            <div className="border-2 border-dashed border-purple-300 rounded-lg p-6 text-center bg-white hover:bg-purple-50 transition-colors cursor-pointer relative">
                                <input type="file" accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onChange={(e) => setRefListaFile(e.target.files[0])} />
                                <Icon name="file-search" size={24} className="mx-auto text-purple-500 mb-2" />
                                <p className="text-sm font-medium text-purple-800">
                                    {refListaFile ? <span className="font-bold">Archivo base listo: {refListaFile.name}</span> : 'Sube el archivo de donde se extraerán estos referidos'}
                                </p>
                            </div>
                        </div>
                    )}
                    {modo === 'manual' && (
                        <div className="bg-white rounded-lg border border-indigo-200 shadow-sm overflow-hidden animate-fade-in">
                            <div className="bg-indigo-50 p-4 border-b border-indigo-100 flex justify-between items-center">
                                <h3 className="font-bold text-indigo-800 text-sm flex items-center gap-2">
                                    <Icon name="edit-3" size={16} /> Captura Manual de Referidos
                                </h3>
                                <div className="flex gap-2">
                                    <button onClick={() => setShowExtraFonos(!showExtraFonos)} className="text-xs bg-white text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded hover:bg-indigo-50 flex items-center gap-1 font-bold">
                                        <Icon name={showExtraFonos ? "chevron-up" : "chevron-down"} size={14} />
                                        {showExtraFonos ? "Ocultar Fonos" : "Añadir + Fonos"}
                                    </button>
                                    <button onClick={handleAddReferido} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700 flex items-center gap-1 font-bold shadow-sm">
                                        <Icon name="plus" size={14} /> Fila
                                    </button>
                                </div>
                            </div>
                            <div className="overflow-x-auto p-4">
                                <table className="w-full text-left text-sm whitespace-nowrap">
                                    <thead>
                                        <tr className="text-gray-500 border-b border-gray-200 uppercase text-xs">
                                            <th className="pb-2 font-bold px-2 w-32">RUT</th>
                                            <th className="pb-2 font-bold px-2">NOMBRE COMPLETO</th>
                                            <th className="pb-2 font-bold px-2 w-32">DISPONIBLE</th>
                                            <th className="pb-2 font-bold px-2 w-32">FONO 01</th>
                                            {showExtraFonos && (
                                                <>
                                                    <th className="pb-2 font-bold px-2 w-32 text-gray-400">FONO 02</th>
                                                    <th className="pb-2 font-bold px-2 w-32 text-gray-400">FONO 03</th>
                                                    <th className="pb-2 font-bold px-2 w-32 text-gray-400">FONO 04</th>
                                                </>
                                            )}
                                            <th className="pb-2 font-bold px-2 w-10 text-center">X</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {gridReferidos.map((row, idx) => (
                                            <tr key={idx} className="border-b border-gray-100 hover:bg-indigo-50/30 transition-colors">
                                                <td className="p-2"><input type="text" className="w-full p-2 border border-gray-300 rounded text-sm outline-none focus:border-indigo-500" placeholder="Ej: 12345678-9" value={row.RUT} onChange={(e) => handleGridChange(idx, 'RUT', e.target.value)} /></td>
                                                <td className="p-2"><input type="text" className="w-full p-2 border border-gray-300 rounded text-sm outline-none focus:border-indigo-500" placeholder="Ej: Juan Perez Garcia" value={row.NOMBRE_COMPLETO} onChange={(e) => handleGridChange(idx, 'NOMBRE_COMPLETO', e.target.value)} /></td>
                                                <td className="p-2"><input type="text" className="w-full p-2 border border-gray-300 rounded text-sm outline-none focus:border-indigo-500" placeholder="Ej: 5000000" value={row.DISPONIBLE_COMPRACARTERA} onChange={(e) => handleGridChange(idx, 'DISPONIBLE_COMPRACARTERA', e.target.value)} /></td>
                                                <td className="p-2"><input type="text" className="w-full p-2 border border-gray-300 rounded text-sm outline-none focus:border-indigo-500" placeholder="Obligatorio" value={row.FONO_01} onChange={(e) => handleGridChange(idx, 'FONO_01', e.target.value)} /></td>
                                                {showExtraFonos && (
                                                    <>
                                                        <td className="p-2"><input type="text" className="w-full p-2 border border-gray-200 bg-gray-50 rounded text-sm outline-none focus:border-indigo-500 focus:bg-white" placeholder="Opcional" value={row.FONO_02} onChange={(e) => handleGridChange(idx, 'FONO_02', e.target.value)} /></td>
                                                        <td className="p-2"><input type="text" className="w-full p-2 border border-gray-200 bg-gray-50 rounded text-sm outline-none focus:border-indigo-500 focus:bg-white" placeholder="Opcional" value={row.FONO_03} onChange={(e) => handleGridChange(idx, 'FONO_03', e.target.value)} /></td>
                                                        <td className="p-2"><input type="text" className="w-full p-2 border border-gray-200 bg-gray-50 rounded text-sm outline-none focus:border-indigo-500 focus:bg-white" placeholder="Opcional" value={row.FONO_04} onChange={(e) => handleGridChange(idx, 'FONO_04', e.target.value)} /></td>
                                                    </>
                                                )}
                                                <td className="p-2 text-center">
                                                    <button onClick={() => handleRemoveReferido(idx)} className="text-gray-400 hover:text-red-500 p-1 rounded transition-colors" title="Eliminar fila"><Icon name="trash-2" size={16} /></button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>

                {modo === 'masivo' && (
                    <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <label className="text-sm font-bold text-gray-700">2. Lista Vigente (Cruce y Exclusión)</label>
                            <label className="flex items-center cursor-pointer">
                                <div className="relative">
                                    <input type="checkbox" className="sr-only" checked={usarCruce} onChange={() => setUsarCruce(!usarCruce)} />
                                    <div className={`block w-10 h-6 rounded-full transition-colors ${usarCruce ? 'bg-blue-600' : 'bg-gray-300'}`}></div>
                                    <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${usarCruce ? 'transform translate-x-4' : ''}`}></div>
                                </div>
                                <div className="ml-3 text-sm font-medium text-gray-600">{usarCruce ? 'Activado' : 'Desactivado'}</div>
                            </label>
                        </div>
                        {usarCruce && (
                            <div className="flex flex-col gap-2 mt-2 animate-fade-in">
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <button type="button" onClick={() => { setCruceSqlMode(false); setCruceSqlData(null); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #6366f1', background: !cruceSqlMode ? '#6366f1' : 'white', color: !cruceSqlMode ? 'white' : '#6366f1', cursor: 'pointer' }}>📂 Archivo</button>
                                    <button type="button" onClick={() => { setCruceSqlMode(true); setCruceFile(null); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #3b82f6', background: cruceSqlMode ? '#3b82f6' : 'white', color: cruceSqlMode ? 'white' : '#3b82f6', cursor: 'pointer' }}>⚡ SQL</button>
                                </div>
                                {!cruceSqlMode ? (
                                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center bg-gray-50 relative">
                                        <input type="file" accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={(e) => setCruceFile(e.target.files[0])} />
                                        <Icon name="file-search" size={24} className="mx-auto text-gray-400 mb-2" />
                                        <p className="text-sm font-medium text-gray-600">{cruceFile ? <span className="text-emerald-600 font-bold">{cruceFile.name}</span> : 'Cargar rutero para excluir'}</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        <textarea style={{ width: '100%', minHeight: '80px', padding: '0.5rem', border: '2px solid #3b82f6', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical', boxSizing: 'border-box' }} value={cruceSqlQuery} onChange={e => setCruceSqlQuery(e.target.value)} placeholder="SELECT RUT FROM tabla WHERE..." />
                                        <button type="button" style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.8rem', background: '#3b82f6', color: 'white', border: 'none', cursor: 'pointer', alignSelf: 'flex-start' }} onClick={async () => {
                                            if (!cruceSqlQuery.trim()) return;
                                            const r = await window.nexusAPI.executeSQL(cruceSqlQuery);
                                            if (!r.success) { addToast('Error SQL: ' + r.error, 'error'); return; }
                                            setCruceSqlData(r.data);
                                            addToast(`${r.data.length} registros cargados desde SQL.`, 'success');
                                        }}>⚡ Ejecutar</button>
                                        {cruceSqlData && <p className="text-xs text-emerald-600 font-bold">✓ {cruceSqlData.length} registros cargados desde SQL</p>}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* CONTROLES INFERIORES COMPARTIDOS */}
                <div className="flex flex-col md:flex-row items-center justify-between bg-gray-50 p-4 rounded-lg border border-gray-200 gap-4 mt-2">
                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <label className="text-sm font-bold text-gray-700 whitespace-nowrap">Fecha de Proceso:</label>
                        <input type="date" className="p-2 border border-gray-300 rounded bg-white text-sm outline-none focus:border-blue-500 font-medium shadow-sm" value={fechaProceso} onChange={(e) => setFechaProceso(e.target.value)} />

                        <label className="text-sm font-bold text-gray-700 whitespace-nowrap ml-2">Salida:</label>
                        <select className="p-2 border border-gray-300 rounded bg-white text-sm outline-none focus:border-blue-500 font-medium shadow-sm" value={formatoExportacion} onChange={(e) => setFormatoExportacion(e.target.value)}>
                            <option value="xlsx">Excel Moderno (.xlsx)</option>
                            <option value="csv">Plano Comas (.csv)</option>
                        </select>
                        <div className="flex items-center gap-2 ml-4">
                            <div className={`w-10 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-colors ${priorizarCel ? 'bg-blue-600' : 'bg-gray-300'}`} onClick={() => setPriorizarCel(!priorizarCel)}>
                                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${priorizarCel ? 'translate-x-5' : ''}`}></div>
                            </div>
                            <span className="text-xs font-bold text-gray-600 whitespace-nowrap">Priorizar Cel.</span>
                        </div>
                    </div>

                    <button
                        className={`w-full md:w-auto px-8 py-3 rounded-lg font-bold text-white shadow-md transition-all flex items-center justify-center gap-2 ${isProcessing || (modo === 'masivo' && (baseFiles.length === 0 || (usarCruce && !cruceFile && !cruceSqlData)))
                            ? 'bg-gray-400 cursor-not-allowed opacity-70'
                            : 'bg-emerald-600 hover:bg-emerald-700 hover:scale-[1.02]'
                            }`}
                        disabled={isProcessing || (modo === 'masivo' && (baseFiles.length === 0 || (usarCruce && !cruceFile && !cruceSqlData)))}
                        onClick={modo === 'masivo' ? handleProcessMasivo : modo === 'manual' ? handleProcessReferidos : handleProcessRefLista}
                    >
                        {isProcessing ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Icon name={modo === 'masivo' ? "play-circle" : "save"} size={20} />}
                        {isProcessing ? 'Procesando...' : (modo === 'masivo' ? 'Ejecutar Carga Masiva' : modo === 'manual' ? 'Generar Referidos' : 'Extraer Referidos de Lista')}
                    </button>
                </div>

                {/* REPORTE DE MASIVA */}
                {processReport && modo === 'masivo' && (
                    <div className="bg-white p-5 rounded-lg border border-emerald-200 shadow-sm mt-2 animate-fade-in border-l-4 border-l-emerald-500">
                        <h3 className="text-lg font-bold text-emerald-800 mb-3 flex items-center gap-2"><Icon name="check-circle" className="text-emerald-600" /> Reporte de Procesamiento</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                            <div className="bg-gray-50 p-3 rounded border border-gray-200"><div className="text-2xl font-black text-gray-700">{processReport.totalLeidos}</div><div className="text-xs text-gray-500 uppercase font-bold">Leídos</div></div>
                            <div className="bg-blue-50 p-3 rounded border border-blue-200"><div className="text-2xl font-black text-blue-700">{processReport.totalValidos}</div><div className="text-xs text-blue-500 uppercase font-bold">Cargados</div></div>
                            <div className="bg-amber-50 p-3 rounded border border-amber-200"><div className="text-2xl font-black text-amber-700">{processReport.duplicadosRUT}</div><div className="text-xs text-amber-500 uppercase font-bold">Duplicados</div></div>
                            <div className="bg-purple-50 p-3 rounded border border-purple-200"><div className="text-2xl font-black text-purple-700">{processReport.excluidos}</div><div className="text-xs text-purple-500 uppercase font-bold">Excluidos</div></div>
                        </div>
                    </div>
                )}
            </div>
        );
    };


    // ========================================================================
    // ⬇️ PEGAR AQUÍ ABAJO EL CÓDIGO DE LA SIGUIENTE TAREA ⬇️
    // ========================================================================


    // ==========================================
    // TAREA 5: Altas/Bajas - Sernac (Cencosud)
    // ==========================================

    // --- UTILS COMPARTIDOS TAREA 5 ---
    const t5_cleanPhone = (p) => {
        if (!p) return "";
        let s = String(p).replace(/\D/g, "");
        if (s.startsWith("56") && s.length === 11) s = s.substring(2);
        if (s.length === 8) s = "9" + s;
        return s.length >= 9 ? s.slice(-9) : "";
    };
    const t5_cleanRut = (rut) => {
        if (!rut) return "";
        return String(rut).split('-')[0].replace(/\D/g, '');
    };
    const t5_chunkArray = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));
    const t5_procesarArchivo = async (file, sheetName) => {
        const result = await leerExcelConHojas(file, sheetName || null);
        if (result.multiSheet) {
            throw new Error(`MULTI_SHEET:${file.name}:${result.sheetNames.join(',')}`);
        }
        return result.data;
    };
    const t5_downloadTxt = (content, filename) => {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = filename;
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    };
    const t5_copyToClipboard = async (text, setMsg) => {
        try {
            await navigator.clipboard.writeText(text);
            if (setMsg) setMsg({ type: 'success', text: '¡Copiado al portapapeles exitosamente!' });
        } catch (err) {
            if (setMsg) setMsg({ type: 'error', text: 'Error al copiar la información.' });
        }
    };

    // --- SUB-COMPONENTE 1: SERNAC (AHORA INDEPENDIENTE Y PERSISTENTE) ---
    const PanelSernac = ({ isOpen, onToggle, globalTrigger, Icon }) => {
        const [clientFiles, setClientFiles] = useState([]);
        const [dncFiles, setDncFiles] = useState([]);
        const [mode, setMode] = useState('dncl');
        const [isProcessing, setIsProcessing] = useState(false);
        const [results, setResults] = useState(null);
        const [panelMessage, setPanelMessage] = useState({ type: '', text: '' });
        const [pendientesHojas, setPendientesHojas] = useState([]);
        const [sheetSelections, setSheetSelections] = useState({});

        useEffect(() => {
            if (globalTrigger > 0 && clientFiles.length > 0 && dncFiles.length > 0 && !isProcessing) handleProcess();
        }, [globalTrigger]);

        const handleProcess = async () => {
            setPanelMessage({ type: '', text: '' });
            setResults(null);

            if (clientFiles.length === 0 || dncFiles.length === 0) {
                setPanelMessage({ type: 'error', text: 'Faltan archivos. Debes cargar al menos un archivo del Cliente y uno de la Base.' });
                return;
            }
            setIsProcessing(true);
            try {
                // --- 0. DETECCIÓN DE HOJAS MÚLTIPLES ---
                const allFiles = [...clientFiles, ...dncFiles];
                const pendientes = [];
                for (const f of allFiles) {
                    if (f.name.toLowerCase().endsWith('.csv') || f.name.toLowerCase().endsWith('.txt')) continue;
                    if (sheetSelections[f.name]) continue;
                    try {
                        const result = await leerExcelConHojas(f);
                        if (result.multiSheet) pendientes.push({ name: f.name, sheetNames: result.sheetNames });
                    } catch (e) { /* se manejará después */ }
                }
                if (pendientes.length > 0) {
                    setPendientesHojas(pendientes);
                    setIsProcessing(false);
                    return;
                }

                const findPhoneKey = (row) => {
                    const keys = Object.keys(row);
                    let key = keys.find(k => /tel|phone|fono|cel|movil|num|nro|contacto/i.test(k));
                    if (!key) {
                        key = keys.find(k => {
                            const digits = String(k).replace(/\D/g, '');
                            return digits.length >= 8 && digits.length <= 12;
                        });
                    }
                    return key;
                };

                let rawClient = [];
                for (let f of clientFiles) { const r = await t5_procesarArchivo(f, sheetSelections[f.name]); if (Array.isArray(r)) rawClient = rawClient.concat(r); }

                const clientPhones = new Set();
                let clientColDetected = false;
                rawClient.forEach(row => {
                    const phoneKey = findPhoneKey(row);
                    if (phoneKey) {
                        clientColDetected = true;
                        if (/^\d{8,12}$/.test(String(phoneKey).replace(/\D/g, ''))) {
                            const headerPhone = t5_cleanPhone(phoneKey);
                            if (headerPhone) clientPhones.add(headerPhone);
                        }
                        const p = t5_cleanPhone(row[phoneKey]);
                        if (p) clientPhones.add(p);
                    }
                });

                if (!clientColDetected || clientPhones.size === 0) {
                    setPanelMessage({ type: 'error', text: 'No se detectaron teléfonos en el archivo del CLIENTE. Revisa que tenga una columna válida (Ej: Fono, Numero, Movil) o que contenga números válidos.' });
                    setIsProcessing(false); return;
                }

                if (mode === 'dncl') {
                    let dnclPhones = new Set();
                    let dncColDetected = false;

                    for (let f of dncFiles) {
                        const dncData = await t5_procesarArchivo(f, sheetSelections[f.name]);
                        dncData.forEach(row => {
                            const phoneKey = findPhoneKey(row);
                            if (phoneKey) {
                                dncColDetected = true;
                                if (/^\d{8,12}$/.test(String(phoneKey).replace(/\D/g, ''))) {
                                    const headerPhone = t5_cleanPhone(phoneKey);
                                    if (headerPhone) dnclPhones.add(headerPhone);
                                }
                                const p = t5_cleanPhone(row[phoneKey]);
                                if (p) dnclPhones.add(p);
                            }
                        });
                    }

                    if (!dncColDetected && dncFiles.some(f => f.size > 0)) {
                        setPanelMessage({ type: 'error', text: 'No se detectaron teléfonos en la lista DNCL. Revisa la estructura de tu archivo.' });
                        setIsProcessing(false); return;
                    }

                    const newPhones = Array.from(clientPhones).filter(p => !dnclPhones.has(p));
                    setResults({ type: 'dncl', data: newPhones });
                    setPanelMessage({ type: 'success', text: `Cruce exitoso. Se procesaron ${clientPhones.size} teléfonos del cliente.` });
                } else {
                    let matchData = [];
                    for (let f of dncFiles) {
                        const baseData = await t5_procesarArchivo(f, sheetSelections[f.name]);
                        baseData.forEach(row => {
                            const idKey = Object.keys(row).find(k => /rut|indice|row_id|ddas_nrt_ppal/i.test(k)) || "ID_NO_ENCONTRADO";
                            const idVal = row[idKey] || "";
                            const phoneKeys = Object.keys(row).filter(k => /tel|fono|cel|movil|num|nro/i.test(k));
                            phoneKeys.forEach(pk => {
                                const p = t5_cleanPhone(row[pk]);
                                if (p && clientPhones.has(p)) {
                                    matchData.push({ TELEFONO: p, COLUMNA_ORIGEN: pk, IDENTIFICADOR: idVal, CAMPO_ID: idKey });
                                }
                            });
                        });
                    }

                    const uniqueMatches = Array.from(new Map(matchData.map(item => [`${item.TELEFONO}-${item.COLUMNA_ORIGEN}`, item])).values());
                    setResults({ type: 'resultante', data: uniqueMatches });
                    setPanelMessage({ type: 'success', text: `Cruce exitoso. Análisis de Base Resultante completado.` });
                }
            } catch (error) {
                setPanelMessage({ type: 'error', text: 'Error procesando archivos: ' + error.message });
            }
            finally { setIsProcessing(false); }
        };

        const exportExcel = () => {
            if (!results) return;
            const ws = window.XLSX.utils.json_to_sheet(results.data);
            const wb = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(wb, ws, "Cruces_Sernac");
            window.XLSX.writeFile(wb, `Sernac_Cruces_Base.xlsx`);
        };

        return (
            <div className="border border-gray-200 rounded-lg bg-white overflow-hidden mb-4 shadow-sm">
                <div className="bg-slate-800 p-4 flex justify-between items-center cursor-pointer" onClick={onToggle}>
                    <h3 className="font-bold text-white flex items-center gap-2"><Icon name="phone-off" size={18} /> SERNAC (Listas Negras)</h3>
                    <Icon name={isOpen ? "chevron-up" : "chevron-down"} className="text-slate-300" size={20} />
                </div>
                <div className={isOpen ? "p-5 animate-fade-in flex flex-col gap-5" : "hidden"}>
                    <div className="flex bg-gray-100 p-1 rounded-lg w-fit mx-auto border border-gray-200">
                        <button type="button" onClick={() => { setMode('dncl'); setResults(null); setPanelMessage({ type: '', text: '' }); }} className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${mode === 'dncl' ? 'bg-white shadow text-slate-800' : 'text-gray-500 hover:text-gray-700'}`}>Cruce vs DNCL (Vicidial)</button>
                        <button type="button" onClick={() => { setMode('resultante'); setResults(null); setPanelMessage({ type: '', text: '' }); }} className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${mode === 'resultante' ? 'bg-white shadow text-slate-800' : 'text-gray-500 hover:text-gray-700'}`}>Cruce vs Base Resultante</button>
                    </div>

                    {pendientesHojas.length > 0 && (
                        <SelectorHojas
                            pendientes={pendientesHojas}
                            Icon={Icon}
                            onConfirm={(sel) => { setSheetSelections(prev => ({ ...prev, ...sel })); setPendientesHojas([]); }}
                            onCancel={() => setPendientesHojas([])}
                        />
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="border-2 border-dashed border-red-200 bg-red-50 p-6 rounded-lg text-center relative flex flex-col justify-center">
                            <input type="file" multiple accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={(e) => setClientFiles(Array.from(e.target.files))} />
                            <Icon name="file-warning" size={24} className="mx-auto text-red-400 mb-2" />
                            <h4 className="font-bold text-red-800 text-sm">Archivos Cliente (Sernac)</h4>
                            <p className="text-xs text-red-600 mt-1">{clientFiles.length > 0 ? `${clientFiles.length} archivos cargados` : 'Arrastrar archivos aquí'}</p>
                        </div>
                        <div className="border-2 border-dashed border-slate-300 bg-slate-50 p-6 rounded-lg text-center relative flex flex-col justify-center">
                            <input type="file" multiple accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={(e) => setDncFiles(Array.from(e.target.files))} />
                            <Icon name="database" size={24} className="mx-auto text-slate-400 mb-2" />
                            <h4 className="font-bold text-slate-700 text-sm">{mode === 'dncl' ? 'Lista Actual DNCL' : 'Bases Resultantes'}</h4>
                            <p className="text-xs text-slate-500 mt-1">{dncFiles.length > 0 ? `${dncFiles.length} archivos cargados` : 'Arrastrar archivos aquí'}</p>
                        </div>
                    </div>

                    {panelMessage.text && (
                        <div className={`p-3 rounded-lg border text-sm font-bold flex items-center gap-2 ${panelMessage.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                            <Icon name={panelMessage.type === 'error' ? 'alert-triangle' : 'check-circle'} size={18} />
                            {panelMessage.text}
                        </div>
                    )}

                    <button type="button" onClick={(e) => { e.preventDefault(); handleProcess(); }} disabled={isProcessing || clientFiles.length === 0 || dncFiles.length === 0} className={`w-full py-3 rounded-lg font-bold text-white flex justify-center items-center gap-2 ${isProcessing || clientFiles.length === 0 || dncFiles.length === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-slate-800 hover:bg-slate-900'}`}>
                        {isProcessing ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Icon name="play" size={18} />}
                        Procesar Cruce Sernac
                    </button>

                    {results && results.type === 'dncl' && (
                        <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg mt-2">
                            <h4 className="font-bold text-slate-800 mb-2">Resultados: {results.data.length} Números Nuevos</h4>
                            {results.data.length === 0 ? (
                                <p className="text-sm font-bold text-slate-600 bg-white p-3 rounded border border-slate-200 text-center shadow-sm">NO SE HAN ENCONTRADO TELÉFONOS NUEVOS. NADA QUE AGREGAR.</p>
                            ) : (
                                <>
                                    <p className="text-xs text-slate-600 mb-2 font-bold">COPIA ESTOS NÚMEROS Y CÁRGALOS EN LA LISTA DNCL EN VICIDIAL<br /><span className="font-normal">RUTA: Listas / Agregar Números DNC / Sección "Números de Teléfono"</span></p>
                                    {results.data.length <= 10000 ? (
                                        <div className="relative">
                                            <textarea readOnly className="w-full h-48 p-3 text-sm font-mono border border-slate-300 rounded outline-none bg-white shadow-inner" value={results.data.join('\n')} />
                                            <CopyButton text={results.data.join('\n')} label="Copiar" style="dark" className="absolute top-3 right-3" onSuccess={() => setPanelMessage({ type: 'success', text: '¡Copiado al portapapeles exitosamente!' })} onError={() => setPanelMessage({ type: 'error', text: 'Error al copiar la información.' })} />
                                        </div>
                                    ) : (
                                        <div className="bg-white p-5 border border-slate-300 rounded text-center shadow-sm">
                                            <Icon name="file-text" size={32} className="mx-auto text-slate-400 mb-2" />
                                            <p className="text-sm text-slate-700 mb-3 font-medium">Se encontraron {results.data.length} registros. Al superar los 10,000, descarga el archivo para no congelar la interfaz.</p>
                                            <button type="button" onClick={(e) => { e.preventDefault(); t5_downloadTxt(results.data.join('\n'), 'Nuevos_Sernac_DNCL.txt'); }} className="bg-slate-800 text-white px-5 py-2.5 rounded font-bold text-sm hover:bg-slate-900 inline-flex items-center gap-2 shadow-md"><Icon name="download" size={16} /> Descargar Archivo TXT</button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {results && results.type === 'resultante' && (
                        <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg flex justify-between items-center mt-2 shadow-sm">
                            <div>
                                <h4 className="font-bold text-blue-800">Cruce Completado</h4>
                                <p className="text-sm text-blue-700 font-medium">Se aislaron {results.data.length} coincidencias en las bases resultantes.</p>
                            </div>
                            <button type="button" onClick={(e) => { e.preventDefault(); exportExcel(); }} className="bg-blue-600 text-white px-5 py-2.5 rounded font-bold text-sm hover:bg-blue-700 inline-flex items-center gap-2 shadow-md"><Icon name="file-spreadsheet" size={16} /> Exportar Excel</button>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // --- SUB-COMPONENTE 2: ALTAS/BAJAS (AHORA INDEPENDIENTE Y PERSISTENTE) ---
    const PanelAltasBajas = ({ title, type, isOpen, onToggle, globalTrigger, Icon }) => {
        const [clientFiles, setClientFiles] = useState([]);
        const [crmFiles, setCrmFiles] = useState([]);
        const [crmType, setCrmType] = useState('vicidial');
        const [isProcessing, setIsProcessing] = useState(false);
        const [results, setResults] = useState(null);
        const [panelMessage, setPanelMessage] = useState({ type: '', text: '' });
        const [pendientesHojas, setPendientesHojas] = useState([]);
        const [sheetSelections, setSheetSelections] = useState({});

        useEffect(() => {
            if (globalTrigger > 0 && clientFiles.length > 0 && crmFiles.length > 0 && !isProcessing) handleProcess();
        }, [globalTrigger]);

        const getTableConfig = () => {
            switch (type) {
                case 'RDR': return { vocalTable: 'CustomerVtec..CLIENTE_CENCOSUD_REPACTACION_WEB', viciMatch: ['vendor_lead_code', 'rut'], prevails: 'ALTA' };
                case 'SAE': return { vocalTable: 'CustomerVtec..CENCOSUD_SAE', viciMatch: ['vendor_lead_code', 'rut'], prevails: 'BAJA' };
                case 'CC': return { vocalTable: 'CustomerCencosud..CENCOSUD_COMPRA_CARTERA', viciMatch: ['postal_code'], prevails: 'BAJA' };
                default: return {};
            }
        };

        const handleProcess = async () => {
            setPanelMessage({ type: '', text: '' });
            setResults(null);

            if (clientFiles.length === 0 || crmFiles.length === 0) {
                setPanelMessage({ type: 'error', text: 'Faltan archivos para procesar. Debes cargar el archivo del cliente y la base vigente.' });
                return;
            }

            setIsProcessing(true);
            try {
                // --- 0. DETECCIÓN DE HOJAS MÚLTIPLES ---
                const allFiles = [...clientFiles, ...crmFiles];
                const pendientes = [];
                for (const f of allFiles) {
                    if (f.name.toLowerCase().endsWith('.csv') || f.name.toLowerCase().endsWith('.txt')) continue;
                    if (sheetSelections[f.name]) continue;
                    try {
                        const result = await leerExcelConHojas(f);
                        if (result.multiSheet) pendientes.push({ name: f.name, sheetNames: result.sheetNames });
                    } catch (e) { /* se manejará después */ }
                }
                if (pendientes.length > 0) {
                    setPendientesHojas(pendientes);
                    setIsProcessing(false);
                    return;
                }

                const config = getTableConfig();

                const rutStates = new Map();
                let clienteHeadersDetected = false;

                for (let f of clientFiles) {
                    const data = await t5_procesarArchivo(f, sheetSelections[f.name]);
                    data.forEach(row => {
                        const rKey = Object.keys(row).find(k => /rut/i.test(k));
                        const eKey = Object.keys(row).find(k => /estado|status/i.test(k));

                        if (rKey && eKey) {
                            clienteHeadersDetected = true;
                            if (row[rKey] && row[eKey]) {
                                const rutClean = t5_cleanRut(row[rKey]);
                                const est = String(row[eKey]).toUpperCase().trim();

                                if (!rutStates.has(rutClean)) rutStates.set(rutClean, est);
                                else {
                                    if (config.prevails === 'ALTA' && est === 'ALTA') rutStates.set(rutClean, 'ALTA');
                                    if (config.prevails === 'BAJA' && est === 'BAJA') rutStates.set(rutClean, 'BAJA');
                                }
                            }
                        }
                    });
                }

                if (!clienteHeadersDetected) {
                    setPanelMessage({ type: 'error', text: 'No se detectaron las columnas RUT y ESTADO en el archivo del cliente.' });
                    setIsProcessing(false); return;
                }

                const bajasReales = new Set();
                rutStates.forEach((estado, rut) => { if (estado === 'BAJA') bajasReales.add(rut); });
                if (bajasReales.size === 0) {
                    setPanelMessage({ type: 'warning', text: 'No se detectaron "BAJAS" reales en el archivo del cliente.' });
                    setIsProcessing(false); return;
                }

                let queryOutput = "";
                let totalMatches = 0;
                let crmHeadersDetected = false;

                if (crmType === 'vicidial') {
                    const listIdMap = {};
                    for (let f of crmFiles) {
                        const crmData = await t5_procesarArchivo(f, sheetSelections[f.name]);
                        crmData.forEach(row => {
                            let matchVal = "";
                            for (let key of config.viciMatch) {
                                const foundKey = Object.keys(row).find(k => k.toLowerCase() === key.toLowerCase());
                                if (foundKey && row[foundKey]) { matchVal = t5_cleanRut(row[foundKey]); break; }
                            }

                            const leadKey = Object.keys(row).find(k => /lead_id/i.test(k));
                            const listKey = Object.keys(row).find(k => /list_id/i.test(k));

                            if (leadKey && listKey) crmHeadersDetected = true;

                            if (matchVal && bajasReales.has(matchVal)) {
                                const lead = leadKey ? row[leadKey] : null;
                                const list = listKey ? row[listKey] : null;
                                if (lead && list) {
                                    if (!listIdMap[list]) listIdMap[list] = [];
                                    listIdMap[list].push(lead);
                                    totalMatches++;
                                }
                            }
                        });
                    }

                    if (!crmHeadersDetected) {
                        setPanelMessage({ type: 'error', text: 'No se detectaron las columnas "lead_id" o "list_id" en la base vigente (Vicidial).' });
                        setIsProcessing(false); return;
                    }

                    let qArray = [];
                    qArray.push(`-- IMPORTANTE: Ejecute estas querys en MySQL (Vicidial).`);
                    qArray.push(`-- Recuerde que la linea "and bajas not in ('1')" debe estar en los filtros de la lista.\n`);
                    Object.keys(listIdMap).forEach(list_id => {
                        qArray.push(`-- Reseteo e Inserción para Lista ${list_id}`);
                        qArray.push(`UPDATE custom_${list_id} SET bajas=0 WHERE lead_id >= 0;`);
                        const chunks = t5_chunkArray(listIdMap[list_id], 1000);
                        chunks.forEach(chunk => { qArray.push(`UPDATE custom_${list_id} SET bajas=1 WHERE lead_id IN (${chunk.join(',')});`); });
                        qArray.push("");
                    });
                    queryOutput = qArray.join('\n');

                } else { // Vocalcom
                    const indices = [];
                    for (let f of crmFiles) {
                        const crmData = await t5_procesarArchivo(f, sheetSelections[f.name]);
                        crmData.forEach(row => {
                            const rKey = Object.keys(row).find(k => /rut/i.test(k));
                            const iKey = Object.keys(row).find(k => /indice/i.test(k));

                            if (rKey && iKey) {
                                crmHeadersDetected = true;
                                if (row[rKey] && row[iKey] && bajasReales.has(t5_cleanRut(row[rKey]))) {
                                    indices.push(row[iKey]);
                                    totalMatches++;
                                }
                            }
                        });
                    }

                    if (!crmHeadersDetected) {
                        setPanelMessage({ type: 'error', text: 'No se detectaron las columnas RUT e INDICE en la base Resultante (Vocalcom).' });
                        setIsProcessing(false); return;
                    }

                    let qArray = [];
                    qArray.push(`-- IMPORTANTE: Ejecute estas querys en T-SQL (Vocalcom).`);
                    qArray.push(`-- Recuerde excluir BAJAS=0 de la campaña respectiva.\n`);
                    qArray.push(`-- Reseteo e Inserción Masiva Vocalcom (${type})`);
                    qArray.push(`UPDATE ${config.vocalTable} SET BAJAS=0;`);

                    const chunks = t5_chunkArray(indices, 1000);
                    chunks.forEach(chunk => {
                        const wrappedChunk = chunk.map(i => `'${String(i).trim()}'`).join(',');
                        qArray.push(`UPDATE ${config.vocalTable} SET BAJAS=1 WHERE INDICE IN (${wrappedChunk});`);
                    });
                    queryOutput = qArray.join('\n');
                }

                if (totalMatches === 0) {
                    setPanelMessage({ type: 'warning', text: 'El cruce finalizó, pero no se encontraron coincidencias de bajas en la base vigente.' });
                } else {
                    setPanelMessage({ type: 'success', text: `Proceso exitoso: Se cruzaron y generaron querys para ${totalMatches} bajas.` });
                    setResults({ matches: totalMatches, query: queryOutput });
                }

            } catch (error) {
                setPanelMessage({ type: 'error', text: 'Error procesando archivos: ' + error.message });
            }
            finally { setIsProcessing(false); }
        };

        const bgHeader = type === 'RDR' ? 'bg-indigo-800' : type === 'SAE' ? 'bg-sky-800' : 'bg-emerald-800';
        return (
            <div className="border border-gray-200 rounded-lg bg-white overflow-hidden mb-4 shadow-sm">
                <div className={`${bgHeader} p-4 flex justify-between items-center cursor-pointer`} onClick={onToggle}>
                    <h3 className="font-bold text-white flex items-center gap-2"><Icon name="user-minus" size={18} /> {title}</h3>
                    <Icon name={isOpen ? "chevron-up" : "chevron-down"} className="text-white opacity-70" size={20} />
                </div>
                <div className={isOpen ? "p-5 animate-fade-in flex flex-col gap-5" : "hidden"}>
                    <div className="flex bg-gray-100 p-1 rounded-lg w-fit mx-auto border border-gray-200">
                        <button type="button" onClick={() => { setCrmType('vicidial'); setPanelMessage({ type: '', text: '' }); setResults(null); }} className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${crmType === 'vicidial' ? 'bg-white shadow text-slate-800' : 'text-gray-500 hover:text-gray-700'}`}>Vicidial (Lista Vigente)</button>
                        <button type="button" onClick={() => { setCrmType('vocalcom'); setPanelMessage({ type: '', text: '' }); setResults(null); }} className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${crmType === 'vocalcom' ? 'bg-white shadow text-slate-800' : 'text-gray-500 hover:text-gray-700'}`}>Vocalcom (Resultante)</button>
                    </div>

                    {pendientesHojas.length > 0 && (
                        <SelectorHojas
                            pendientes={pendientesHojas}
                            Icon={Icon}
                            onConfirm={(sel) => { setSheetSelections(prev => ({ ...prev, ...sel })); setPendientesHojas([]); }}
                            onCancel={() => setPendientesHojas([])}
                        />
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="border-2 border-dashed border-amber-300 bg-amber-50 p-6 rounded-lg text-center relative flex flex-col justify-center">
                            <input type="file" multiple accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={(e) => setClientFiles(Array.from(e.target.files))} />
                            <Icon name="file-text" size={24} className="mx-auto text-amber-500 mb-2" />
                            <h4 className="font-bold text-amber-800 text-sm">Archivos Cliente (Altas/Bajas)</h4>
                            <p className="text-xs text-amber-600 mt-1">{clientFiles.length > 0 ? `${clientFiles.length} archivos cargados` : 'Arrastrar archivos aquí'}</p>
                            <div className="mt-3 inline-block bg-amber-100 text-amber-800 text-[11px] font-bold px-2 py-1 rounded border border-amber-200">
                                Campos requeridos: RUT y ESTADO
                            </div>
                        </div>
                        <div className="border-2 border-dashed border-blue-300 bg-blue-50 p-6 rounded-lg text-center relative flex flex-col justify-center">
                            <input type="file" multiple accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={(e) => setCrmFiles(Array.from(e.target.files))} />
                            <Icon name="server" size={24} className="mx-auto text-blue-500 mb-2" />
                            <h4 className="font-bold text-blue-800 text-sm">Base Vigente ({crmType === 'vicidial' ? 'Lista Vigente' : 'Resultante'})</h4>
                            <p className="text-xs text-blue-600 mt-1">{crmFiles.length > 0 ? `${crmFiles.length} archivos cargados` : 'Arrastrar archivos aquí'}</p>
                            <div className="mt-3 inline-block bg-blue-100 text-blue-800 text-[11px] font-bold px-2 py-1 rounded border border-blue-200">
                                {crmType === 'vocalcom'
                                    ? 'Campos req: RUT e INDICE'
                                    : type === 'CC'
                                        ? 'Campos req: postal_code (o RUT), lead_id y list_id'
                                        : 'Campos req: vendor_lead_code (o RUT), lead_id y list_id'}
                            </div>
                        </div>
                    </div>

                    {panelMessage.text && (
                        <div className={`p-3 rounded-lg border text-sm font-bold flex items-center gap-2 ${panelMessage.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : panelMessage.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                            <Icon name={panelMessage.type === 'error' ? 'alert-triangle' : panelMessage.type === 'warning' ? 'alert-circle' : 'check-circle'} size={18} />
                            {panelMessage.text}
                        </div>
                    )}

                    <button type="button" onClick={(e) => { e.preventDefault(); handleProcess(); }} disabled={isProcessing || clientFiles.length === 0 || crmFiles.length === 0} className={`w-full py-3 rounded-lg font-bold text-white flex justify-center items-center gap-2 ${isProcessing || clientFiles.length === 0 || crmFiles.length === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}>
                        {isProcessing ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Icon name="code" size={18} />}
                        Generar Querys de Actualización
                    </button>

                    {results && (
                        <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg relative mt-2 shadow-sm">
                            <div className="flex justify-between items-center mb-3">
                                <h4 className="font-bold text-slate-800">Querys Generadas ({results.matches} bajas reales detectadas)</h4>
                                <div className="flex gap-2">
                                    {results.matches <= 10000 && <CopyButton text={results.query} label="Copiar" style="light" onSuccess={() => setPanelMessage({ type: 'success', text: '¡Copiado al portapapeles exitosamente!' })} onError={() => setPanelMessage({ type: 'error', text: 'Error al copiar la información.' })} />}
                                    <button type="button" onClick={(e) => { e.preventDefault(); t5_downloadTxt(results.query, `Querys_Bajas_${type}_${crmType}.sql`); }} className="bg-slate-800 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-slate-900 flex items-center gap-1 shadow-sm"><Icon name="download" size={14} /> Descargar SQL</button>
                                </div>
                            </div>

                            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-3 text-xs text-yellow-800 font-medium">
                                <strong>AVISO:</strong> Las indicaciones de ejecución fueron incluidas en el encabezado del código SQL generado.
                            </div>

                            {results.matches <= 10000 ? (
                                <textarea readOnly className="w-full h-48 p-3 text-xs font-mono border border-slate-300 rounded outline-none bg-slate-900 text-green-400 whitespace-pre shadow-inner" value={results.query} />
                            ) : (
                                <div className="bg-white p-6 border border-slate-300 rounded text-center mt-2 shadow-sm">
                                    <Icon name="database" size={32} className="mx-auto text-slate-400 mb-2" />
                                    <p className="text-sm text-slate-600 mb-3 font-medium">Se procesaron {results.matches} registros. Al superar los 10,000, el código SQL se ha ocultado de la interfaz para mantener su fluidez.</p>
                                    <p className="text-xs text-slate-500 mb-4">Utiliza el botón <strong>Descargar SQL</strong> de arriba para obtener tu archivo listo para ejecutar.</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // --- COMPONENTE PRINCIPAL (HOST) ---
    const TaskAltasBajasSernac = ({ Icon }) => {
        const [selectedTask, setSelectedTask] = useState('sernac');
        const [openPanels, setOpenPanels] = useState({ sernac: true, rdr: false, sae: false, cc: false });
        const [globalTrigger, setGlobalTrigger] = useState(0);

        useEffect(() => {
            if (selectedTask === 'todas') setOpenPanels({ sernac: true, rdr: false, sae: false, cc: false });
            else setOpenPanels({ sernac: selectedTask === 'sernac', rdr: selectedTask === 'rdr', sae: selectedTask === 'sae', cc: selectedTask === 'cc' });
        }, [selectedTask]);

        const togglePanel = (panelId) => {
            if (selectedTask === 'todas') {
                setOpenPanels(prev => ({ ...prev, [panelId]: !prev[panelId] }));
            }
        };

        return (
            <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full animate-fade-in">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-gray-200 pb-4 gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                            <Icon name="shield-alert" className="text-red-600" />
                            Gestión Sernac y Altas/Bajas
                        </h2>
                        <p className="text-gray-500 text-sm mt-1">Módulo unificado para listas negras y actualizaciones de estado CRM.</p>
                    </div>

                    <div className="flex items-center bg-gray-100 p-1.5 rounded-lg border border-gray-200 shadow-sm">
                        <Icon name="filter" size={16} className="text-gray-500 ml-2 mr-1" />
                        <select className="bg-transparent text-sm font-bold text-gray-700 outline-none pr-4 py-1 cursor-pointer" value={selectedTask} onChange={(e) => setSelectedTask(e.target.value)}>
                            <option value="sernac">SERNAC (Listas Negras)</option>
                            <option value="rdr">ALTAS/BAJAS - RDR</option>
                            <option value="sae">ALTAS/BAJAS - SAE</option>
                            <option value="cc">ALTAS/BAJAS - Compra Cartera</option>
                            <option value="todas">⚙️ Gestionar Todas Juntas</option>
                        </select>
                    </div>
                </div>

                {selectedTask === 'todas' && (
                    <div className="bg-slate-800 p-4 rounded-lg flex flex-col md:flex-row justify-between items-center shadow-md mb-2">
                        <div className="mb-3 md:mb-0 text-center md:text-left">
                            <h3 className="text-white font-bold text-lg flex items-center gap-2 justify-center md:justify-start"><Icon name="layers" size={20} /> Ejecución en Lote</h3>
                            <p className="text-slate-300 text-sm">Procesará automáticamente todos los paneles que tengan archivos cargados.</p>
                        </div>
                        <button type="button" onClick={() => setGlobalTrigger(prev => prev + 1)} className="bg-emerald-500 text-white px-6 py-2 rounded-lg font-bold hover:bg-emerald-600 flex items-center gap-2 shadow-sm w-full md:w-auto justify-center">
                            <Icon name="play" size={18} /> Procesar Todo
                        </button>
                    </div>
                )}

                <div className="flex flex-col gap-1">
                    {(selectedTask === 'sernac' || selectedTask === 'todas') && (
                        <PanelSernac isOpen={openPanels.sernac} onToggle={() => togglePanel('sernac')} globalTrigger={globalTrigger} Icon={Icon} />
                    )}
                    {(selectedTask === 'rdr' || selectedTask === 'todas') && (
                        <PanelAltasBajas title="ALTAS/BAJAS - Cencosud RDR" type="RDR" isOpen={openPanels.rdr} onToggle={() => togglePanel('rdr')} globalTrigger={globalTrigger} Icon={Icon} />
                    )}
                    {(selectedTask === 'sae' || selectedTask === 'todas') && (
                        <PanelAltasBajas title="ALTAS/BAJAS - Cencosud SAE" type="SAE" isOpen={openPanels.sae} onToggle={() => togglePanel('sae')} globalTrigger={globalTrigger} Icon={Icon} />
                    )}
                    {(selectedTask === 'cc' || selectedTask === 'todas') && (
                        <PanelAltasBajas title="ALTAS/BAJAS - Cencosud CC" type="CC" isOpen={openPanels.cc} onToggle={() => togglePanel('cc')} globalTrigger={globalTrigger} Icon={Icon} />
                    )}
                </div>
            </div>
        );
    };


    // ========================================================================
    // ⬇️ PEGAR AQUÍ ABAJO EL CÓDIGO DE LA SIGUIENTE TAREA ⬇️
    // ========================================================================


    // ========================================================================
    // TAREA 6: Carga Santander Consumer Terreno
    // ========================================================================

    const PanelSantander = ({ title, campaignCode, isOpen, onToggle, globalTrigger, Icon }) => {
        const [clientFiles, setClientFiles] = useState([]);
        const [vigenteFiles, setVigenteFiles] = useState([]);
        const [useVigente, setUseVigente] = useState(true);
        const [vigenteSqlMode, setVigenteSqlMode] = useState(false);
        const [vigenteSqlQuery, setVigenteSqlQuery] = useState('');
        const [vigenteSqlData, setVigenteSqlData] = useState(null);
        const [maxRutCount, setMaxRutCount] = useState(10);
        const [baseDate, setBaseDate] = useState(new Date().toISOString().split('T')[0]);

        const [isProcessing, setIsProcessing] = useState(false);
        const [processReport, setProcessReport] = useState(null);
        const [panelMessage, setPanelMessage] = useState({ type: '', text: '' });

        useEffect(() => {
            if (globalTrigger > 0 && clientFiles.length > 0 && !isProcessing) handleProcess();
        }, [globalTrigger]);

        // --- MOTOR 1: SANITIZACIÓN Y UTILIDADES ---
        const sanitizeText = (text) => {
            if (text === null || text === undefined) return '';
            // Rescate puro de fechas nativas
            if (text instanceof Date) {
                const d = String(text.getDate()).padStart(2, '0');
                const m = String(text.getMonth() + 1).padStart(2, '0');
                const y = text.getFullYear();
                return `${d}-${m}-${y}`;
            }
            let str = String(text);
            str = str.replace(/ñ/g, 'n').replace(/Ñ/g, 'N');
            str = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            str = str.replace(/['"%\\|¿?¡!*+]/g, '');
            return str.replace(/\s+/g, ' ').trim();
        };

        const cleanRut = (rut) => String(rut || '').split('-')[0].replace(/[^0-9kK]/gi, '').toUpperCase();
        const [priorizarCel, setPriorizarCel] = useState(true);
        const [pendientesHojas, setPendientesHojas] = useState([]);
        const [sheetSelections, setSheetSelections] = useState({});

        const procesarArchivo = (file, sheetName) => {
            return new Promise((resolve, reject) => {
                if (file.name.toLowerCase().endsWith('.csv') || file.name.toLowerCase().endsWith('.txt')) {
                    window.Papa.parse(file, { header: true, skipEmptyLines: true, complete: (res) => resolve(res.data), error: reject });
                } else {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        try {
                            const wb = window.XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
                            if (wb.SheetNames.length > 1 && !sheetName) {
                                resolve({ multiSheet: true, sheetNames: wb.SheetNames });
                                return;
                            }
                            const ws = wb.Sheets[sheetName || wb.SheetNames[0]];

                            // SALVAVIDAS: Proteger números largos y evitar pérdida de precisión
                            for (let cell in ws) {
                                if (cell[0] === '!') continue;
                                if (ws[cell].t === 'n' && ws[cell].w && ws[cell].w.length > 11) {
                                    ws[cell].t = 's';
                                    ws[cell].v = ws[cell].w;
                                }
                            }

                            resolve(window.XLSX.utils.sheet_to_json(ws, { defval: "", raw: true }));
                        } catch (err) { reject(err); }
                    };
                    reader.readAsArrayBuffer(file);
                }
            });
        };

        // --- MOTOR 2: ETL SANTANDER ---
        const handleProcess = async () => {
            setPanelMessage({ type: '', text: '' });
            setProcessReport(null);

            if (clientFiles.length === 0) {
                setPanelMessage({ type: 'error', text: 'Debes cargar al menos un archivo base del cliente.' });
                return;
            }
            if (useVigente && vigenteFiles.length === 0 && !vigenteSqlData) {
                setPanelMessage({ type: 'warning', text: 'El cruce con Lista Vigente está activo pero no cargaste el archivo. Apaga el interruptor o carga el archivo.' });
                return;
            }

            setIsProcessing(true);
            try {
                // --- 0. DETECCIÓN DE HOJAS MÚLTIPLES ---
                const allFiles = [...clientFiles, ...vigenteFiles];
                const pendientes = [];
                for (const f of allFiles) {
                    if (f.name.toLowerCase().endsWith('.csv') || f.name.toLowerCase().endsWith('.txt')) continue;
                    if (sheetSelections[f.name]) continue;
                    const result = await procesarArchivo(f);
                    if (result && result.multiSheet) pendientes.push({ name: f.name, sheetNames: result.sheetNames });
                }
                if (pendientes.length > 0) {
                    setPendientesHojas(pendientes);
                    setIsProcessing(false);
                    return;
                }

                // 1. Leer y Sanitizar Base Cliente
                let rawData = [];
                for (let f of clientFiles) {
                    const result = await procesarArchivo(f, sheetSelections[f.name]);
                    if (result && result.multiSheet) continue;
                    if (Array.isArray(result)) rawData = rawData.concat(result);
                }

                let sanitizedData = rawData.map(row => {
                    let newRow = {};
                    for (let key in row) newRow[key.trim()] = sanitizeText(row[key]);
                    return newRow;
                });

                // 2. Leer Lista Vigente (Si aplica)
                let vigenteRuts = new Set();
                if (useVigente && vigenteSqlMode && vigenteSqlData) {
                    vigenteSqlData.forEach(row => {
                        const rKey = Object.keys(row).find(k => ['vendor_lead_code', 'rut', 'rut_cliente'].includes(k.toLowerCase()));
                        if (rKey && row[rKey]) vigenteRuts.add(cleanRut(row[rKey]));
                    });
                } else if (useVigente && vigenteFiles.length > 0) {
                    for (let f of vigenteFiles) {
                        const vData = await procesarArchivo(f, sheetSelections[f.name]);
                        if (!Array.isArray(vData)) continue;
                        vData.forEach(row => {
                            const rKey = Object.keys(row).find(k => /rut|nrt/i.test(k));
                            if (rKey && row[rKey]) vigenteRuts.add(cleanRut(row[rKey]));
                        });
                    }
                }

                // 3. Deduplicación por RUT y Agrupación
                const groupedByRut = {};
                const orderedRuts = [];
                let maxGroupSize = 0;
                let excluidosCount = 0;

                sanitizedData.forEach(row => {
                    const rutRaw = row['DDAS_NRT_PPAL'] || row['RUT'] || '';
                    if (!rutRaw) return;
                    const rutClean = cleanRut(rutRaw);

                    // Exclusión de Lista Vigente Temprana
                    if (useVigente && vigenteRuts.has(rutClean)) { excluidosCount++; return; }

                    if (!groupedByRut[rutClean]) {
                        groupedByRut[rutClean] = [];
                        orderedRuts.push(rutClean);
                    }
                    groupedByRut[rutClean].push(row);
                    if (groupedByRut[rutClean].length > maxGroupSize) {
                        maxGroupSize = groupedByRut[rutClean].length;
                    }
                });

                // Límite de columnas dinámico e inteligente
                const finalMaxRuts = Math.min(maxGroupSize, parseInt(maxRutCount));
                const expandingCols = ['DDAS_ID_NUMERO_OPERAC', 'TRAMO_MORA', 'PRODUCTO', 'COL_INI', 'AT_DIA_INI', 'DDAS_FEC_ULT_PAGO', 'DEUDA_TOTAL', 'DDAS_MTO_CUOTA_MO', 'DDAS_FEC_PROX_VCTO', 'PAC', 'DDAS_NROCUO_PACTADAS', 'DDAS_NROCUO_PAGADAS', 'DDAS_NROCUO_MOROSAS', 'ROL', 'MARCA', 'MODELO', 'PATENTE'];

                let maxPhonesFound = 0;
                const finalData = [];

                orderedRuts.forEach(rut => {
                    const group = groupedByRut[rut];
                    const firstRow = group[0];
                    const outputRow = { ...firstRow };

                    // 4. Expansión Horizontal Inteligente
                    expandingCols.forEach(col => {
                        for (let i = 0; i < finalMaxRuts; i++) {
                            const suffix = i === 0 ? '' : `_${i + 1}`;
                            outputRow[`${col}${suffix}`] = group[i] ? (group[i][col] || '') : '';
                        }
                    });

                    // 5. Unificación de Dirección
                    let address = `${firstRow['CALLE1'] || ''} ${firstRow['NUMERO1'] || ''} ${firstRow['RESTO_DIR1'] || ''}`.replace(/\s+/g, ' ').trim();
                    outputRow['DIRECCION'] = address;

                    // 6. Extracción, Limpieza y Shifting de Teléfonos
                    const rawPhones = [];
                    for (let i = 1; i <= 12; i++) {
                        const area = firstRow[`AREA${i}`] || '';
                        const fono = firstRow[`FONO${i}`] || '';
                        if (area || fono) rawPhones.push(area + fono);
                    }
                    let phones = depurarTelefonos(rawPhones, priorizarCel);

                    // Rescate si queda sin teléfono
                    if (phones.length === 0) phones.push('999999999');
                    if (phones.length > maxPhonesFound) maxPhonesFound = phones.length;

                    // Asignación como números (evitando string)
                    phones.forEach((p, idx) => {
                        outputRow[`TEL_TEMP_${idx + 1}`] = Number(p);
                    });

                    finalData.push(outputRow);
                });

                // 7. Mapeo Definitivo, Tipos Numéricos y Orden Perfecto
                const maxTel = Math.min(maxPhonesFound, 10);

                // Función para forzar a Número en Excel
                const toNumber = (val) => {
                    if (val === '' || val === null || val === undefined) return '';
                    const num = Number(val);
                    return isNaN(num) ? val : num;
                };

                const [y, m, d] = baseDate.split('-');
                const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
                const dateObj = new Date(y, m - 1, d);
                const baseStr = `BASE_${d}_${m}_${y}`;
                const mesCargaStr = `${monthNames[dateObj.getMonth()]}_${String(y).slice(-2)}`;

                const exportData = finalData.map(row => {
                    const mapped = {};

                    // A. Copiar todas las columnas originales con sus desdoblamientos
                    Object.keys(row).forEach(k => {
                        // Saltar TEL_TEMP_ (se renombrará a TEL_)
                        if (k.startsWith('TEL_TEMP_')) return;
                        // Saltar desdoblamientos sueltos (se insertan junto a su padre)
                        const isExpandedSibling = expandingCols.some(col => k.startsWith(`${col}_`) && !isNaN(k.substring(col.length + 1)));
                        if (isExpandedSibling) return;

                        const isRutCol = /rut|nrt/i.test(k);
                        mapped[k] = isRutCol ? toNumber(cleanRut(row[k])) : row[k];

                        // Insertar desdoblamientos pegados al padre
                        if (expandingCols.includes(k)) {
                            for (let i = 1; i < finalMaxRuts; i++) {
                                const suffix = `_${i + 1}`;
                                if (row[`${k}${suffix}`] !== undefined) {
                                    mapped[`${k}${suffix}`] = isRutCol ? toNumber(cleanRut(row[`${k}${suffix}`])) : row[`${k}${suffix}`];
                                }
                            }
                        }
                    });

                    // B. Teléfonos depurados como TEL_1..TEL_n
                    for (let i = 1; i <= maxTel; i++) {
                        mapped[`TEL_${i}`] = row[`TEL_TEMP_${i}`] !== undefined ? toNumber(row[`TEL_TEMP_${i}`]) : '';
                    }

                    // C. Columnas de cierre
                    mapped['BASE'] = baseStr;
                    mapped['MES_CARGA'] = mesCargaStr;

                    return mapped;
                });

                // 8. Construir Orden de Cabeceras: Vicidial primero, resto después, TEL+BASE al final
                const headerOrder = [];
                const allKeys = new Set();
                exportData.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));

                // Helper: agregar columna + desdoblamientos si existen en los datos
                const pushWithExpansions = (col) => {
                    if (allKeys.has(col) && !headerOrder.includes(col)) {
                        headerOrder.push(col);
                        if (expandingCols.includes(col)) {
                            for (let i = 1; i < finalMaxRuts; i++) {
                                const exp = `${col}_${i + 1}`;
                                if (allKeys.has(exp) && !headerOrder.includes(exp)) headerOrder.push(exp);
                            }
                        }
                    }
                };

                // 8.1 Bloque Vicidial: columnas priorizadas en orden de carga
                const vicidialOrder = [
                    'DDAS_NRT_PPAL', 'DDAS_NOMBRE_DDOR', 'DDAS_DRT_PPAL',
                    'ZONA', 'REGION', 'COMUNA', 'DIRECCION', 'CORREO',
                    'DDAS_ID_NUMERO_OPERAC', 'TRAMO_MORA', 'PRODUCTO',
                    'COL_INI', 'AT_DIA_INI', 'DDAS_FEC_ULT_PAGO',
                    'DEUDA_TOTAL', 'DDAS_MTO_CUOTA_MO', 'DDAS_FEC_PROX_VCTO',
                    'PAC', 'DDAS_NROCUO_PACTADAS', 'DDAS_NROCUO_PAGADAS',
                    'DDAS_NROCUO_MOROSAS', 'ROL', 'TRIBUNAL',
                    'MARCA', 'MODELO', 'PATENTE'
                ];
                vicidialOrder.forEach(col => pushWithExpansions(col));

                // 8.2 Resto de columnas en su orden natural (excluyendo las ya colocadas, TEL_ y BASE/MES_CARGA)
                const firstRawRow = finalData[0] || {};
                Object.keys(firstRawRow).forEach(k => {
                    if (k.startsWith('TEL_TEMP_')) return;
                    if (k === 'BASE' || k === 'MES_CARGA') return;
                    const isExpandedSibling = expandingCols.some(col => k.startsWith(`${col}_`) && !isNaN(k.substring(col.length + 1)));
                    if (isExpandedSibling) return;
                    pushWithExpansions(k);
                });

                // 8.3 TEL_1..TEL_n + BASE + MES_CARGA al final
                for (let i = 1; i <= maxTel; i++) {
                    const telCol = `TEL_${i}`;
                    if (allKeys.has(telCol) && !headerOrder.includes(telCol)) headerOrder.push(telCol);
                }
                if (allKeys.has('BASE')) headerOrder.push('BASE');
                if (allKeys.has('MES_CARGA')) headerOrder.push('MES_CARGA');

                // 9. Validación de Salida y Exportación
                if (exportData.length === 0) {
                    setPanelMessage({ type: 'warning', text: 'El cruce dejó la base vacía. Todos los registros cargados estaban en la lista vigente.' });
                    setIsProcessing(false);
                    return;
                }

                const { ws } = crearSheetLimpio(exportData, headerOrder);

                // ESCUDO PROTECTOR: Obligar a Excel a tratar los textos como Texto (Evita el 4.08E+15)
                for (let cell in ws) {
                    if (cell[0] === '!') continue;
                    if (ws[cell].t === 's') {
                        ws[cell].z = '@';
                    }
                }

                const wb = window.XLSX.utils.book_new();
                window.XLSX.utils.book_append_sheet(wb, ws, "Santander_Carga");

                const safeCampaignCode = campaignCode.replace(/[\/\\?%*:|"<>]/g, '-');
                const fileName = `CARGA_${safeCampaignCode}_BASE_${d}_${m}_${y}.xlsx`;
                window.XLSX.writeFile(wb, fileName);

                setProcessReport({
                    leidos: rawData.length,
                    validos: exportData.length,
                    repeticiones: maxGroupSize,
                    excluidos: excluidosCount
                });

                setPanelMessage({ type: 'success', text: `¡Archivo de carga generado y descargado correctamente!` });

            } catch (error) {
                setPanelMessage({ type: 'error', text: 'Error en proceso: ' + error.message });
            } finally {
                setIsProcessing(false);
            }
        };

        return (
            <div className="border border-gray-200 rounded-lg bg-white overflow-hidden mb-4 shadow-sm">
                <div className="bg-red-800 p-4 flex justify-between items-center cursor-pointer" onClick={onToggle}>
                    <h3 className="font-bold text-white flex items-center gap-2">
                        <Icon name="briefcase" size={18} /> {title} ({campaignCode})
                    </h3>
                    <Icon name={isOpen ? "chevron-up" : "chevron-down"} className="text-white opacity-70" size={20} />
                </div>

                <div className={isOpen ? "p-5 animate-fade-in flex flex-col gap-5" : "hidden"}>
                    {/* CONTROLES SUPERIORES */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
                        <div className="flex flex-col">
                            <label className="text-xs font-bold text-gray-600 mb-1">Fecha de la Base</label>
                            <input type="date" className="border border-gray-300 rounded p-1.5 text-sm outline-none" value={baseDate} onChange={(e) => setBaseDate(e.target.value)} />
                        </div>
                        <div className="flex flex-col">
                            <label className="text-xs font-bold text-gray-600 mb-1">Máx. Repeticiones (RUT)</label>
                            <input type="number" min="1" max="50" className="border border-gray-300 rounded p-1.5 text-sm outline-none" value={maxRutCount} onChange={(e) => setMaxRutCount(e.target.value)} />
                        </div>
                        <div className="flex flex-col items-center justify-center">
                            <label className="text-xs font-bold text-gray-600 mb-1">Priorizar Celulares</label>
                            <div className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${priorizarCel ? 'bg-red-600' : 'bg-gray-300'}`} onClick={() => setPriorizarCel(!priorizarCel)}>
                                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${priorizarCel ? 'translate-x-6' : ''}`}></div>
                            </div>
                        </div>
                        <div className="flex flex-col items-center justify-center">
                            <label className="text-xs font-bold text-gray-600 mb-1">Excluir Lista Vigente</label>
                            <div
                                className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${useVigente ? 'bg-red-600' : 'bg-gray-300'}`}
                                onClick={() => setUseVigente(!useVigente)}
                            >
                                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${useVigente ? 'translate-x-6' : ''}`}></div>
                            </div>
                        </div>
                    </div>

                    {/* ZONAS DE CARGA */}
                    {pendientesHojas.length > 0 && (
                        <SelectorHojas
                            pendientes={pendientesHojas}
                            Icon={Icon}
                            onConfirm={(sel) => { setSheetSelections(prev => ({ ...prev, ...sel })); setPendientesHojas([]); }}
                            onCancel={() => setPendientesHojas([])}
                        />
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="border-2 border-dashed border-red-300 bg-red-50 p-6 rounded-lg text-center relative flex flex-col justify-center">
                            <input type="file" accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={(e) => setClientFiles(Array.from(e.target.files))} />
                            <Icon name="file-text" size={24} className="mx-auto text-red-500 mb-2" />
                            <h4 className="font-bold text-red-800 text-sm">Base Original Santander</h4>
                            <p className="text-xs text-red-600 mt-1">{clientFiles.length > 0 ? `${clientFiles.length} archivo(s)` : 'Arrastrar aquí'}</p>
                        </div>

                        <div className={`border-2 border-dashed p-4 rounded-lg text-center relative flex flex-col justify-center gap-2 transition-opacity ${useVigente ? 'border-slate-300 bg-slate-50' : 'border-gray-200 bg-gray-100 opacity-50'}`}>
                            {useVigente && (
                                <>
                                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                        <button type="button" onClick={() => { setVigenteSqlMode(false); setVigenteSqlData(null); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #6366f1', background: !vigenteSqlMode ? '#6366f1' : 'white', color: !vigenteSqlMode ? 'white' : '#6366f1', cursor: 'pointer' }}>📂 Archivo</button>
                                        <button type="button" onClick={() => { setVigenteSqlMode(true); setVigenteFiles([]); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #3b82f6', background: vigenteSqlMode ? '#3b82f6' : 'white', color: vigenteSqlMode ? 'white' : '#3b82f6', cursor: 'pointer' }}>⚡ SQL</button>
                                    </div>
                                    {!vigenteSqlMode ? (
                                        <div className="relative">
                                            <input type="file" accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={(e) => setVigenteFiles(Array.from(e.target.files))} />
                                            <Icon name="shield-off" size={24} className="mx-auto mb-1 text-slate-500" />
                                            <h4 className="font-bold text-sm text-slate-800">Lista Vigente (A excluir)</h4>
                                            <p className="text-xs mt-1 text-slate-600">{vigenteFiles.length > 0 ? `${vigenteFiles.length} archivo(s)` : 'Arrastrar aquí'}</p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-1">
                                            <textarea style={{ width: '100%', minHeight: '70px', padding: '0.5rem', border: '2px solid #3b82f6', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.75rem', resize: 'vertical', boxSizing: 'border-box' }} value={vigenteSqlQuery} onChange={e => setVigenteSqlQuery(e.target.value)} placeholder="SELECT RUT FROM tabla WHERE..." />
                                            <button type="button" style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', background: '#3b82f6', color: 'white', border: 'none', cursor: 'pointer' }} onClick={async () => {
                                                if (!vigenteSqlQuery.trim()) return;
                                                const r = await window.nexusAPI.executeSQL(vigenteSqlQuery);
                                                if (!r.success) { setPanelMessage({ type: 'error', text: 'Error SQL: ' + r.error }); return; }
                                                setVigenteSqlData(r.data);
                                                setPanelMessage({ type: 'success', text: `${r.data.length} registros cargados desde SQL.` });
                                            }}>⚡ Ejecutar</button>
                                            {vigenteSqlData && <p className="text-xs text-emerald-600 font-bold">✓ {vigenteSqlData.length} registros</p>}
                                        </div>
                                    )}
                                </>
                            )}
                            {!useVigente && (
                                <>
                                    <Icon name="shield-off" size={24} className="mx-auto mb-2 text-gray-400" />
                                    <h4 className="font-bold text-sm text-gray-500">Lista Vigente (A excluir)</h4>
                                    <p className="text-xs mt-1 text-gray-400">Desactivado</p>
                                </>
                            )}
                        </div>
                    </div>

                    {/* CAJAS VISUALES DE REPORTE */}
                    {processReport && (
                        <div className="bg-white p-5 rounded-lg border border-emerald-200 shadow-sm mt-2 animate-fade-in border-l-4 border-l-emerald-500">
                            <h3 className="text-lg font-bold text-emerald-800 mb-3 flex items-center gap-2"><Icon name="check-circle" className="text-emerald-600" /> Reporte de Procesamiento</h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                                <div className="bg-gray-50 p-3 rounded border border-gray-200"><div className="text-2xl font-black text-gray-700">{processReport.leidos}</div><div className="text-[10px] text-gray-500 uppercase font-bold">Leídos</div></div>
                                <div className="bg-blue-50 p-3 rounded border border-blue-200"><div className="text-2xl font-black text-blue-700">{processReport.validos}</div><div className="text-[10px] text-blue-500 uppercase font-bold">Válidos</div></div>
                                <div className="bg-amber-50 p-3 rounded border border-amber-200"><div className="text-2xl font-black text-amber-700">{processReport.repeticiones}</div><div className="text-[10px] text-amber-500 uppercase font-bold">Máx. Repeticiones</div></div>
                                <div className="bg-purple-50 p-3 rounded border border-purple-200"><div className="text-2xl font-black text-purple-700">{processReport.excluidos}</div><div className="text-[10px] text-purple-500 uppercase font-bold">Excluidos (Lista)</div></div>
                            </div>
                        </div>
                    )}

                    {panelMessage.text && !processReport && (
                        <div className={`p-3 rounded-lg border text-sm font-bold flex items-center gap-2 ${panelMessage.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : panelMessage.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                            <Icon name={panelMessage.type === 'error' ? 'alert-triangle' : panelMessage.type === 'warning' ? 'alert-circle' : 'check-circle'} size={18} />
                            {panelMessage.text}
                        </div>
                    )}

                    <button type="button" onClick={(e) => { e.preventDefault(); handleProcess(); }} disabled={isProcessing || clientFiles.length === 0} className={`w-full py-3 rounded-lg font-bold text-white flex justify-center items-center gap-2 ${isProcessing || clientFiles.length === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-red-700 hover:bg-red-800'}`}>
                        {isProcessing ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Icon name="play" size={18} />}
                        Procesar y Exportar Carga
                    </button>
                </div>
            </div>
        );
    };

    const TaskCargaSantander = ({ Icon }) => {
        const [selectedCampaign, setSelectedCampaign] = useState('');
        const [openPanels, setOpenPanels] = useState({ lv: false, lvc1: false, sc: false, lvc3: false, rmt: false });
        const [globalTrigger, setGlobalTrigger] = useState(0);

        useEffect(() => {
            if (selectedCampaign === 'todas') setOpenPanels({ lv: true, lvc1: false, sc: false, lvc3: false, rmt: false });
            else setOpenPanels({ lv: selectedCampaign === 'lv', lvc1: selectedCampaign === 'lvc1', sc: selectedCampaign === 'sc', lvc3: selectedCampaign === 'lvc3', rmt: selectedCampaign === 'rmt' });
        }, [selectedCampaign]);

        const togglePanel = (panelId) => {
            if (selectedCampaign === 'todas') setOpenPanels(prev => ({ ...prev, [panelId]: !prev[panelId] }));
        };

        const campaigns = [
            { id: 'lv', code: 'STDCONLV', name: 'SANTANDER_COBRANZA_CONSUMER_LV' },
            { id: 'lvc1', code: 'STDCLVC1', name: 'SANTANDER_COBRANZA_CONSUMER_LV_C1' },
            { id: 'sc', code: 'STDCONSC (C2/TERR)', name: 'SANTANDER_COBRANZA_CONSUMER (C2/TERRENO)' },
            { id: 'lvc3', code: 'STDCLVC3', name: 'SANTANDER_COBRANZA_CONSUMER_LV_C3' },
            { id: 'rmt', code: 'STDCCRMT', name: 'SANTANDER_COBRANZA_CONSUMER_RM_TERRENO' }
        ];

        return (
            <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full animate-fade-in">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-gray-200 pb-4 gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                            <Icon name="briefcase" className="text-red-700" />
                            Carga Santander Consumer
                        </h2>
                        <p className="text-gray-500 text-sm mt-1">Deduplicación, limpieza de teléfonos y armado de carga para terreno.</p>
                    </div>
                    <div className="flex items-center bg-gray-100 p-1.5 rounded-lg border border-gray-200 shadow-sm">
                        <Icon name="filter" size={16} className="text-gray-500 ml-2 mr-1" />
                        <select className="bg-transparent text-sm font-bold text-gray-700 outline-none pr-4 py-1 cursor-pointer" value={selectedCampaign} onChange={(e) => setSelectedCampaign(e.target.value)}>
                            <option value="" disabled>Seleccione una opción...</option>
                            {campaigns.map(c => <option key={c.id} value={c.id}>{c.code}</option>)}
                            <option value="todas">⚙️ Gestionar Todas Juntas</option>
                        </select>
                    </div>
                </div>

                {selectedCampaign === '' && (
                    <div className="bg-white p-12 rounded-lg border border-gray-200 text-center shadow-sm mt-2">
                        <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-gray-100">
                            <Icon name="layout" size={40} className="text-gray-400" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-700 mb-2">Área de Trabajo Lista</h3>
                        <p className="text-gray-500 max-w-md mx-auto text-sm">
                            Selecciona una campaña específica en el menú superior o elige <strong>"Gestionar Todas Juntas"</strong> para habilitar los paneles y comenzar la depuración.
                        </p>
                    </div>
                )}

                {selectedCampaign === 'todas' && (
                    <div className="bg-slate-800 p-4 rounded-lg flex flex-col md:flex-row justify-between items-center shadow-md mb-2">
                        <div className="mb-3 md:mb-0 text-center md:text-left">
                            <h3 className="text-white font-bold text-lg flex items-center gap-2 justify-center md:justify-start"><Icon name="layers" size={20} /> Ejecución en Lote</h3>
                            <p className="text-slate-300 text-sm">Procesará automáticamente todas las campañas que tengan bases cargadas.</p>
                        </div>
                        <button type="button" onClick={() => setGlobalTrigger(prev => prev + 1)} className="bg-emerald-500 text-white px-6 py-2 rounded-lg font-bold hover:bg-emerald-600 flex items-center gap-2 shadow-sm w-full md:w-auto justify-center">
                            <Icon name="play" size={18} /> Procesar Todo
                        </button>
                    </div>
                )}

                <div className="flex flex-col gap-1">
                    {campaigns.map(camp => (
                        (selectedCampaign === camp.id || selectedCampaign === 'todas') && (
                            <PanelSantander
                                key={camp.id}
                                title={camp.name}
                                campaignCode={camp.code}
                                isOpen={openPanels[camp.id]}
                                onToggle={() => togglePanel(camp.id)}
                                globalTrigger={globalTrigger}
                                Icon={Icon}
                            />
                        )
                    ))}
                </div>
            </div>
        );
    };




    // ========================================================================
    // ⬇️ PEGAR AQUÍ ABAJO EL CÓDIGO DE LA SIGUIENTE TAREA ⬇️
    // ========================================================================                            


    // ========================================================================
    // TAREA 7: Marcado de Estrategias (Generador SQL Vicidial)
    // ========================================================================

    const PanelEstrategia = ({ title, campaignCode, isOpen, onToggle, globalTrigger, Icon, db }) => {
        const [solicitudFiles, setSolicitudFiles] = useState([]);
        const [cruceFiles, setCruceFiles] = useState([]);
        const [cruceSqlMode, setCruceSqlMode] = useState(false);
        const [cruceSqlQuery, setCruceSqlQuery] = useState('');
        const [cruceSqlData, setCruceSqlData] = useState(null);
        const [marcaValue, setMarcaValue] = useState('');

        const [isAnalyzing, setIsAnalyzing] = useState(false);
        const [panelMessage, setPanelMessage] = useState({ type: '', text: '' });

        // Nuevos Estados de Memoria y Reporte
        const [preMatchData, setPreMatchData] = useState([]);
        const [unmatchedData, setUnmatchedData] = useState([]);
        const [stats, setStats] = useState({ received: 0, crossed: 0 });
        const [sqlResult, setSqlResult] = useState('');

        const [statusFilters, setStatusFilters] = useState({});
        const [showFilters, setShowFilters] = useState(true);

        useEffect(() => {
            if (solicitudFiles.length > 0 && (cruceFiles.length > 0 || cruceSqlData)) {
                handleAnalyze();
            } else {
                setPreMatchData([]); setUnmatchedData([]); setSqlResult('');
                setStatusFilters({}); setPanelMessage({ type: '', text: '' });
            }
        }, [solicitudFiles, cruceFiles, cruceSqlData]);

        useEffect(() => {
            if (globalTrigger > 0 && preMatchData.length > 0 && marcaValue && !sqlResult) {
                handleGenerateSQL();
            }
        }, [globalTrigger]);

        const cleanRut = (str) => String(str || '').split('-')[0].replace(/[^0-9kK]/gi, '').toUpperCase();

        const extractKey = (row) => {
            const key = Object.keys(row).find(k => /vendor_lead_code|rut_cliente|rut|ddas_nrt_ppal/i.test(k));
            return key ? cleanRut(row[key]) : null;
        };

        const [pendientesHojas, setPendientesHojas] = useState([]);
        const [sheetSelections, setSheetSelections] = useState({});

        const t7_procesarArchivo = async (file) => {
            const result = await leerExcelConHojas(file, sheetSelections[file.name] || null);
            if (result.multiSheet) {
                throw new Error(`MULTI_SHEET:${file.name}:${result.sheetNames.join(',')}`);
            }
            return result.data;
        };

        const handleAnalyze = async () => {
            setIsAnalyzing(true);
            setPanelMessage({ type: '', text: '' });
            setSqlResult('');

            try {
                // --- 0. DETECCIÓN DE HOJAS MÚLTIPLES ---
                const allFiles = [...solicitudFiles, ...cruceFiles];
                const pendientes = [];
                for (const f of allFiles) {
                    if (f.name.toLowerCase().endsWith('.csv') || f.name.toLowerCase().endsWith('.txt')) continue;
                    if (sheetSelections[f.name]) continue;
                    try {
                        const result = await leerExcelConHojas(f);
                        if (result.multiSheet) pendientes.push({ name: f.name, sheetNames: result.sheetNames });
                    } catch (e) { /* se manejará después */ }
                }
                if (pendientes.length > 0) {
                    setPendientesHojas(pendientes);
                    setIsAnalyzing(false);
                    return;
                }

                // 1. Leer Base Solicitud y Agrupar
                let solData = [];
                for (let f of solicitudFiles) { const r = await t7_procesarArchivo(f, sheetSelections[f.name]); if (Array.isArray(r)) solData = solData.concat(r); }

                let targetRutsMap = new Map();
                solData.forEach(row => {
                    const rut = extractKey(row);
                    if (rut) {
                        if (!targetRutsMap.has(rut)) targetRutsMap.set(rut, []);
                        targetRutsMap.get(rut).push(row);
                    }
                });

                if (targetRutsMap.size === 0) throw new Error("No se encontraron RUTs/Vendor válidos en la base de Solicitud.");

                // 2. Leer Lista de Cruce
                let cruceData = [];
                if (cruceSqlMode && cruceSqlData) {
                    cruceData = cruceSqlData;
                } else {
                    for (let f of cruceFiles) { const r = await t7_procesarArchivo(f, sheetSelections[f.name]); if (Array.isArray(r)) cruceData = cruceData.concat(r); }
                }

                let matched = [];
                let matchedRuts = new Set();
                let uniqueStatuses = new Set();

                cruceData.forEach(row => {
                    const rut = extractKey(row);
                    const leadKey = Object.keys(row).find(k => k.toLowerCase() === 'lead_id');
                    const listKey = Object.keys(row).find(k => k.toLowerCase() === 'list_id');
                    const statusKey = Object.keys(row).find(k => k.toLowerCase() === 'status');

                    if (rut && targetRutsMap.has(rut) && leadKey && listKey && row[leadKey] && row[listKey]) {
                        const sVal = statusKey && row[statusKey] ? String(row[statusKey]).trim() : '';

                        // Rescatamos TODAS las columnas originales de la solicitud + Data de Vicidial oculta
                        targetRutsMap.get(rut).forEach(solRow => {
                            matched.push({
                                ...solRow,
                                _vici_lead_id: row[leadKey],
                                _vici_list_id: row[listKey],
                                _vici_status: sVal
                            });
                        });

                        if (sVal) uniqueStatuses.add(sVal);
                        matchedRuts.add(rut);
                    }
                });

                // 3. Aislar los NO CRUZADOS
                let unmatched = [];
                targetRutsMap.forEach((rows, rut) => {
                    if (!matchedRuts.has(rut)) {
                        rows.forEach(r => unmatched.push({ ...r, OBSERVACION: 'NO CRUZADO' }));
                    }
                });
                setUnmatchedData(unmatched);

                if (matched.length === 0) {
                    setPanelMessage({ type: 'warning', text: `El cruce arrojó 0 resultados. Se detectaron ${unmatched.length} registros sin estado en Nexus.` });
                    setStats({ received: solData.length, crossed: 0 });
                    setIsAnalyzing(false);
                    return;
                }

                // 4. Conexión Nativa a Nexus DB (IndexedDB)
                const campMap = {};
                const sysMap = {};

                if (db && typeof db.getAll === 'function' && uniqueStatuses.size > 0) {
                    try {
                        const typifications = await db.getAll('typifications');
                        if (Array.isArray(typifications)) {
                            typifications.forEach(t => {
                                const code = String(t.status || '').trim();
                                if (!code) return;
                                if (t.campaign === campaignCode) campMap[code] = t.detail || code;
                                else if (t.campaign === 'SYSTEM') sysMap[code] = t.detail || code;
                            });
                        }
                    } catch (dbErr) { console.error("Error BD:", dbErr); }
                }

                // 5. Mapeo final
                let initialFilters = {};
                matched = matched.map(r => {
                    const code = String(r._vici_status || '').trim();
                    const sName = campMap[code] || sysMap[code] || (code ? `SIN ESTADO (${code})` : 'SIN ESTADO');
                    initialFilters[sName] = true;
                    return { ...r, _vici_status_name: sName };
                });

                setStats({ received: solData.length, crossed: matched.length });
                setPreMatchData(matched);
                setStatusFilters(initialFilters);
                setShowFilters(true);
                setPanelMessage({ type: 'success', text: `¡Análisis completado! Revisa el reporte y las tipificaciones detectadas.` });
            } catch (error) {
                setPanelMessage({ type: 'error', text: 'Error analizando: ' + error.message });
                setPreMatchData([]); setUnmatchedData([]);
            } finally {
                setIsAnalyzing(false);
            }
        };

        const handleDownloadReport = (type, statusName = null) => {
            let exportData = [];
            let fileName = '';

            if (type === 'unmatched') {
                exportData = unmatchedData;
                fileName = `NO_CRUZADOS_${campaignCode}.xlsx`;
            } else if (type === 'status') {
                // Filtramos por estado, limpiamos variables internas y agregamos observación
                exportData = preMatchData.filter(r => r._vici_status_name === statusName).map(r => {
                    let out = { ...r, OBSERVACION: statusName };
                    delete out._vici_lead_id; delete out._vici_list_id; delete out._vici_status; delete out._vici_status_name;
                    return out;
                });
                fileName = `CRUCE_${statusName.replace(/[^a-zA-Z0-9]/g, '_')}_${campaignCode}.xlsx`;
            }

            if (exportData.length === 0) return;
            const ws = window.XLSX.utils.json_to_sheet(exportData);
            const wb = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(wb, ws, "Reporte");
            window.XLSX.writeFile(wb, fileName);
            setPanelMessage({ type: 'success', text: `¡Reporte descargado correctamente!` });
        };

        const handleGenerateSQL = () => {
            if (!marcaValue.trim() || marcaValue.length > 5) {
                setPanelMessage({ type: 'warning', text: 'Por favor, ingresa un valor válido para tribunal_12 (1 a 5 caracteres).' });
                return;
            }

            const finalData = preMatchData.filter(r => statusFilters[r._vici_status_name]);
            if (finalData.length === 0) {
                setPanelMessage({ type: 'warning', text: 'No hay registros para procesar con las tipificaciones seleccionadas.' });
                return;
            }

            const byList = {};
            finalData.forEach(r => {
                if (!byList[r._vici_list_id]) byList[r._vici_list_id] = [];
                byList[r._vici_list_id].push(r._vici_lead_id);
            });

            let sqlString = `-- Generación Automática Nexus - Estrategias\n`;
            sqlString += `-- Campaña: ${campaignCode} | Marcador tribunal_12: '${marcaValue}'\n`;
            sqlString += `-- Total Leads Afectados: ${finalData.length}\n\n`;

            Object.keys(byList).forEach(listId => {
                const leads = byList[listId];
                for (let i = 0; i < leads.length; i += 2000) {
                    const chunk = leads.slice(i, i + 2000);
                    sqlString += `UPDATE custom_${listId} SET tribunal_12='${marcaValue}' WHERE lead_id IN (${chunk.join(',')});\n`;
                }
            });

            setSqlResult(sqlString);
            setPanelMessage({ type: 'success', text: `¡Script SQL generado para ${finalData.length} registros!` });
        };

        const copyToClipboard = async () => {
            try {
                await navigator.clipboard.writeText(sqlResult);
                setPanelMessage({ type: 'success', text: '¡Script copiado al portapapeles!' });
            } catch (err) {
                setPanelMessage({ type: 'error', text: 'Error al copiar al portapapeles.' });
            }
        };

        const priorizadosCount = preMatchData.filter(r => statusFilters[r._vici_status_name]).length;

        return (
            <div className="border border-gray-200 rounded-lg bg-white overflow-hidden mb-4 shadow-sm">
                <div className="bg-indigo-800 p-4 flex justify-between items-center cursor-pointer" onClick={onToggle}>
                    <h3 className="font-bold text-white flex items-center gap-2">
                        <Icon name="crosshair" size={18} /> {title} ({campaignCode})
                    </h3>
                    <Icon name={isOpen ? "chevron-up" : "chevron-down"} className="text-white opacity-70" size={20} />
                </div>

                <div className={isOpen ? "p-5 animate-fade-in flex flex-col gap-4" : "hidden"}>

                    {pendientesHojas.length > 0 && (
                        <SelectorHojas
                            pendientes={pendientesHojas}
                            Icon={Icon}
                            onConfirm={(sel) => { setSheetSelections(prev => ({ ...prev, ...sel })); setPendientesHojas([]); }}
                            onCancel={() => setPendientesHojas([])}
                        />
                    )}
                    {/* ZONA DE CARGA */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="border border-indigo-200 bg-indigo-50 p-4 rounded-lg flex flex-col">
                            <h4 className="font-bold text-indigo-800 text-sm mb-2 flex items-center gap-2"><Icon name="file-text" size={16} /> 1. Base Solicitud (A Marcar)</h4>
                            <div className="border-2 border-dashed border-indigo-300 bg-white p-4 rounded text-center relative mb-3">
                                <input type="file" accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={(e) => setSolicitudFiles(Array.from(e.target.files))} />
                                <Icon name="upload" size={20} className="mx-auto text-indigo-400 mb-1" />
                                <p className="text-xs text-indigo-600 font-bold">{solicitudFiles.length > 0 ? `${solicitudFiles.length} archivo(s)` : 'Cargar Solicitud'}</p>
                            </div>
                            <div className="mt-auto">
                                <label className="text-xs font-bold text-gray-700 mb-1 block">Valor tribunal_12 (1 a 5 caract.)</label>
                                <input type="text" maxLength="5" placeholder="Ej: y" className="w-full border border-gray-300 rounded p-1.5 text-sm outline-none focus:border-indigo-500 font-bold" value={marcaValue} onChange={(e) => setMarcaValue(e.target.value)} />
                            </div>
                        </div>

                        <div className="border border-gray-200 bg-gray-50 p-4 rounded-lg flex flex-col">
                            <h4 className="font-bold text-gray-700 text-sm mb-2 flex items-center gap-2"><Icon name="database" size={16} /> 2. Lista Cruce (Vicidial)</h4>
                            <div style={{ display: 'flex', gap: '6px', marginBottom: '0.5rem' }}>
                                <button type="button" onClick={() => { setCruceSqlMode(false); setCruceSqlData(null); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #6366f1', background: !cruceSqlMode ? '#6366f1' : 'white', color: !cruceSqlMode ? 'white' : '#6366f1', cursor: 'pointer' }}>📂 Archivo</button>
                                <button type="button" onClick={() => { setCruceSqlMode(true); setCruceFiles([]); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #3b82f6', background: cruceSqlMode ? '#3b82f6' : 'white', color: cruceSqlMode ? 'white' : '#3b82f6', cursor: 'pointer' }}>⚡ SQL</button>
                            </div>
                            {!cruceSqlMode ? (
                                <div className="border-2 border-dashed border-gray-300 bg-white p-4 rounded text-center relative flex-1 flex flex-col justify-center">
                                    <input type="file" accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={(e) => setCruceFiles(Array.from(e.target.files))} />
                                    <Icon name="file-search" size={24} className="mx-auto text-gray-400 mb-2" />
                                    <p className="text-sm text-gray-600 font-bold">{cruceFiles.length > 0 ? `${cruceFiles.length} archivo(s) listo(s)` : 'Cargar Export Vicidial'}</p>
                                    <p className="text-[10px] text-gray-400 mt-1">El cruce iniciará automáticamente al cargar ambas bases.</p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    <textarea style={{ width: '100%', minHeight: '80px', padding: '0.5rem', border: '2px solid #3b82f6', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical', boxSizing: 'border-box' }} value={cruceSqlQuery} onChange={e => setCruceSqlQuery(e.target.value)} placeholder="SELECT RUT, lead_id, list_id, status FROM tabla WHERE..." />
                                    <button type="button" style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.8rem', background: '#3b82f6', color: 'white', border: 'none', cursor: 'pointer', alignSelf: 'flex-start' }} onClick={async () => {
                                        if (!cruceSqlQuery.trim()) return;
                                        const r = await window.nexusAPI.executeSQL(cruceSqlQuery);
                                        if (!r.success) { setPanelMessage({ type: 'error', text: 'Error SQL: ' + r.error }); return; }
                                        setCruceSqlData(r.data);
                                        setPanelMessage({ type: 'success', text: `${r.data.length} registros cargados desde SQL.` });
                                    }}>⚡ Ejecutar</button>
                                    {cruceSqlData && <p className="text-xs text-emerald-600 font-bold">✓ {cruceSqlData.length} registros cargados desde SQL</p>}
                                </div>
                            )}
                        </div>
                    </div>

                    {isAnalyzing && (
                        <div className="flex justify-center items-center py-3 text-indigo-600 font-bold text-sm gap-2 bg-indigo-50 rounded-lg border border-indigo-100">
                            <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                            Procesando cruce automático con Nexus...
                        </div>
                    )}

                    {/* REPORTE Y TIPIFICACIONES */}
                    {(preMatchData.length > 0 || unmatchedData.length > 0) && !isAnalyzing && (
                        <div className="animate-fade-in flex flex-col gap-3">

                            {/* CAJAS DE ESTADÍSTICAS */}
                            <div className="grid grid-cols-4 gap-2">
                                <div className="bg-gray-100 border border-gray-200 p-2 rounded-lg text-center flex flex-col justify-center shadow-sm">
                                    <div className="text-xl font-black text-gray-700">{stats.received}</div>
                                    <div className="text-[10px] font-bold text-gray-500 uppercase">Recibidos</div>
                                </div>
                                <div className="bg-blue-50 border border-blue-200 p-2 rounded-lg text-center flex flex-col justify-center shadow-sm">
                                    <div className="text-xl font-black text-blue-700">{stats.crossed}</div>
                                    <div className="text-[10px] font-bold text-blue-600 uppercase">Cruzados</div>
                                </div>
                                <div className="bg-indigo-50 border border-indigo-200 p-2 rounded-lg text-center flex flex-col justify-center shadow-sm">
                                    <div className="text-xl font-black text-indigo-700">{priorizadosCount}</div>
                                    <div className="text-[10px] font-bold text-indigo-600 uppercase">Priorizados (SQL)</div>
                                </div>
                                <div
                                    className="bg-amber-50 border border-amber-200 p-2 rounded-lg text-center flex flex-col justify-center shadow-sm cursor-pointer hover:bg-amber-100 transition-colors"
                                    onClick={() => handleDownloadReport('unmatched')}
                                    title="Descargar casos NO cruzados"
                                >
                                    <div className="text-xl font-black text-amber-700">{unmatchedData.length}</div>
                                    <div className="text-[10px] font-bold text-amber-600 uppercase flex items-center justify-center gap-1">
                                        <Icon name="download" size={10} /> No Cruzados
                                    </div>
                                </div>
                            </div>

                            {/* ACORDEÓN DE ESTADOS */}
                            {preMatchData.length > 0 && (
                                <div className="border border-emerald-200 bg-emerald-50 rounded-lg overflow-hidden">
                                    <div className="bg-emerald-100 p-3 flex justify-between items-center cursor-pointer hover:bg-emerald-200 transition-colors" onClick={() => setShowFilters(!showFilters)}>
                                        <h4 className="font-bold text-emerald-800 text-sm flex items-center gap-2">
                                            <Icon name="check-square" size={16} /> 3. Filtro de Tipificaciones ({stats.crossed} cruzados)
                                        </h4>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-emerald-600 font-bold">{showFilters ? 'Ocultar' : 'Revisar'} detalle</span>
                                            <Icon name={showFilters ? "chevron-up" : "chevron-down"} size={16} className="text-emerald-700" />
                                        </div>
                                    </div>

                                    <div className={`transition-all duration-300 ease-in-out ${showFilters ? 'max-h-96 opacity-100 p-4' : 'max-h-0 opacity-0 overflow-hidden'}`}>
                                        <p className="text-[11px] text-emerald-700 mb-3">Desmarca los que no deseas marcar. <strong>Haz clic en el nombre en azul</strong> para descargar el archivo original con la observación.</p>
                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 overflow-y-auto pr-1" style={{ maxHeight: '200px' }}>
                                            {Object.entries(statusFilters).map(([sName, isChecked]) => {
                                                const count = preMatchData.filter(r => r._vici_status_name === sName).length;
                                                return (
                                                    <label key={sName} className={`flex items-center p-1.5 rounded border transition-colors ${isChecked ? 'bg-indigo-50 border-indigo-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
                                                        <input type="checkbox" className="mr-2 cursor-pointer" checked={isChecked} onChange={() => setStatusFilters({ ...statusFilters, [sName]: !isChecked })} />
                                                        <span
                                                            className="text-[11px] font-bold truncate flex-1 cursor-pointer text-indigo-900 hover:text-blue-600 hover:underline"
                                                            title={`Descargar archivo de los ${count} registros: ${sName}`}
                                                            onClick={(e) => { e.preventDefault(); handleDownloadReport('status', sName); }}
                                                        >
                                                            {sName}
                                                        </span>
                                                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ml-1 ${isChecked ? 'bg-indigo-200 text-indigo-800' : 'bg-gray-200 text-gray-500'}`}>{count}</span>
                                                    </label>
                                                )
                                            })}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* PANEL DE RESULTADO SQL IN-LINE */}
                    {sqlResult && (
                        <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg relative mt-2 shadow-sm animate-fade-in">
                            <div className="flex justify-between items-center mb-2">
                                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2"><Icon name="database" size={16} /> Script de Marcado Generado</h4>
                                <CopyButton text={sqlResult} label="Copiar SQL" style="lightSm" onSuccess={() => setPanelMessage({ type: 'success', text: '¡Script copiado al portapapeles!' })} onError={() => setPanelMessage({ type: 'error', text: 'Error al copiar al portapapeles.' })} />
                            </div>

                            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-2 mb-3 text-[11px] text-yellow-800 font-medium flex items-center gap-2 shadow-sm">
                                <Icon name="info" size={14} className="text-yellow-600 flex-shrink-0" />
                                <span><strong>GUÍA OPERATIVA:</strong> Recuerde ejecutar esta query en MySQL y activar la marca de <strong>tribunal_12</strong> en el filtro de la campaña.</span>
                            </div>

                            <textarea readOnly className="w-full h-32 p-3 text-xs font-mono bg-slate-900 text-emerald-400 rounded outline-none shadow-inner resize-none" value={sqlResult} />
                        </div>
                    )}

                    {panelMessage.text && !isAnalyzing && (
                        <div className={`p-3 rounded-lg text-sm font-bold flex items-center gap-2 ${panelMessage.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : panelMessage.type === 'warning' ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
                            <Icon name={panelMessage.type === 'success' ? 'check-circle' : 'alert-circle'} size={18} /> {panelMessage.text}
                        </div>
                    )}

                    {/* BOTONES DE ACCIÓN */}
                    <button
                        onClick={handleGenerateSQL}
                        disabled={preMatchData.length === 0 || isAnalyzing}
                        className={`w-full font-bold py-3 rounded-lg flex justify-center items-center gap-2 shadow-sm transition-all ${preMatchData.length === 0 || isAnalyzing ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                    >
                        <Icon name="code" size={18} /> Generar Script SQL de Actualización
                    </button>
                </div>
            </div>
        );
    };

    const TaskMarcadoEstrategias = ({ Icon, db }) => {
        const [selectedCampaign, setSelectedCampaign] = useState('');
        const [openPanels, setOpenPanels] = useState({ lv: false, lvc1: false, sc: false, lvc3: false, rmt: false });
        const [globalTrigger, setGlobalTrigger] = useState(0);

        const campaigns = [
            { id: 'lv', code: 'STDCONLV', name: 'SANTANDER_COBRANZA_CONSUMER_LV' },
            { id: 'lvc1', code: 'STDCLVC1', name: 'SANTANDER_COBRANZA_CONSUMER_LV_C1' },
            { id: 'sc', code: 'STDCONSC', name: 'SANTANDER_COBRANZA_CONSUMER (C2/TERRENO)' },
            { id: 'lvc3', code: 'STDCLVC3', name: 'SANTANDER_COBRANZA_CONSUMER_LV_C3' },
            { id: 'rmt', code: 'STDCCRMT', name: 'SANTANDER_COBRANZA_CONSUMER_RM_TERRENO' }
        ];

        useEffect(() => {
            if (selectedCampaign === 'todas') setOpenPanels({ lv: true, lvc1: false, sc: false, lvc3: false, rmt: false });
            else setOpenPanels({ lv: selectedCampaign === 'lv', lvc1: selectedCampaign === 'lvc1', sc: selectedCampaign === 'sc', lvc3: selectedCampaign === 'lvc3', rmt: selectedCampaign === 'rmt' });
        }, [selectedCampaign]);

        const togglePanel = (panelId) => {
            if (selectedCampaign === 'todas') setOpenPanels(prev => ({ ...prev, [panelId]: !prev[panelId] }));
        };

        return (
            <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full animate-fade-in">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-gray-200 pb-4 gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                            <Icon name="crosshair" className="text-indigo-700" />
                            Marcado de Estrategias
                        </h2>
                        <p className="text-gray-500 text-sm mt-1">Cruce de solicitudes contra listas de Vicidial para generar Updates masivos.</p>
                    </div>
                    <div className="flex items-center bg-gray-100 p-1.5 rounded-lg border border-gray-200 shadow-sm">
                        <Icon name="filter" size={16} className="text-gray-500 ml-2 mr-1" />
                        <select className="bg-transparent text-sm font-bold text-gray-700 outline-none pr-4 py-1 cursor-pointer" value={selectedCampaign} onChange={(e) => setSelectedCampaign(e.target.value)}>
                            <option value="" disabled>Seleccione una campaña...</option>
                            {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            <option value="todas">⚙️ Gestionar Todas Juntas</option>
                        </select>
                    </div>
                </div>

                {selectedCampaign === '' && (
                    <div className="bg-white p-12 rounded-lg border border-gray-200 text-center shadow-sm mt-2">
                        <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-indigo-100">
                            <Icon name="code" size={40} className="text-indigo-400" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-700 mb-2">Motor de Queries Inverso</h3>
                        <p className="text-gray-500 max-w-md mx-auto text-sm">
                            Selecciona una campaña para cruzar tus bases y generar las sentencias SQL segmentadas por <strong>list_id</strong> filtrando dinámicamente las tipificaciones.
                        </p>
                    </div>
                )}

                {selectedCampaign === 'todas' && (
                    <div className="bg-slate-800 p-4 rounded-lg flex flex-col md:flex-row justify-between items-center shadow-md mb-2">
                        <div className="mb-3 md:mb-0 text-center md:text-left">
                            <h3 className="text-white font-bold text-lg flex items-center gap-2 justify-center md:justify-start"><Icon name="layers" size={20} /> Pre-Carga en Lote</h3>
                            <p className="text-slate-300 text-sm">Analizará todas las campañas con archivos cargados simultáneamente.</p>
                        </div>
                        <button type="button" onClick={() => setGlobalTrigger(prev => prev + 1)} className="bg-emerald-500 text-white px-6 py-2 rounded-lg font-bold hover:bg-emerald-600 flex items-center gap-2 shadow-sm">
                            <Icon name="cpu" size={18} /> Analizar Todo
                        </button>
                    </div>
                )}

                <div className="flex flex-col gap-1">
                    {campaigns.map(camp => (
                        (selectedCampaign === camp.id || selectedCampaign === 'todas') && (
                            <PanelEstrategia
                                key={camp.id} title={camp.name} campaignCode={camp.code}
                                isOpen={openPanels[camp.id]} onToggle={() => togglePanel(camp.id)}
                                globalTrigger={globalTrigger} Icon={Icon} db={db}
                            />
                        )
                    ))}
                </div>
            </div>
        );
    };



    // ========================================================================
    // ⬇️ PEGAR AQUÍ ABAJO EL CÓDIGO DE LA SIGUIENTE TAREA ⬇️
    // ========================================================================     

    // ========================================================================
    // TAREA 8: Carga La Polar (ETL + Homologación Dinámica)
    // ========================================================================

    const PanelLaPolar = ({ title, campaignCode, isOpen, onToggle, globalTrigger, Icon, utils }) => {
        const { addToast } = utils;
        const [baseFiles, setBaseFiles] = useState([]);
        const [cruceFile, setCruceFile] = useState(null);
        const [useCruce, setUseCruce] = useState(false);
        const [cruceSqlMode, setCruceSqlMode] = useState(false);
        const [cruceSqlQuery, setCruceSqlQuery] = useState('');
        const [cruceSqlData, setCruceSqlData] = useState(null);
        const [exportFormat, setExportFormat] = useState('xls');
        const [priorizarCel, setPriorizarCel] = useState(true);

        const [step, setStep] = useState(1); // 1: Configuración, 2: Mapeo Manual, 3: Reporte
        const [isProcessing, setIsProcessing] = useState(false);
        const [report, setReport] = useState(null);

        // Estados para Homologación en Memoria
        const [rawDatasets, setRawDatasets] = useState([]);
        const [masterCols, setMasterCols] = useState([]);
        const [mismatchedCols, setMismatchedCols] = useState([]); // [{ fileIdx, fileName, originalCol, autoCol }]
        const [userMappings, setUserMappings] = useState({}); // { "fileIdx_originalCol": "TARGET" }

        useEffect(() => {
            if (globalTrigger > 0 && baseFiles.length > 0 && step === 1 && !isProcessing) handleAnalyze();
        }, [globalTrigger]);

        // --- MOTORES DE LIMPIEZA Y CÁLCULO ---
        const cleanText = (str) => String(str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
        const extractNumbers = (str) => String(str || '').replace(/\D/g, '');

        const calculateDV = (rutStr) => {
            let t = parseInt(extractNumbers(rutStr)), m = 0, s = 1;
            if (!t) return '';
            for (; t; t = Math.floor(t / 10)) s = (s + t % 10 * (9 - m++ % 6)) % 11;
            return s ? String(s - 1) : 'K';
        };

        const autoHomologate = (colName) => {
            const k = cleanText(colName);
            if (k.includes('MONTO')) return 'MONTO_AVANCE_XL';
            if (k.includes('SIMULA')) return 'SIMULA_XL_UA';
            return k;
        };

        const [pendientesHojas, setPendientesHojas] = useState([]);
        const [sheetSelections, setSheetSelections] = useState({});

        const procesarArchivo = async (file) => {
            const result = await leerExcelConHojas(file, sheetSelections[file.name] || null);
            if (result.multiSheet) {
                throw new Error(`MULTI_SHEET:${file.name}:${result.sheetNames.join(',')}`);
            }
            return result.data;
        };

        // --- FASE 1: LECTURA Y DETECCIÓN DE DISCREPANCIAS ---
        const handleAnalyze = async () => {
            if (baseFiles.length === 0) { addToast('Carga al menos un archivo base.', 'error'); return; }
            if (useCruce && !cruceFile && !cruceSqlData) { addToast('Carga la lista de exclusión o desactiva el cruce.', 'error'); return; }

            setIsProcessing(true);
            try {
                // --- 0. DETECCIÓN DE HOJAS MÚLTIPLES ---
                const allFiles = [...baseFiles, ...(cruceFile ? [cruceFile] : [])];
                const pendientes = [];
                for (const f of allFiles) {
                    if (f.name.toLowerCase().endsWith('.csv') || f.name.toLowerCase().endsWith('.txt')) continue;
                    if (sheetSelections[f.name]) continue;
                    try {
                        const result = await leerExcelConHojas(f);
                        if (result.multiSheet) pendientes.push({ name: f.name, sheetNames: result.sheetNames });
                    } catch (e) { /* se manejará después */ }
                }
                if (pendientes.length > 0) {
                    setPendientesHojas(pendientes);
                    setIsProcessing(false);
                    return;
                }

                let parsedFiles = [];
                for (let f of baseFiles) {
                    const data = await procesarArchivo(f);
                    if (data.length > 0) parsedFiles.push({ fileName: f.name, data });
                }

                if (parsedFiles.length === 0) throw new Error("Los archivos están vacíos.");

                // Detectar Columnas Maestras (Archivo 1)
                let masterHeaders = Array.from(new Set(Object.keys(parsedFiles[0].data[0]).map(autoHomologate)));
                let discrepancies = [];

                // Comparar el resto de archivos contra el Maestro
                for (let i = 1; i < parsedFiles.length; i++) {
                    const fileHeaders = Object.keys(parsedFiles[i].data[0] || {});
                    fileHeaders.forEach(originalCol => {
                        const autoCol = autoHomologate(originalCol);
                        if (!masterHeaders.includes(autoCol)) {
                            discrepancies.push({ fileIdx: i, fileName: parsedFiles[i].fileName, originalCol, autoCol });
                        }
                    });
                }

                setRawDatasets(parsedFiles);
                setMasterCols(masterHeaders);

                if (discrepancies.length > 0) {
                    // Ir a Fase 2: Mapeo Manual
                    setMismatchedCols(discrepancies);
                    setStep(2);
                    addToast(`Se detectaron ${discrepancies.length} columnas discrepantes. Requiere homologación manual.`, 'warning');
                    setIsProcessing(false);
                } else {
                    // Pasar directo a Fase 3
                    await executeETL(parsedFiles, {});
                }
            } catch (error) {
                addToast('Error analizando archivos: ' + error.message, 'error');
                setIsProcessing(false);
            }
        };

        // --- FASE 3: UNIFICACIÓN, LIMPIEZA Y EXPORTACIÓN ---
        const executeETL = async (datasets, mappings) => {
            setIsProcessing(true);
            try {
                // 1. Unificar bases aplicando Homologación (Auto + Manual)
                let unifiedData = [];
                datasets.forEach((fileObj, idx) => {
                    fileObj.data.forEach(row => {
                        let newRow = {};
                        Object.keys(row).forEach(originalCol => {
                            let targetCol = autoHomologate(originalCol);
                            // Override manual si existe
                            const mapKey = `${idx}_${originalCol}`;
                            if (mappings[mapKey]) {
                                if (mappings[mapKey] === 'DISCARD') return; // Se descarta
                                targetCol = mappings[mapKey];
                            }
                            newRow[targetCol] = row[originalCol];
                        });
                        unifiedData.push(newRow);
                    });
                });

                // 2. Lógica de Exclusión (Cruce)
                let exclusionSet = new Set();
                if (useCruce && cruceSqlMode && cruceSqlData) {
                    cruceSqlData.forEach(row => {
                        const idVal = row.ID || row.id || row.Id;
                        if (idVal) exclusionSet.add(String(idVal).trim().toUpperCase());
                        else {
                            const rutKey = Object.keys(row).find(k => /rut/i.test(k));
                            if (rutKey && row[rutKey]) exclusionSet.add(extractNumbers(String(row[rutKey]).split('-')[0]));
                        }
                    });
                } else if (useCruce && cruceFile) {
                    const cruceData = await procesarArchivo(cruceFile);
                    cruceData.forEach(row => {
                        const idVal = row.ID || row.id || row.Id;
                        if (idVal) exclusionSet.add(String(idVal).trim().toUpperCase());
                        else {
                            const rutKey = Object.keys(row).find(k => /rut/i.test(k));
                            if (rutKey && row[rutKey]) exclusionSet.add(extractNumbers(String(row[rutKey]).split('-')[0]));
                        }
                    });
                }

                // 3. Procesamiento Fila por Fila
                let processedData = [];
                let stats = { loaded: unifiedData.length, excluded: 0, duplicates: 0, valid: 0 };

                const [y, m, d] = baseDate.split('-');
                const dateObj = new Date(y, m - 1, d);
                const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
                const baseStr = `BASE_${d}_${m}_${y}`;
                const mesCargaStr = `${monthNames[dateObj.getMonth()]}_${y.slice(-2)}`;

                unifiedData.forEach(row => {
                    let obj = { ...row };

                    // A. ID y Exclusión
                    const idKey = Object.keys(obj).find(k => cleanText(k) === 'ID');
                    const idVal = idKey ? String(obj[idKey]).trim().toUpperCase() : null;

                    let rLimpio = '';
                    const rutKey = Object.keys(obj).find(k => cleanText(k) === 'RUT');
                    if (rutKey) {
                        const rRaw = String(obj[rutKey]);
                        rLimpio = extractNumbers(rRaw.split('-')[0]);
                        const dvMatch = rRaw.match(/-([0-9kK])/);
                        obj['RUT'] = rLimpio;

                        const dvCol = Object.keys(obj).find(k => cleanText(k) === 'DV');
                        if (!dvCol) obj['DV'] = dvMatch ? dvMatch[1].toUpperCase() : calculateDV(rLimpio);
                    }

                    const crossKey = idVal || rLimpio;
                    if (useCruce && crossKey && exclusionSet.has(crossKey)) {
                        stats.excluded++;
                        return;
                    }

                    // B. Tratamiento de Teléfonos
                    const rawPhoneVals = [];
                    Object.keys(obj).forEach(k => {
                        if (/CELULAR|TEL|FONO|MOVIL/i.test(k)) {
                            rawPhoneVals.push(obj[k]);
                            delete obj[k];
                        }
                    });
                    let phones = depurarTelefonos(rawPhoneVals, priorizarCel);
                    if (phones.length === 0) phones.push('999999999');
                    phones.forEach((p, i) => obj[`TEL_${i + 1}`] = Number(p));

                    // C. Fechas
                    obj['BASE'] = baseStr;
                    obj['MES_CARGA'] = mesCargaStr;

                    processedData.push(obj);
                });

                // 4. Ordenamiento global por Monto Más Alto (y deduplicación)
                processedData.sort((a, b) => {
                    let mA = a.MONTO_AVANCE_XL ? Number(String(a.MONTO_AVANCE_XL).replace(/\D/g, '')) || 0 : 0;
                    let mB = b.MONTO_AVANCE_XL ? Number(String(b.MONTO_AVANCE_XL).replace(/\D/g, '')) || 0 : 0;

                    // Orden principal: Mayor Monto primero
                    if (mA !== mB) return mB - mA;

                    // Orden secundario (solo en caso de empate de monto): Mayor ID primero
                    let idA = a.ID ? parseInt(extractNumbers(a.ID)) || 0 : 0;
                    let idB = b.ID ? parseInt(extractNumbers(b.ID)) || 0 : 0;
                    return idB - idA;
                });

                let deduplicatedMap = new Map();
                processedData.forEach(row => {
                    const uniqueKey = row.ID ? String(row.ID) : (row.RUT ? String(row.RUT) : Math.random().toString());
                    if (!deduplicatedMap.has(uniqueKey)) deduplicatedMap.set(uniqueKey, row);
                    else stats.duplicates++;
                });

                let finalArray = Array.from(deduplicatedMap.values());

                // 5. Limpieza Final y Exportación
                const { ws, cleanData } = crearSheetLimpio(finalArray);

                stats.valid = cleanData.length;
                setReport(stats);

                if (stats.valid === 0) {
                    addToast('La base final quedó vacía luego de los cruces y depuración.', 'warning');
                    setStep(3); setIsProcessing(false); return;
                }

                const wb = window.XLSX.utils.book_new();
                window.XLSX.utils.book_append_sheet(wb, ws, "La_Polar");
                window.XLSX.writeFile(wb, `CARGA_${campaignCode}_${baseDate.replace(/-/g, '')}.${exportFormat}`);

                addToast(`¡Carga procesada! ${stats.valid} registros exportados.`, 'success');
                setStep(3);

            } catch (error) {
                addToast('Error unificando: ' + error.message, 'error');
            } finally {
                setIsProcessing(false);
            }
        };

        const resetPanel = () => {
            setStep(1); setReport(null); setBaseFiles([]); setCruceFile(null);
            setRawDatasets([]); setMismatchedCols([]); setUserMappings({});
        };

        return (
            <div className="border border-gray-200 rounded-lg bg-white overflow-hidden mb-4 shadow-sm">
                <div className="bg-sky-800 p-4 flex justify-between items-center cursor-pointer" onClick={onToggle}>
                    <h3 className="font-bold text-white flex items-center gap-2">
                        <Icon name="shopping-bag" size={18} /> {title} ({campaignCode})
                    </h3>
                    <Icon name={isOpen ? "chevron-up" : "chevron-down"} className="text-white opacity-70" size={20} />
                </div>

                <div className={isOpen ? "p-5 animate-fade-in flex flex-col gap-5" : "hidden"}>

                    {/* FASE 1: CONFIGURACIÓN Y CARGA */}
                    {step === 1 && (
                        <div className="flex flex-col gap-4 animate-fade-in">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
                                <div className="flex flex-col">
                                    <label className="text-xs font-bold text-gray-600 mb-1">Fecha de Proceso</label>
                                    <input type="date" className="border border-gray-300 rounded p-1.5 text-sm outline-none font-medium" value={baseDate} onChange={(e) => setBaseDate(e.target.value)} />
                                </div>
                                <div className="flex flex-col">
                                    <label className="text-xs font-bold text-gray-600 mb-1">Formato de Salida</label>
                                    <select className="border border-gray-300 rounded p-1.5 text-sm outline-none font-medium" value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
                                        <option value="xls">Excel 97-2003 (.xls)</option>
                                        <option value="xlsx">Excel Moderno (.xlsx)</option>
                                    </select>
                                </div>
                                <div className="flex flex-col items-center justify-center">
                                    <label className="text-xs font-bold text-gray-600 mb-1">Priorizar Celulares</label>
                                    <div className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${priorizarCel ? 'bg-sky-600' : 'bg-gray-300'}`} onClick={() => setPriorizarCel(!priorizarCel)}>
                                        <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${priorizarCel ? 'translate-x-6' : ''}`}></div>
                                    </div>
                                </div>
                                <div className="flex flex-col items-center justify-center">
                                    <label className="text-xs font-bold text-gray-600 mb-1">Excluir Registros (Cruce ID)</label>
                                    <div className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${useCruce ? 'bg-sky-600' : 'bg-gray-300'}`} onClick={() => setUseCruce(!useCruce)}>
                                        <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${useCruce ? 'translate-x-6' : ''}`}></div>
                                    </div>
                                </div>
                            </div>

                            {pendientesHojas.length > 0 && (
                                <SelectorHojas
                                    pendientes={pendientesHojas}
                                    Icon={Icon}
                                    onConfirm={(sel) => { setSheetSelections(prev => ({ ...prev, ...sel })); setPendientesHojas([]); }}
                                    onCancel={() => setPendientesHojas([])}
                                />
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="border-2 border-dashed border-sky-300 bg-sky-50 p-6 rounded-lg text-center relative flex flex-col justify-center">
                                    <input type="file" multiple accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={(e) => setBaseFiles(Array.from(e.target.files))} />
                                    <Icon name="files" size={24} className="mx-auto text-sky-500 mb-2" />
                                    <h4 className="font-bold text-sky-800 text-sm">Bases Originales (Múltiples)</h4>
                                    <p className="text-xs text-sky-600 mt-1">{baseFiles.length > 0 ? `${baseFiles.length} archivo(s) listo(s)` : 'Arrastrar archivos aquí'}</p>
                                </div>

                                <div className={`border-2 border-dashed p-4 rounded-lg text-center relative flex flex-col justify-center gap-2 transition-all ${useCruce ? 'border-slate-300 bg-slate-50' : 'border-gray-200 bg-gray-50 opacity-50'}`}>
                                    {useCruce && (
                                        <>
                                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                                                <button type="button" onClick={() => { setCruceSqlMode(false); setCruceSqlData(null); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #6366f1', background: !cruceSqlMode ? '#6366f1' : 'white', color: !cruceSqlMode ? 'white' : '#6366f1', cursor: 'pointer' }}>📂 Archivo</button>
                                                <button type="button" onClick={() => { setCruceSqlMode(true); setCruceFile(null); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #3b82f6', background: cruceSqlMode ? '#3b82f6' : 'white', color: cruceSqlMode ? 'white' : '#3b82f6', cursor: 'pointer' }}>⚡ SQL</button>
                                            </div>
                                            {!cruceSqlMode ? (
                                                <div className="relative">
                                                    <input type="file" accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={(e) => setCruceFile(e.target.files[0])} />
                                                    <Icon name="file-search" size={24} className="mx-auto mb-2 text-slate-500" />
                                                    <h4 className="font-bold text-sm text-slate-800">Archivo de Exclusión (Opcional)</h4>
                                                    <p className="text-xs mt-1 text-slate-600">{cruceFile ? cruceFile.name : 'Arrastrar aquí'}</p>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col gap-1">
                                                    <textarea style={{ width: '100%', minHeight: '70px', padding: '0.5rem', border: '2px solid #3b82f6', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.75rem', resize: 'vertical', boxSizing: 'border-box' }} value={cruceSqlQuery} onChange={e => setCruceSqlQuery(e.target.value)} placeholder="SELECT ID FROM tabla WHERE..." />
                                                    <button type="button" style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', background: '#3b82f6', color: 'white', border: 'none', cursor: 'pointer' }} onClick={async () => {
                                                        if (!cruceSqlQuery.trim()) return;
                                                        const r = await window.nexusAPI.executeSQL(cruceSqlQuery);
                                                        if (!r.success) { addToast('Error SQL: ' + r.error, 'error'); return; }
                                                        setCruceSqlData(r.data);
                                                        addToast(`${r.data.length} registros cargados desde SQL.`, 'success');
                                                    }}>⚡ Ejecutar</button>
                                                    {cruceSqlData && <p className="text-xs text-emerald-600 font-bold">✓ {cruceSqlData.length} registros</p>}
                                                </div>
                                            )}
                                        </>
                                    )}
                                    {!useCruce && (
                                        <>
                                            <Icon name="file-search" size={24} className="mx-auto mb-2 text-gray-400" />
                                            <h4 className="font-bold text-sm text-gray-500">Archivo de Exclusión (Opcional)</h4>
                                            <p className="text-xs mt-1 text-gray-400">Interruptor apagado</p>
                                        </>
                                    )}
                                </div>
                            </div>

                            <button onClick={handleAnalyze} disabled={isProcessing || baseFiles.length === 0} className={`w-full py-3 rounded-lg font-bold text-white flex justify-center items-center gap-2 shadow-sm transition-all ${isProcessing || baseFiles.length === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-sky-600 hover:bg-sky-700'}`}>
                                {isProcessing ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Icon name="play" size={18} />}
                                Analizar y Procesar Carga
                            </button>
                        </div>
                    )}

                    {/* FASE 2: HOMOLOGACIÓN MANUAL */}
                    {step === 2 && (
                        <div className="flex flex-col gap-4 animate-fade-in border border-amber-200 bg-amber-50 p-5 rounded-lg">
                            <div className="flex items-start gap-3 mb-2">
                                <Icon name="alert-triangle" size={24} className="text-amber-500 flex-shrink-0 mt-1" />
                                <div>
                                    <h4 className="font-bold text-amber-800">Discrepancia de Columnas Detectada</h4>
                                    <p className="text-sm text-amber-700">Los archivos tienen estructuras diferentes. Selecciona con qué columna maestra deseas unificar las siguientes discrepancias o descártalas.</p>
                                </div>
                            </div>

                            <div className="bg-white border border-amber-200 rounded-lg overflow-hidden shadow-inner max-h-60 overflow-y-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-amber-100 text-amber-800 text-xs uppercase font-bold">
                                        <tr>
                                            <th className="px-3 py-2">Archivo Origen</th>
                                            <th className="px-3 py-2">Columna Detectada</th>
                                            <th className="px-3 py-2">Acción / Mapeo</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {mismatchedCols.map((col, idx) => (
                                            <tr key={idx} className="border-b border-amber-50 hover:bg-amber-50/50">
                                                <td className="px-3 py-2 font-mono text-[11px] text-gray-500">{col.fileName}</td>
                                                <td className="px-3 py-2 font-bold text-gray-700">{col.originalCol}</td>
                                                <td className="px-3 py-2">
                                                    <select
                                                        className="w-full p-1 border border-gray-300 rounded text-xs outline-none focus:border-amber-500 font-medium bg-white"
                                                        value={userMappings[`${col.fileIdx}_${col.originalCol}`] || col.autoCol}
                                                        onChange={(e) => setUserMappings({ ...userMappings, [`${col.fileIdx}_${col.originalCol}`]: e.target.value })}
                                                    >
                                                        <option value={col.autoCol} className="text-blue-600 font-bold">Mantener como Nueva Columna</option>
                                                        <option value="DISCARD" className="text-red-600 font-bold">❌ Descartar Columna</option>
                                                        <optgroup label="Unificar con Columna Maestra:">
                                                            {masterCols.map(mCol => <option key={mCol} value={mCol}>{mCol}</option>)}
                                                        </optgroup>
                                                    </select>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <button onClick={() => executeETL(rawDatasets, userMappings)} disabled={isProcessing} className="w-full py-3 mt-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg flex justify-center items-center gap-2 shadow-sm transition-all">
                                {isProcessing ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Icon name="git-merge" size={18} />}
                                Confirmar Mapeo y Unificar Base
                            </button>
                        </div>
                    )}

                    {/* FASE 3: REPORTE FINAL */}
                    {step === 3 && report && (
                        <div className="flex flex-col gap-4 animate-fade-in border border-emerald-200 bg-white p-5 rounded-lg shadow-sm">
                            <div className="flex justify-between items-center mb-2 border-b border-emerald-100 pb-3">
                                <h3 className="text-lg font-bold text-emerald-800 flex items-center gap-2">
                                    <Icon name="check-circle" className="text-emerald-600" /> Carga Completada
                                </h3>
                                <button onClick={resetPanel} className="text-xs font-bold text-gray-500 hover:text-sky-600 flex items-center gap-1 border border-gray-200 px-3 py-1.5 rounded bg-gray-50 hover:bg-sky-50 transition-colors">
                                    <Icon name="refresh-cw" size={12} /> Procesar Otra
                                </button>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center mb-2">
                                <div className="bg-gray-50 p-3 rounded border border-gray-200"><div className="text-2xl font-black text-gray-700">{report.loaded}</div><div className="text-[10px] text-gray-500 uppercase font-bold">Leídos</div></div>
                                <div className="bg-blue-50 p-3 rounded border border-blue-200"><div className="text-2xl font-black text-blue-700">{report.valid}</div><div className="text-[10px] text-blue-500 uppercase font-bold">Válidos Finales</div></div>
                                <div className="bg-amber-50 p-3 rounded border border-amber-200"><div className="text-2xl font-black text-amber-700">{report.duplicates}</div><div className="text-[10px] text-amber-500 uppercase font-bold">Duplicados ID</div></div>
                                <div className="bg-purple-50 p-3 rounded border border-purple-200"><div className="text-2xl font-black text-purple-700">{report.excluded}</div><div className="text-[10px] text-purple-500 uppercase font-bold">Excluidos</div></div>
                            </div>

                            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 mt-1 text-xs text-yellow-800 font-medium flex items-start gap-2">
                                <Icon name="info" size={16} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                                <span><strong>GUÍA OPERATIVA:</strong> Archivo descargado automáticamente. Recuerde cargar los registros resultantes en <strong>Vocalcom - Sitio Multisector Outbound</strong>.</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const TaskCargaLaPolar = ({ Icon, utils }) => {
        const [selectedCampaign, setSelectedCampaign] = useState('');
        const [openPanels, setOpenPanels] = useState({ xl: false, cofisa: false, especial: false });
        const [globalTrigger, setGlobalTrigger] = useState(0);

        const campaigns = [
            { id: 'xl', code: 'LAPOLAR_AVANCE_XL', name: 'La Polar Avance XL' },
            { id: 'cofisa', code: 'LAPOLAR_AVANCE_XL_COFISA', name: 'La Polar Avance XL Cofisa' },
            { id: 'especial', code: 'LAPOLAR_AVANCE_XL_ESPECIAL', name: 'La Polar Avance XL Especial' }
        ];

        useEffect(() => {
            if (selectedCampaign === 'todas') setOpenPanels({ xl: true, cofisa: true, especial: true });
            else setOpenPanels({ xl: selectedCampaign === 'xl', cofisa: selectedCampaign === 'cofisa', especial: selectedCampaign === 'especial' });
        }, [selectedCampaign]);

        const togglePanel = (panelId) => {
            if (selectedCampaign === 'todas') setOpenPanels(prev => ({ ...prev, [panelId]: !prev[panelId] }));
        };

        return (
            <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full animate-fade-in">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-gray-200 pb-4 gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                            <Icon name="shopping-bag" className="text-sky-600" />
                            Carga La Polar
                        </h2>
                        <p className="text-gray-500 text-sm mt-1">Homologación dinámica, depuración y carga para Vocalcom Outbound.</p>
                    </div>
                    <div className="flex items-center bg-gray-100 p-1.5 rounded-lg border border-gray-200 shadow-sm">
                        <Icon name="filter" size={16} className="text-gray-500 ml-2 mr-1" />
                        <select className="bg-transparent text-sm font-bold text-gray-700 outline-none pr-4 py-1 cursor-pointer" value={selectedCampaign} onChange={(e) => setSelectedCampaign(e.target.value)}>
                            <option value="" disabled>Seleccione una campaña...</option>
                            {campaigns.map(c => <option key={c.id} value={c.id}>{c.code}</option>)}
                            <option value="todas">⚙️ Gestionar Todas Juntas</option>
                        </select>
                    </div>
                </div>

                {selectedCampaign === '' && (
                    <div className="bg-white p-12 rounded-lg border border-gray-200 text-center shadow-sm mt-2">
                        <div className="w-20 h-20 bg-sky-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-sky-100">
                            <Icon name="git-merge" size={40} className="text-sky-400" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-700 mb-2">Motor de Homologación Inteligente</h3>
                        <p className="text-gray-500 max-w-md mx-auto text-sm">
                            Selecciona una campaña para subir tus archivos. El sistema auto-detectará diferencias de columnas y te permitirá unificarlas interactivamente.
                        </p>
                    </div>
                )}

                {selectedCampaign === 'todas' && (
                    <div className="bg-slate-800 p-4 rounded-lg flex flex-col md:flex-row justify-between items-center shadow-md mb-2">
                        <div className="mb-3 md:mb-0 text-center md:text-left">
                            <h3 className="text-white font-bold text-lg flex items-center gap-2 justify-center md:justify-start"><Icon name="layers" size={20} /> Carga Simultánea</h3>
                            <p className="text-slate-300 text-sm">Ejecuta el análisis de todas las campañas en paralelo.</p>
                        </div>
                        <button type="button" onClick={() => setGlobalTrigger(prev => prev + 1)} className="bg-emerald-500 text-white px-6 py-2 rounded-lg font-bold hover:bg-emerald-600 flex items-center gap-2 shadow-sm">
                            <Icon name="cpu" size={18} /> Iniciar Análisis
                        </button>
                    </div>
                )}

                <div className="flex flex-col gap-1">
                    {campaigns.map(camp => (
                        (selectedCampaign === camp.id || selectedCampaign === 'todas') && (
                            <PanelLaPolar
                                key={camp.id} title={camp.name} campaignCode={camp.code}
                                isOpen={openPanels[camp.id]} onToggle={() => togglePanel(camp.id)}
                                globalTrigger={globalTrigger} Icon={Icon} utils={utils}
                            />
                        )
                    ))}
                </div>
            </div>
        );
    };


    // ========================================================================
    // ⬇️ PEGAR AQUÍ ABAJO EL CÓDIGO DE LA SIGUIENTE TAREA ⬇️
    // ========================================================================  

    // ========================================================================
    // TAREA 9: Carga Coopeuch
    // ========================================================================

    const PanelCoopeuch = ({ title, campaignCode, isOpen, onToggle, globalTrigger, Icon }) => {
        const [baseFiles, setBaseFiles] = useState([]);
        const [baseDate, setBaseDate] = useState(new Date().toISOString().split('T')[0]);
        const [exportFormat, setExportFormat] = useState('xls');

        const [isProcessing, setIsProcessing] = useState(false);
        const [processReport, setProcessReport] = useState(null);
        const [panelMessage, setPanelMessage] = useState({ type: '', text: '' });

        // --- ESTADOS DE CRUCE/EXCLUSIÓN ---
        const [useCruce, setUseCruce] = useState(false);
        const [cruceFile, setCruceFile] = useState(null);
        const [cruceSqlMode, setCruceSqlMode] = useState(false);
        const [cruceSqlQuery, setCruceSqlQuery] = useState('');
        const [cruceSqlData, setCruceSqlData] = useState(null);

        // --- ESTADOS DE CONTRASEÑA ---
        const [protectedFiles, setProtectedFiles] = useState([]); // [{ file, name }]
        const [samePassword, setSamePassword] = useState(true);
        const [globalPassword, setGlobalPassword] = useState('');
        const [filePasswords, setFilePasswords] = useState({}); // { fileName: 'pass' }
        const [showPasswordUI, setShowPasswordUI] = useState(false);
        const [parsedData, setParsedData] = useState([]); // Datos ya leídos exitosamente

        useEffect(() => {
            if (globalTrigger > 0 && (parsedData.length > 0 || baseFiles.length > 0) && !isProcessing) handleProcess();
        }, [globalTrigger]);

        const [priorizarCel, setPriorizarCel] = useState(true);
        const [pendientesHojas, setPendientesHojas] = useState([]);
        const [sheetSelections, setSheetSelections] = useState({});

        const readFile = (file, password, sheetName) => {
            return new Promise((resolve, reject) => {
                if (file.name.toLowerCase().endsWith('.csv') || file.name.toLowerCase().endsWith('.txt')) {
                    window.Papa.parse(file, { header: true, skipEmptyLines: true, complete: (res) => resolve(res.data), error: reject });
                    return;
                }

                const reader = new FileReader();
                reader.onload = async (e) => {
                    const buffer = e.target.result;
                    try {
                        let wb;
                        if (!password) {
                            wb = window.XLSX.read(new Uint8Array(buffer), { type: 'array' });
                        } else {
                            const decrypted = await decryptExcelBuffer(buffer, password);
                            wb = window.XLSX.read(decrypted, { type: 'array' });
                        }
                        if (wb.SheetNames.length > 1 && !sheetName) {
                            resolve({ multiSheet: true, sheetNames: wb.SheetNames });
                            return;
                        }
                        const targetSheet = sheetName || wb.SheetNames[0];
                        resolve(window.XLSX.utils.sheet_to_json(wb.Sheets[targetSheet], { defval: "" }));
                    } catch (err) { reject(err); }
                };
                reader.readAsArrayBuffer(file);
            });
        };

        // --- FASE 1: CARGA Y DETECCIÓN DE ARCHIVOS PROTEGIDOS ---
        const handleFileLoad = async (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;

            setBaseFiles(files);
            setParsedData([]);
            setProtectedFiles([]);
            setShowPasswordUI(false);
            setGlobalPassword('');
            setFilePasswords({});
            setPanelMessage({ type: '', text: '' });
            setProcessReport(null);

            let okData = [];
            let blocked = [];

            for (const file of files) {
                try {
                    const data = await readFile(file, null, sheetSelections[file.name]);
                    if (data && data.multiSheet) { blocked.push({ file, name: file.name, sheetNames: data.sheetNames }); continue; }
                    okData = okData.concat(data);
                } catch (err) {
                    blocked.push({ file, name: file.name });
                }
            }

            const multiSheetFiles = blocked.filter(b => b.sheetNames);
            const realBlocked = blocked.filter(b => !b.sheetNames);

            if (multiSheetFiles.length > 0) {
                setPendientesHojas(multiSheetFiles.map(b => ({ name: b.name, sheetNames: b.sheetNames })));
            }

            if (realBlocked.length > 0) {
                setProtectedFiles(realBlocked);
                setShowPasswordUI(true);
                setParsedData(okData);
                setPanelMessage({ type: 'warning', text: `${realBlocked.length} archivo(s) protegido(s) con contraseña. Ingresa las credenciales para desbloquearlos.` });
            } else {
                setParsedData(okData);
                setPanelMessage({ type: 'success', text: `${files.length} archivo(s) cargado(s) correctamente (${okData.length} registros).` });
            }

            e.target.value = '';
        };

        // --- PROCESO UNIFICADO: DESBLOQUEO + PROCESAMIENTO ---
        const handleProcess = async () => {
            setPanelMessage({ type: '', text: '' });
            setProcessReport(null);

            if (baseFiles.length === 0) {
                setPanelMessage({ type: 'error', text: 'Debes cargar al menos un archivo.' });
                return;
            }

            setIsProcessing(true);

            // A. Desbloquear archivos protegidos pendientes
            let allData = [...parsedData];

            if (protectedFiles.length > 0) {
                let stillBlocked = [];
                for (const pf of protectedFiles) {
                    const pass = samePassword ? globalPassword : (filePasswords[pf.name] || '');

                    if (!pass) { stillBlocked.push(pf); continue; }
                    try {
                        const data = await readFile(pf.file, pass, sheetSelections[pf.name]);
                        if (data && data.multiSheet) { stillBlocked.push(pf); continue; }
                        allData = allData.concat(data);

                    } catch (err) {

                        stillBlocked.push(pf);
                    }
                }

                if (stillBlocked.length > 0) {
                    setProtectedFiles(stillBlocked);
                    setPanelMessage({ type: 'error', text: `${stillBlocked.length} archivo(s) no se pudieron desbloquear. Verifica las contraseñas.` });
                    setIsProcessing(false);
                    return;
                }

                setProtectedFiles([]);
                setShowPasswordUI(false);
                setParsedData(allData);
            }

            if (allData.length === 0) {
                setPanelMessage({ type: 'warning', text: 'No hay registros para procesar.' });
                setIsProcessing(false);
                return;
            }

            try {
                const [y, m, d] = baseDate.split('-');
                const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
                const dateObj = new Date(y, m - 1, d);
                const baseStr = `BASE_${d}_${m}_${y}`;
                const mesCargaStr = `${monthNames[dateObj.getMonth()]}_${String(y).slice(-2)}`;

                // --- EXCLUSIÓN POR LISTA DE CRUCE ---
                let exclusionSet = new Set();
                if (useCruce && cruceSqlMode && cruceSqlData) {
                    cruceSqlData.forEach(row => {
                        const rKey = Object.keys(row).find(k => /rut/i.test(k));
                        if (rKey && row[rKey]) { const rLimpio = String(row[rKey]).split('-')[0].replace(/\D/g, ''); if (rLimpio) exclusionSet.add(rLimpio); }
                    });
                } else if (useCruce && cruceFile) {
                    const cruceData = await readFile(cruceFile, null, sheetSelections[cruceFile.name]);
                    cruceData.forEach(row => {
                        const rKey = Object.keys(row).find(k => /rut/i.test(k));
                        if (rKey && row[rKey]) {
                            const rLimpio = String(row[rKey]).split('-')[0].replace(/\D/g, '');
                            if (rLimpio) exclusionSet.add(rLimpio);
                        }
                    });
                }

                // --- A. DETECCIÓN INTELIGENTE DE COLUMNAS DE NOMBRE ---
                const sampleKeys = Object.keys(allData[0] || {});
                const upperKeys = sampleKeys.map(k => ({ original: k, upper: k.toUpperCase().trim() }));

                const nameVariants = ['NOMBRE', 'NOMBRES', 'NOMBRE_CLIENTE', 'NOMBRE CLIENTE', 'NAME', 'FIRST_NAME', 'PRIMER_NOMBRE'];
                const lastNameVariants = ['APELLIDO', 'APELLIDOS', 'APELLIDO_PATERNO', 'PATERNO', 'APELLIDO_MATERNO', 'MATERNO', 'LAST_NAME', 'SEGUNDO_APELLIDO', 'APELLIDO PATERNO', 'APELLIDO MATERNO', 'AP_PATERNO', 'AP_MATERNO'];

                const nameColKeys = upperKeys.filter(k => nameVariants.includes(k.upper));
                const lastNameColKeys = upperKeys.filter(k => lastNameVariants.includes(k.upper));

                const hasLastNameCols = lastNameColKeys.length > 0;

                // --- B. DETECCIÓN DE COLUMNAS DE TELÉFONO ---
                const phonePatterns = /^(CELULAR|TELEFONO|TELEFONO_PRIMARIO|TELEFONO_SECUNDARIO|FONO|PHONE|TEL_|MOVIL|CONTACTO_TEL)/i;
                const phoneColKeys = upperKeys.filter(k => phonePatterns.test(k.upper));

                // --- DEBUG TEL (TEMPORAL) ---
                console.log('[T9-DEBUG] phoneColKeys:', phoneColKeys.map(pk => pk.original));
                console.log('[T9-DEBUG] Primera fila phones:', phoneColKeys.map(pk => ({ col: pk.original, val: allData[0][pk.original], type: typeof allData[0][pk.original] })));
                // Buscar una fila con 3 teléfonos válidos para debug
                const debugRow = allData.find(r => {
                    let count = 0;
                    phoneColKeys.forEach(pk => { if (cleanPhone(r[pk.original])) count++; });
                    return count >= 3;
                });
                if (debugRow) {
                    console.log('[T9-DEBUG] Fila con 3+ phones:', phoneColKeys.map(pk => ({ col: pk.original, raw: debugRow[pk.original], cleaned: cleanPhone(debugRow[pk.original]) })));
                }

                // --- C. PROCESAMIENTO FILA POR FILA ---
                let processedData = [];
                let stats = { loaded: allData.length, valid: 0, duplicates: 0 };

                let excluidosCount = 0;

                // Pre-cálculo: máximo de teléfonos válidos en toda la base
                let maxPhonesFound = 0;
                allData.forEach(row => {
                    let count = 0;
                    phoneColKeys.forEach(pk => {
                        const cleaned = cleanPhone(row[pk.original]);
                        if (cleaned && !isJunkPhone(cleaned)) count++;
                    });
                    if (count > maxPhonesFound) maxPhonesFound = count;
                });

                allData.forEach(row => {
                    // Exclusión por cruce
                    if (useCruce && exclusionSet.size > 0) {
                        const rKey = sampleKeys.find(k => /^(RUT|rut|Rut)$/i.test(k.trim()));
                        if (rKey) {
                            const rLimpio = String(row[rKey] || '').split('-')[0].replace(/\D/g, '');
                            if (rLimpio && exclusionSet.has(rLimpio)) { excluidosCount++; return; }
                        }
                    }

                    let obj = {};

                    // C.1 Copiar columnas originales tal cual (la limpieza de nombres se hace en C.2)
                    sampleKeys.forEach(k => {
                        obj[k] = row[k];
                    });

                    // C.2 Tratamiento de NOMBRE
                    if (hasLastNameCols) {
                        // Unificar: tomar nombres + todos los apellidos
                        let parts = [];
                        nameColKeys.forEach(nk => {
                            const val = cleanNames(row[nk.original]);
                            if (val) parts.push(val);
                        });
                        lastNameColKeys.forEach(lk => {
                            const val = cleanNames(row[lk.original]);
                            if (val) parts.push(val);
                        });
                        obj['NOMBRE'] = parts.join(' ');

                        // Eliminar columnas originales de nombre y apellido (serán reemplazadas por NOMBRE)
                        nameColKeys.forEach(nk => { if (nk.original !== 'NOMBRE') delete obj[nk.original]; });
                        lastNameColKeys.forEach(lk => delete obj[lk.original]);
                    } else {
                        // Solo viene nombre (ya es completo), renombrar a NOMBRE
                        if (nameColKeys.length > 0) {
                            const firstNameCol = nameColKeys[0].original;
                            if (firstNameCol !== 'NOMBRE') {
                                obj['NOMBRE'] = obj[firstNameCol];
                                delete obj[firstNameCol];
                            }
                        }
                    }

                    // C.3 Extracción, limpieza y deduplicación de teléfonos
                    const rawPhoneVals = phoneColKeys.map(pk => row[pk.original]);
                    let phones = depurarTelefonos(rawPhoneVals, priorizarCel);

                    // TEL_1 nunca vacío
                    if (phones.length === 0) phones.push('999999999');

                    // Asignar TEL_1 a TEL_n como número (columnas homogéneas en toda la base)
                    for (let i = 0; i < maxPhonesFound; i++) {
                        obj[`TEL_${i + 1}`] = phones[i] ? Number(phones[i]) : '';
                    }

                    // C.4 Columnas de cierre
                    obj['CAMPANA'] = campaignCode;
                    obj['BASE'] = baseStr;
                    obj['MES_CARGA'] = mesCargaStr;

                    processedData.push(obj);
                });

                // --- D. DEDUPLICACIÓN POR RUT (primera aparición prevalece) ---
                const rutKey = sampleKeys.find(k => /^(RUT|rut|Rut)$/i.test(k.trim()));
                const deduped = new Map();
                processedData.forEach(row => {
                    const r = rutKey ? String(row[rutKey] || '').split('-')[0].replace(/\D/g, '') : null;
                    if (r) {
                        if (!deduped.has(r)) deduped.set(r, row);
                        else stats.duplicates++;
                    } else {
                        deduped.set(`_noRut_${deduped.size}`, row);
                    }
                });
                processedData = Array.from(deduped.values());

                stats.valid = processedData.length;
                stats.excluded = excluidosCount;
                setProcessReport(stats);

                if (stats.valid === 0) {
                    setPanelMessage({ type: 'warning', text: 'No hay registros para exportar.' });
                    setIsProcessing(false);
                    return;
                }

                // --- E. EXPORTACIÓN LIMPIA ---
                const { ws, cleanData } = crearSheetLimpio(processedData);

                const wb = window.XLSX.utils.book_new();
                window.XLSX.utils.book_append_sheet(wb, ws, "Coopeuch");

                const safeCampaign = campaignCode.replace(/[\/\\?%*:|"<>]/g, '-');
                window.XLSX.writeFile(wb, `CARGA_${safeCampaign}_${d}_${m}_${y}.${exportFormat}`);

                setPanelMessage({ type: 'success', text: `¡Carga generada! ${cleanData.length} registros exportados.` });

            } catch (error) {
                setPanelMessage({ type: 'error', text: 'Error en proceso: ' + error.message });
            } finally {
                setIsProcessing(false);
            }
        };

        return (
            <div className="border border-gray-200 rounded-lg bg-white overflow-hidden mb-4 shadow-sm">
                <div className="bg-teal-800 p-4 flex justify-between items-center cursor-pointer" onClick={onToggle}>
                    <h3 className="font-bold text-white flex items-center gap-2">
                        <Icon name="credit-card" size={18} /> {title} ({campaignCode})
                    </h3>
                    <Icon name={isOpen ? "chevron-up" : "chevron-down"} className="text-white opacity-70" size={20} />
                </div>

                <div className={isOpen ? "p-5 animate-fade-in flex flex-col gap-5" : "hidden"}>
                    {/* CONTROLES SUPERIORES */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
                        <div className="flex flex-col">
                            <label className="text-xs font-bold text-gray-600 mb-1">Fecha de Proceso</label>
                            <input type="date" className="border border-gray-300 rounded p-1.5 text-sm outline-none font-medium" value={baseDate} onChange={(e) => setBaseDate(e.target.value)} />
                        </div>
                        <div className="flex flex-col">
                            <label className="text-xs font-bold text-gray-600 mb-1">Formato de Salida</label>
                            <select className="border border-gray-300 rounded p-1.5 text-sm outline-none font-medium" value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
                                <option value="xls">Excel 97-2003 (.xls)</option>
                                <option value="xlsx">Excel Moderno (.xlsx)</option>
                            </select>
                        </div>
                        <div className="flex flex-col items-center justify-center">
                            <label className="text-xs font-bold text-gray-600 mb-1">Priorizar Celulares</label>
                            <div className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${priorizarCel ? 'bg-teal-600' : 'bg-gray-300'}`} onClick={() => setPriorizarCel(!priorizarCel)}>
                                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${priorizarCel ? 'translate-x-6' : ''}`}></div>
                            </div>
                        </div>
                    </div>

                    {pendientesHojas.length > 0 && (
                        <SelectorHojas
                            pendientes={pendientesHojas}
                            Icon={Icon}
                            onConfirm={(sel) => { setSheetSelections(prev => ({ ...prev, ...sel })); setPendientesHojas([]); }}
                            onCancel={() => setPendientesHojas([])}
                        />
                    )}
                    {/* ZONA DE CARGA */}
                    <div className="border-2 border-dashed border-teal-300 bg-teal-50 p-6 rounded-lg text-center relative flex flex-col justify-center">
                        <input type="file" multiple accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={handleFileLoad} />
                        <Icon name="upload-cloud" size={32} className="mx-auto text-teal-500 mb-2" />
                        <h4 className="font-bold text-teal-800 text-sm">Archivos Base Coopeuch</h4>
                        <p className="text-xs text-teal-600 mt-1">
                            {baseFiles.length > 0
                                ? `${baseFiles.length} archivo(s) cargado(s)`
                                : 'Haz clic o arrastra los archivos aquí'}
                        </p>
                        {baseFiles.length > 0 && (
                            <p className="text-xs text-teal-700 mt-2 font-mono bg-teal-100 inline-block px-2 py-1 rounded mx-auto">
                                {baseFiles[0].name} {baseFiles.length > 1 ? `y ${baseFiles.length - 1} más...` : ''}
                            </p>
                        )}
                    </div>

                    {/* CRUCE / EXCLUSIÓN */}
                    <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-bold text-gray-700">Excluir por Lista de RUT</label>
                            <div
                                className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${useCruce ? 'bg-teal-600' : 'bg-gray-300'}`}
                                onClick={() => setUseCruce(!useCruce)}
                            >
                                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${useCruce ? 'translate-x-6' : ''}`}></div>
                            </div>
                        </div>
                        {useCruce && (
                            <div className="flex flex-col gap-2 mt-3 animate-fade-in">
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <button type="button" onClick={() => { setCruceSqlMode(false); setCruceSqlData(null); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #6366f1', background: !cruceSqlMode ? '#6366f1' : 'white', color: !cruceSqlMode ? 'white' : '#6366f1', cursor: 'pointer' }}>📂 Archivo</button>
                                    <button type="button" onClick={() => { setCruceSqlMode(true); setCruceFile(null); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #3b82f6', background: cruceSqlMode ? '#3b82f6' : 'white', color: cruceSqlMode ? 'white' : '#3b82f6', cursor: 'pointer' }}>⚡ SQL</button>
                                </div>
                                {!cruceSqlMode ? (
                                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center bg-gray-50 hover:bg-gray-100 relative">
                                        <input type="file" accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={(e) => setCruceFile(e.target.files[0])} />
                                        <Icon name="shield" size={20} className="mx-auto text-gray-400 mb-1" />
                                        <p className="text-xs font-medium text-gray-600">{cruceFile ? <span className="text-emerald-600 font-bold">{cruceFile.name}</span> : 'Cargar lista de RUT a excluir'}</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-1">
                                        <textarea style={{ width: '100%', minHeight: '70px', padding: '0.5rem', border: '2px solid #3b82f6', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.75rem', resize: 'vertical', boxSizing: 'border-box' }} value={cruceSqlQuery} onChange={e => setCruceSqlQuery(e.target.value)} placeholder="SELECT RUT FROM tabla WHERE..." />
                                        <button type="button" style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', background: '#3b82f6', color: 'white', border: 'none', cursor: 'pointer', alignSelf: 'flex-start' }} onClick={async () => {
                                            if (!cruceSqlQuery.trim()) return;
                                            const r = await window.nexusAPI.executeSQL(cruceSqlQuery);
                                            if (!r.success) { setPanelMessage({ type: 'error', text: 'Error SQL: ' + r.error }); return; }
                                            setCruceSqlData(r.data);
                                            setPanelMessage({ type: 'success', text: `${r.data.length} registros cargados desde SQL.` });
                                        }}>⚡ Ejecutar</button>
                                        {cruceSqlData && <p className="text-xs text-emerald-600 font-bold">✓ {cruceSqlData.length} registros cargados</p>}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* UI DE CONTRASEÑAS */}
                    {showPasswordUI && protectedFiles.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 flex flex-col gap-4 animate-fade-in">
                            <div className="flex items-start gap-3">
                                <Icon name="lock" size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
                                <div>
                                    <h4 className="text-sm font-bold text-amber-800">Archivos Protegidos ({protectedFiles.length})</h4>
                                    <p className="text-xs text-amber-700 mt-1">Estos archivos requieren contraseña para ser leídos.</p>
                                </div>
                            </div>

                            {/* Switch: misma contraseña o por archivo */}
                            <div className="flex items-center gap-3 bg-white p-3 rounded border border-amber-200">
                                <div
                                    className={`w-10 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-colors ${samePassword ? 'bg-amber-600' : 'bg-gray-300'}`}
                                    onClick={() => setSamePassword(!samePassword)}
                                >
                                    <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${samePassword ? 'translate-x-5' : ''}`}></div>
                                </div>
                                <span className="text-xs font-bold text-gray-700">
                                    {samePassword ? 'Misma contraseña para todos' : 'Contraseña por archivo'}
                                </span>
                            </div>

                            {samePassword ? (
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="Contraseña para todos los archivos"
                                        className="flex-1 border border-amber-300 rounded p-2 text-sm outline-none focus:border-amber-500 bg-white font-mono"
                                        value={globalPassword}
                                        onChange={(e) => setGlobalPassword(e.target.value)}
                                    />
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
                                    {protectedFiles.map((pf, idx) => (
                                        <div key={idx} className="flex items-center gap-2 bg-white p-2 rounded border border-gray-200">
                                            <Icon name="file-code" size={14} className="text-amber-500 flex-shrink-0" />
                                            <span className="text-xs font-mono text-gray-700 truncate flex-1">{pf.name}</span>
                                            <input
                                                type="text"
                                                placeholder="Contraseña"
                                                className="w-40 border border-gray-300 rounded p-1.5 text-xs outline-none focus:border-amber-500 font-mono"
                                                value={filePasswords[pf.name] || ''}
                                                onChange={(e) => setFilePasswords(prev => ({ ...prev, [pf.name]: e.target.value }))}
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* REPORTE */}
                    {processReport && (
                        <div className="bg-white p-5 rounded-lg border border-emerald-200 shadow-sm animate-fade-in border-l-4 border-l-emerald-500">
                            <h3 className="text-lg font-bold text-emerald-800 mb-3 flex items-center gap-2"><Icon name="check-circle" className="text-emerald-600" /> Reporte de Procesamiento</h3>
                            <div className={`grid grid-cols-2 ${processReport.excluded > 0 ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-4 text-center`}>
                                <div className="bg-gray-50 p-3 rounded border border-gray-200"><div className="text-2xl font-black text-gray-700">{processReport.loaded}</div><div className="text-[10px] text-gray-500 uppercase font-bold">Leídos</div></div>
                                <div className="bg-blue-50 p-3 rounded border border-blue-200"><div className="text-2xl font-black text-blue-700">{processReport.valid}</div><div className="text-[10px] text-blue-500 uppercase font-bold">Exportados</div></div>
                                <div className="bg-amber-50 p-3 rounded border border-amber-200"><div className="text-2xl font-black text-amber-700">{processReport.duplicates}</div><div className="text-[10px] text-amber-500 uppercase font-bold">Duplicados</div></div>
                                {processReport.excluded > 0 && (
                                    <div className="bg-purple-50 p-3 rounded border border-purple-200"><div className="text-2xl font-black text-purple-700">{processReport.excluded}</div><div className="text-[10px] text-purple-500 uppercase font-bold">Excluidos</div></div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* MENSAJES */}
                    {panelMessage.text && !processReport && (
                        <div className={`p-3 rounded-lg border text-sm font-bold flex items-center gap-2 ${panelMessage.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : panelMessage.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                            <Icon name={panelMessage.type === 'error' ? 'alert-triangle' : panelMessage.type === 'warning' ? 'alert-circle' : 'check-circle'} size={18} />
                            {panelMessage.text}
                        </div>
                    )}

                    {/* BOTÓN PROCESAR */}
                    <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); handleProcess(); }}
                        disabled={isProcessing || baseFiles.length === 0}
                        className={`w-full py-3 rounded-lg font-bold text-white flex justify-center items-center gap-2 ${isProcessing || baseFiles.length === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-teal-700 hover:bg-teal-800'}`}
                    >
                        {isProcessing ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Icon name="play" size={18} />}
                        Procesar y Exportar Carga
                    </button>
                </div>
            </div>
        );
    };

    const TaskCargaCoopeuch = ({ Icon }) => {
        const [selectedCampaign, setSelectedCampaign] = useState('');
        const [openPanels, setOpenPanels] = useState({
            cambio_pin: false, cambio_pin_tc: false, renovacion_expirada: false,
            renovacion_normal: false, retira_tarjeta: false, retira_tc: false, retira_td: false
        });
        const [globalTrigger, setGlobalTrigger] = useState(0);

        const campaigns = [
            { id: 'cambio_pin', code: 'COOPEUCH_CAMBIO_PIN', name: 'Cambio Pin' },
            { id: 'cambio_pin_tc', code: 'COOPEUCH_CAMBIO_PIN_TC', name: 'Cambio Pin TC' },
            { id: 'renovacion_expirada', code: 'COOPEUCH_RENOVACION_EXPIRADA', name: 'Renovación Expirada' },
            { id: 'renovacion_normal', code: 'COOPEUCH_RENOVACION_NORMAL', name: 'Renovación Normal' },
            { id: 'retira_tarjeta', code: 'COOPEUCH_RETIRA_TARJETA', name: 'Retira Tarjeta' },
            { id: 'retira_tc', code: 'COOPEUCH_RETIRA_TC', name: 'Retira TC' },
            { id: 'retira_td', code: 'COOPEUCH_RETIRA_TD_RENOVACION', name: 'Retira TD Renovación' }
        ];

        useEffect(() => {
            if (selectedCampaign === 'todas') {
                const allOpen = {};
                campaigns.forEach(c => allOpen[c.id] = true);
                setOpenPanels(allOpen);
            } else {
                const newPanels = {};
                campaigns.forEach(c => newPanels[c.id] = (selectedCampaign === c.id));
                setOpenPanels(newPanels);
            }
        }, [selectedCampaign]);

        const togglePanel = (panelId) => {
            if (selectedCampaign === 'todas') setOpenPanels(prev => ({ ...prev, [panelId]: !prev[panelId] }));
        };

        return (
            <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full animate-fade-in">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-gray-200 pb-4 gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                            <Icon name="credit-card" className="text-teal-700" />
                            Carga Coopeuch
                        </h2>
                        <p className="text-gray-500 text-sm mt-1">Carga de bases con soporte de archivos cifrados, unificación de nombres y depuración de teléfonos.</p>
                    </div>
                    <div className="flex items-center bg-gray-100 p-1.5 rounded-lg border border-gray-200 shadow-sm">
                        <Icon name="filter" size={16} className="text-gray-500 ml-2 mr-1" />
                        <select className="bg-transparent text-sm font-bold text-gray-700 outline-none pr-4 py-1 cursor-pointer" value={selectedCampaign} onChange={(e) => setSelectedCampaign(e.target.value)}>
                            <option value="" disabled>Seleccione una campaña...</option>
                            {campaigns.map(c => <option key={c.id} value={c.id}>{c.code}</option>)}
                            <option value="todas">⚙️ Gestionar Todas Juntas</option>
                        </select>
                    </div>
                </div>

                {selectedCampaign === '' && (
                    <div className="bg-white p-12 rounded-lg border border-gray-200 text-center shadow-sm mt-2">
                        <div className="w-20 h-20 bg-teal-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-teal-100">
                            <Icon name="lock" size={40} className="text-teal-400" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-700 mb-2">Área de Trabajo Lista</h3>
                        <p className="text-gray-500 max-w-md mx-auto text-sm">
                            Selecciona una campaña específica en el menú superior o elige <strong>"Gestionar Todas Juntas"</strong> para habilitar los paneles. Soporta archivos cifrados con contraseña.
                        </p>
                    </div>
                )}

                {selectedCampaign === 'todas' && (
                    <div className="bg-slate-800 p-4 rounded-lg flex flex-col md:flex-row justify-between items-center shadow-md mb-2">
                        <div className="mb-3 md:mb-0 text-center md:text-left">
                            <h3 className="text-white font-bold text-lg flex items-center gap-2 justify-center md:justify-start"><Icon name="layers" size={20} /> Ejecución en Lote</h3>
                            <p className="text-slate-300 text-sm">Procesará automáticamente todas las campañas que tengan bases cargadas.</p>
                        </div>
                        <button type="button" onClick={() => setGlobalTrigger(prev => prev + 1)} className="bg-emerald-500 text-white px-6 py-2 rounded-lg font-bold hover:bg-emerald-600 flex items-center gap-2 shadow-sm w-full md:w-auto justify-center">
                            <Icon name="play" size={18} /> Procesar Todo
                        </button>
                    </div>
                )}

                <div className="flex flex-col gap-1">
                    {campaigns.map(camp => (
                        (selectedCampaign === camp.id || selectedCampaign === 'todas') && (
                            <PanelCoopeuch
                                key={camp.id} title={camp.name} campaignCode={camp.code}
                                isOpen={openPanels[camp.id]} onToggle={() => togglePanel(camp.id)}
                                globalTrigger={globalTrigger} Icon={Icon}
                            />
                        )
                    ))}
                </div>
            </div>
        );
    };


    // ========================================================================
    // ⬇️ PEGAR AQUÍ ABAJO EL CÓDIGO DE LA SIGUIENTE TAREA ⬇️
    // ========================================================================        

    // ========================================================================
    // TAREA 10: Carga Banco de Chile
    // ========================================================================

    // --- PANEL BCH CONSUMO ---
    const PanelBchConsumo = ({ title, campaignCode, isOpen, onToggle, globalTrigger, Icon }) => {
        const [baseFiles, setBaseFiles] = useState([]);
        const [baseDate, setBaseDate] = useState(new Date().toISOString().split('T')[0]);
        const [exportFormat, setExportFormat] = useState('xls');
        const [priorizarCel, setPriorizarCel] = useState(true);
        const [crearNombreCompleto, setCrearNombreCompleto] = useState(false);
        const [ordenAleatorio, setOrdenAleatorio] = useState(false);

        const [isProcessing, setIsProcessing] = useState(false);
        const [processReport, setProcessReport] = useState(null);
        const [panelMessage, setPanelMessage] = useState({ type: '', text: '' });

        // Cruce
        const [useCruce, setUseCruce] = useState(false);
        const [cruceFile, setCruceFile] = useState(null);
        const [cruceSqlMode, setCruceSqlMode] = useState(false);
        const [cruceSqlQuery, setCruceSqlQuery] = useState('');
        const [cruceSqlData, setCruceSqlData] = useState(null);

        // Contraseña
        const [protectedFiles, setProtectedFiles] = useState([]);
        const [samePassword, setSamePassword] = useState(true);
        const [globalPassword, setGlobalPassword] = useState('');
        const [filePasswords, setFilePasswords] = useState({});
        const [showPasswordUI, setShowPasswordUI] = useState(false);
        const [parsedData, setParsedData] = useState([]);
        const [pendientesHojas, setPendientesHojas] = useState([]);
        const [sheetSelections, setSheetSelections] = useState({});

        useEffect(() => {
            if (globalTrigger > 0 && (parsedData.length > 0 || baseFiles.length > 0) && !isProcessing) handleProcess();
        }, [globalTrigger]);

        const readFile = (file, password, sheetName) => {
            return new Promise((resolve, reject) => {
                if (file.name.toLowerCase().endsWith('.csv') || file.name.toLowerCase().endsWith('.txt')) {
                    window.Papa.parse(file, { header: true, skipEmptyLines: true, complete: (res) => resolve(res.data), error: reject });
                    return;
                }
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const buffer = e.target.result;
                    try {
                        let wb;
                        if (!password) {
                            wb = window.XLSX.read(new Uint8Array(buffer), { type: 'array' });
                        } else {
                            const decrypted = await decryptExcelBuffer(buffer, password);
                            wb = window.XLSX.read(decrypted, { type: 'array' });
                        }
                        if (wb.SheetNames.length > 1 && !sheetName) {
                            resolve({ multiSheet: true, sheetNames: wb.SheetNames });
                            return;
                        }
                        const targetSheet = sheetName || wb.SheetNames[0];
                        resolve(window.XLSX.utils.sheet_to_json(wb.Sheets[targetSheet], { defval: "" }));
                    } catch (err) { reject(err); }
                };
                reader.readAsArrayBuffer(file);
            });
        };

        const handleFileLoad = async (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;
            setBaseFiles(files); setParsedData([]); setProtectedFiles([]); setShowPasswordUI(false);
            setGlobalPassword(''); setFilePasswords({}); setPanelMessage({ type: '', text: '' }); setProcessReport(null);
            let okData = [], blocked = [];
            for (const file of files) {
                try { const data = await readFile(file, null, sheetSelections[file.name]); if (data && data.multiSheet) { blocked.push({ file, name: file.name, sheetNames: data.sheetNames }); continue; } okData = okData.concat(data); }
                catch (err) { blocked.push({ file, name: file.name }); }
            }
            const multiSheetFiles = blocked.filter(b => b.sheetNames);
            const realBlocked = blocked.filter(b => !b.sheetNames);
            if (multiSheetFiles.length > 0) {
                setPendientesHojas(multiSheetFiles.map(b => ({ name: b.name, sheetNames: b.sheetNames })));
            }
            if (realBlocked.length > 0) {
                setProtectedFiles(realBlocked); setShowPasswordUI(true); setParsedData(okData);
                setPanelMessage({ type: 'warning', text: `${realBlocked.length} archivo(s) protegido(s). Ingresa las credenciales.` });
            } else {
                setParsedData(okData);
                setPanelMessage({ type: 'success', text: `${files.length} archivo(s) cargado(s) (${okData.length} registros).` });
            }
            e.target.value = '';
        };

        const handleProcess = async () => {
            setPanelMessage({ type: '', text: '' }); setProcessReport(null);
            if (baseFiles.length === 0) { setPanelMessage({ type: 'error', text: 'Debes cargar al menos un archivo.' }); return; }
            setIsProcessing(true);

            let allData = [...parsedData];
            if (protectedFiles.length > 0) {
                let stillBlocked = [];
                for (const pf of protectedFiles) {
                    const pass = samePassword ? globalPassword : (filePasswords[pf.name] || '');
                    if (!pass) { stillBlocked.push(pf); continue; }
                    try { const data = await readFile(pf.file, pass, sheetSelections[pf.name]); if (data && data.multiSheet) { stillBlocked.push(pf); continue; } allData = allData.concat(data); }
                    catch (err) { stillBlocked.push(pf); }
                }
                if (stillBlocked.length > 0) {
                    setProtectedFiles(stillBlocked);
                    setPanelMessage({ type: 'error', text: `${stillBlocked.length} archivo(s) no se pudieron desbloquear.` });
                    setIsProcessing(false); return;
                }
                setProtectedFiles([]); setShowPasswordUI(false); setParsedData(allData);
            }
            if (allData.length === 0) { setPanelMessage({ type: 'warning', text: 'No hay registros.' }); setIsProcessing(false); return; }

            try {
                const [y, m, d] = baseDate.split('-');
                const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
                const dateObj = new Date(y, m - 1, d);
                const baseStr = `BASE_${d}_${m}_${y}`;
                const mesCargaStr = `${monthNames[dateObj.getMonth()]}_${String(y).slice(-2)}`;

                // Exclusión por ROW_ID
                let exclusionSet = new Set();
                if (useCruce && cruceSqlMode && cruceSqlData) {
                    cruceSqlData.forEach(row => {
                        const id = row.ROW_ID || row.row_id || row.vendor_lead_code || row.VENDOR_LEAD_CODE || '';
                        if (id) exclusionSet.add(String(id).trim());
                    });
                } else if (useCruce && cruceFile) {
                    const cruceData = await readFile(cruceFile, null, sheetSelections[cruceFile.name]);
                    cruceData.forEach(row => {
                        const id = row.ROW_ID || row.row_id || row.vendor_lead_code || row.VENDOR_LEAD_CODE || '';
                        if (id) exclusionSet.add(String(id).trim());
                    });
                }

                const sampleKeys = Object.keys(allData[0] || {});

                // Detectar columnas FONO
                const fonoColKeys = sampleKeys.filter(k => /^FONO\d+$/i.test(k));

                // Pre-cálculo maxPhones
                let maxPhonesFound = 0;
                allData.forEach(row => {
                    const rawVals = fonoColKeys.map(k => row[k]);
                    const cleaned = depurarTelefonos(rawVals, priorizarCel);
                    if (cleaned.length > maxPhonesFound) maxPhonesFound = cleaned.length;
                });

                let processedData = [];
                let stats = { loaded: allData.length, valid: 0, duplicates: 0, excluded: 0 };

                allData.forEach(row => {
                    const rowId = String(row.ROW_ID || row.row_id || '').trim();
                    if (useCruce && rowId && exclusionSet.has(rowId)) { stats.excluded++; return; }

                    // Copiar columnas originales en orden
                    let obj = {};
                    sampleKeys.forEach(k => { obj[k] = row[k]; });

                    // Nombre completo opcional
                    if (crearNombreCompleto) {
                        const nom = cleanNames(row.NOMBRE || row.nombre || '');
                        const pat = cleanNames(row.AP_PATERNO || row.ap_paterno || '');
                        const mat = cleanNames(row.AP_MATERNO || row.ap_materno || '');
                        obj['NOMBRE_COMPLETO'] = [nom, pat, mat].filter(Boolean).join(' ');
                    }

                    // Teléfonos: extraer, limpiar, crear TEL_1..n
                    const rawPhoneVals = fonoColKeys.map(k => row[k]);
                    const phones = depurarTelefonos(rawPhoneVals, priorizarCel);
                    if (phones.length === 0) phones.push('999999999');
                    for (let i = 0; i < maxPhonesFound; i++) {
                        obj[`TEL_${i + 1}`] = phones[i] ? Number(phones[i]) : '';
                    }

                    obj['BASE'] = baseStr;
                    obj['MES_CARGA'] = mesCargaStr;
                    processedData.push(obj);
                });

                // Ordenamiento
                if (ordenAleatorio) {
                    for (let i = processedData.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [processedData[i], processedData[j]] = [processedData[j], processedData[i]];
                    }
                } else {
                    processedData.sort((a, b) => {
                        const pA = Number(a.PROPENSION || a.propension || 999999);
                        const pB = Number(b.PROPENSION || b.propension || 999999);
                        if (pA !== pB) return pA - pB;
                        const oA = Number(a.OFERTA || a.oferta || 0);
                        const oB = Number(b.OFERTA || b.oferta || 0);
                        return oB - oA;
                    });
                }

                // Deduplicación por ROW_ID
                const deduped = new Map();
                processedData.forEach(row => {
                    const id = String(row.ROW_ID || row.row_id || '').trim();
                    if (id) {
                        if (!deduped.has(id)) deduped.set(id, row);
                        else stats.duplicates++;
                    } else {
                        deduped.set(`_noId_${deduped.size}`, row);
                    }
                });
                processedData = Array.from(deduped.values());

                stats.valid = processedData.length;
                setProcessReport(stats);

                if (stats.valid === 0) { setPanelMessage({ type: 'warning', text: 'No hay registros para exportar.' }); setIsProcessing(false); return; }

                const { ws, cleanData } = crearSheetLimpio(processedData);
                const wb = window.XLSX.utils.book_new();
                window.XLSX.utils.book_append_sheet(wb, ws, "BCH_Consumo");
                window.XLSX.writeFile(wb, `CARGA_BCH_CONSUMO_${y}${m}${d}.${exportFormat}`);
                setPanelMessage({ type: 'success', text: `¡Carga generada! ${cleanData.length} registros.` });

            } catch (error) {
                setPanelMessage({ type: 'error', text: 'Error: ' + error.message });
            } finally { setIsProcessing(false); }
        };

        return (
            <div className="border border-gray-200 rounded-lg bg-white overflow-hidden mb-4 shadow-sm">
                <div className="bg-blue-900 p-4 flex justify-between items-center cursor-pointer" onClick={onToggle}>
                    <h3 className="font-bold text-white flex items-center gap-2"><Icon name="database" size={18} /> {title} ({campaignCode})</h3>
                    <Icon name={isOpen ? "chevron-up" : "chevron-down"} className="text-white opacity-70" size={20} />
                </div>
                <div className={isOpen ? "p-5 animate-fade-in flex flex-col gap-5" : "hidden"}>
                    {/* CONTROLES */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
                        <div className="flex flex-col">
                            <label className="text-xs font-bold text-gray-600 mb-1">Fecha de Proceso</label>
                            <input type="date" className="border border-gray-300 rounded p-1.5 text-sm outline-none font-medium" value={baseDate} onChange={(e) => setBaseDate(e.target.value)} />
                        </div>
                        <div className="flex flex-col">
                            <label className="text-xs font-bold text-gray-600 mb-1">Formato</label>
                            <select className="border border-gray-300 rounded p-1.5 text-sm outline-none font-medium" value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
                                <option value="xls">Excel 97-2003</option>
                                <option value="xlsx">Excel Moderno</option>
                            </select>
                        </div>
                        <div className="flex flex-col items-center justify-center">
                            <label className="text-xs font-bold text-gray-600 mb-1">Priorizar Cel.</label>
                            <div className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${priorizarCel ? 'bg-blue-600' : 'bg-gray-300'}`} onClick={() => setPriorizarCel(!priorizarCel)}>
                                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${priorizarCel ? 'translate-x-6' : ''}`}></div>
                            </div>
                        </div>
                        <div className="flex flex-col items-center justify-center">
                            <label className="text-xs font-bold text-gray-600 mb-1">Orden Aleatorio</label>
                            <div className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${ordenAleatorio ? 'bg-amber-500' : 'bg-gray-300'}`} onClick={() => setOrdenAleatorio(!ordenAleatorio)}>
                                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${ordenAleatorio ? 'translate-x-6' : ''}`}></div>
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex items-center gap-3 bg-white p-3 rounded border border-gray-200">
                            <div className={`w-10 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-colors ${crearNombreCompleto ? 'bg-blue-600' : 'bg-gray-300'}`} onClick={() => setCrearNombreCompleto(!crearNombreCompleto)}>
                                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${crearNombreCompleto ? 'translate-x-5' : ''}`}></div>
                            </div>
                            <span className="text-xs font-bold text-gray-700">Crear NOMBRE_COMPLETO</span>
                        </div>
                        <div className="flex items-center gap-3 bg-white p-3 rounded border border-gray-200">
                            <div className={`w-10 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-colors ${useCruce ? 'bg-blue-600' : 'bg-gray-300'}`} onClick={() => setUseCruce(!useCruce)}>
                                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${useCruce ? 'translate-x-5' : ''}`}></div>
                            </div>
                            <span className="text-xs font-bold text-gray-700">Excluir por Lista (ROW_ID)</span>
                        </div>
                    </div>
                    {useCruce && (
                        <div className="flex flex-col gap-2 animate-fade-in">
                            <div style={{ display: 'flex', gap: '6px' }}>
                                <button type="button" onClick={() => { setCruceSqlMode(false); setCruceSqlData(null); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #6366f1', background: !cruceSqlMode ? '#6366f1' : 'white', color: !cruceSqlMode ? 'white' : '#6366f1', cursor: 'pointer' }}>📂 Archivo</button>
                                <button type="button" onClick={() => { setCruceSqlMode(true); setCruceFile(null); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #3b82f6', background: cruceSqlMode ? '#3b82f6' : 'white', color: cruceSqlMode ? 'white' : '#3b82f6', cursor: 'pointer' }}>⚡ SQL</button>
                            </div>
                            {!cruceSqlMode ? (
                                <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center bg-gray-50 hover:bg-gray-100 relative">
                                    <input type="file" accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={(e) => setCruceFile(e.target.files[0])} />
                                    <Icon name="shield" size={20} className="mx-auto text-gray-400 mb-1" />
                                    <p className="text-xs font-medium text-gray-600">{cruceFile ? <span className="text-emerald-600 font-bold">{cruceFile.name}</span> : 'Cargar lista con ROW_ID a excluir'}</p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-1">
                                    <textarea style={{ width: '100%', minHeight: '70px', padding: '0.5rem', border: '2px solid #3b82f6', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.75rem', resize: 'vertical', boxSizing: 'border-box' }} value={cruceSqlQuery} onChange={e => setCruceSqlQuery(e.target.value)} placeholder="SELECT ROW_ID FROM tabla WHERE..." />
                                    <button type="button" style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', background: '#3b82f6', color: 'white', border: 'none', cursor: 'pointer', alignSelf: 'flex-start' }} onClick={async () => {
                                        if (!cruceSqlQuery.trim()) return;
                                        const r = await window.nexusAPI.executeSQL(cruceSqlQuery);
                                        if (!r.success) { setPanelMessage({ type: 'error', text: 'Error SQL: ' + r.error }); return; }
                                        setCruceSqlData(r.data);
                                        setPanelMessage({ type: 'success', text: `${r.data.length} registros cargados desde SQL.` });
                                    }}>⚡ Ejecutar</button>
                                    {cruceSqlData && <p className="text-xs text-emerald-600 font-bold">✓ {cruceSqlData.length} registros cargados</p>}
                                </div>
                            )}
                        </div>
                    )}

                    {pendientesHojas.length > 0 && (
                        <SelectorHojas
                            pendientes={pendientesHojas}
                            Icon={Icon}
                            onConfirm={(sel) => { setSheetSelections(prev => ({ ...prev, ...sel })); setPendientesHojas([]); }}
                            onCancel={() => setPendientesHojas([])}
                        />
                    )}

                    {/* CARGA DE ARCHIVOS */}
                    <div className="border-2 border-dashed border-blue-300 bg-blue-50 p-6 rounded-lg text-center relative">
                        <input type="file" multiple accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={handleFileLoad} />
                        <Icon name="upload-cloud" size={32} className="mx-auto text-blue-500 mb-2" />
                        <h4 className="font-bold text-blue-800 text-sm">Archivos Base</h4>
                        <p className="text-xs text-blue-600 mt-1">{baseFiles.length > 0 ? `${baseFiles.length} archivo(s)` : 'Haz clic o arrastra'}</p>
                    </div>

                    {/* UI CONTRASEÑAS */}
                    {showPasswordUI && protectedFiles.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 flex flex-col gap-4 animate-fade-in">
                            <div className="flex items-start gap-3">
                                <Icon name="lock" size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
                                <div><h4 className="text-sm font-bold text-amber-800">Archivos Protegidos ({protectedFiles.length})</h4></div>
                            </div>
                            <div className="flex items-center gap-3 bg-white p-3 rounded border border-amber-200">
                                <div className={`w-10 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-colors ${samePassword ? 'bg-amber-600' : 'bg-gray-300'}`} onClick={() => setSamePassword(!samePassword)}>
                                    <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${samePassword ? 'translate-x-5' : ''}`}></div>
                                </div>
                                <span className="text-xs font-bold text-gray-700">{samePassword ? 'Misma contraseña' : 'Por archivo'}</span>
                            </div>
                            {samePassword ? (
                                <input type="text" placeholder="Contraseña" className="border border-amber-300 rounded p-2 text-sm outline-none font-mono bg-white" value={globalPassword} onChange={(e) => setGlobalPassword(e.target.value)} />
                            ) : (
                                <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
                                    {protectedFiles.map((pf, idx) => (
                                        <div key={idx} className="flex items-center gap-2 bg-white p-2 rounded border border-gray-200">
                                            <span className="text-xs font-mono text-gray-700 truncate flex-1">{pf.name}</span>
                                            <input type="text" placeholder="Contraseña" className="w-40 border border-gray-300 rounded p-1.5 text-xs outline-none font-mono" value={filePasswords[pf.name] || ''} onChange={(e) => setFilePasswords(prev => ({ ...prev, [pf.name]: e.target.value }))} />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* REPORTE */}
                    {processReport && (
                        <div className="bg-white p-5 rounded-lg border border-emerald-200 shadow-sm animate-fade-in border-l-4 border-l-emerald-500">
                            <h3 className="text-lg font-bold text-emerald-800 mb-3 flex items-center gap-2"><Icon name="check-circle" className="text-emerald-600" /> Reporte</h3>
                            <div className={`grid grid-cols-2 ${processReport.excluded > 0 ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-4 text-center`}>
                                <div className="bg-gray-50 p-3 rounded border border-gray-200"><div className="text-2xl font-black text-gray-700">{processReport.loaded}</div><div className="text-[10px] text-gray-500 uppercase font-bold">Leídos</div></div>
                                <div className="bg-blue-50 p-3 rounded border border-blue-200"><div className="text-2xl font-black text-blue-700">{processReport.valid}</div><div className="text-[10px] text-blue-500 uppercase font-bold">Exportados</div></div>
                                <div className="bg-amber-50 p-3 rounded border border-amber-200"><div className="text-2xl font-black text-amber-700">{processReport.duplicates}</div><div className="text-[10px] text-amber-500 uppercase font-bold">Duplicados</div></div>
                                {processReport.excluded > 0 && (<div className="bg-purple-50 p-3 rounded border border-purple-200"><div className="text-2xl font-black text-purple-700">{processReport.excluded}</div><div className="text-[10px] text-purple-500 uppercase font-bold">Excluidos</div></div>)}
                            </div>
                        </div>
                    )}
                    {panelMessage.text && !processReport && (
                        <div className={`p-3 rounded-lg border text-sm font-bold flex items-center gap-2 ${panelMessage.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : panelMessage.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                            <Icon name={panelMessage.type === 'error' ? 'alert-triangle' : panelMessage.type === 'warning' ? 'alert-circle' : 'check-circle'} size={18} />
                            {panelMessage.text}
                        </div>
                    )}

                    <button type="button" onClick={(e) => { e.preventDefault(); handleProcess(); }} disabled={isProcessing || baseFiles.length === 0} className={`w-full py-3 rounded-lg font-bold text-white flex justify-center items-center gap-2 ${isProcessing || baseFiles.length === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-800 hover:bg-blue-900'}`}>
                        {isProcessing ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Icon name="play" size={18} />}
                        Procesar y Exportar
                    </button>
                </div>
            </div>
        );
    };

    // --- PANEL BCH REPRO (Compartido por REPRO_1 y REPRO_TOTAL) ---
    const PanelBchRepro = ({ title, campaignCode, alias, isOpen, onToggle, globalTrigger, Icon }) => {
        const [baseFiles, setBaseFiles] = useState([]);
        const [baseDate, setBaseDate] = useState(new Date().toISOString().split('T')[0]);
        const [exportFormat, setExportFormat] = useState('xls');
        const [priorizarCel, setPriorizarCel] = useState(true);
        const [modoHorizontal, setModoHorizontal] = useState(false);
        const [crearNombreCompleto, setCrearNombreCompleto] = useState(false);

        const [isProcessing, setIsProcessing] = useState(false);
        const [processReport, setProcessReport] = useState(null);
        const [panelMessage, setPanelMessage] = useState({ type: '', text: '' });

        // Cruce
        const [useCruce, setUseCruce] = useState(false);
        const [cruceFile, setCruceFile] = useState(null);
        const [cruceSqlMode, setCruceSqlMode] = useState(false);
        const [cruceSqlQuery, setCruceSqlQuery] = useState('');
        const [cruceSqlData, setCruceSqlData] = useState(null);

        // Contraseña
        const [protectedFiles, setProtectedFiles] = useState([]);
        const [samePassword, setSamePassword] = useState(true);
        const [globalPassword, setGlobalPassword] = useState('');
        const [filePasswords, setFilePasswords] = useState({});
        const [showPasswordUI, setShowPasswordUI] = useState(false);
        const [parsedData, setParsedData] = useState([]);
        const [pendientesHojas, setPendientesHojas] = useState([]);
        const [sheetSelections, setSheetSelections] = useState({});

        useEffect(() => {
            if (globalTrigger > 0 && (parsedData.length > 0 || baseFiles.length > 0) && !isProcessing) handleProcess();
        }, [globalTrigger]);

        const readFile = (file, password, sheetName) => {
            return new Promise((resolve, reject) => {
                if (file.name.toLowerCase().endsWith('.csv') || file.name.toLowerCase().endsWith('.txt')) {
                    window.Papa.parse(file, { header: true, skipEmptyLines: true, complete: (res) => resolve(res.data), error: reject });
                    return;
                }
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const buffer = e.target.result;
                    try {
                        let wb;
                        if (!password) {
                            wb = window.XLSX.read(new Uint8Array(buffer), { type: 'array' });
                        } else {
                            const decrypted = await decryptExcelBuffer(buffer, password);
                            wb = window.XLSX.read(decrypted, { type: 'array' });
                        }
                        if (wb.SheetNames.length > 1 && !sheetName) {
                            resolve({ multiSheet: true, sheetNames: wb.SheetNames });
                            return;
                        }
                        const targetSheet = sheetName || wb.SheetNames[0];
                        resolve(window.XLSX.utils.sheet_to_json(wb.Sheets[targetSheet], { defval: "" }));
                    } catch (err) { reject(err); }
                };
                reader.readAsArrayBuffer(file);
            });
        };

        const handleFileLoad = async (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;
            setBaseFiles(files); setParsedData([]); setProtectedFiles([]); setShowPasswordUI(false);
            setGlobalPassword(''); setFilePasswords({}); setPanelMessage({ type: '', text: '' }); setProcessReport(null);
            let okData = [], blocked = [];
            for (const file of files) {
                try { const data = await readFile(file, null, sheetSelections[file.name]); if (data && data.multiSheet) { blocked.push({ file, name: file.name, sheetNames: data.sheetNames }); continue; } okData = okData.concat(data); }
                catch (err) { blocked.push({ file, name: file.name }); }
            }
            const multiSheetFiles = blocked.filter(b => b.sheetNames);
            const realBlocked = blocked.filter(b => !b.sheetNames);
            if (multiSheetFiles.length > 0) {
                setPendientesHojas(multiSheetFiles.map(b => ({ name: b.name, sheetNames: b.sheetNames })));
            }
            if (realBlocked.length > 0) {
                setProtectedFiles(realBlocked); setShowPasswordUI(true); setParsedData(okData);
                setPanelMessage({ type: 'warning', text: `${realBlocked.length} archivo(s) protegido(s).` });
            } else {
                setParsedData(okData);
                setPanelMessage({ type: 'success', text: `${files.length} archivo(s) cargado(s) (${okData.length} registros).` });
            }
            e.target.value = '';
        };

        const handleProcess = async () => {
            setPanelMessage({ type: '', text: '' }); setProcessReport(null);
            if (baseFiles.length === 0) { setPanelMessage({ type: 'error', text: 'Debes cargar al menos un archivo.' }); return; }
            setIsProcessing(true);

            let allData = [...parsedData];
            if (protectedFiles.length > 0) {
                let stillBlocked = [];
                for (const pf of protectedFiles) {
                    const pass = samePassword ? globalPassword : (filePasswords[pf.name] || '');
                    if (!pass) { stillBlocked.push(pf); continue; }
                    try { const data = await readFile(pf.file, pass, sheetSelections[pf.name]); if (data && data.multiSheet) { stillBlocked.push(pf); continue; } allData = allData.concat(data); }
                    catch (err) { stillBlocked.push(pf); }
                }
                if (stillBlocked.length > 0) {
                    setProtectedFiles(stillBlocked);
                    setPanelMessage({ type: 'error', text: `${stillBlocked.length} archivo(s) no se pudieron desbloquear.` });
                    setIsProcessing(false); return;
                }
                setProtectedFiles([]); setShowPasswordUI(false); setParsedData(allData);
            }
            if (allData.length === 0) { setPanelMessage({ type: 'warning', text: 'No hay registros.' }); setIsProcessing(false); return; }

            try {
                const [y, m, d] = baseDate.split('-');
                const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
                const dateObj = new Date(y, m - 1, d);
                const baseStr = `BASE_${d}_${m}_${y}`;
                const mesCargaStr = `${monthNames[dateObj.getMonth()]}_${String(y).slice(-2)}`;
                const dateSuffix = `${y}${m}${d}`;

                // Exclusión por ROW_ID
                let exclusionSet = new Set();
                if (useCruce && cruceSqlMode && cruceSqlData) {
                    cruceSqlData.forEach(row => {
                        const id = row.ROW_ID || row.row_id || row.vendor_lead_code || row.VENDOR_LEAD_CODE || '';
                        if (id) exclusionSet.add(String(id).trim());
                    });
                } else if (useCruce && cruceFile) {
                    const cruceData = await readFile(cruceFile, null, sheetSelections[cruceFile.name]);
                    cruceData.forEach(row => {
                        const id = row.ROW_ID || row.row_id || row.vendor_lead_code || row.VENDOR_LEAD_CODE || '';
                        if (id) exclusionSet.add(String(id).trim());
                    });
                }

                const sampleKeys = Object.keys(allData[0] || {});
                const fonoColKeys = sampleKeys.filter(k => /^FONO\d+$/i.test(k));

                // Pre-cálculo maxPhones
                let maxPhonesFound = 0;
                allData.forEach(row => {
                    const rawVals = fonoColKeys.map(k => row[k]);
                    const cleaned = depurarTelefonos(rawVals, priorizarCel);
                    if (cleaned.length > maxPhonesFound) maxPhonesFound = cleaned.length;
                });

                // Construir filas con TEL, BASE, MES_CARGA
                let processedData = [];
                let stats = { loaded: allData.length, valid: 0, duplicates: 0, excluded: 0 };

                allData.forEach(row => {
                    const rowId = String(row.ROW_ID || row.row_id || '').trim();
                    if (useCruce && rowId && exclusionSet.has(rowId)) { stats.excluded++; return; }

                    let obj = {};
                    sampleKeys.forEach(k => { obj[k] = row[k]; });

                    if (crearNombreCompleto) {
                        const nom = cleanNames(row.NOMBRE || row.nombre || '');
                        const pat = cleanNames(row.AP_PATERNO || row.ap_paterno || '');
                        const mat = cleanNames(row.AP_MATERNO || row.ap_materno || '');
                        obj['NOMBRE_COMPLETO'] = [nom, pat, mat].filter(Boolean).join(' ');
                    }

                    const rawPhoneVals = fonoColKeys.map(k => row[k]);
                    const phones = depurarTelefonos(rawPhoneVals, priorizarCel);
                    if (phones.length === 0) phones.push('999999999');
                    for (let i = 0; i < maxPhonesFound; i++) {
                        obj[`TEL_${i + 1}`] = phones[i] ? Number(phones[i]) : '';
                    }

                    obj['BASE'] = baseStr;
                    obj['MES_CARGA'] = mesCargaStr;
                    processedData.push(obj);
                });

                // Ordenar por MONTO desc
                processedData.sort((a, b) => {
                    const mA = Number(String(a.MONTO || a.monto || 0).replace(/\D/g, '')) || 0;
                    const mB = Number(String(b.MONTO || b.monto || 0).replace(/\D/g, '')) || 0;
                    return mB - mA;
                });

                if (modoHorizontal) {
                    // --- VÍA 2: Desdoblamiento horizontal ---
                    const grouped = new Map();
                    processedData.forEach(row => {
                        const id = String(row.ROW_ID || row.row_id || '').trim();
                        if (!grouped.has(id)) grouped.set(id, []);
                        grouped.get(id).push(row);
                    });

                    let maxRepeticiones = 0;
                    grouped.forEach(rows => { if (rows.length > maxRepeticiones) maxRepeticiones = rows.length; });

                    const flatData = [];
                    grouped.forEach((rows, id) => {
                        const base = { ...rows[0] };
                        delete base.PRODUCTO; delete base.MONTO;
                        delete base.producto; delete base.monto;

                        for (let i = 0; i < maxRepeticiones; i++) {
                            const suffix = String(i + 1).padStart(2, '0');
                            base[`PRODUCTO_${suffix}`] = rows[i] ? (rows[i].PRODUCTO || rows[i].producto || '') : '';
                            base[`MONTO_${suffix}`] = rows[i] ? (Number(String(rows[i].MONTO || rows[i].monto || 0).replace(/\D/g, '')) || '') : '';
                        }
                        flatData.push(base);
                    });

                    stats.valid = flatData.length;
                    stats.duplicates = processedData.length - flatData.length;
                    setProcessReport(stats);

                    if (flatData.length === 0) { setPanelMessage({ type: 'warning', text: 'Sin registros.' }); setIsProcessing(false); return; }

                    const { ws } = crearSheetLimpio(flatData);
                    const wb = window.XLSX.utils.book_new();
                    window.XLSX.utils.book_append_sheet(wb, ws, alias);
                    window.XLSX.writeFile(wb, `${alias}_${dateSuffix}.${exportFormat}`);
                    setPanelMessage({ type: 'success', text: `¡Exportado! ${flatData.length} registros únicos con desdoblamiento horizontal.` });

                } else {
                    // --- VÍA 1: Dos archivos (OPERACIONES + UNICOS) ---
                    // Archivo 1: OPERACIONES (todos)
                    const { ws: wsOps, cleanData: cdOps } = crearSheetLimpio(processedData);
                    const wbOps = window.XLSX.utils.book_new();
                    window.XLSX.utils.book_append_sheet(wbOps, wsOps, alias);
                    window.XLSX.writeFile(wbOps, `${alias}_${dateSuffix}_OPERACIONES.${exportFormat}`);

                    // Archivo 2: UNICOS (primera aparición = mayor monto por el sort previo)
                    const uniqueMap = new Map();
                    processedData.forEach(row => {
                        const id = String(row.ROW_ID || row.row_id || '').trim();
                        if (id && !uniqueMap.has(id)) uniqueMap.set(id, row);
                    });
                    const uniqueData = Array.from(uniqueMap.values());

                    const { ws: wsUni, cleanData: cdUni } = crearSheetLimpio(uniqueData);
                    const wbUni = window.XLSX.utils.book_new();
                    window.XLSX.utils.book_append_sheet(wbUni, wsUni, alias);
                    window.XLSX.writeFile(wbUni, `${alias}_${dateSuffix}_UNICOS.${exportFormat}`);

                    stats.valid = cdUni.length;
                    stats.duplicates = processedData.length - uniqueData.length;
                    setProcessReport(stats);
                    setPanelMessage({ type: 'success', text: `¡2 archivos generados! ${cdOps.length} operaciones, ${cdUni.length} únicos.` });
                }

            } catch (error) {
                setPanelMessage({ type: 'error', text: 'Error: ' + error.message });
            } finally { setIsProcessing(false); }
        };

        return (
            <div className="border border-gray-200 rounded-lg bg-white overflow-hidden mb-4 shadow-sm">
                <div className="bg-blue-900 p-4 flex justify-between items-center cursor-pointer" onClick={onToggle}>
                    <h3 className="font-bold text-white flex items-center gap-2"><Icon name="database" size={18} /> {title} ({campaignCode})</h3>
                    <Icon name={isOpen ? "chevron-up" : "chevron-down"} className="text-white opacity-70" size={20} />
                </div>
                <div className={isOpen ? "p-5 animate-fade-in flex flex-col gap-5" : "hidden"}>
                    {/* CONTROLES */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
                        <div className="flex flex-col">
                            <label className="text-xs font-bold text-gray-600 mb-1">Fecha de Proceso</label>
                            <input type="date" className="border border-gray-300 rounded p-1.5 text-sm outline-none font-medium" value={baseDate} onChange={(e) => setBaseDate(e.target.value)} />
                        </div>
                        <div className="flex flex-col">
                            <label className="text-xs font-bold text-gray-600 mb-1">Formato</label>
                            <select className="border border-gray-300 rounded p-1.5 text-sm outline-none font-medium" value={exportFormat} onChange={(e) => setExportFormat(e.target.value)}>
                                <option value="xls">Excel 97-2003</option>
                                <option value="xlsx">Excel Moderno</option>
                            </select>
                        </div>
                        <div className="flex flex-col items-center justify-center">
                            <label className="text-xs font-bold text-gray-600 mb-1">Priorizar Cel.</label>
                            <div className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${priorizarCel ? 'bg-blue-600' : 'bg-gray-300'}`} onClick={() => setPriorizarCel(!priorizarCel)}>
                                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${priorizarCel ? 'translate-x-6' : ''}`}></div>
                            </div>
                        </div>
                        <div className="flex flex-col items-center justify-center">
                            <label className="text-xs font-bold text-gray-600 mb-1">Desdoblamiento</label>
                            <div className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors ${modoHorizontal ? 'bg-indigo-600' : 'bg-gray-300'}`} onClick={() => setModoHorizontal(!modoHorizontal)}>
                                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${modoHorizontal ? 'translate-x-6' : ''}`}></div>
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex items-center gap-3 bg-white p-3 rounded border border-gray-200">
                            <div className={`w-10 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-colors ${crearNombreCompleto ? 'bg-blue-600' : 'bg-gray-300'}`} onClick={() => setCrearNombreCompleto(!crearNombreCompleto)}>
                                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${crearNombreCompleto ? 'translate-x-5' : ''}`}></div>
                            </div>
                            <span className="text-xs font-bold text-gray-700">Crear NOMBRE_COMPLETO</span>
                        </div>
                        <div className="flex items-center gap-3 bg-white p-3 rounded border border-gray-200">
                            <div className={`w-10 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-colors ${useCruce ? 'bg-blue-600' : 'bg-gray-300'}`} onClick={() => setUseCruce(!useCruce)}>
                                <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${useCruce ? 'translate-x-5' : ''}`}></div>
                            </div>
                            <span className="text-xs font-bold text-gray-700">Excluir por Lista (ROW_ID)</span>
                        </div>
                    </div>
                    {useCruce && (
                        <div className="flex flex-col gap-2 animate-fade-in">
                            <div style={{ display: 'flex', gap: '6px' }}>
                                <button type="button" onClick={() => { setCruceSqlMode(false); setCruceSqlData(null); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #6366f1', background: !cruceSqlMode ? '#6366f1' : 'white', color: !cruceSqlMode ? 'white' : '#6366f1', cursor: 'pointer' }}>📂 Archivo</button>
                                <button type="button" onClick={() => { setCruceSqlMode(true); setCruceFile(null); }} style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', border: '2px solid #3b82f6', background: cruceSqlMode ? '#3b82f6' : 'white', color: cruceSqlMode ? 'white' : '#3b82f6', cursor: 'pointer' }}>⚡ SQL</button>
                            </div>
                            {!cruceSqlMode ? (
                                <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center bg-gray-50 hover:bg-gray-100 relative">
                                    <input type="file" accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={(e) => setCruceFile(e.target.files[0])} />
                                    <Icon name="shield" size={20} className="mx-auto text-gray-400 mb-1" />
                                    <p className="text-xs font-medium text-gray-600">{cruceFile ? <span className="text-emerald-600 font-bold">{cruceFile.name}</span> : 'Cargar lista con ROW_ID a excluir'}</p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-1">
                                    <textarea style={{ width: '100%', minHeight: '70px', padding: '0.5rem', border: '2px solid #3b82f6', borderRadius: '6px', fontFamily: 'monospace', fontSize: '0.75rem', resize: 'vertical', boxSizing: 'border-box' }} value={cruceSqlQuery} onChange={e => setCruceSqlQuery(e.target.value)} placeholder="SELECT ROW_ID FROM tabla WHERE..." />
                                    <button type="button" style={{ padding: '4px 12px', borderRadius: '6px', fontWeight: 'bold', fontSize: '0.75rem', background: '#3b82f6', color: 'white', border: 'none', cursor: 'pointer', alignSelf: 'flex-start' }} onClick={async () => {
                                        if (!cruceSqlQuery.trim()) return;
                                        const r = await window.nexusAPI.executeSQL(cruceSqlQuery);
                                        if (!r.success) { setPanelMessage({ type: 'error', text: 'Error SQL: ' + r.error }); return; }
                                        setCruceSqlData(r.data);
                                        setPanelMessage({ type: 'success', text: `${r.data.length} registros cargados desde SQL.` });
                                    }}>⚡ Ejecutar</button>
                                    {cruceSqlData && <p className="text-xs text-emerald-600 font-bold">✓ {cruceSqlData.length} registros cargados</p>}
                                </div>
                            )}
                        </div>
                    )}

                    {pendientesHojas.length > 0 && (
                        <SelectorHojas
                            pendientes={pendientesHojas}
                            Icon={Icon}
                            onConfirm={(sel) => { setSheetSelections(prev => ({ ...prev, ...sel })); setPendientesHojas([]); }}
                            onCancel={() => setPendientesHojas([])}
                        />
                    )}

                    {/* CARGA */}
                    <div className="border-2 border-dashed border-blue-300 bg-blue-50 p-6 rounded-lg text-center relative">
                        <input type="file" multiple accept=".csv,.txt,.xlsx,.xls" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={handleFileLoad} />
                        <Icon name="upload-cloud" size={32} className="mx-auto text-blue-500 mb-2" />
                        <h4 className="font-bold text-blue-800 text-sm">Archivos Base</h4>
                        <p className="text-xs text-blue-600 mt-1">{baseFiles.length > 0 ? `${baseFiles.length} archivo(s)` : 'Haz clic o arrastra'}</p>
                    </div>

                    {/* UI CONTRASEÑAS */}
                    {showPasswordUI && protectedFiles.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 flex flex-col gap-4 animate-fade-in">
                            <div className="flex items-start gap-3">
                                <Icon name="lock" size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
                                <div><h4 className="text-sm font-bold text-amber-800">Archivos Protegidos ({protectedFiles.length})</h4></div>
                            </div>
                            <div className="flex items-center gap-3 bg-white p-3 rounded border border-amber-200">
                                <div className={`w-10 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-colors ${samePassword ? 'bg-amber-600' : 'bg-gray-300'}`} onClick={() => setSamePassword(!samePassword)}>
                                    <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${samePassword ? 'translate-x-5' : ''}`}></div>
                                </div>
                                <span className="text-xs font-bold text-gray-700">{samePassword ? 'Misma contraseña' : 'Por archivo'}</span>
                            </div>
                            {samePassword ? (
                                <input type="text" placeholder="Contraseña" className="border border-amber-300 rounded p-2 text-sm outline-none font-mono bg-white" value={globalPassword} onChange={(e) => setGlobalPassword(e.target.value)} />
                            ) : (
                                <div className="flex flex-col gap-2 max-h-40 overflow-y-auto">
                                    {protectedFiles.map((pf, idx) => (
                                        <div key={idx} className="flex items-center gap-2 bg-white p-2 rounded border border-gray-200">
                                            <span className="text-xs font-mono text-gray-700 truncate flex-1">{pf.name}</span>
                                            <input type="text" placeholder="Contraseña" className="w-40 border border-gray-300 rounded p-1.5 text-xs outline-none font-mono" value={filePasswords[pf.name] || ''} onChange={(e) => setFilePasswords(prev => ({ ...prev, [pf.name]: e.target.value }))} />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* INFO MODO */}
                    <div className={`p-3 rounded-lg border text-xs font-bold flex items-center gap-2 ${modoHorizontal ? 'bg-indigo-50 border-indigo-200 text-indigo-800' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
                        <Icon name="info" size={16} />
                        {modoHorizontal ? 'Modo Horizontal: Exportará 1 archivo con PRODUCTO_01..n y MONTO_01..n por ROW_ID.' : 'Modo Estándar: Exportará 2 archivos — OPERACIONES (todos) y UNICOS (mayor monto por ROW_ID).'}
                    </div>

                    {/* REPORTE */}
                    {processReport && (
                        <div className="bg-white p-5 rounded-lg border border-emerald-200 shadow-sm animate-fade-in border-l-4 border-l-emerald-500">
                            <h3 className="text-lg font-bold text-emerald-800 mb-3 flex items-center gap-2"><Icon name="check-circle" className="text-emerald-600" /> Reporte</h3>
                            <div className={`grid grid-cols-2 ${processReport.excluded > 0 ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-4 text-center`}>
                                <div className="bg-gray-50 p-3 rounded border border-gray-200"><div className="text-2xl font-black text-gray-700">{processReport.loaded}</div><div className="text-[10px] text-gray-500 uppercase font-bold">Leídos</div></div>
                                <div className="bg-blue-50 p-3 rounded border border-blue-200"><div className="text-2xl font-black text-blue-700">{processReport.valid}</div><div className="text-[10px] text-blue-500 uppercase font-bold">Únicos</div></div>
                                <div className="bg-amber-50 p-3 rounded border border-amber-200"><div className="text-2xl font-black text-amber-700">{processReport.duplicates}</div><div className="text-[10px] text-amber-500 uppercase font-bold">Repetidos</div></div>
                                {processReport.excluded > 0 && (<div className="bg-purple-50 p-3 rounded border border-purple-200"><div className="text-2xl font-black text-purple-700">{processReport.excluded}</div><div className="text-[10px] text-purple-500 uppercase font-bold">Excluidos</div></div>)}
                            </div>
                        </div>
                    )}
                    {panelMessage.text && !processReport && (
                        <div className={`p-3 rounded-lg border text-sm font-bold flex items-center gap-2 ${panelMessage.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : panelMessage.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                            <Icon name={panelMessage.type === 'error' ? 'alert-triangle' : panelMessage.type === 'warning' ? 'alert-circle' : 'check-circle'} size={18} />
                            {panelMessage.text}
                        </div>
                    )}

                    <button type="button" onClick={(e) => { e.preventDefault(); handleProcess(); }} disabled={isProcessing || baseFiles.length === 0} className={`w-full py-3 rounded-lg font-bold text-white flex justify-center items-center gap-2 ${isProcessing || baseFiles.length === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-800 hover:bg-blue-900'}`}>
                        {isProcessing ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Icon name="play" size={18} />}
                        Procesar y Exportar
                    </button>
                </div>
            </div>
        );
    };

    // --- WRAPPER TASK ---
    const TaskCargaBancoChile = ({ Icon }) => {
        const [selectedCampaign, setSelectedCampaign] = useState('');
        const [openPanels, setOpenPanels] = useState({ consumo: false, derivacion: false, repro1: false, reprotototal: false });
        const [globalTrigger, setGlobalTrigger] = useState(0);

        const campaigns = [
            { id: 'consumo', code: 'BCH_CONSUMO', name: 'Banco de Chile Consumo', status: 'active' },
            { id: 'derivacion', code: 'BCH_DERIVACION', name: 'Banco de Chile Derivación', status: 'construction' },
            { id: 'repro1', code: 'REPRO_1', name: 'Recaptación Monto', alias: 'REPRO_1', status: 'active' },
            { id: 'reprotototal', code: 'REPRO_TOTAL', name: 'Reprogramación Total Monto TC', alias: 'REPRO_TOTAL', status: 'active' }
        ];

        useEffect(() => {
            if (selectedCampaign === 'todas') {
                const allOpen = {};
                campaigns.forEach(c => { if (c.status === 'active') allOpen[c.id] = true; });
                setOpenPanels(allOpen);
            } else {
                const newPanels = {};
                campaigns.forEach(c => newPanels[c.id] = (selectedCampaign === c.id));
                setOpenPanels(newPanels);
            }
        }, [selectedCampaign]);

        const togglePanel = (panelId) => {
            if (selectedCampaign === 'todas') setOpenPanels(prev => ({ ...prev, [panelId]: !prev[panelId] }));
        };

        return (
            <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full animate-fade-in">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-gray-200 pb-4 gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                            <Icon name="database" className="text-blue-900" />
                            Carga Banco de Chile
                        </h2>
                        <p className="text-gray-500 text-sm mt-1">Consumo, Recaptación y Reprogramación. Soporte de archivos cifrados y desdoblamiento horizontal.</p>
                    </div>
                    <div className="flex items-center bg-gray-100 p-1.5 rounded-lg border border-gray-200 shadow-sm">
                        <Icon name="filter" size={16} className="text-gray-500 ml-2 mr-1" />
                        <select className="bg-transparent text-sm font-bold text-gray-700 outline-none pr-4 py-1 cursor-pointer" value={selectedCampaign} onChange={(e) => setSelectedCampaign(e.target.value)}>
                            <option value="" disabled>Seleccione una campaña...</option>
                            {campaigns.map(c => <option key={c.id} value={c.id}>{c.code}{c.status === 'construction' ? ' (En Construcción)' : ''}</option>)}
                            <option value="todas">⚙️ Gestionar Todas Juntas</option>
                        </select>
                    </div>
                </div>

                {selectedCampaign === '' && (
                    <div className="bg-white p-12 rounded-lg border border-gray-200 text-center shadow-sm mt-2">
                        <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-blue-100">
                            <Icon name="database" size={40} className="text-blue-400" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-700 mb-2">Área de Trabajo Lista</h3>
                        <p className="text-gray-500 max-w-md mx-auto text-sm">
                            Selecciona una campaña o elige <strong>"Gestionar Todas Juntas"</strong>.
                        </p>
                    </div>
                )}

                {selectedCampaign === 'derivacion' && (
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-8 text-center">
                        <Icon name="settings" size={40} className="mx-auto text-orange-400 mb-3" />
                        <h3 className="text-lg font-bold text-orange-800 mb-2">En Construcción</h3>
                        <p className="text-sm text-orange-700 max-w-md mx-auto">Esta campaña requiere conectividad T-SQL que está en evaluación. Se habilitará en una versión futura.</p>
                    </div>
                )}

                {selectedCampaign === 'todas' && (
                    <div className="bg-slate-800 p-4 rounded-lg flex flex-col md:flex-row justify-between items-center shadow-md mb-2">
                        <div className="mb-3 md:mb-0 text-center md:text-left">
                            <h3 className="text-white font-bold text-lg flex items-center gap-2 justify-center md:justify-start"><Icon name="layers" size={20} /> Ejecución en Lote</h3>
                            <p className="text-slate-300 text-sm">Procesará todas las campañas activas que tengan bases cargadas.</p>
                        </div>
                        <button type="button" onClick={() => setGlobalTrigger(prev => prev + 1)} className="bg-emerald-500 text-white px-6 py-2 rounded-lg font-bold hover:bg-emerald-600 flex items-center gap-2 shadow-sm w-full md:w-auto justify-center">
                            <Icon name="play" size={18} /> Procesar Todo
                        </button>
                    </div>
                )}

                <div className="flex flex-col gap-1">
                    {(selectedCampaign === 'consumo' || selectedCampaign === 'todas') && (
                        <PanelBchConsumo title="Consumo" campaignCode="BCH_CONSUMO" isOpen={openPanels.consumo} onToggle={() => togglePanel('consumo')} globalTrigger={globalTrigger} Icon={Icon} />
                    )}
                    {(selectedCampaign === 'repro1' || selectedCampaign === 'todas') && (
                        <PanelBchRepro title="Recaptación Monto" campaignCode="BANCO_DE_CHILE_RECAPTACION_MONTO" alias="REPRO_1" isOpen={openPanels.repro1} onToggle={() => togglePanel('repro1')} globalTrigger={globalTrigger} Icon={Icon} />
                    )}
                    {(selectedCampaign === 'reprotototal' || selectedCampaign === 'todas') && (
                        <PanelBchRepro title="Reprogramación Total TC" campaignCode="BANCO_DE_CHILE_REPROGRAMACION_TOTAL_MONTO_TC" alias="REPRO_TOTAL" isOpen={openPanels.reprotototal} onToggle={() => togglePanel('reprotototal')} globalTrigger={globalTrigger} Icon={Icon} />
                    )}
                </div>
            </div>
        );
    };



    // ========================================================================
    // ⬇️ PEGAR AQUÍ ABAJO EL CÓDIGO DE LA SIGUIENTE TAREA ⬇️
    // ========================================================================  

    // ========================================================================
    // TAREA 11: Carga Simuladores BCH
    // ========================================================================
    const TaskCargaSimuladoresBCH = ({ Icon, addToast }) => {
        const [simFile, setSimFile] = useState(null);
        const [simRowIds, setSimRowIds] = useState([]);
        const [simFileName, setSimFileName] = useState('');
        const [fechaProceso, setFechaProceso] = useState(new Date().toISOString().split('T')[0]);
        const [modoEjecucion, setModoEjecucion] = useState('manual');
        const [isProcessing, setIsProcessing] = useState(false);
        const [reportePrevio, setReportePrevio] = useState(null);
        const [resultadoFinal, setResultadoFinal] = useState([]);
        const [sqlBloqueo, setSqlBloqueo] = useState('');
        const [reporteEjecucion, setReporteEjecucion] = useState(null);
        const [panelMessage, setPanelMessage] = useState({ type: '', text: '' });

        const getFechaFormato = () => fechaProceso.replace(/-/g, '');

        const getMesCarga = () => {
            const d = new Date(fechaProceso + 'T12:00:00');
            const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
            return `${meses[d.getMonth()]}_${String(d.getFullYear()).slice(-2)}`;
        };

        const readFileLocal = (file) => new Promise((resolve, reject) => {
            if (file.name.toLowerCase().match(/\.(csv|txt)$/)) {
                window.Papa.parse(file, { header: true, skipEmptyLines: true, complete: r => resolve(r.data), error: reject });
                return;
            }
            const reader = new FileReader();
            reader.onload = e => {
                try {
                    const wb = window.XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                    resolve(window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }));
                } catch (err) { reject(err); }
            };
            reader.readAsArrayBuffer(file);
        });

        const handleFileLoad = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            setSimFile(file);
            setSimFileName(file.name);
            setSimRowIds([]);
            setReportePrevio(null);
            setResultadoFinal([]);
            setSqlBloqueo('');
            setReporteEjecucion(null);
            setPanelMessage({ type: '', text: '' });

            try {
                const data = await readFileLocal(file);
                const rowIdCol = Object.keys(data[0] || {}).find(k => /row_?id/i.test(k));
                if (!rowIdCol) throw new Error('No se encontró columna ROW_ID en el archivo.');
                const ids = [...new Set(data.map(r => String(r[rowIdCol] || '').trim()).filter(Boolean))];
                setSimRowIds(ids);
                setPanelMessage({ type: 'success', text: `${ids.length} ROW_IDs únicos cargados desde "${file.name}".` });

                if (!window.nexusAPI) { setPanelMessage({ type: 'warning', text: `${ids.length} ROW_IDs cargados. Sin conexión SQL activa para reporte previo.` }); return; }

                const idsStr = ids.map(id => `'${id}'`).join(',');
                const mesCarga = getMesCarga();
                const qPrevio = `SELECT COUNT(*) as ya_en_derivacion FROM CustomerBancodeChile..CLIENTE_BANCO_DE_CHILE_CONSUMO_DERIVACION a JOIN CustomerBancodeChile..C1_BANCO_DE_CHILE_CONSUMO_DERIVACION b ON a.INDICE = b.INDICE WHERE MESCARGA = '${mesCarga}' AND ROW_ID IN (${idsStr})`;
                const rPrevio = await window.nexusAPI.executeSQL(qPrevio);
                if (rPrevio.success && rPrevio.data.length > 0) {
                    setReportePrevio({ yaEnDerivacion: rPrevio.data[0].ya_en_derivacion, total: ids.length });
                }
            } catch (err) {
                setPanelMessage({ type: 'error', text: 'Error al leer el archivo: ' + err.message });
            }
        };

        const handleProcesar = async () => {
            if (simRowIds.length === 0) { setPanelMessage({ type: 'warning', text: 'Primero carga el archivo de simuladores.' }); return; }
            if (!window.nexusAPI) { setPanelMessage({ type: 'error', text: 'No hay conexión SQL activa.' }); return; }

            setIsProcessing(true);
            setPanelMessage({ type: '', text: '' });
            setSqlBloqueo('');
            setReporteEjecucion(null);

            try {
                const mesCarga = getMesCarga();
                const fechaStr = getFechaFormato();
                const idsStr = simRowIds.map(id => `'${id}'`).join(',');

                const qPrincipal = `
    SET LANGUAGE Spanish;
    DECLARE @MESCARGA_FORMAT VARCHAR(20);
    SET @MESCARGA_FORMAT = UPPER(LEFT(DATENAME(MONTH, GETDATE()), 1)) + LOWER(SUBSTRING(DATENAME(MONTH, GETDATE()), 2, LEN(DATENAME(MONTH, GETDATE())))) + '_' + RIGHT(CAST(YEAR(GETDATE()) AS VARCHAR(4)), 2);
    SELECT ID, CAMPANA, a.INDICE, ROW_ID, NOMBRE, AP_PATERNO, AP_MATERNO, EDAD, GENERO, MARCA,
        FONO1, FONO2, FONO3, FONO4, FONO5, FONO6, PROPENSION, OFERTA,
        OFERTA_REBAJA_TASA, INICIO_VIGENCIA, TERMINO_VIGENCIA, BASE, MESCARGA,
        TEL_1, TEL_2, TEL_3, TEL_4, TEL_5, TEL_6, TEL_7, TEL_8, STATUS
    FROM CustomerBancodeChile..CLIENTE_BANCO_DE_CHILE_CONSUMO a
    JOIN CustomerBancodeChile..C1_BANCO_DE_CHILE_CONSUMO b ON a.INDICE = b.INDICE
    WHERE MESCARGA = @MESCARGA_FORMAT
    AND ROW_ID IN (${idsStr})
    AND (STATUS IN (2,3,4,5,7,8,11,12,13,16,17,80,89,90,91,92,93,95,98,99,101) OR STATUS IS NULL)
    AND NOT EXISTS (
        SELECT 1 FROM (
            SELECT ROW_ID AS deriv_ROW_ID
            FROM CustomerBancodeChile..CLIENTE_BANCO_DE_CHILE_CONSUMO_DERIVACION sub_a
            JOIN CustomerBancodeChile..C1_BANCO_DE_CHILE_CONSUMO_DERIVACION sub_b ON sub_a.INDICE = sub_b.INDICE
            WHERE MESCARGA = @MESCARGA_FORMAT
        ) derivacion WHERE derivacion.deriv_ROW_ID = ROW_ID
    )`;

                const rPrincipal = await window.nexusAPI.executeSQL(qPrincipal);
                if (!rPrincipal.success) throw new Error(rPrincipal.error);
                if (!rPrincipal.data || rPrincipal.data.length === 0) {
                    setPanelMessage({ type: 'warning', text: 'No se encontraron simuladores nuevos para procesar.' });
                    setIsProcessing(false);
                    return;
                }

                const indices = rPrincipal.data.map(r => r.INDICE).filter(Boolean);

                const datosFin = rPrincipal.data.map(r => {
                    const row = { ...r };
                    delete row.STATUS;
                    delete row.INDICE;
                    row.SIMULACION = fechaStr;
                    if (row.OFERTA !== undefined && row.OFERTA !== '') row.OFERTA = parseInt(row.OFERTA) || 0;
                    ['TEL_1', 'TEL_2', 'TEL_3', 'TEL_4', 'TEL_5', 'TEL_6', 'TEL_7', 'TEL_8'].forEach(t => {
                        if (row[t] !== undefined && row[t] !== '') row[t] = Number(String(row[t]).replace(/\D/g, '')) || '';
                    });
                    return row;
                });

                setResultadoFinal(datosFin);
                const indicesStr = indices.join(',');
                const mesCargaExcl = `${mesCarga}_Excl`;

                const qBloqueo = `-- ============================================================
    -- QUERIES DE BLOQUEO - Simuladores BCH (${datosFin.length} registros)
    -- Fecha proceso: ${fechaStr} | MESCARGA: ${mesCarga}
    -- IMPORTANTE: Ejecutar ANTES de cargar el archivo en DERIVACIÓN
    -- ============================================================

    UPDATE [CustomerBancodeChile].[dbo].[CLIENTE_BANCO_DE_CHILE_CONSUMO]
    SET BLOQUEO_SIMULADOR = '${fechaStr}', MESCARGA = '${mesCargaExcl}'
    WHERE INDICE IN (${indicesStr});

    UPDATE [CustomerBancodeChile].[dbo].[C1_BANCO_DE_CHILE_CONSUMO]
    SET PRIORITE = '-11', RAPPEL = 'Z999999999999', VERSOP = '-1'
    WHERE INDICE IN (${indicesStr});`;

                setSqlBloqueo(qBloqueo);

                if (modoEjecucion === 'automatico') {
                    const r1 = await window.nexusAPI.executeSQL(`UPDATE [CustomerBancodeChile].[dbo].[CLIENTE_BANCO_DE_CHILE_CONSUMO] SET BLOQUEO_SIMULADOR = '${fechaStr}', MESCARGA = '${mesCargaExcl}' WHERE INDICE IN (${indicesStr})`);
                    const r2 = await window.nexusAPI.executeSQL(`UPDATE [CustomerBancodeChile].[dbo].[C1_BANCO_DE_CHILE_CONSUMO] SET PRIORITE = '-11', RAPPEL = 'Z999999999999', VERSOP = '-1' WHERE INDICE IN (${indicesStr})`);
                    setReporteEjecucion({
                        ok: r1.success && r2.success,
                        msg: r1.success && r2.success ? `Bloqueo aplicado: ${indices.length} registros actualizados en CONSUMO.` : `Error: ${r1.error || r2.error}`
                    });
                }

                setPanelMessage({ type: 'success', text: `${datosFin.length} simuladores procesados. Exporta el archivo y cárgalo en DERIVACIÓN.` });

            } catch (err) {
                setPanelMessage({ type: 'error', text: 'Error en el proceso: ' + err.message });
            }
            setIsProcessing(false);
        };

        const handleExportar = () => {
            if (resultadoFinal.length === 0) return;
            const { ws, headers, cleanData } = crearSheetLimpio(resultadoFinal);
            if (!ws) { addToast('No hay datos para exportar.', 'warning'); return; }
            const wb = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(wb, ws, 'Simuladores');
            window.XLSX.writeFile(wb, `Simuladores_BCH_${getFechaFormato()}.xlsx`);
            addToast(`Exportados ${cleanData.length} registros.`, 'success');
        };

        const copySQL = async () => {
            try { await navigator.clipboard.writeText(sqlBloqueo); addToast('Queries copiadas al portapapeles.', 'success'); }
            catch { addToast('Error al copiar.', 'error'); }
        };

        return (
            <div className="flex flex-col gap-5 p-1">
                {/* ENCABEZADO */}
                <div className="bg-blue-900 rounded-lg p-4 text-white">
                    <h3 className="text-lg font-bold flex items-center gap-2"><Icon name="cpu" size={20} /> Carga Simuladores BCH Consumo → Derivación</h3>
                    <p className="text-blue-200 text-xs mt-1">Extrae simuladores desde CONSUMO, genera bloqueo y exporta base para DERIVACIÓN.</p>
                </div>

                {/* FILA 1: CONFIGURACIÓN */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                    {/* Carga archivo */}
                    <div className="border border-blue-200 bg-blue-50 rounded-lg p-4 flex flex-col gap-3">
                        <h4 className="font-bold text-blue-800 text-sm flex items-center gap-2"><Icon name="upload" size={15} /> 1. Archivo Simuladores</h4>
                        <label className="border-2 border-dashed border-blue-300 bg-white rounded-lg p-4 text-center cursor-pointer hover:border-blue-500 transition-colors">
                            <input type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden" onChange={handleFileLoad} />
                            <Icon name="file-text" size={24} className="mx-auto text-blue-400 mb-1" />
                            <p className="text-xs text-blue-600 font-bold">{simFileName || 'Clic para cargar'}</p>
                            {simRowIds.length > 0 && <p className="text-xs text-green-600 font-bold mt-1">{simRowIds.length} ROW_IDs</p>}
                        </label>
                        {reportePrevio && (
                            <div className="bg-amber-50 border border-amber-300 rounded p-2 text-xs text-amber-800">
                                <strong>📊 Reporte previo:</strong><br />
                                {reportePrevio.yaEnDerivacion} de {reportePrevio.total} ROW_IDs ya están en DERIVACIÓN este período.
                            </div>
                        )}
                    </div>

                    {/* Fecha */}
                    <div className="border border-gray-200 bg-gray-50 rounded-lg p-4 flex flex-col gap-3">
                        <h4 className="font-bold text-gray-700 text-sm flex items-center gap-2"><Icon name="calendar" size={15} /> 2. Fecha de Proceso</h4>
                        <input type="date" className="border border-gray-300 rounded p-2 text-sm outline-none focus:border-blue-500 bg-white font-medium" value={fechaProceso} onChange={e => setFechaProceso(e.target.value)} />
                        <p className="text-xs text-gray-500">Formato exportado: <strong>{getFechaFormato()}</strong></p>
                        <p className="text-xs text-gray-500">MESCARGA: <strong>{getMesCarga()}</strong></p>
                    </div>

                    {/* Modo ejecución */}
                    <div className="border border-gray-200 bg-gray-50 rounded-lg p-4 flex flex-col gap-3">
                        <h4 className="font-bold text-gray-700 text-sm flex items-center gap-2"><Icon name="settings" size={15} /> 3. Modo de Bloqueo</h4>
                        <div className="flex flex-col gap-2">
                            <label className={`flex items-center gap-2 p-2 rounded cursor-pointer border-2 transition-colors ${modoEjecucion === 'manual' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'}`}>
                                <input type="radio" name="modo" value="manual" checked={modoEjecucion === 'manual'} onChange={() => setModoEjecucion('manual')} />
                                <div>
                                    <p className="text-sm font-bold text-gray-800">📋 Generar Query</p>
                                    <p className="text-xs text-gray-500">Copia y ejecuta manualmente</p>
                                </div>
                            </label>
                            <label className={`flex items-center gap-2 p-2 rounded cursor-pointer border-2 transition-colors ${modoEjecucion === 'automatico' ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white'}`}>
                                <input type="radio" name="modo" value="automatico" checked={modoEjecucion === 'automatico'} onChange={() => setModoEjecucion('automatico')} />
                                <div>
                                    <p className="text-sm font-bold text-gray-800">⚡ Ejecutar Automático</p>
                                    <p className="text-xs text-gray-500">Requiere conexión SQL activa</p>
                                </div>
                            </label>
                        </div>
                    </div>
                </div>

                {/* BOTÓN PROCESAR */}
                <button
                    onClick={handleProcesar}
                    disabled={isProcessing || simRowIds.length === 0}
                    className="w-full bg-blue-800 hover:bg-blue-900 disabled:bg-gray-400 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-colors shadow-md"
                >
                    {isProcessing ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> Procesando...</> : <><Icon name="zap" size={18} /> Procesar Simuladores</>}
                </button>

                {/* MENSAJE */}
                {panelMessage.text && (
                    <div className={`rounded-lg p-3 text-sm font-medium ${panelMessage.type === 'success' ? 'bg-green-50 border border-green-300 text-green-800' : panelMessage.type === 'error' ? 'bg-red-50 border border-red-300 text-red-800' : 'bg-amber-50 border border-amber-300 text-amber-800'}`}>
                        {panelMessage.text}
                    </div>
                )}

                {/* REPORTE EJECUCIÓN AUTOMÁTICA */}
                {reporteEjecucion && (
                    <div className={`rounded-lg p-4 text-sm ${reporteEjecucion.ok ? 'bg-green-50 border border-green-300 text-green-800' : 'bg-red-50 border border-red-300 text-red-800'}`}>
                        <strong>{reporteEjecucion.ok ? '✅ Bloqueo Ejecutado:' : '❌ Error:'}</strong> {reporteEjecucion.msg}
                        {reporteEjecucion.ok && <p className="mt-1 text-xs">Recuerde cargar el archivo exportado en la campaña <strong>BCH CONSUMO DERIVACIÓN</strong>.</p>}
                    </div>
                )}

                {/* QUERIES DE BLOQUEO */}
                {sqlBloqueo && (
                    <div className="flex flex-col gap-2">
                        <div className="flex justify-between items-center">
                            <h4 className="font-bold text-gray-700 text-sm flex items-center gap-2"><Icon name="code" size={15} /> Queries de Bloqueo ({modoEjecucion === 'manual' ? 'Copiar y ejecutar en el motor' : 'Ejecutadas automáticamente'})</h4>
                            <button onClick={copySQL} className="bg-gray-800 hover:bg-gray-900 text-white text-xs font-bold px-3 py-1.5 rounded flex items-center gap-1 transition-colors">
                                <Icon name="copy" size={13} /> Copiar
                            </button>
                        </div>
                        <pre className="bg-gray-900 text-green-300 text-xs p-4 rounded-lg overflow-x-auto whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">{sqlBloqueo}</pre>
                        {modoEjecucion === 'manual' && (
                            <div className="bg-amber-50 border border-amber-400 rounded p-3 text-xs text-amber-800">
                                <strong>⚠️ Importante:</strong> Ejecute estas queries en el motor de base de datos <strong>antes</strong> de cargar el archivo en la campaña BCH CONSUMO DERIVACIÓN. De lo contrario los registros seguirán activos en CONSUMO.
                            </div>
                        )}
                    </div>
                )}

                {/* EXPORTAR */}
                {resultadoFinal.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <div className="bg-green-50 border border-green-300 rounded-lg p-3 text-sm text-green-800 flex justify-between items-center">
                            <span><strong>{resultadoFinal.length} registros</strong> listos para exportar → campaña BCH CONSUMO DERIVACIÓN</span>
                            <button onClick={handleExportar} className="bg-green-700 hover:bg-green-800 text-white font-bold text-xs px-4 py-2 rounded flex items-center gap-1 transition-colors">
                                <Icon name="download" size={14} /> Descargar Excel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    };



    // ========================================================================
    // ⬇️ PEGAR AQUÍ ABAJO EL CÓDIGO DE LA SIGUIENTE TAREA ⬇️
    // ========================================================================  


    /* const TaskEjemplo = ({ campaigns, dispositions, Icon, addToast }) => {
        return (
            <div className="p-4">
                <h4 className="font-bold">Interfaz de Tarea de Ejemplo</h4>
            </div>
        );
    }; 
    */



    // ========================================================================
    // NÚCLEO PRINCIPAL (HOST)
    // ========================================================================
    return () => {
        const [activeTask, setActiveTask] = useState(null);
        const [showGuide, setShowGuide] = useState(false);

        // --- ESTADOS PARA DATOS DE NEXUS (SEGUNDO PLANO) ---
        const [campaigns, setCampaigns] = useState([]);
        const [typifications, setTypifications] = useState([]);

        // --- CARGA SILENCIOSA DE NEXUS ---
        useEffect(() => {
            const loadNexusData = async () => {
                try {
                    if (db) {
                        const camps = await db.getAll('campaigns') || [];
                        const typs = await db.getAll('typifications') || [];
                        setCampaigns(camps);
                        setTypifications(typs);
                    }
                } catch (error) {
                    console.error("Error cargando datos de Nexus:", error);
                }
            };
            loadNexusData();
        }, []);

        // --- AUTO-CORRECCIÓN VISUAL (TARJETA EN HOME) ---
        useEffect(() => {
            const fixIcon = async () => {
                if (!db) return;
                try {
                    const modules = await db.getAll('modules');
                    const candidates = modules.filter(m => m.title && (m.title.includes('Procesos_Vetec') || m.title.includes('Procesos Vetec')));
                    for (const me of candidates) {
                        if (me.color !== 'bg-slate-700' || me.icon !== 'terminal') {
                            me.color = 'bg-slate-700';
                            me.icon = 'cpu';
                            me.desc = 'Automatizaciones Control Desk';
                            await db.addOrUpdate('modules', [me]);
                        }
                    }
                } catch (e) { console.error("Error actualizando ícono:", e); }
            };
            fixIcon();
        }, []);

        // ========================================================================
        // ZONA 2: REGISTRO DE TAREAS EN EL MENÚ
        // ========================================================================
        // Instrucción: Agrega una línea aquí para cada tarea que pegues en la ZONA 1.

        const tasks = [
            {
                id: 'carga_sae',
                name: 'Carga Cencosud SAE WEB',
                component: <TaskCargaSaeWeb Icon={Icon} addToast={addToast} utils={utils} />,
                guide: [
                    'Esta tarea depura bases de la campaña SAE Web para su carga en Vicidial.',
                    '1. En "Tipo de Carga y Origen" seleccione Carga Masiva para procesar archivos del cliente, o elija un origen de referidos para extraer registros desde una lista existente.',
                    '2. Si es carga masiva, arrastre o seleccione los archivos base en la zona de carga. Soporta múltiples archivos.',
                    '3. Si es referido, pegue los RUTs a buscar en el área de texto y cargue el archivo de la lista de donde se extraerán.',
                    '4. Active o desactive "Lista Vigente" según necesite cruzar con registros ya cargados para excluirlos.',
                    '5. Seleccione el formato de salida (xlsx o xls) y active "Priorizar Cel." si desea que los celulares queden primero en los campos TEL.',
                    '6. Presione "Procesar Carga" para ejecutar.',
                    'El archivo descargado debe cargarse en la campaña CENCOSUD SAE WEB del CRM.'
                ]
            },
            {
                id: 'carga_rdr',
                name: 'Carga Cencosud RDR WEB',
                component: <TaskCargaRdrWeb Icon={Icon} addToast={addToast} utils={utils} />,
                guide: [
                    'Esta tarea depura bases de la campaña RDR Web para su carga en Vicidial.',
                    '1. En "Tipo de Carga y Origen" seleccione Carga Masiva o el origen de referidos correspondiente.',
                    '2. Si es masiva, cargue los archivos base. Si es referido, pegue los RUTs y cargue la lista de origen.',
                    '3. Active "Lista Vigente" si necesita excluir registros ya cargados.',
                    '4. Seleccione formato de salida y configure "Priorizar Cel." según necesidad.',
                    '5. Presione "Procesar Carga RDR" para ejecutar.',
                    'El archivo descargado debe cargarse en la campaña CENCOSUD RDR WEB del CRM.'
                ]
            },
            {
                id: 'carga_sae_tradicional',
                name: 'Carga Cencosud SAE',
                component: <TaskCargaSae Icon={Icon} addToast={addToast} utils={utils} />,
                guide: [
                    'Esta tarea depura bases de la campaña SAE tradicional para su carga en Vicidial.',
                    '1. Cargue los archivos base en la zona de carga. Soporta múltiples archivos.',
                    '2. Active o desactive el cruce con lista vigente según necesidad. Si está activo, cargue el archivo de exclusión.',
                    '3. Seleccione la fecha de proceso, formato de salida y configure "Priorizar Cel."',
                    '4. Presione "Ejecutar Proceso SAE" para procesar.',
                    'La tarea conserva el orden original de columnas del archivo y agrega NOMBRE_COMPLETO, TEL_1 a TEL_4, BASE y MES_CARGA al final. El archivo descargado debe cargarse en la campaña CENCOSUD SAE del CRM.'
                ]
            },
            {
                id: 'carga_compra_cartera',
                name: 'Carga Cencosud CC',
                component: <TaskCargaCompraCartera Icon={Icon} addToast={addToast} utils={utils} />,
                guide: [
                    'Esta tarea depura bases de Compra Cartera para su carga en Vicidial.',
                    '1. En "Tipo de Carga y Origen" seleccione Carga Masiva para archivos del cliente, un origen de referidos (SAE WEB, SAE o RDR WEB) para extraer desde listas, o Ingreso Manual para capturar referidos fila por fila.',
                    '2. Si es masiva, cargue los archivos y active el cruce con lista vigente si corresponde.',
                    '3. Si es referido desde lista, pegue los RUTs y cargue el archivo de la lista. El monto se captura automáticamente según el origen seleccionado.',
                    '4. Si es manual, complete la grilla con RUT, nombre, disponible y al menos un teléfono.',
                    '5. Configure fecha de proceso, formato de salida y "Priorizar Cel."',
                    '6. Presione "Ejecutar Carga Masiva", "Extraer Referidos de Lista" o "Generar Referidos" según el modo.',
                    'El archivo descargado debe cargarse en la campaña CENCOSUD COMPRA CARTERA del CRM.'
                ]
            },
            {
                id: 'gestion_sernac',
                name: 'Gestión Sernac y Bajas (Cencosud)',
                component: <TaskAltasBajasSernac Icon={Icon} />,
                guide: [
                    'Esta tarea gestiona altas Sernac y bajas de registros en el CRM. No genera archivos de carga sino archivos de gestión y queries SQL.',
                    '1. Para Proceso Sernac: cargue la base del cliente en la zona izquierda y la lista DNCL en la zona derecha. Presione "Cruzar" para identificar nuevos registros Sernac. Copie los resultados del panel y cárguelos en la lista DNC.',
                    '2. Para Bajas: seleccione el tipo de campaña o procese todo masivo. Cargue la lista de bajas del cliente y las listas vigentes de las campañas en la sección correspondiente. Presione "Generar Queries". Las queries SQL generadas se pueden copiar al portapapeles o descargar como archivo .sql para ejecutar en el motor de base de datos del CRM.',
                    'Importante: verifique en Vicidial que la sentencia "and bajas not in (\'1\')" se encuentre dentro de las instrucciones del filtro de la campaña.'
                ]
            },
            {
                id: 'carga_santander',
                name: 'Carga Santander Consumer',
                component: <TaskCargaSantander Icon={Icon} />,
                guide: [
                    'Esta tarea depura bases de campañas Santander Consumer para su carga en Vicidial.',
                    '1. Seleccione una campaña específica o "Gestionar Todas Juntas" para trabajar en paralelo.',
                    '2. En cada panel: configure la fecha de base, el máximo de repeticiones por RUT, y active "Priorizar Celulares" si corresponde.',
                    '3. Active "Excluir Lista Vigente" si necesita cruzar, y cargue ambos archivos: la base original y el archivo de exclusión.',
                    '4. Presione "Procesar" en el panel individual, o "Iniciar Análisis" para ejecutar todas las campañas con archivos cargados.',
                    'Los teléfonos se extraen de pares AREA+FONO (hasta 12 por registro), se limpian y deduplicatan. El archivo descargado debe cargarse en la campaña Santander correspondiente del CRM.'
                ]
            },
            {
                id: 'marcado_estrategias',
                name: 'Estrategias Santander Terreno',
                component: <TaskMarcadoEstrategias Icon={Icon} db={db} />,
                guide: [
                    'Esta tarea genera queries SQL para marcar estrategias en Vicidial. No genera archivos de carga.',
                    '1. Cargue el archivo con los RUTs o identificadores a marcar.',
                    '2. Seleccione la lista destino en Vicidial, el campo a actualizar y el valor de la estrategia.',
                    '3. Presione "Generar" para crear las sentencias SQL.',
                    '4. Copie o descargue las queries y ejecútelas directamente en el motor de base de datos de Vicidial.',
                    'Útil para segmentación y priorización de carteras sin intervenir manualmente la base.'
                ]
            },
            {
                id: 'carga_lapolar',
                name: 'Carga La Polar',
                component: <TaskCargaLaPolar Icon={Icon} utils={utils} />,
                guide: [
                    'Esta tarea depura bases de campañas La Polar para su carga en Vicidial, con soporte de homologación dinámica de columnas.',
                    '1. Seleccione una campaña específica o "Gestionar Todas Juntas".',
                    '2. Configure fecha, formato de salida, "Priorizar Celulares" y active "Excluir Registros" si necesita cruzar.',
                    '3. Cargue los archivos base (puede ser múltiples con estructuras diferentes).',
                    '4. Presione "Analizar y Procesar Carga". Si se detectan columnas discrepantes entre archivos, aparecerá un mapeador visual para unificarlas.',
                    '5. Resuelva las discrepancias seleccionando la columna maestra para cada caso y confirme.',
                    'Los teléfonos se detectan automáticamente por nombre de columna (CELULAR, TEL, FONO, MOVIL). El archivo descargado debe cargarse en la campaña La Polar correspondiente del CRM.'
                ]
            },
            {
                id: 'carga_coopeuch',
                name: 'Carga Coopeuch',
                component: <TaskCargaCoopeuch Icon={Icon} />,
                guide: [
                    'Esta tarea depura bases de 7 campañas Coopeuch para su carga en Vicidial. Soporta archivos cifrados con contraseña.',
                    '1. Seleccione una campaña o "Gestionar Todas Juntas".',
                    '2. Configure fecha, formato de salida y "Priorizar Celulares".',
                    '3. Cargue los archivos base. Si alguno está protegido con contraseña, aparecerá la zona de credenciales — ingrese la misma contraseña para todos o una por archivo.',
                    '4. Active "Excluir por Lista (RUT)" si necesita cruzar, y cargue el archivo de exclusión.',
                    '5. Presione "Procesar y Exportar" en el panel individual, o "Procesar Todo" para ejecutar todas las campañas con archivos cargados.',
                    'Los nombres se unifican automáticamente y los teléfonos se detectan por patrón de columna. El archivo descargado debe cargarse en la campaña Coopeuch correspondiente del CRM.'
                ]
            },
            {
                id: 'carga_bch',
                name: 'Carga Banco de Chile',
                component: <TaskCargaBancoChile Icon={Icon} />,
                guide: [
                    'Esta tarea depura bases de campañas Banco de Chile para su carga en Vicidial. Soporta archivos cifrados.',
                    '1. Seleccione una campaña o "Gestionar Todas Juntas". BCH Derivación está en construcción.',
                    '2. Para BCH Consumo: configure fecha, formato, "Priorizar Cel." y opcionalmente active "Orden Aleatorio" (apagado ordena por PROPENSION asc y OFERTA desc). Active "Crear NOMBRE_COMPLETO" si necesita unificar nombre.',
                    '3. Para REPRO_1 y REPRO_TOTAL: configure los mismos parámetros. Por defecto exporta 2 archivos (OPERACIONES con todos los registros y UNICOS con mayor monto por ROW_ID). Active "Desdoblamiento" para exportar un solo archivo con PRODUCTO_01..n y MONTO_01..n horizontales.',
                    '4. Cargue los archivos base. Si están protegidos, ingrese las contraseñas.',
                    '5. Active "Excluir por Lista (ROW_ID)" si necesita cruzar.',
                    '6. Presione "Procesar y Exportar".',
                    'Los teléfonos vienen en formato FONO1..n con guion separador. El archivo descargado debe cargarse en la campaña BCH correspondiente del CRM.'
                ]
            }

            , {
                id: 'carga_simuladores_bch',
                name: 'Carga Simuladores BCH',
                component: <TaskCargaSimuladoresBCH Icon={Icon} addToast={addToast} />,
                guide: [
                    'Esta tarea extrae simuladores de BCH CONSUMO y los prepara para carga en BCH CONSUMO DERIVACIÓN.',
                    '1. Carga el archivo del cliente con los ROW_IDs de simuladores. Al cargar, se muestra automáticamente cuántos ya están en DERIVACIÓN este período.',
                    '2. Configura la fecha de proceso (por defecto hoy). Se usará como valor de SIMULACION y como fecha de bloqueo.',
                    '3. Selecciona el modo de bloqueo: "Generar Query" para copiar y ejecutar manualmente (recomendado), o "Ejecutar Automático" si tienes conexión SQL activa y deseas aplicar el bloqueo desde la app.',
                    '4. Presiona "Procesar Simuladores". La app consulta CONSUMO filtrando por ROW_ID, STATUS válido y excluyendo los ya existentes en DERIVACIÓN.',
                    '5. Si elegiste modo manual: copia las queries de bloqueo y ejecútalas en el motor ANTES de cargar el archivo. Si elegiste automático: revisa el reporte de ejecución.',
                    '6. Descarga el archivo Excel y cárgalo en la campaña BCH CONSUMO DERIVACIÓN.',
                    'IMPORTANTE: Los registros bloqueados en CONSUMO quedan con MESCARGA marcado como "Mes_yy_Excl" y PRIORITE = -11, lo que los excluye del marcado normal.'
                ]
            }
            // --- TAREA 12: (Aquí irá la próxima) ---
        ];

        // ========================================================================
        // INTERFAZ GRÁFICA (NO TOCAR)
        // ========================================================================
        return (
            <div className="flex flex-col md:flex-row w-full h-full min-h-[600px] bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden">

                {/* PANEL IZQUIERDO: ÍNDICE DE TAREAS */}
                <div className="w-full md:w-64 bg-gray-900 text-white flex flex-col border-r border-gray-700">
                    <div className="p-5 border-b border-gray-800">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <Icon name="bolt" className="w-5 h-5 text-yellow-400" />
                            Procesos Vetec
                        </h2>
                        <p className="text-xs text-gray-400 mt-1">Automatizaciones Control Desk</p>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {tasks.length === 0 ? (
                            <div className="text-center text-gray-500 text-sm italic mt-10">
                                Sin tareas registradas.
                            </div>
                        ) : (
                            tasks.map(task => (
                                <button
                                    key={task.id}
                                    onClick={() => { setActiveTask(task.id); setShowGuide(false); }}
                                    className={`w-full text-left px-4 py-3 rounded-md transition-colors text-sm ${activeTask === task.id ? 'bg-blue-600 text-white shadow-md' : 'text-gray-300 hover:bg-gray-800'
                                        }`}
                                >
                                    {task.name}
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* PANEL DERECHO: ÁREA DE TRABAJO */}
                <div className="flex-1 bg-gray-50 p-6 flex flex-col items-center justify-center text-center relative overflow-y-auto">
                    {!activeTask ? (
                        <div>
                            <div className="p-4 bg-gray-200 rounded-full mb-4 shadow-inner inline-flex items-center justify-center">
                                <Icon name="clipboard-list" size={48} className="text-gray-500" />
                            </div>
                            <h3 className="text-2xl font-bold text-gray-800 mb-2">Selecciona una tarea</h3>
                            <p className="text-gray-500 max-w-md mx-auto">
                                Elige un proceso en el panel izquierdo para cargar los archivos e iniciar la automatización.
                            </p>
                        </div>
                    ) : showGuide ? (
                        <div className="w-full max-w-2xl mx-auto animate-fade-in flex flex-col items-center">
                            <div className="p-4 bg-blue-100 rounded-full mb-5 shadow-inner inline-flex items-center justify-center">
                                <Icon name="info" size={40} className="text-blue-600" />
                            </div>
                            <h3 className="text-2xl font-bold text-gray-800 mb-2">{tasks.find(t => t.id === activeTask)?.name}</h3>
                            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 mt-4 w-full text-left">
                                {(tasks.find(t => t.id === activeTask)?.guide || []).map((line, i) => (
                                    <p key={i} className={`text-sm text-gray-700 ${i === 0 ? 'font-bold text-gray-800 mb-3' : 'mb-2'} ${/^\d+\./.test(line) ? 'pl-2 border-l-2 border-blue-300 ml-1' : ''}`}>
                                        {line}
                                    </p>
                                ))}
                            </div>
                            <button
                                onClick={() => setShowGuide(false)}
                                className="mt-6 px-8 py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-all flex items-center gap-2 shadow-md"
                            >
                                <Icon name="arrowLeft" size={18} /> Volver a la tarea
                            </button>
                        </div>
                    ) : (
                        <div className="w-full h-full text-left animate-fade-in flex flex-col relative">
                            <button
                                onClick={() => setShowGuide(true)}
                                className="absolute top-0 right-0 z-10 w-8 h-8 bg-gray-200 hover:bg-blue-100 text-gray-600 hover:text-blue-700 rounded-full flex items-center justify-center font-bold text-sm transition-all shadow-sm border border-gray-300"
                                title="Guía de uso"
                            >?</button>
                            {tasks.find(t => t.id === activeTask)?.component}
                        </div>
                    )}
                </div>
            </div>
        );
    };
};