import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type {
  CrearDepositoInput,
  CrearTransferenciaStockInput,
  DepositoItem,
  RolUsuario,
  StockPorDepositoItem,
  TransferenciaStockCompleta,
  TransferenciaStockResumen,
} from '@ferreteria/shared';
import { apiUrl } from './api-url.js';

export interface DepositosTransferenciasProps {
  token: string;
  rolUsuario: RolUsuario;
}

interface ArticuloBusqueda {
  id: string;
  codigo: string;
  nombre: string;
  marca: string | null;
  unidadPrincipal: string;
}

export function DepositosTransferencias({
  token,
  rolUsuario,
}: DepositosTransferenciasProps): ReactElement {
  const [seccion, setSeccion] = useState<'stock' | 'transferencias' | 'depositos'>('stock');
  const [depositos, setDepositos] = useState<DepositoItem[]>([]);
  const [depositoSeleccionadoId, setDepositoSeleccionadoId] = useState<string>('');
  const [stockDeposito, setStockDeposito] = useState<StockPorDepositoItem[]>([]);
  const [cargandoStock, setCargandoStock] = useState<boolean>(false);
  const [busquedaArticulo, setBusquedaArticulo] = useState<string>('');

  // Transferencias
  const [transferencias, setTransferencias] = useState<TransferenciaStockResumen[]>([]);
  const [cargandoTransferencias, setCargandoTransferencias] = useState<boolean>(false);
  const [modalNuevaTransferencia, setModalNuevaTransferencia] = useState<boolean>(false);
  const [transferenciaSeleccionada, setTransferenciaSeleccionada] =
    useState<TransferenciaStockCompleta | null>(null);

  // Formulario Nueva Transferencia
  const [trfOrigenId, setTrfOrigenId] = useState<string>('');
  const [trfDestinoId, setTrfDestinoId] = useState<string>('');
  const [trfMotivo, setTrfMotivo] = useState<string>('');
  const [trfObservaciones, setTrfObservaciones] = useState<string>('');
  const [trfItems, setTrfItems] = useState<
    Array<{
      productoId: string;
      codigo: string;
      nombre: string;
      cantidad: string;
      unidad: string;
      cantidadBase: string;
      notas: string;
    }>
  >([]);
  const [buscadorProductoTrf, setBuscadorProductoTrf] = useState<string>('');
  const [resultadosProductos, setResultadosProductos] = useState<ArticuloBusqueda[]>([]);
  const [guardandoTrf, setGuardandoTrf] = useState<boolean>(false);

  // Modal Nuevo/Editar Depósito
  const [modalDeposito, setModalDeposito] = useState<boolean>(false);
  const [depositoEdicion, setDepositoEdicion] = useState<DepositoItem | null>(null);
  const [formDepNombre, setFormDepNombre] = useState<string>('');
  const [formDepCodigo, setFormDepCodigo] = useState<string>('');
  const [formDepDireccion, setFormDepDireccion] = useState<string>('');
  const [formDepEsPrincipal, setFormDepEsPrincipal] = useState<boolean>(false);
  const [guardandoDep, setGuardandoDep] = useState<boolean>(false);

  const [mensajeExito, setMensajeExito] = useState<string | null>(null);
  const [errorGlobal, setErrorGlobal] = useState<string | null>(null);

  const puedeGestionar = rolUsuario === 'dueno' || rolUsuario === 'encargado';

  // 1. Cargar depósitos
  const cargarDepositos = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/depositos'), {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error al cargar depósitos');
      const data = (await res.json()) as DepositoItem[];
      setDepositos(data);
      if (data.length > 0 && !depositoSeleccionadoId) {
        const princ = data.find((d) => d.esPrincipal) ?? data[0];
        if (princ) {
          setDepositoSeleccionadoId(princ.id);
        }
      }
    } catch (err) {
      setErrorGlobal(err instanceof Error ? err.message : 'Error inesperado');
    }
  }, [token, depositoSeleccionadoId]);

  // 2. Cargar stock por depósito seleccionado
  const cargarStock = useCallback(async (depId: string) => {
    if (!depId) return;
    setCargandoStock(true);
    try {
      const res = await fetch(apiUrl(`/depositos/${depId}/stock`), {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error al cargar stock del depósito');
      const data = (await res.json()) as StockPorDepositoItem[];
      setStockDeposito(data);
    } catch (err) {
      setErrorGlobal(err instanceof Error ? err.message : 'Error al cargar stock');
    } finally {
      setCargandoStock(false);
    }
  }, [token]);

  // 3. Cargar historial de transferencias
  const cargarTransferencias = useCallback(async () => {
    setCargandoTransferencias(true);
    try {
      const res = await fetch(apiUrl('/depositos/transferencias'), {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error al listar transferencias');
      const data = (await res.json()) as TransferenciaStockResumen[];
      setTransferencias(data);
    } catch (err) {
      setErrorGlobal(err instanceof Error ? err.message : 'Error al cargar transferencias');
    } finally {
      setCargandoTransferencias(false);
    }
  }, [token]);

  useEffect(() => {
    void cargarDepositos();
  }, [cargarDepositos]);

  useEffect(() => {
    if (depositoSeleccionadoId && seccion === 'stock') {
      void cargarStock(depositoSeleccionadoId);
    }
  }, [depositoSeleccionadoId, seccion, cargarStock]);

  useEffect(() => {
    if (seccion === 'transferencias') {
      void cargarTransferencias();
    }
  }, [seccion, cargarTransferencias]);

  // Buscar artículos para la transferencia
  useEffect(() => {
    if (!buscadorProductoTrf.trim()) {
      setResultadosProductos([]);
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            apiUrl(`/productos?q=${encodeURIComponent(buscadorProductoTrf.trim())}`),
            { headers: { authorization: `Bearer ${token}` } }
          );
          if (res.ok) {
            const data = (await res.json()) as ArticuloBusqueda[];
            setResultadosProductos(data);
          }
        } catch {
          // silenciar error de búsqueda rápida
        }
      })();
    }, 250);
    return () => { clearTimeout(timer); };
  }, [buscadorProductoTrf, token]);

  // Ver detalle completo de una transferencia
  const verDetalleTransferencia = async (id: string) => {
    try {
      const res = await fetch(apiUrl(`/depositos/transferencias/${id}`), {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('No se pudo obtener el detalle de la transferencia');
      const data = (await res.json()) as TransferenciaStockCompleta;
      setTransferenciaSeleccionada(data);
    } catch (err) {
      setErrorGlobal(err instanceof Error ? err.message : 'Error al obtener detalle');
    }
  };

  // Guardar nueva transferencia
  const handleGuardarTransferencia = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!trfOrigenId || !trfDestinoId) {
      setErrorGlobal('Seleccioná depósito de origen y de destino.');
      return;
    }
    if (trfOrigenId === trfDestinoId) {
      setErrorGlobal('El depósito de origen y destino no pueden ser el mismo.');
      return;
    }
    if (trfItems.length === 0) {
      setErrorGlobal('Agregá al menos un artículo a la transferencia.');
      return;
    }

    setGuardandoTrf(true);
    setErrorGlobal(null);
    try {
      const payload: CrearTransferenciaStockInput = {
        depositoOrigenId: trfOrigenId,
        depositoDestinoId: trfDestinoId,
        motivo: trfMotivo.trim() || null,
        observaciones: trfObservaciones.trim() || null,
        items: trfItems.map((it) => ({
          productoId: it.productoId,
          cantidad: it.cantidad,
          unidad: it.unidad,
          cantidadBase: it.cantidadBase,
          notas: it.notas.trim() || null,
        })),
      };

      const res = await fetch(apiUrl('/depositos/transferencias'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = (await res.json()) as { error?: string };
        throw new Error(errData.error ?? 'Error al procesar la transferencia');
      }

      setMensajeExito('Transferencia de stock registrada y movimientos impactados con éxito.');
      setModalNuevaTransferencia(false);
      setTrfItems([]);
      setTrfMotivo('');
      setTrfObservaciones('');
      void cargarTransferencias();
      if (depositoSeleccionadoId) {
        void cargarStock(depositoSeleccionadoId);
      }
    } catch (err) {
      setErrorGlobal(err instanceof Error ? err.message : 'Error al registrar transferencia');
    } finally {
      setGuardandoTrf(false);
    }
  };

  // Guardar nuevo/editar depósito
  const handleGuardarDeposito = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!formDepNombre.trim() || !formDepCodigo.trim()) {
      setErrorGlobal('Completá nombre y código de depósito.');
      return;
    }

    setGuardandoDep(true);
    setErrorGlobal(null);
    try {
      if (depositoEdicion) {
        const res = await fetch(apiUrl(`/depositos/${depositoEdicion.id}`), {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            nombre: formDepNombre.trim(),
            direccion: formDepDireccion.trim() || null,
            esPrincipal: formDepEsPrincipal,
          }),
        });
        if (!res.ok) throw new Error('Error al actualizar depósito');
      } else {
        const payload: CrearDepositoInput = {
          nombre: formDepNombre.trim(),
          codigo: formDepCodigo.trim().toUpperCase(),
          direccion: formDepDireccion.trim() || null,
          esPrincipal: formDepEsPrincipal,
        };
        const res = await fetch(apiUrl('/depositos'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Error al crear depósito');
      }

      setMensajeExito(depositoEdicion ? 'Depósito actualizado.' : 'Nuevo depósito creado.');
      setModalDeposito(false);
      setDepositoEdicion(null);
      void cargarDepositos();
    } catch (err) {
      setErrorGlobal(err instanceof Error ? err.message : 'Error al guardar depósito');
    } finally {
      setGuardandoDep(false);
    }
  };

  // Filtrado de stock por búsqueda
  const stockFiltrado = stockDeposito.filter((it) => {
    if (!busquedaArticulo.trim()) return true;
    const txt = busquedaArticulo.toLowerCase();
    return (
      it.productoCodigo.toLowerCase().includes(txt) ||
      it.productoNombre.toLowerCase().includes(txt) ||
      (it.productoMarca && it.productoMarca.toLowerCase().includes(txt))
    );
  });

  return (
    <section className="space-y-6">
      {/* Encabezado y Métricas */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-3xl">🏢</span>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">
              Múltiples Depósitos y Transferencias de Stock
            </h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Control de existencias por sucursal, trastienda y corralón, con transferencias internas auditadas.
          </p>
        </div>

        {/* Selector de subsecciones */}
        <div className="flex items-center rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            data-testid="subtab-stock-deposito"
            onClick={() => { setSeccion('stock'); }}
            className={`rounded-lg px-4 py-1.5 text-xs font-bold transition ${
              seccion === 'stock'
                ? 'bg-white text-emerald-800 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            📦 Stock por Depósito
          </button>
          <button
            type="button"
            data-testid="subtab-transferencias"
            onClick={() => { setSeccion('transferencias'); }}
            className={`rounded-lg px-4 py-1.5 text-xs font-bold transition ${
              seccion === 'transferencias'
                ? 'bg-white text-emerald-800 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            🔄 Transferencias Internas ({transferencias.length})
          </button>
          <button
            type="button"
            data-testid="subtab-depositos-admin"
            onClick={() => { setSeccion('depositos'); }}
            className={`rounded-lg px-4 py-1.5 text-xs font-bold transition ${
              seccion === 'depositos'
                ? 'bg-white text-emerald-800 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            🏢 Sucursales y Galpones ({depositos.length})
          </button>
        </div>
      </div>

      {/* Alertas */}
      {mensajeExito && (
        <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 border border-emerald-200 shadow-sm">
          <span>✓ {mensajeExito}</span>
          <button
            type="button"
            onClick={() => { setMensajeExito(null); }}
            className="text-emerald-600 hover:text-emerald-900"
          >
            ✕
          </button>
        </div>
      )}

      {errorGlobal && (
        <div className="flex items-center justify-between rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800 border border-rose-200 shadow-sm">
          <span>⚠️ {errorGlobal}</span>
          <button
            type="button"
            onClick={() => { setErrorGlobal(null); }}
            className="text-rose-600 hover:text-rose-900"
          >
            ✕
          </button>
        </div>
      )}

      {/* SUBSECCIÓN 1: STOCK POR DEPÓSITO */}
      {seccion === 'stock' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="selector-deposito-stock" className="text-xs font-black uppercase text-slate-500">
                Ubicación / Depósito:
              </label>
              <select
                id="selector-deposito-stock"
                value={depositoSeleccionadoId}
                onChange={(e) => {
                  setDepositoSeleccionadoId(e.target.value);
                  void cargarStock(e.target.value);
                }}
                className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {depositos.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nombre} ({d.codigo}) {d.esPrincipal ? '⭐ Principal' : ''}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => { void cargarStock(depositoSeleccionadoId); }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                ↻ Actualizar
              </button>
            </div>

            <div className="w-full sm:w-80">
              <input
                type="text"
                placeholder="Buscar por código, nombre o marca..."
                value={busquedaArticulo}
                onChange={(e) => { setBusquedaArticulo(e.target.value); }}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Tabla de Stock */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-50 text-xs font-black uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Código</th>
                    <th className="px-4 py-3">Artículo / Descripción</th>
                    <th className="px-4 py-3">Marca</th>
                    <th className="px-4 py-3">Unidad</th>
                    <th className="px-4 py-3 text-right">Stock Disponible</th>
                    <th className="px-4 py-3 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cargandoStock ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400">
                        Cargando inventario del depósito...
                      </td>
                    </tr>
                  ) : stockFiltrado.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400">
                        No hay artículos registrados con stock en esta ubicación.
                      </td>
                    </tr>
                  ) : (
                    stockFiltrado.map((it) => {
                      const cant = parseFloat(it.stockActualBase);
                      return (
                        <tr key={it.productoId} className="hover:bg-slate-50/70 transition">
                          <td className="px-4 py-3 font-mono font-bold text-emerald-800">
                            {it.productoCodigo}
                          </td>
                          <td className="px-4 py-3 font-bold text-slate-900">
                            {it.productoNombre}
                          </td>
                          <td className="px-4 py-3 text-slate-500">{it.productoMarca ?? '-'}</td>
                          <td className="px-4 py-3 text-xs uppercase font-medium text-slate-500">
                            {it.unidadPrincipal}
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-black text-slate-900 text-base">
                            {cant.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {cant > 0 ? (
                              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                                En Stock
                              </span>
                            ) : cant === 0 ? (
                              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600">
                                Sin Stock
                              </span>
                            ) : (
                              <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-800">
                                Negativo
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUBSECCIÓN 2: TRANSFERENCIAS INTERNAS */}
      {seccion === 'transferencias' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div>
              <span className="text-sm font-black text-slate-800">
                Historial de Transferencias ({transferencias.length})
              </span>
              <p className="text-xs text-slate-400">
                Movimientos de reabastecimiento interno entre salones y galpones
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { void cargarTransferencias(); }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                ↻ Actualizar
              </button>
              {puedeGestionar && (
                <button
                  type="button"
                  data-testid="btn-nueva-transferencia"
                  onClick={() => {
                    setTrfOrigenId(depositos[0]?.id ?? '');
                    setTrfDestinoId(depositos[1]?.id ?? '');
                    setTrfItems([]);
                    setModalNuevaTransferencia(true);
                  }}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm flex items-center gap-1.5"
                >
                  <span>🔄</span> + Nueva Transferencia
                </button>
              )}
            </div>
          </div>

          {/* Tabla de Transferencias */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-50 text-xs font-black uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Nº Transf.</th>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Origen</th>
                    <th className="px-4 py-3">Destino</th>
                    <th className="px-4 py-3 text-center">Ítems</th>
                    <th className="px-4 py-3">Motivo / Notas</th>
                    <th className="px-4 py-3 text-center">Estado</th>
                    <th className="px-4 py-3 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cargandoTransferencias ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-400">
                        Cargando transferencias...
                      </td>
                    </tr>
                  ) : transferencias.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-400">
                        No hay transferencias registradas todavía.
                      </td>
                    </tr>
                  ) : (
                    transferencias.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50/70 transition">
                        <td className="px-4 py-3 font-mono font-black text-blue-900">
                          {t.numero}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {new Date(t.creadoEn).toLocaleString('es-AR')}
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-800">
                          {t.depositoOrigenNombre}
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-800">
                          {t.depositoDestinoNombre}
                        </td>
                        <td className="px-4 py-3 text-center font-bold text-slate-700">
                          {t.totalArticulos}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {t.motivo ?? t.observaciones ?? '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-800">
                            {t.estado}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            data-testid={`btn-ver-trf-${t.numero}`}
                            onClick={() => { void verDetalleTransferencia(t.id); }}
                            className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200"
                          >
                            Ver Remito 📄
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUBSECCIÓN 3: ADMINISTRACIÓN DE DEPÓSITOS */}
      {seccion === 'depositos' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div>
              <span className="text-sm font-black text-slate-800">
                Puntos de Almacenamiento y Sucursales ({depositos.length})
              </span>
              <p className="text-xs text-slate-400">
                Ubicaciones físicas donde se almacena mercadería
              </p>
            </div>

            {puedeGestionar && (
              <button
                type="button"
                data-testid="btn-nuevo-deposito"
                onClick={() => {
                  setDepositoEdicion(null);
                  setFormDepNombre('');
                  setFormDepCodigo(`DEP-${(depositos.length + 1).toString().padStart(2, '0')}`);
                  setFormDepDireccion('');
                  setFormDepEsPrincipal(false);
                  setModalDeposito(true);
                }}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm flex items-center gap-1.5"
              >
                <span>🏢</span> + Nuevo Depósito
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {depositos.map((d) => (
              <div
                key={d.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3 relative overflow-hidden"
              >
                {d.esPrincipal && (
                  <span className="absolute top-3 right-3 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-800">
                    ⭐ Principal
                  </span>
                )}
                <div>
                  <span className="font-mono text-xs font-bold text-emerald-700">{d.codigo}</span>
                  <h3 className="text-base font-black text-slate-900">{d.nombre}</h3>
                  <p className="text-xs text-slate-500 mt-1">{d.direccion ?? 'Sin dirección especificada'}</p>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                  <span
                    className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 ${
                      d.activo ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {d.activo ? 'Activo' : 'Inactivo'}
                  </span>

                  {puedeGestionar && (
                    <button
                      type="button"
                      onClick={() => {
                        setDepositoEdicion(d);
                        setFormDepNombre(d.nombre);
                        setFormDepCodigo(d.codigo);
                        setFormDepDireccion(d.direccion ?? '');
                        setFormDepEsPrincipal(d.esPrincipal);
                        setModalDeposito(true);
                      }}
                      className="text-xs font-bold text-indigo-600 hover:text-indigo-800"
                    >
                      ✎ Editar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL: NUEVA TRANSFERENCIA */}
      {modalNuevaTransferencia && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[95vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  Nueva Transferencia Interna de Stock
                </h3>
                <p className="text-xs text-slate-500">
                  Traspaso de mercadería con descarga en origen e ingreso en destino
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setModalNuevaTransferencia(false); }}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={(e) => void handleGuardarTransferencia(e)} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="trf-deposito-origen" className="block text-xs font-black uppercase text-slate-600">
                    Depósito Origen (Sale stock)
                  </label>
                  <select
                    id="trf-deposito-origen"
                    value={trfOrigenId}
                    onChange={(e) => { setTrfOrigenId(e.target.value); }}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm font-bold text-slate-800"
                  >
                    {depositos.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nombre} ({d.codigo})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="trf-deposito-destino" className="block text-xs font-black uppercase text-slate-600">
                    Depósito Destino (Entra stock)
                  </label>
                  <select
                    id="trf-deposito-destino"
                    value={trfDestinoId}
                    onChange={(e) => { setTrfDestinoId(e.target.value); }}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm font-bold text-slate-800"
                  >
                    {depositos.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nombre} ({d.codigo})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="trf-motivo" className="block text-xs font-black uppercase text-slate-600">
                    Motivo
                  </label>
                  <input
                    id="trf-motivo"
                    type="text"
                    placeholder="Ej. Reabastecimiento de mostrador"
                    value={trfMotivo}
                    onChange={(e) => { setTrfMotivo(e.target.value); }}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="trf-observaciones" className="block text-xs font-black uppercase text-slate-600">
                    Observaciones / Remito
                  </label>
                  <input
                    id="trf-observaciones"
                    type="text"
                    placeholder="Ej. Trasladado en camioneta Fiorino"
                    value={trfObservaciones}
                    onChange={(e) => { setTrfObservaciones(e.target.value); }}
                    className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm"
                  />
                </div>
              </div>

              {/* Agregar Artículos */}
              <div className="pt-2 border-t border-slate-200 space-y-3">
                <span className="text-xs font-black uppercase text-slate-700">
                  Artículos a transferir ({trfItems.length})
                </span>

                <div className="relative">
                  <input
                    type="text"
                    placeholder="Escribí para buscar artículo a agregar..."
                    value={buscadorProductoTrf}
                    onChange={(e) => { setBuscadorProductoTrf(e.target.value); }}
                    className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  {resultadosProductos.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-20 mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                      {resultadosProductos.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            if (!trfItems.some((it) => it.productoId === p.id)) {
                              setTrfItems([
                                ...trfItems,
                                {
                                  productoId: p.id,
                                  codigo: p.codigo,
                                  nombre: p.nombre,
                                  cantidad: '1.000',
                                  unidad: p.unidadPrincipal,
                                  cantidadBase: '1.000',
                                  notas: '',
                                },
                              ]);
                            }
                            setBuscadorProductoTrf('');
                            setResultadosProductos([]);
                          }}
                          className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50 border-b border-slate-100 last:border-b-0 text-xs"
                        >
                          <div>
                            <span className="font-mono font-bold text-emerald-800">{p.codigo}</span> -{' '}
                            <span className="font-bold text-slate-800">{p.nombre}</span>{' '}
                            <span className="text-slate-400">({p.marca ?? 'Sin marca'})</span>
                          </div>
                          <span className="text-emerald-600 font-bold">+ Agregar</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Lista de items cargados */}
                {trfItems.length > 0 && (
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {trfItems.map((it, idx) => (
                      <div
                        key={it.productoId}
                        className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs"
                      >
                        <div className="flex-1 min-w-[200px]">
                          <span className="font-mono font-bold text-emerald-800">{it.codigo}</span>
                          <span className="block font-bold text-slate-900">{it.nombre}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <label htmlFor={`trf-cant-${idx}`} className="text-[10px] font-bold uppercase text-slate-500">
                            Cant:
                          </label>
                          <input
                            id={`trf-cant-${idx}`}
                            type="number"
                            step="any"
                            min="0.001"
                            value={it.cantidad}
                            onChange={(e) => {
                              const val = e.target.value;
                              const updated = [...trfItems];
                              if (updated[idx]) {
                                updated[idx].cantidad = val;
                                updated[idx].cantidadBase = val;
                              }
                              setTrfItems(updated);
                            }}
                            className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-center font-bold font-mono"
                          />
                          <span className="text-slate-500 font-bold uppercase">{it.unidad}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setTrfItems(trfItems.filter((_, i) => i !== idx));
                            }}
                            className="text-rose-500 hover:text-rose-700 font-bold px-2 py-1"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => { setModalNuevaTransferencia(false); }}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoTrf || trfItems.length === 0}
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm disabled:opacity-50"
                >
                  {guardandoTrf ? 'Impactando...' : 'Confirmar Transferencia ✓'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: VER DETALLE / REMITO DE TRANSFERENCIA */}
      {transferenciaSeleccionada && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <span className="font-mono text-xs font-bold text-blue-800">
                  REMITO INTERNO DE TRANSFERENCIA
                </span>
                <h3 className="text-xl font-black text-slate-900">
                  {transferenciaSeleccionada.numero}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => { setTransferenciaSeleccionada(null); }}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
              <div>
                <span className="block text-[10px] font-bold uppercase text-slate-400">Origen:</span>
                <span className="font-bold text-slate-800">{transferenciaSeleccionada.depositoOrigenNombre}</span>
              </div>
              <div>
                <span className="block text-[10px] font-bold uppercase text-slate-400">Destino:</span>
                <span className="font-bold text-slate-800">{transferenciaSeleccionada.depositoDestinoNombre}</span>
              </div>
              <div>
                <span className="block text-[10px] font-bold uppercase text-slate-400">Fecha y Hora:</span>
                <span className="font-bold text-slate-800">
                  {new Date(transferenciaSeleccionada.creadoEn).toLocaleString('es-AR')}
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-bold uppercase text-slate-400">Estado:</span>
                <span className="font-bold text-emerald-700 uppercase">{transferenciaSeleccionada.estado}</span>
              </div>
              {transferenciaSeleccionada.motivo && (
                <div className="col-span-2">
                  <span className="block text-[10px] font-bold uppercase text-slate-400">Motivo:</span>
                  <span className="text-slate-700">{transferenciaSeleccionada.motivo}</span>
                </div>
              )}
            </div>

            {/* Artículos transferidos */}
            <div className="space-y-2">
              <span className="text-xs font-black uppercase text-slate-700">Detalle de Materiales</span>
              <table className="w-full text-left text-xs border border-slate-200 rounded-xl overflow-hidden">
                <thead className="bg-slate-100 font-bold text-slate-600">
                  <tr>
                    <th className="p-2.5">Código</th>
                    <th className="p-2.5">Artículo</th>
                    <th className="p-2.5 text-right">Cantidad</th>
                    <th className="p-2.5">Unidad</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {transferenciaSeleccionada.items.map((it) => (
                    <tr key={it.id}>
                      <td className="p-2.5 font-mono font-bold text-blue-900">{it.productoCodigo}</td>
                      <td className="p-2.5 font-bold text-slate-800">{it.productoNombre}</td>
                      <td className="p-2.5 text-right font-mono font-bold text-slate-900">{it.cantidad}</td>
                      <td className="p-2.5 uppercase text-slate-500">{it.unidad}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => { window.print(); }}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                🖨️ Imprimir Remito
              </button>
              <button
                type="button"
                onClick={() => { setTransferenciaSeleccionada(null); }}
                className="rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white hover:bg-slate-800"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: NUEVO / EDITAR DEPÓSITO */}
      {modalDeposito && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-black text-slate-900">
                {depositoEdicion ? 'Editar Depósito' : 'Nuevo Depósito / Sucursal'}
              </h3>
              <button
                type="button"
                onClick={() => { setModalDeposito(false); }}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={(e) => void handleGuardarDeposito(e)} className="space-y-4">
              <div>
                <label htmlFor="dep-form-codigo" className="block text-xs font-black uppercase text-slate-600">
                  Código (Identificador único)
                </label>
                <input
                  id="dep-form-codigo"
                  type="text"
                  disabled={Boolean(depositoEdicion)}
                  placeholder="Ej. DEP-04 o SUC-CENTRAL"
                  value={formDepCodigo}
                  onChange={(e) => { setFormDepCodigo(e.target.value.toUpperCase()); }}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm font-mono font-bold uppercase disabled:bg-slate-100"
                />
              </div>

              <div>
                <label htmlFor="dep-form-nombre" className="block text-xs font-black uppercase text-slate-600">
                  Nombre descriptivo
                </label>
                <input
                  id="dep-form-nombre"
                  type="text"
                  placeholder="Ej. Trastienda / Galpón de Hierros"
                  value={formDepNombre}
                  onChange={(e) => { setFormDepNombre(e.target.value); }}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm"
                />
              </div>

              <div>
                <label htmlFor="dep-form-direccion" className="block text-xs font-black uppercase text-slate-600">
                  Dirección o Referencia
                </label>
                <input
                  id="dep-form-direccion"
                  type="text"
                  placeholder="Ej. Lateral del salón comercial"
                  value={formDepDireccion}
                  onChange={(e) => { setFormDepDireccion(e.target.value); }}
                  className="mt-1 w-full rounded-xl border border-slate-300 p-2.5 text-sm"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="dep-form-principal"
                  type="checkbox"
                  checked={formDepEsPrincipal}
                  onChange={(e) => { setFormDepEsPrincipal(e.target.checked); }}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                />
                <label htmlFor="dep-form-principal" className="text-xs font-bold text-slate-700 cursor-pointer">
                  Marcar como depósito principal del negocio
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => { setModalDeposito(false); }}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoDep}
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm"
                >
                  {guardandoDep ? 'Guardando...' : 'Guardar Depósito ✓'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
