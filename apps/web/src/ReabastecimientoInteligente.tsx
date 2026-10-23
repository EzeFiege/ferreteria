import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type {
  GenerarOrdenesReabastecimientoInput,
  GenerarOrdenesReabastecimientoResponse,
  OrdenCompraGeneradaInfo,
  RolUsuario,
  SugerenciaReabastecimientoItem,
} from '@ferreteria/shared';
import { apiUrl } from './api-url.js';
import { formatearPesos } from './App.js';

export interface ReabastecimientoInteligenteProps {
  token: string;
  rolActivo: RolUsuario;
  onIrAOrdenes?: () => void;
}

interface ResumenSugerencias {
  totalSugeridos: number;
  totalQuiebres: number;
  totalCriticos: number;
  totalPreventivos: number;
  resumenProveedores: Array<{
    proveedorId: string;
    proveedorNombre: string;
    cantidadArticulos: number;
    inversionEstimada: string;
  }>;
}

export function ReabastecimientoInteligente({
  token,
  rolActivo,
  onIrAOrdenes,
}: ReabastecimientoInteligenteProps): ReactElement {
  const [items, setItems] = useState<SugerenciaReabastecimientoItem[]>([]);
  const [resumen, setResumen] = useState<ResumenSugerencias | null>(null);
  const [cargando, setCargando] = useState<boolean>(false);
  const [filtroUrgencia, setFiltroUrgencia] = useState<string>('todos');
  const [filtroProveedor, setFiltroProveedor] = useState<string>('');

  // Cantidades modificadas por el usuario: map productoId -> cantidad string
  const [cantidadesPedir, setCantidadesPedir] = useState<Record<string, string>>({});
  // Selección de artículos para generar la orden: map productoId -> boolean
  const [seleccionados, setSeleccionados] = useState<Record<string, boolean>>({});

  // Feedback
  const [generando, setGenerando] = useState<boolean>(false);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [ordenesGeneradas, setOrdenesGeneradas] = useState<OrdenCompraGeneradaInfo[]>([]);

  const esDuenoOEncargado = rolActivo === 'dueno' || rolActivo === 'encargado';

  const cargarSugerencias = useCallback(async () => {
    setCargando(true);
    setErrorMsg(null);
    try {
      let url = apiUrl('/api/reabastecimiento/sugerencias?');
      if (filtroUrgencia && filtroUrgencia !== 'todos') {
        url += `urgencia=${filtroUrgencia}&`;
      } else {
        url += 'urgencia=todos&';
      }
      if (filtroProveedor) {
        url += `proveedorId=${filtroProveedor}&`;
      }

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error('Error al cargar sugerencias de reabastecimiento');
      }

      const data = (await res.json()) as {
        items: SugerenciaReabastecimientoItem[];
        resumen: ResumenSugerencias;
      };

      setItems(data.items);
      setResumen(data.resumen);

      // Inicializar cantidades a pedir con la cantidad sugerida y pre-seleccionar todos
      const inicialCantidades: Record<string, string> = {};
      const inicialSeleccionados: Record<string, boolean> = {};
      for (const it of data.items) {
        inicialCantidades[it.productoId] = it.cantidadSugerida;
        // Solo seleccionar por defecto los que tienen proveedor asignado
        inicialSeleccionados[it.productoId] = Boolean(it.proveedorId);
      }
      setCantidadesPedir(inicialCantidades);
      setSeleccionados(inicialSeleccionados);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCargando(false);
    }
  }, [filtroProveedor, filtroUrgencia, token]);

  useEffect(() => {
    void cargarSugerencias();
  }, [cargarSugerencias]);

  // Manejar cambio de cantidad a pedir
  const actualizarCantidadPedir = (productoId: string, valor: string) => {
    setCantidadesPedir((prev) => ({ ...prev, [productoId]: valor }));
  };

  // Alternar selección de un ítem
  const alternarSeleccion = (productoId: string) => {
    setSeleccionados((prev) => ({ ...prev, [productoId]: !prev[productoId] }));
  };

  // Seleccionar / Deseleccionar todos
  const alternarSeleccionarTodos = () => {
    const hayDeseleccionados = items.some((it) => it.proveedorId && !seleccionados[it.productoId]);
    const nuevaSeleccion: Record<string, boolean> = {};
    for (const it of items) {
      if (it.proveedorId) {
        nuevaSeleccion[it.productoId] = hayDeseleccionados;
      }
    }
    setSeleccionados(nuevaSeleccion);
  };

  // Generar Órdenes de Compra Automáticas agrupadas por Proveedor
  const generarOrdenes = async () => {
    // Filtrar ítems seleccionados que tengan proveedor y cantidad válida
    const itemsParaPedir = items.filter(
      (it) => it.proveedorId && seleccionados[it.productoId],
    );

    if (itemsParaPedir.length === 0) {
      setErrorMsg('Seleccione al menos un artículo con proveedor asignado para generar órdenes.');
      return;
    }

    // Agrupar por proveedor
    const gruposPorProveedor: Record<
      string,
      Array<{ productoId: string; cantidad: string; costoUnitario: string }>
    > = {};

    for (const it of itemsParaPedir) {
      const provId = it.proveedorId;
      if (!provId) continue;
      const cant = cantidadesPedir[it.productoId] ?? it.cantidadSugerida;
      if (parseFloat(cant) <= 0) continue;

      if (!gruposPorProveedor[provId]) {
        gruposPorProveedor[provId] = [];
      }
      gruposPorProveedor[provId].push({
        productoId: it.productoId,
        cantidad: cant,
        costoUnitario: it.costoCompraEstimado,
      });
    }

    const ordenesPayload = Object.entries(gruposPorProveedor).map(
      ([proveedorId, itemsList]) => ({
        proveedorId,
        condicionPago: 'cuenta_corriente' as const,
        items: itemsList,
        notas: 'Generada automáticamente por Asistente de Reabastecimiento Inteligente',
      }),
    );

    if (ordenesPayload.length === 0) {
      setErrorMsg('No hay artículos con cantidades mayores a cero seleccionados.');
      return;
    }

    setGenerando(true);
    setErrorMsg(null);
    setMensajeExito(null);

    try {
      const payload: GenerarOrdenesReabastecimientoInput = {
        ordenes: ordenesPayload,
      };

      const res = await fetch(apiUrl('/api/reabastecimiento/generar-ordenes'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? 'Error al generar órdenes de compra');
      }

      const data = (await res.json()) as GenerarOrdenesReabastecimientoResponse;
      setOrdenesGeneradas(data.ordenesCreadas);
      setMensajeExito(data.mensaje);
      void cargarSugerencias();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerando(false);
    }
  };

  const articulosSeleccionadosCount = items.filter(
    (it) => it.proveedorId && seleccionados[it.productoId],
  ).length;

  return (
    <div className="space-y-6">
      {/* Tarjetas de Resumen Logístico */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4">
          <div className="text-xs font-bold text-rose-700 uppercase tracking-wider">
            Quiebres de Stock
          </div>
          <div className="text-2xl font-black text-rose-900 mt-1">
            {resumen?.totalQuiebres ?? 0}
          </div>
          <div className="text-[11px] text-rose-600 mt-0.5">Stock en cero o negativo</div>
        </div>

        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
          <div className="text-xs font-bold text-amber-700 uppercase tracking-wider">
            Stock Crítico
          </div>
          <div className="text-2xl font-black text-amber-900 mt-1">
            {resumen?.totalCriticos ?? 0}
          </div>
          <div className="text-[11px] text-amber-600 mt-0.5">Por debajo del mínimo</div>
        </div>

        <div className="rounded-2xl bg-blue-50 border border-blue-200 p-4">
          <div className="text-xs font-bold text-blue-700 uppercase tracking-wider">
            Atención Preventiva
          </div>
          <div className="text-2xl font-black text-blue-900 mt-1">
            {resumen?.totalPreventivos ?? 0}
          </div>
          <div className="text-[11px] text-blue-600 mt-0.5">Por debajo de punto de pedido</div>
        </div>

        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
          <div className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
            Total Artículos a Reponer
          </div>
          <div className="text-2xl font-black text-emerald-900 mt-1">
            {resumen?.totalSugeridos ?? 0}
          </div>
          <div className="text-[11px] text-emerald-600 mt-0.5">
            {resumen?.resumenProveedores.length ?? 0} proveedores habituales
          </div>
        </div>
      </div>

      {/* Alertas y Feedback */}
      {mensajeExito && (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-emerald-900 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-sm">✓ {mensajeExito}</span>
            <button
              type="button"
              onClick={() => { setMensajeExito(null); }}
              className="text-emerald-700 font-black text-xs"
            >
              ✕
            </button>
          </div>
          {ordenesGeneradas.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {ordenesGeneradas.map((oc) => (
                <div
                  key={oc.id}
                  className="rounded-lg bg-white px-3 py-1.5 border border-emerald-300 text-xs shadow-sm flex items-center gap-2"
                >
                  <span className="font-extrabold text-emerald-800">{oc.numero}</span>
                  <span className="text-slate-600">{oc.proveedorNombre}</span>
                  <span className="font-bold text-slate-800">({formatearPesos(oc.total)})</span>
                </div>
              ))}
              {onIrAOrdenes && (
                <button
                  type="button"
                  onClick={onIrAOrdenes}
                  className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-emerald-800 transition"
                >
                  Ver Órdenes de Compra →
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center justify-between rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-xs font-bold text-rose-900">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => { setErrorMsg(null); }}
            className="text-rose-700 font-black"
          >
            ✕
          </button>
        </div>
      )}

      {/* Barra de Filtros y Acciones */}
      <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-500">Urgencia:</span>
            <select
              value={filtroUrgencia}
              onChange={(e) => { setFiltroUrgencia(e.target.value); }}
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold bg-white focus:outline-none focus:border-slate-900"
            >
              <option value="todos">Todos los requeridos</option>
              <option value="quiebre">Solo Quiebres (Stock 0)</option>
              <option value="critico">Quiebres + Stock Crítico</option>
              <option value="preventivo">Críticos + Preventivos</option>
            </select>
          </div>

          {resumen && resumen.resumenProveedores.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-slate-500">Proveedor:</span>
              <select
                value={filtroProveedor}
                onChange={(e) => { setFiltroProveedor(e.target.value); }}
                className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold bg-white focus:outline-none focus:border-slate-900"
              >
                <option value="">Todos los proveedores</option>
                {resumen.resumenProveedores.map((p) => (
                  <option key={p.proveedorId} value={p.proveedorId}>
                    {p.proveedorNombre} ({p.cantidadArticulos})
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="button"
            onClick={alternarSeleccionarTodos}
            className="text-xs font-bold text-slate-700 hover:text-slate-900 underline"
          >
            Seleccionar / Deseleccionar todos
          </button>
        </div>

        {/* Botón de Generación de Órdenes */}
        <button
          type="button"
          disabled={generando || articulosSeleccionadosCount === 0 || !esDuenoOEncargado}
          onClick={() => { void generarOrdenes(); }}
          className="rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-extrabold text-white shadow-md hover:bg-slate-800 disabled:opacity-50 transition flex items-center gap-2"
        >
          <span>📦</span>
          <span>
            {generando
              ? 'Generando Órdenes...'
              : `Generar Órdenes de Compra (${String(articulosSeleccionadosCount)} seleccionados)`}
          </span>
        </button>
      </div>

      {/* Tabla de Artículos a Reponer */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        {cargando ? (
          <div className="p-12 text-center text-xs text-slate-400 font-bold">
            Analizando rotación histórica de ventas y stock en vivo...
          </div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400 font-bold">
            🎉 ¡Excelente! No hay artículos en quiebre ni por debajo del stock de reposición.
          </div>
        ) : (
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 w-10 text-center">Sel.</th>
                <th className="px-4 py-3">Urgencia</th>
                <th className="px-4 py-3">Artículo / Rubro</th>
                <th className="px-4 py-3 text-right">Stock Actual</th>
                <th className="px-4 py-3 text-right">Mín / Punto Pedido</th>
                <th className="px-4 py-3 text-right">Consumo / Autonomía</th>
                <th className="px-4 py-3">Proveedor Asignado</th>
                <th className="px-4 py-3 text-right">Costo Estimado</th>
                <th className="px-4 py-3 text-center">Cant. a Pedir</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((it) => {
                const esSeleccionado = Boolean(seleccionados[it.productoId]);
                const cantPedirVal = cantidadesPedir[it.productoId] ?? it.cantidadSugerida;

                return (
                  <tr
                    key={it.productoId}
                    className={`hover:bg-slate-50/80 transition ${
                      esSeleccionado ? 'bg-blue-50/20' : ''
                    }`}
                  >
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={esSeleccionado}
                        disabled={!it.proveedorId}
                        onChange={() => { alternarSeleccion(it.productoId); }}
                        className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                      />
                    </td>

                    <td className="px-4 py-3">
                      {it.nivelUrgencia === 'quiebre' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-800">
                          🔴 Quiebre
                        </span>
                      )}
                      {it.nivelUrgencia === 'critico' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">
                          🟠 Crítico
                        </span>
                      )}
                      {it.nivelUrgencia === 'preventivo' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-800">
                          🟡 Preventivo
                        </span>
                      )}
                      {it.nivelUrgencia === 'normal' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                          Normal
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-extrabold text-slate-900">{it.nombre}</div>
                      <div className="text-[11px] text-slate-400">
                        {it.codigo} · {it.rubroNombre ?? 'Sin rubro'}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-right">
                      <span
                        className={`font-black ${
                          parseFloat(it.stockActual) <= 0
                            ? 'text-rose-600'
                            : parseFloat(it.stockActual) <= parseFloat(it.stockMinimo)
                              ? 'text-amber-600'
                              : 'text-slate-900'
                        }`}
                      >
                        {parseFloat(it.stockActual)} {it.unidadPrincipal}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-right">
                      <div className="font-semibold text-slate-700">
                        Mín: {parseFloat(it.stockMinimo)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        P.P: {parseFloat(it.puntoPedidoEfectivo)}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-right">
                      <div className="font-semibold text-slate-700">
                        {it.consumoDiarioPromedio} un/día
                      </div>
                      <div className="text-[10px] text-slate-500 font-bold">
                        {it.diasAutonomia >= 900
                          ? 'Sin ventas rec.'
                          : `${String(it.diasAutonomia)} días rest.`}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      {it.proveedorNombre ? (
                        <div className="font-bold text-slate-800">{it.proveedorNombre}</div>
                      ) : (
                        <div className="text-amber-600 font-semibold italic">
                          ⚠️ Sin proveedor asignado
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 text-right font-extrabold text-slate-900">
                      {formatearPesos(it.costoCompraEstimado)}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <div className="inline-flex items-center gap-1.5">
                        <input
                          type="number"
                          step="1"
                          min="0.001"
                          value={cantPedirVal}
                          onChange={(e) => {
                            actualizarCantidadPedir(it.productoId, e.target.value);
                          }}
                          className="w-20 rounded-xl border border-slate-300 px-2 py-1 text-center font-black text-slate-900 focus:border-slate-900 focus:outline-none"
                        />
                        <span className="text-[10px] font-bold text-slate-400">
                          {it.unidadPrincipal}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
