import { useMemo, useState, type ReactElement } from 'react';
import { apiUrl } from './api-url.js';
import { formatearPesos } from './App.js';

export interface ProductoCatalogoItem {
  id: string;
  codigo: string;
  nombre: string;
  costo_base: string;
  stock_actual_base: string;
}

export interface ImportadorMasivoModalProps {
  token: string;
  productosActuales: ProductoCatalogoItem[];
  onCerrar: () => void;
  onImportadoExitoso: (mensaje: string) => void;
}

interface ItemPrevisualizacion {
  fila: number;
  codigo: string;
  sku?: string | undefined;
  nombre: string;
  marca?: string | undefined;
  rubroNombre?: string | undefined;
  costoBase: string;
  precioMostradorSugerido?: string | undefined;
  unidadPrincipal: string;
  stockMinimo: string;
  stockActual?: string | undefined;
  codigoBarra?: string | undefined;
  esNuevo: boolean;
  error?: string | undefined;
}

export function ImportadorMasivoModal({
  token,
  productosActuales,
  onCerrar,
  onImportadoExitoso,
}: ImportadorMasivoModalProps): ReactElement {
  const [modoEntrada, setModoEntrada] = useState<'archivo' | 'pegar'>('archivo');
  const [textoPegado, setTextoPegado] = useState<string>('');
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null);
  const [itemsParseados, setItemsParseados] = useState<ItemPrevisualizacion[]>([]);
  const [procesando, setProcesando] = useState<boolean>(false);
  const [errorParseo, setErrorParseo] = useState<string | null>(null);

  // Mapa rápido de códigos existentes para detectar si es alta o actualización
  const codigosExistentes = useMemo(() => {
    const set = new Set<string>();
    for (const p of productosActuales) {
      set.add(p.codigo.trim().toLowerCase());
    }
    return set;
  }, [productosActuales]);

  // Generador de Plantilla CSV Modelo para descargar
  const descargarPlantilla = (): void => {
    const encabezados = [
      'codigo',
      'sku',
      'nombre',
      'marca',
      'rubro',
      'costo',
      'precio_mostrador',
      'unidad',
      'stock_minimo',
      'stock_actual',
      'codigo_barra',
    ].join(';');

    const filasEjemplo = [
      'TAR-FIS-8;SX-8;Tarugo Fischer SX 8mm x 100u;Fischer;Fijaciones;2500.00;4000.00;caja;5.000;20.000;7791234560011',
      'PIN-LAT-4L;ALB-04L;Pintura Látex Interior Blanco 4L;Alba;Pinturas;18500.00;29600.00;un;3.000;12.000;7791234560028',
      'DIS-COR-115;NOR-115;Disco de corte fino 115 x 1.6mm;Norton;Herramientas;950.00;1520.00;un;20.000;100.000;7791234560035',
      'CAB-TPR-25;PIR-225;Cable Taller Bipolar 2x2.5mm x 100m;Pirelli;Electricidad;42000.00;67200.00;rollo;2.000;15.000;7791234560042',
    ];

    const contenidoCsv = `\uFEFF${encabezados}\r\n${filasEjemplo.join('\r\n')}\r\n`;
    const blob = new Blob([contenidoCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'plantilla_articulos_ferreteria.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Parseador de texto plano (CSV / TSV / Excel copiado)
  const parsearTexto = (rawText: string): void => {
    setErrorParseo(null);
    const lineas = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lineas.length === 0) {
      setItemsParseados([]);
      return;
    }

    // Detectar separador de la primera línea: tabulador, punto y coma o coma
    const primeraLinea = lineas[0] ?? '';
    let delimitador = ',';
    if (primeraLinea.includes('\t')) {
      delimitador = '\t';
    } else if (primeraLinea.includes(';')) {
      delimitador = ';';
    }

    const dividirFila = (filaStr: string): string[] => {
      if (delimitador === '\t') {
        return filaStr.split('\t').map((c) => c.trim().replace(/^"|"$/g, ''));
      }
      // Regex para respetar comillas en CSV/punto y coma
      const regex = new RegExp(`(?:^|${delimitador})("(?:[^"]|"")*"|[^${delimitador}]*)`, 'g');
      const partes: string[] = [];
      let match;
      while ((match = regex.exec(filaStr)) !== null) {
        let celda = match[1] ?? '';
        if (celda.startsWith('"') && celda.endsWith('"')) {
          celda = celda.slice(1, -1).replace(/""/g, '"');
        }
        partes.push(celda.trim());
      }
      return partes;
    };

    const encabezados = dividirFila(primeraLinea).map((h) =>
      h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(),
    );

    // Mapeo flexible de columnas
    let idxCodigo = encabezados.findIndex((h) => ['codigo', 'cod', 'articulo', 'codigo_interno'].includes(h));
    const idxSku = encabezados.findIndex((h) => ['sku', 'modelo', 'cod_prov', 'cod_fabrica', 'referencia'].includes(h));
    if (idxCodigo === -1 && idxSku !== -1) {
      idxCodigo = idxSku;
    }
    const idxNombre = encabezados.findIndex((h) => ['nombre', 'descripcion', 'detalle', 'producto'].includes(h));
    const idxMarca = encabezados.findIndex((h) => ['marca', 'fabricante'].includes(h));
    const idxRubro = encabezados.findIndex((h) => ['rubro', 'categoria', 'familia', 'seccion'].includes(h));
    const idxCosto = encabezados.findIndex((h) => ['costo', 'precio_costo', 'costo_base', 'costo_unitario'].includes(h));
    const idxPrecioMostrador = encabezados.findIndex((h) => ['precio_mostrador', 'mostrador', 'precio_venta', 'pvp', 'precio'].includes(h));
    const idxUnidad = encabezados.findIndex((h) => ['unidad', 'u_medida', 'um'].includes(h));
    const idxStockMinimo = encabezados.findIndex((h) => ['stock_minimo', 'minimo', 'stk_min'].includes(h));
    const idxStockActual = encabezados.findIndex((h) => ['stock_actual', 'stock', 'existencia', 'cantidad', 'stk_actual'].includes(h));
    const idxCodigoBarra = encabezados.findIndex((h) => ['codigo_barra', 'barra', 'ean', 'ean13', 'upc'].includes(h));

    if (idxCodigo === -1 || idxNombre === -1) {
      setErrorParseo(
        'El archivo no contiene las columnas requeridas: "codigo" y "nombre". Descargá la plantilla modelo para orientarte.',
      );
      setItemsParseados([]);
      return;
    }

    const limpiarMonto = (val: string | undefined): string => {
      if (!val) return '0.00';
      const limpio = val.replace(/[$ \s]/g, '').replace(',', '.');
      const num = Number(limpio);
      return isNaN(num) || num < 0 ? '0.00' : num.toFixed(2);
    };

    const limpiarCantidad = (val: string | undefined, def = '0.000'): string => {
      if (!val) return def;
      const limpio = val.replace(/[$ \s]/g, '').replace(',', '.');
      const num = Number(limpio);
      return isNaN(num) || num < 0 ? def : num.toFixed(3);
    };

    const items: ItemPrevisualizacion[] = [];

    for (let i = 1; i < lineas.length; i++) {
      const linea = lineas[i];
      if (!linea) continue;
      const cols = dividirFila(linea);
      if (cols.length === 0 || cols.every((c) => c === '')) continue;

      const codigo = cols[idxCodigo]?.trim() ?? '';
      const nombre = cols[idxNombre]?.trim() ?? '';
      const marca = idxMarca !== -1 ? cols[idxMarca]?.trim() : undefined;
      const rubroNombre = idxRubro !== -1 ? cols[idxRubro]?.trim() : undefined;
      const costoBase = limpiarMonto(idxCosto !== -1 ? cols[idxCosto] : undefined);
      const precioMostradorSugerido =
        idxPrecioMostrador !== -1 ? limpiarMonto(cols[idxPrecioMostrador]) : undefined;
      const unidadPrincipal = (idxUnidad !== -1 ? cols[idxUnidad]?.trim() : '') || 'un';
      const stockMinimo = limpiarCantidad(idxStockMinimo !== -1 ? cols[idxStockMinimo] : undefined, '0.000');
      const colStock = idxStockActual !== -1 ? cols[idxStockActual] : undefined;
      const stockActual =
        colStock !== undefined && colStock.trim() !== ''
          ? limpiarCantidad(colStock, '0.000')
          : undefined;
      const codigoBarra = idxCodigoBarra !== -1 ? cols[idxCodigoBarra]?.trim() : undefined;

      let error: string | undefined;
      if (!codigo) {
        error = 'Falta el código (SKU)';
      } else if (!nombre) {
        error = 'Falta el nombre o descripción';
      }

      const sku = (idxSku !== -1 ? cols[idxSku]?.trim() : undefined) || undefined;
      const esNuevo = !codigosExistentes.has(codigo.toLowerCase());

      items.push({
        fila: i + 1,
        codigo,
        sku,
        nombre,
        marca: marca || undefined,
        rubroNombre: rubroNombre || undefined,
        costoBase,
        precioMostradorSugerido:
          precioMostradorSugerido && Number(precioMostradorSugerido) > 0
            ? precioMostradorSugerido
            : undefined,
        unidadPrincipal,
        stockMinimo,
        stockActual,
        codigoBarra: codigoBarra || undefined,
        esNuevo,
        error,
      });
    }

    setItemsParseados(items);
  };

  const handleArchivoSeleccionado = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    setNombreArchivo(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const texto = evt.target?.result as string;
      parsearTexto(texto);
    };
    reader.readAsText(file, 'utf-8');
  };

  const confirmarImportacion = async (): Promise<void> => {
    const validos = itemsParseados.filter((it) => !it.error);
    if (validos.length === 0) {
      setErrorParseo('No hay filas válidas para importar.');
      return;
    }

    setProcesando(true);
    setErrorParseo(null);

    try {
      const payload = {
        productos: validos.map((it) => ({
          codigo: it.codigo,
          sku: it.sku,
          nombre: it.nombre,
          marca: it.marca,
          rubroNombre: it.rubroNombre,
          costoBase: it.costoBase,
          precioMostradorSugerido: it.precioMostradorSugerido,
          unidadPrincipal: it.unidadPrincipal,
          stockMinimo: it.stockMinimo,
          stockActual: it.stockActual,
          codigoBarra: it.codigoBarra,
        })),
      };

      const res = await fetch(apiUrl('/api/productos/importar-masivo'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? 'Error al procesar la importación masiva');
      }

      const data = (await res.json()) as {
        totalProcesados: number;
        creados: number;
        actualizados: number;
        movimientosStockCreados: number;
        rubrosCreados: number;
      };

      onImportadoExitoso(
        `✅ Importación masiva completada: ${data.creados} nuevos artículos, ${data.actualizados} actualizados, ${data.movimientosStockCreados} movimientos de stock registrados y ${data.rubrosCreados} rubros creados.`,
      );
      onCerrar();
    } catch (err: unknown) {
      setErrorParseo(err instanceof Error ? err.message : 'Error en la importación');
    } finally {
      setProcesando(false);
    }
  };

  const cantNuevos = itemsParseados.filter((i) => i.esNuevo && !i.error).length;
  const cantActualizados = itemsParseados.filter((i) => !i.esNuevo && !i.error).length;
  const cantErrores = itemsParseados.filter((i) => Boolean(i.error)).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-3xl bg-white shadow-2xl overflow-hidden border border-slate-200">
        {/* Cabecera del Modal */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700 font-bold text-lg">
              📥
            </span>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Carga Masiva de Artículos y Precios
              </h2>
              <p className="text-xs text-slate-500">
                Importá desde Excel o CSV con actualización automática de catálogo, precios y stock en Kardex.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Barra de opciones de entrada y descarga de plantilla */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-blue-50/70 p-4 rounded-2xl border border-blue-100">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setModoEntrada('archivo');
                }}
                className={`rounded-xl px-4 py-2 text-xs font-bold transition-colors ${
                  modoEntrada === 'archivo'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                📁 Subir Archivo (.CSV / Excel)
              </button>
              <button
                type="button"
                onClick={() => {
                  setModoEntrada('pegar');
                }}
                className={`rounded-xl px-4 py-2 text-xs font-bold transition-colors ${
                  modoEntrada === 'pegar'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                📋 Pegar directo desde Excel
              </button>
            </div>

            <button
              type="button"
              onClick={descargarPlantilla}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-blue-700 border border-blue-200 shadow-sm hover:bg-blue-50"
            >
              <span>📄</span>
              <span>Descargar Plantilla Modelo (.CSV)</span>
            </button>
          </div>

          {/* Área de carga según modo */}
          {modoEntrada === 'archivo' ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/50 p-8 hover:bg-slate-50 transition-colors">
              <span className="text-4xl mb-2">📊</span>
              <p className="text-sm font-semibold text-slate-700 mb-1">
                {nombreArchivo ? `Archivo seleccionado: ${nombreArchivo}` : 'Seleccioná un archivo CSV exportado desde Excel'}
              </p>
              <p className="text-xs text-slate-400 mb-4">
                Compatible con delimitador punto y coma (;), coma (,) o tabulaciones.
              </p>
              <label className="cursor-pointer rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow hover:bg-blue-500">
                <span>Examinar archivo...</span>
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleArchivoSeleccionado}
                  className="hidden"
                />
              </label>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700">
                Pegá aquí las celdas copiadas directamente de tu planilla de Excel (Ctrl+V):
              </label>
              <textarea
                rows={5}
                placeholder="codigo&#9;nombre&#9;costo&#9;precio_mostrador&#9;stock_actual&#10;TAR-8&#9;Tarugo 8mm&#9;2500.00&#9;4000.00&#9;20"
                value={textoPegado}
                onChange={(e) => {
                  setTextoPegado(e.target.value);
                  parsearTexto(e.target.value);
                }}
                className="w-full rounded-2xl border border-slate-300 p-3 font-mono text-xs text-slate-900 shadow-inner focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Mensaje de Error en Parseo si hubiere */}
          {errorParseo && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
              ⚠️ {errorParseo}
            </div>
          )}

          {/* Tabla de Previsualización con Semáforo */}
          {itemsParseados.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                <h3 className="text-sm font-bold text-slate-900">
                  Vista Previa ({itemsParseados.length} artículos detectados)
                </h3>
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-emerald-800">
                    ✨ {cantNuevos} Nuevos
                  </span>
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-blue-800">
                    🔄 {cantActualizados} Actualizaciones
                  </span>
                  {cantErrores > 0 && (
                    <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-rose-800">
                      ⚠️ {cantErrores} Con Errores
                    </span>
                  )}
                </div>
              </div>

              <div className="max-h-64 overflow-x-auto overflow-y-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="sticky top-0 bg-slate-100 text-[11px] font-bold uppercase text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2">Código</th>
                      <th className="px-3 py-2">Artículo</th>
                      <th className="px-3 py-2">Rubro</th>
                      <th className="px-3 py-2 text-right">Costo</th>
                      <th className="px-3 py-2 text-right">P. Mostrador</th>
                      <th className="px-3 py-2 text-right">Stock Actual</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {itemsParseados.map((it) => (
                      <tr
                        key={it.fila}
                        className={it.error ? 'bg-rose-50/50' : it.esNuevo ? 'hover:bg-emerald-50/30' : 'hover:bg-blue-50/30'}
                      >
                        <td className="px-3 py-2">
                          {it.error ? (
                            <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 font-bold text-[10px] text-rose-800" title={it.error}>
                              ⚠️ {it.error}
                            </span>
                          ) : it.esNuevo ? (
                            <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-[10px] text-emerald-800">
                              ✨ Nuevo
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 font-bold text-[10px] text-blue-800">
                              🔄 Actualiza
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono font-bold text-slate-900">{it.codigo || '-'}</td>
                        <td className="px-3 py-2">
                          <span className="font-semibold text-slate-800">{it.nombre || '-'}</span>
                          {it.marca && <span className="text-[10px] text-slate-400 block">{it.marca}</span>}
                        </td>
                        <td className="px-3 py-2">{it.rubroNombre ?? 'Sin rubro'}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">
                          {formatearPesos(it.costoBase)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-600">
                          {it.precioMostradorSugerido ? formatearPesos(it.precioMostradorSugerido) : '-'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">
                          {it.stockActual !== undefined ? `${it.stockActual} ${it.unidadPrincipal}` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Pie del Modal con Acciones */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={onCerrar}
            disabled={procesando}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-100 disabled:opacity-50"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={() => void confirmarImportacion()}
            disabled={procesando || itemsParseados.length === 0 || cantNuevos + cantActualizados === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow hover:bg-blue-500 disabled:opacity-50"
          >
            <span>{procesando ? 'Procesando e Importando...' : `Confirmar e Importar ${cantNuevos + cantActualizados} Artículos`}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
