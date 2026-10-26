import { useState, type ReactElement } from 'react';
import type {
  ActualizarPreciosListaProveedorInput,
  ActualizarPreciosPorcentajeInput,
  PrevisualizacionPrecioItem,
  ReglaRedondeoPrecios,
  ResultadoActualizacionPrecios,
  RolUsuario,
} from '@ferreteria/shared';
import { apiUrl } from './api-url.js';
import { formatearPesos } from './App.js';

export interface ActualizadorMasivoPreciosProps {
  token: string;
  rolUsuario: RolUsuario;
  rubros: Array<{ id: string; nombre: string }>;
  onActualizacionExitosa?: () => void;
  onCerrar?: () => void;
}

export function ActualizadorMasivoPrecios({
  token,
  rolUsuario: _rolUsuario,
  rubros,
  onActualizacionExitosa,
  onCerrar,
}: ActualizadorMasivoPreciosProps): ReactElement {
  // Pestaña activa
  const [pestana, setPestana] = useState<'porcentaje' | 'proveedor'>('porcentaje');

  // Estado Pestaña 1: Aumento Porcentual
  const [porcentajeInput, setPorcentajeInput] = useState<string>('10');
  const [rubroIdSeleccionado, setRubroIdSeleccionado] = useState<string>('');
  const [baseSeleccionada, setBaseSeleccionada] = useState<'costo_base' | 'precio_venta'>('costo_base');
  const [redondeoSeleccionado, setRedondeoSeleccionado] = useState<ReglaRedondeoPrecios>('multiplo_10');

  // Previsualización
  const [cargandoPrevia, setCargandoPrevia] = useState<boolean>(false);
  const [previsualizacion, setPrevisualizacion] = useState<PrevisualizacionPrecioItem[] | null>(null);
  const [totalCoincidentes, setTotalCoincidentes] = useState<number>(0);

  // Estado Pestaña 2: Lista de Proveedor
  const [textoListaProveedor, setTextoListaProveedor] = useState<string>('');
  const [redondeoProveedor, setRedondeoProveedor] = useState<ReglaRedondeoPrecios>('ninguno');
  const [filasParseadas, setFilasParseadas] = useState<Array<{ identificador: string; nuevoCosto: string }>>([]);

  // Acciones & Feedback
  const [guardando, setGuardando] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultadoExito, setResultadoExito] = useState<ResultadoActualizacionPrecios | null>(null);

  // Manejo de chips de porcentaje rápido
  const setPorcentajeRapido = (pct: number): void => {
    setPorcentajeInput(String(pct));
    setPrevisualizacion(null);
  };

  // Simular / Previsualizar aumento porcentual
  const handlePrevisualizar = async (): Promise<void> => {
    const pct = parseFloat(porcentajeInput);
    if (isNaN(pct) || pct === 0) {
      setErrorMsg('Ingresa un porcentaje de variación válido (positivo o negativo).');
      return;
    }

    setCargandoPrevia(true);
    setErrorMsg(null);
    setResultadoExito(null);

    try {
      const payload: ActualizarPreciosPorcentajeInput = {
        porcentaje: pct,
        base: baseSeleccionada,
        rubroId: rubroIdSeleccionado || undefined,
        redondeo: redondeoSeleccionado,
      };

      const res = await fetch(apiUrl('/api/productos/precios/previsualizar-aumento'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = (await res.json()) as { error?: string };
        throw new Error(errJson.error ?? 'Error al simular aumento');
      }

      const data = (await res.json()) as {
        totalCoincidentes: number;
        previsualizacion: PrevisualizacionPrecioItem[];
      };

      setTotalCoincidentes(data.totalCoincidentes);
      setPrevisualizacion(data.previsualizacion);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al previsualizar');
    } finally {
      setCargandoPrevia(false);
    }
  };

  // Confirmar y aplicar aumento masivo
  const handleAplicarAumento = async (): Promise<void> => {
    const pct = parseFloat(porcentajeInput);
    if (isNaN(pct) || pct === 0) {
      setErrorMsg('Porcentaje inválido.');
      return;
    }

    setGuardando(true);
    setErrorMsg(null);

    try {
      const payload: ActualizarPreciosPorcentajeInput = {
        porcentaje: pct,
        base: baseSeleccionada,
        rubroId: rubroIdSeleccionado || undefined,
        redondeo: redondeoSeleccionado,
      };

      const res = await fetch(apiUrl('/api/productos/precios/aplicar-aumento'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = (await res.json()) as { error?: string };
        throw new Error(errJson.error ?? 'Error al aplicar aumento masivo');
      }

      const resData = (await res.json()) as ResultadoActualizacionPrecios;
      setResultadoExito(resData);
      setPrevisualizacion(null);
      if (onActualizacionExitosa) {
        onActualizacionExitosa();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al aplicar cambios');
    } finally {
      setGuardando(false);
    }
  };

  // Parsear texto pegado de lista de proveedor (código \t costo o código,costo)
  const handleParsearTextoProveedor = (texto: string): void => {
    setTextoListaProveedor(texto);
    if (!texto.trim()) {
      setFilasParseadas([]);
      return;
    }

    const lineas = texto.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const parseados: Array<{ identificador: string; nuevoCosto: string }> = [];

    for (const linea of lineas) {
      // Ignorar encabezados si contienen palabras como "codigo" o "costo" o "precio"
      const lower = linea.toLowerCase();
      if (
        (lower.includes('codigo') || lower.includes('sku') || lower.includes('ean')) &&
        (lower.includes('costo') || lower.includes('precio') || lower.includes('lista'))
      ) {
        continue;
      }

      // Separadores admitidos: tabulador, punto y coma, coma o pipe
      const partes = linea.includes('\t')
        ? linea.split('\t')
        : linea.includes(';')
        ? linea.split(';')
        : linea.includes(',')
        ? linea.split(',')
        : linea.split('|');

      if (partes.length >= 2) {
        const iden = partes[0]?.trim();
        const rawCosto = partes[1]?.trim().replace('$', '').replace(/\./g, '').replace(',', '.');
        const numCosto = parseFloat(rawCosto ?? '0');
        if (iden && !isNaN(numCosto) && numCosto > 0) {
          parseados.push({
            identificador: iden,
            nuevoCosto: numCosto.toFixed(2),
          });
        }
      }
    }

    setFilasParseadas(parseados);
  };

  // Procesar lista de proveedor
  const handleProcesarListaProveedor = async (): Promise<void> => {
    if (filasParseadas.length === 0) {
      setErrorMsg('No se detectaron artículos válidos en la lista. Pega al menos un código y costo.');
      return;
    }

    setGuardando(true);
    setErrorMsg(null);

    try {
      const payload: ActualizarPreciosListaProveedorInput = {
        items: filasParseadas,
        redondeo: redondeoProveedor,
      };

      const res = await fetch(apiUrl('/api/productos/precios/actualizar-desde-lista'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = (await res.json()) as { error?: string };
        throw new Error(errJson.error ?? 'Error al procesar lista');
      }

      const resData = (await res.json()) as ResultadoActualizacionPrecios;
      setResultadoExito(resData);
      setTextoListaProveedor('');
      setFilasParseadas([]);
      if (onActualizacionExitosa) {
        onActualizacionExitosa();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al procesar lista');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm space-y-6">
      {/* Encabezado y Selector de Modo */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-600 text-white font-black text-lg">
              ⚡
            </span>
            <h2 className="text-xl font-black text-slate-900 tracking-tight">
              Actualizador Masivo de Precios
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Ajustes porcentuales por rubro, reglas de redondeo comercial y carga desde listas de proveedor.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-xl bg-slate-100 p-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setPestana('porcentaje');
                setErrorMsg(null);
                setResultadoExito(null);
              }}
              className={`rounded-lg px-3 py-1.5 transition ${
                pestana === 'porcentaje'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📈 Porcentaje por Rubro
            </button>
            <button
              type="button"
              onClick={() => {
                setPestana('proveedor');
                setErrorMsg(null);
                setResultadoExito(null);
              }}
              className={`rounded-lg px-3 py-1.5 transition ${
                pestana === 'proveedor'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📑 Lista de Proveedor
            </button>
          </div>

          {onCerrar && (
            <button
              type="button"
              onClick={onCerrar}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-50"
            >
              ✕ Cerrar
            </button>
          )}
        </div>
      </div>

      {/* Alertas */}
      {errorMsg && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800 flex items-center justify-between">
          <span>⚠️ {errorMsg}</span>
          <button
            type="button"
            onClick={() => { setErrorMsg(null); }}
            className="font-bold underline"
          >
            ✕
          </button>
        </div>
      )}

      {resultadoExito && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-medium text-emerald-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">✅</span>
            <span>{resultadoExito.mensaje}</span>
          </div>
          <button
            type="button"
            onClick={() => { setResultadoExito(null); }}
            className="font-bold underline text-emerald-800"
          >
            ✕
          </button>
        </div>
      )}

      {/* MODO 1: AUMENTO PORCENTUAL */}
      {pestana === 'porcentaje' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200/80">
            {/* Porcentaje y Chips */}
            <div className="space-y-2 md:col-span-1">
              <label className="text-xs font-black uppercase text-slate-700 block">
                Porcentaje (%)
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.5"
                  value={porcentajeInput}
                  onChange={(e) => {
                    setPorcentajeInput(e.target.value);
                    setPrevisualizacion(null);
                  }}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base font-black text-slate-900 focus:border-purple-500 focus:outline-none text-right"
                  placeholder="Ej: 15"
                />
                <span className="font-bold text-slate-500 text-sm">%</span>
              </div>

              {/* Chips rápidos */}
              <div className="flex flex-wrap gap-1 pt-1">
                {[5, 10, 15, 20, 25, 30].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => { setPorcentajeRapido(val); }}
                    className="rounded-lg bg-white px-2 py-1 text-[11px] font-bold text-purple-700 border border-purple-200 hover:bg-purple-50"
                  >
                    +{val}%
                  </button>
                ))}
              </div>
            </div>

            {/* Rubro */}
            <div className="space-y-2 md:col-span-1">
              <label className="text-xs font-black uppercase text-slate-700 block">
                Rubro a Afectar
              </label>
              <select
                value={rubroIdSeleccionado}
                onChange={(e) => {
                  setRubroIdSeleccionado(e.target.value);
                  setPrevisualizacion(null);
                }}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 focus:border-purple-500 focus:outline-none"
              >
                <option value="">Todos los rubros (Catálogo completo)</option>
                {rubros.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nombre}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-slate-400">
                Filtra por rubro si el aumento proviene de un fabricante específico.
              </p>
            </div>

            {/* Base a Modificar */}
            <div className="space-y-2 md:col-span-1">
              <label className="text-xs font-black uppercase text-slate-700 block">
                Base del Ajuste
              </label>
              <select
                value={baseSeleccionada}
                onChange={(e) => {
                  setBaseSeleccionada(e.target.value as 'costo_base' | 'precio_venta');
                  setPrevisualizacion(null);
                }}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 focus:border-purple-500 focus:outline-none"
              >
                <option value="costo_base">Costo de Reposición / Base</option>
                <option value="precio_venta">Precio de Venta Mostrador</option>
              </select>
              <p className="text-[10px] text-slate-400">
                Aumentar el costo base actualiza todas las listas manteniendo sus márgenes.
              </p>
            </div>

            {/* Redondeo Comercial */}
            <div className="space-y-2 md:col-span-1">
              <label className="text-xs font-black uppercase text-slate-700 block">
                Regla de Redondeo
              </label>
              <select
                value={redondeoSeleccionado}
                onChange={(e) => {
                  setRedondeoSeleccionado(e.target.value as ReglaRedondeoPrecios);
                  setPrevisualizacion(null);
                }}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 focus:border-purple-500 focus:outline-none"
              >
                <option value="multiplo_10">Múltiplo de $10 (Recomendado)</option>
                <option value="multiplo_50">Múltiplo de $50</option>
                <option value="multiplo_100">Múltiplo de $100</option>
                <option value="entero">Al peso entero ($1.00)</option>
                <option value="ninguno">Sin redondeo (Decimal exacto)</option>
              </select>
              <p className="text-[10px] text-slate-400">
                Evita precios con monedas o billetes fuera de circulación.
              </p>
            </div>
          </div>

          {/* Botón Previsualizar */}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              disabled={cargandoPrevia}
              onClick={() => void handlePrevisualizar()}
              className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-purple-700 disabled:opacity-50 transition"
            >
              {cargandoPrevia ? 'Calculando impacto...' : '🔍 Simular y Previsualizar Impacto'}
            </button>
          </div>

          {/* Tabla de Previsualización */}
          {previsualizacion && (
            <div className="space-y-4 border border-purple-200 bg-purple-50/30 rounded-2xl p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-purple-100 pb-3">
                <div>
                  <h3 className="text-sm font-black text-slate-900">
                    Previsualización del Aumento ({previsualizacion.length} de {totalCoincidentes} artículos coincidentes)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Revisa las variaciones antes de aplicar los cambios en la base de datos.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={guardando}
                  onClick={() => void handleAplicarAumento()}
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 transition"
                >
                  {guardando ? 'Actualizando artículos...' : '⚡ Confirmar y Aplicar Aumento Definitivo'}
                </button>
              </div>

              <div className="overflow-x-auto max-h-96 rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 uppercase text-[10px] font-black text-slate-500 border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="p-2.5">Código / Artículo</th>
                      <th className="p-2.5">Rubro</th>
                      <th className="p-2.5 text-right">Costo Actual</th>
                      <th className="p-2.5 text-right">Nuevo Costo</th>
                      <th className="p-2.5 text-right">P. Venta Actual</th>
                      <th className="p-2.5 text-right">Nuevo P. Venta</th>
                      <th className="p-2.5 text-right">Variación ($)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {previsualizacion.map((item) => (
                      <tr key={item.productoId} className="hover:bg-slate-50/60">
                        <td className="p-2.5">
                          <span className="font-mono text-[10px] text-slate-400 block">
                            {item.codigo}
                          </span>
                          <span className="font-bold text-slate-900">{item.nombre}</span>
                        </td>
                        <td className="p-2.5 text-slate-600">
                          {item.rubroNombre ?? 'Sin rubro'}
                        </td>
                        <td className="p-2.5 text-right font-medium text-slate-600">
                          {formatearPesos(item.costoActual)}
                        </td>
                        <td className="p-2.5 text-right font-black text-purple-900 bg-purple-50/50">
                          {formatearPesos(item.costoNuevo)}
                        </td>
                        <td className="p-2.5 text-right font-medium text-slate-600">
                          {formatearPesos(item.precioVentaActual)}
                        </td>
                        <td className="p-2.5 text-right font-black text-emerald-700 bg-emerald-50/50">
                          {formatearPesos(item.precioVentaNuevo)}
                        </td>
                        <td className="p-2.5 text-right font-bold text-emerald-800">
                          +{formatearPesos(item.diferenciaMonto)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODO 2: LISTA DE PROVEEDOR */}
      {pestana === 'proveedor' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-slate-50 p-4 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black uppercase text-slate-700">
                Pega aquí las columnas de Excel del Proveedor
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-slate-500">Redondeo:</span>
                <select
                  value={redondeoProveedor}
                  onChange={(e) => { setRedondeoProveedor(e.target.value as ReglaRedondeoPrecios); }}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-800 focus:outline-none"
                >
                  <option value="ninguno">Sin redondeo</option>
                  <option value="multiplo_10">Múltiplo de $10</option>
                  <option value="multiplo_50">Múltiplo de $50</option>
                  <option value="multiplo_100">Múltiplo de $100</option>
                  <option value="entero">Al peso entero</option>
                </select>
              </div>
            </div>

            <textarea
              rows={8}
              value={textoListaProveedor}
              onChange={(e) => { handleParsearTextoProveedor(e.target.value); }}
              placeholder={`Copia desde Excel o lista de precios (Código o EAN [TAB] Costo)\nEjemplo:\nTOR-001\t185.00\n7791234567890\t1420.50\nPIN-LATEX-20L\t38500.00`}
              className="w-full rounded-xl border border-slate-300 bg-white p-3 font-mono text-xs text-slate-800 focus:border-purple-500 focus:outline-none"
            />

            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                Filas detectadas:{' '}
                <strong className="text-purple-700 font-bold">
                  {filasParseadas.length} artículos
                </strong>
              </span>
              <span className="text-[11px] text-slate-400">
                Coincide por código SKU o por código de barras de cualquier proveedor.
              </span>
            </div>
          </div>

          {/* Previsualización rápida de filas parseadas */}
          {filasParseadas.length > 0 && (
            <div className="border border-slate-200 rounded-2xl p-4 bg-white space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-800 uppercase">
                  Muestra de artículos a conciliar ({Math.min(5, filasParseadas.length)} de {filasParseadas.length})
                </span>
                <button
                  type="button"
                  disabled={guardando}
                  onClick={() => void handleProcesarListaProveedor()}
                  className="rounded-xl bg-purple-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-purple-700 disabled:opacity-50 transition"
                >
                  {guardando ? 'Procesando lista...' : '📥 Aplicar Nuevos Costos de Lista'}
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {filasParseadas.slice(0, 10).map((f, i) => (
                  <span
                    key={i}
                    className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-700 border border-slate-200"
                  >
                    <strong className="font-mono">{f.identificador}</strong> →{' '}
                    <strong className="text-purple-800">{formatearPesos(f.nuevoCosto)}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
