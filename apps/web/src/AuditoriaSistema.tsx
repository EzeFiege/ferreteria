import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { apiUrl } from './api-url.js';
import { exportarACSV } from './utils/exportar-csv.js';
import type {
  AccionAuditoria,
  RegistroAuditoriaItem,
  RolUsuario,
} from '@ferreteria/shared';

export interface AuditoriaSistemaProps {
  token: string;
  rolUsuario: RolUsuario;
}

const ACCIONES_LABELS: Record<AccionAuditoria, { label: string; color: string }> = {
  anulacion_venta: { label: 'Anulación / Reversión', color: 'bg-rose-100 text-rose-800 border-rose-300' },
  arqueo_caja: { label: 'Arqueo de Turno', color: 'bg-amber-100 text-amber-800 border-amber-300' },
  ajuste_cta_cte_cliente: { label: 'Ajuste Cta. Cte. Cliente', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  ajuste_cta_cte_proveedor: { label: 'Ajuste Cta. Cte. Proveedor', color: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
  cambio_precio: { label: 'Cambio de Precios', color: 'bg-purple-100 text-purple-800 border-purple-300' },
  cierre_ejercicio: { label: 'Cierre de Ejercicio Contable', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  apertura_ejercicio: { label: 'Apertura de Ejercicio Contable', color: 'bg-teal-100 text-teal-800 border-teal-300' },
  cheque_rechazado: { label: 'Cheque Rechazado', color: 'bg-red-100 text-red-800 border-red-300' },
  asiento_manual: { label: 'Asiento Contable Manual', color: 'bg-slate-100 text-slate-800 border-slate-300' },
  crear_acopio: { label: 'Nuevo Acopio Materiales', color: 'bg-amber-100 text-amber-800 border-amber-300' },
  entrega_acopio: { label: 'Remito Entrega Acopio', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  crear_deposito: { label: 'Creación de Depósito', color: 'bg-cyan-100 text-cyan-800 border-cyan-300' },
  crear_transferencia_stock: { label: 'Transferencia de Stock', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
};

function detalleString(val: unknown, fallback = ''): string {
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return val.toString();
  return fallback;
}

export function AuditoriaSistema({
  token,
  rolUsuario,
}: AuditoriaSistemaProps): ReactElement {
  const [registros, setRegistros] = useState<RegistroAuditoriaItem[]>([]);
  const [cargando, setCargando] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filtros
  const [filtroAccion, setFiltroAccion] = useState<string>('todas');
  const [filtroEntidad, setFiltroEntidad] = useState<string>('todas');
  const [filtroFechaDesde, setFiltroFechaDesde] = useState<string>('');
  const [filtroFechaHasta, setFiltroFechaHasta] = useState<string>('');
  const [detalleModal, setDetalleModal] = useState<RegistroAuditoriaItem | null>(null);

  const cargarAuditoria = useCallback(async () => {
    if (rolUsuario === 'cajero') return;
    setCargando(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams();
      if (filtroAccion !== 'todas') params.set('accion', filtroAccion);
      if (filtroEntidad !== 'todas') params.set('entidad', filtroEntidad);
      if (filtroFechaDesde) params.set('desde', `${filtroFechaDesde}T00:00:00Z`);
      if (filtroFechaHasta) params.set('hasta', `${filtroFechaHasta}T23:59:59Z`);
      params.set('limite', '100');

      const res = await fetch(apiUrl(`/auditoria?${params.toString()}`), {
        headers: { authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'No se pudo cargar el registro de auditoría');
      }

      const data = (await res.json()) as RegistroAuditoriaItem[];
      setRegistros(data);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error desconocido al cargar auditoría');
    } finally {
      setCargando(false);
    }
  }, [token, rolUsuario, filtroAccion, filtroEntidad, filtroFechaDesde, filtroFechaHasta]);

  useEffect(() => {
    void cargarAuditoria();
  }, [cargarAuditoria]);

  const handleExportarExcel = (): void => {
    if (registros.length === 0) return;
    const nombreArchivo = `auditoria_${new Date().toISOString().slice(0, 10)}`;
    const encabezados = ['Fecha y Hora', 'Acción', 'Entidad', 'ID Entidad', 'Rol Operador', 'Email / Usuario', 'Detalles'];
    const filas: (string | number)[][] = registros.map((r) => [
      new Date(r.creadoEn).toLocaleString('es-AR'),
      ACCIONES_LABELS[r.accion].label,
      r.entidad,
      r.entidadId ?? '-',
      r.rol,
      r.usuarioEmail ?? r.usuarioId,
      JSON.stringify(r.detalles),
    ]);
    exportarACSV(nombreArchivo, encabezados, filas);
  };

  if (rolUsuario === 'cajero') {
    return (
      <div className="p-8 text-center bg-white rounded-lg border border-slate-200 shadow-sm max-w-xl mx-auto mt-8">
        <div className="text-4xl mb-3">🛡️</div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">Acceso Restringido a Auditoría</h2>
        <p className="text-sm text-slate-600">
          El libro inmutable de auditoría centralizada registra todas las operaciones sensibles (anulaciones, arqueos, cierres de ejercicio y ajustes) y solo está habilitado para supervisores con rol <strong>Encargado</strong> o <strong>Dueño</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Encabezado y Acciones */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900">🛡️ Auditoría Centralizada del Sistema</h2>
            <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-300 font-medium">
              Solo Agregar / Inmutable
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Trazabilidad rigurosa y no modificable de operaciones críticas, diferencias de caja y cierres fiscales.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportarExcel}
            disabled={cargando || registros.length === 0}
            className="px-3 py-2 text-xs font-medium rounded border border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            title="Exportar registros filtrados a planilla de cálculo Excel / CSV"
          >
            📊 Exportar a Excel
          </button>
          <button
            type="button"
            onClick={() => {
              void cargarAuditoria();
            }}
            disabled={cargando}
            className="px-3 py-2 text-xs font-medium rounded bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            🔄 Actualizar
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-md text-sm">
          {errorMsg}
        </div>
      )}

      {/* Barra de Filtros */}
      <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo de Acción</label>
          <select
            value={filtroAccion}
            onChange={(e) => {
              setFiltroAccion(e.target.value);
            }}
            className="w-full text-xs rounded border border-slate-300 bg-white p-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-500"
          >
            <option value="todas">Todas las acciones</option>
            <option value="anulacion_venta">Anulación / Reversión de Venta</option>
            <option value="arqueo_caja">Arqueo de Caja / Cierre de Turno</option>
            <option value="cierre_ejercicio">Cierre de Ejercicio Contable</option>
            <option value="apertura_ejercicio">Apertura de Ejercicio Contable</option>
            <option value="asiento_manual">Asiento Contable Manual</option>
            <option value="ajuste_cta_cte_cliente">Ajuste Cta Cte Cliente</option>
            <option value="ajuste_cta_cte_proveedor">Ajuste Cta Cte Proveedor</option>
            <option value="cambio_precio">Cambio de Precios</option>
            <option value="cheque_rechazado">Cheque Rechazado</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Entidad Afectada</label>
          <select
            value={filtroEntidad}
            onChange={(e) => {
              setFiltroEntidad(e.target.value);
            }}
            className="w-full text-xs rounded border border-slate-300 bg-white p-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-500"
          >
            <option value="todas">Todas las entidades</option>
            <option value="turno_caja">Turnos de Caja</option>
            <option value="venta">Ventas</option>
            <option value="ejercicio_contable">Ejercicios Contables</option>
            <option value="asiento_contable">Asientos Contables</option>
            <option value="cliente">Clientes & Cta Cte</option>
            <option value="proveedor">Proveedores & Compras</option>
            <option value="articulo">Catálogo & Stock</option>
            <option value="cheque">Cheques & Valores</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha Desde</label>
          <input
            type="date"
            value={filtroFechaDesde}
            onChange={(e) => {
              setFiltroFechaDesde(e.target.value);
            }}
            className="w-full text-xs rounded border border-slate-300 bg-white p-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-500"
          >
          </input>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Fecha Hasta</label>
          <input
            type="date"
            value={filtroFechaHasta}
            onChange={(e) => {
              setFiltroFechaHasta(e.target.value);
            }}
            className="w-full text-xs rounded border border-slate-300 bg-white p-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-500"
          >
          </input>
        </div>
      </div>

      {/* Tabla de Registros */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-4 py-3">Fecha & Hora</th>
                <th className="px-4 py-3">Acción Registrada</th>
                <th className="px-4 py-3">Entidad</th>
                <th className="px-4 py-3">Operador</th>
                <th className="px-4 py-3">Resumen de Operación</th>
                <th className="px-4 py-3 text-right">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargando ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Cargando eventos de auditoría...
                  </td>
                </tr>
              ) : registros.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No se encontraron registros de auditoría con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                registros.map((r) => {
                  const meta = ACCIONES_LABELS[r.accion];
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600 font-mono">
                        {new Date(r.creadoEn).toLocaleString('es-AR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium border ${meta.color}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 capitalize whitespace-nowrap font-medium text-slate-800">
                        {r.entidad.replace('_', ' ')}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-semibold text-slate-800 capitalize">{r.rol}</div>
                        <div className="text-[10px] text-slate-500 truncate max-w-[140px]" title={r.usuarioEmail ?? r.usuarioId}>
                          {r.usuarioEmail ?? r.usuarioId}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {r.accion === 'arqueo_caja' && (
                          <div className="flex items-center gap-2">
                            <span>Esperado: <strong>$ {detalleString(r.detalles['efectivoEsperado'], '0.00')}</strong></span>
                            <span>Contado: <strong>$ {detalleString(r.detalles['efectivoContado'], '0.00')}</strong></span>
                            {Number(r.detalles['diferencia']) !== 0 && (
                              <span className={`font-semibold px-1.5 py-0.2 rounded text-[10px] ${Number(r.detalles['diferencia']) < 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                Dif: $ {detalleString(r.detalles['diferencia'], '0.00')}
                              </span>
                            )}
                          </div>
                        )}
                        {r.accion === 'cierre_ejercicio' && (
                          <div className="flex items-center gap-2">
                            <span>Ejercicio: <strong>{detalleString(r.detalles['nombre'])}</strong></span>
                            <span>Resultado Neto: <strong>$ {detalleString(r.detalles['resultadoNeto'], '0.00')}</strong></span>
                          </div>
                        )}
                        {r.accion === 'anulacion_venta' && (
                          <div>
                            <span>Monto revertido: <strong>$ {detalleString(r.detalles['monto'], '0.00')}</strong></span>
                            {Boolean(r.detalles['motivo']) && <span className="text-slate-500 italic ml-2">({detalleString(r.detalles['motivo'])})</span>}
                          </div>
                        )}
                        {r.accion === 'asiento_manual' && (
                          <div>
                            <span>Asiento #{detalleString(r.detalles['numero'])}</span> — <span className="text-slate-800 font-medium">{detalleString(r.detalles['concepto'])}</span> ($ {detalleString(r.detalles['totalDebe'])})
                          </div>
                        )}
                        {r.accion !== 'arqueo_caja' && r.accion !== 'cierre_ejercicio' && r.accion !== 'anulacion_venta' && r.accion !== 'asiento_manual' && (
                          <div className="text-slate-500 truncate max-w-xs font-mono text-[10px]">
                            {JSON.stringify(r.detalles)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setDetalleModal(r);
                          }}
                          className="px-2 py-1 text-[11px] rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors"
                        >
                          Ver JSON
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Detalle JSON */}
      {detalleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="font-bold text-slate-800 text-sm">
                Detalle del Registro de Auditoría #{detalleModal.id.slice(0, 8)}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setDetalleModal(null);
                }}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg leading-none"
              >
                &times;
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 pb-3 border-b border-slate-100">
                <div>
                  <span className="text-slate-500">Fecha y Hora:</span>
                  <div className="font-semibold text-slate-800">{new Date(detalleModal.creadoEn).toLocaleString('es-AR')}</div>
                </div>
                <div>
                  <span className="text-slate-500">Operador:</span>
                  <div className="font-semibold text-slate-800">{detalleModal.rol} ({detalleModal.usuarioEmail ?? detalleModal.usuarioId})</div>
                </div>
                <div>
                  <span className="text-slate-500">Acción:</span>
                  <div className="font-semibold text-slate-800">{detalleModal.accion}</div>
                </div>
                <div>
                  <span className="text-slate-500">Entidad Afectada:</span>
                  <div className="font-semibold text-slate-800">{detalleModal.entidad} (ID: {detalleModal.entidadId ?? 'N/A'})</div>
                </div>
              </div>

              <div>
                <span className="text-slate-500 font-semibold block mb-1">Detalles de la Transacción:</span>
                <pre className="p-3 bg-slate-900 text-slate-100 rounded text-[11px] overflow-x-auto font-mono">
                  {JSON.stringify(detalleModal.detalles, null, 2)}
                </pre>
              </div>
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setDetalleModal(null);
                }}
                className="px-4 py-2 text-xs font-medium rounded bg-slate-800 text-white hover:bg-slate-700 transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
