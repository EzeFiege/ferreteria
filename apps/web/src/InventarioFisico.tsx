import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type {
  DetalleInventarioFisico,
  InventarioFisicoItem,
  RolUsuario,
} from '@ferreteria/shared';
import { apiUrl } from './api-url.js';
import { formatearPesos } from './App.js';
import { exportarACSV } from './utils/exportar-csv.js';

export interface InventarioFisicoProps {
  token: string;
  rolUsuario: RolUsuario;
  rubros: Array<{ id: string; nombre: string }>;
}

export function InventarioFisico({
  token,
  rolUsuario,
  rubros,
}: InventarioFisicoProps): ReactElement {
  const [inventarios, setInventarios] = useState<InventarioFisicoItem[]>([]);
  const [cargandoLista, setCargandoLista] = useState<boolean>(false);
  const [inventarioSeleccionadoId, setInventarioSeleccionadoId] = useState<
    string | null
  >(null);
  const [detalle, setDetalle] = useState<DetalleInventarioFisico | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState<boolean>(false);

  // Mensajes de feedback
  const [mensajeOk, setMensajeOk] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modal para iniciar nuevo inventario
  const [mostrarModalNuevo, setMostrarModalNuevo] = useState<boolean>(false);
  const [nuevoNombre, setNuevoNombre] = useState<string>('');
  const [nuevoRubroId, setNuevoRubroId] = useState<string>('');
  const [nuevasObservaciones, setNuevasObservaciones] = useState<string>('');
  const [iniciandoInventario, setIniciandoInventario] = useState<boolean>(false);

  // Modo de recuento: Ciego vs Revelado/Auditoría
  const [modoCiego, setModoCiego] = useState<boolean>(false);

  // Filtro / Buscador de artículos dentro del inventario
  const [busquedaArticulo, setBusquedaArticulo] = useState<string>('');
  const [filtroDiferencia, setFiltroDiferencia] = useState<
    'todos' | 'con_diferencia' | 'pendientes'
  >('todos');

  // Estado local de conteos editados antes de guardar
  const [conteosLocales, setConteosLocales] = useState<Record<string, string>>(
    {},
  );
  const [guardandoConteos, setGuardandoConteos] = useState<boolean>(false);
  const [aplicandoInventario, setAplicandoInventario] =
    useState<boolean>(false);

  // Cargar lista de tomas de inventario
  const cargarInventarios = useCallback(async () => {
    try {
      setCargandoLista(true);
      const res = await fetch(apiUrl('/api/inventarios'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          inventarios: InventarioFisicoItem[];
        };
        setInventarios(data.inventarios);
      }
    } catch {
      setErrorMsg('No se pudo cargar el historial de inventarios físicos.');
    } finally {
      setCargandoLista(false);
    }
  }, [token]);

  // Cargar detalle del inventario seleccionado
  const cargarDetalleInventario = useCallback(
    async (id: string) => {
      try {
        setCargandoDetalle(true);
        const res = await fetch(apiUrl(`/api/inventarios/${id}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as DetalleInventarioFisico;
          setDetalle(data);
          // Inicializar los conteos locales con lo que ya está guardado
          const mapa: Record<string, string> = {};
          for (const it of data.items) {
            if (it.stockContado !== null) {
              mapa[it.productoId] = it.stockContado;
            }
          }
          setConteosLocales(mapa);
        } else {
          setErrorMsg('No se pudo cargar el detalle del inventario.');
        }
      } catch {
        setErrorMsg('Error de red al consultar el inventario.');
      } finally {
        setCargandoDetalle(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void cargarInventarios();
  }, [cargarInventarios]);

  useEffect(() => {
    if (inventarioSeleccionadoId) {
      void cargarDetalleInventario(inventarioSeleccionadoId);
    } else {
      setDetalle(null);
    }
  }, [inventarioSeleccionadoId, cargarDetalleInventario]);

  // Iniciar nuevo inventario
  const iniciarNuevoInventario = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!nuevoNombre.trim()) {
      setErrorMsg('El nombre de la toma de inventario es requerido.');
      return;
    }

    try {
      setIniciandoInventario(true);
      setErrorMsg(null);
      const res = await fetch(apiUrl('/api/inventarios/iniciar'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nombre: nuevoNombre.trim(),
          rubroId: nuevoRubroId || null,
          observaciones: nuevasObservaciones.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setErrorMsg(err.error ?? 'No se pudo iniciar el inventario.');
        return;
      }

      const data = (await res.json()) as { inventario: InventarioFisicoItem };
      setMensajeOk(
        `Inventario #${data.inventario.numero} iniciado con ${data.inventario.totalArticulos} artículos.`,
      );
      setMostrarModalNuevo(false);
      setNuevoNombre('');
      setNuevoRubroId('');
      setNuevasObservaciones('');
      await cargarInventarios();
      setInventarioSeleccionadoId(data.inventario.id);
    } catch {
      setErrorMsg('Error de conexión al iniciar el inventario.');
    } finally {
      setIniciandoInventario(false);
    }
  };

  // Guardar conteo físico de un ítem
  const actualizarConteoLocal = (productoId: string, cantidad: string) => {
    setConteosLocales((prev) => ({
      ...prev,
      [productoId]: cantidad,
    }));
  };

  // Guardar todos los conteos pendientes
  const guardarConteos = async () => {
    if (!detalle) return;

    const itemsParaGuardar = Object.entries(conteosLocales)
      .filter(([, val]) => val.trim().length > 0)
      .map(([prodId, val]) => ({
        productoId: prodId,
        stockContado: val.trim(),
      }));

    if (itemsParaGuardar.length === 0) {
      setErrorMsg('No hay conteos ingresados para guardar.');
      return;
    }

    try {
      setGuardandoConteos(true);
      setErrorMsg(null);
      const res = await fetch(
        apiUrl(`/api/inventarios/${detalle.inventario.id}/conteos`),
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ items: itemsParaGuardar }),
        },
      );

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setErrorMsg(err.error ?? 'No se pudieron guardar los conteos.');
        return;
      }

      setMensajeOk('Conteos físicos guardados correctamente.');
      await cargarDetalleInventario(detalle.inventario.id);
      await cargarInventarios();
    } catch {
      setErrorMsg('Error de conexión al guardar los conteos.');
    } finally {
      setGuardandoConteos(false);
    }
  };

  // Aplicar inventario y conciliar stock
  const aplicarInventario = async () => {
    if (!detalle) return;

    const confirmar = window.confirm(
      `¿Confirmás aplicar el Inventario #${detalle.inventario.numero}?\n\nEsta acción registrará ajustes inmutables en el Kardex de stock y generará el asiento contable correspondiente.`,
    );
    if (!confirmar) return;

    try {
      setAplicandoInventario(true);
      setErrorMsg(null);
      const res = await fetch(
        apiUrl(`/api/inventarios/${detalle.inventario.id}/aplicar`),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({}),
        },
      );

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setErrorMsg(err.error ?? 'No se pudo aplicar el inventario.');
        return;
      }

      const resJson = (await res.json()) as {
        mensaje: string;
        movimientosGenerados: number;
      };
      setMensajeOk(
        `${resJson.mensaje}. Se generaron ${resJson.movimientosGenerados} movimientos de ajuste en el Kardex.`,
      );
      await cargarDetalleInventario(detalle.inventario.id);
      await cargarInventarios();
    } catch {
      setErrorMsg('Error al conectar con el servidor.');
    } finally {
      setAplicandoInventario(false);
    }
  };

  // Cancelar inventario
  const cancelarInventario = async () => {
    if (!detalle) return;

    const confirmar = window.confirm(
      `¿Estás seguro de cancelar el Inventario #${detalle.inventario.numero}? Los conteos quedarán descartados y no se alterará el stock.`,
    );
    if (!confirmar) return;

    try {
      const res = await fetch(
        apiUrl(`/api/inventarios/${detalle.inventario.id}/cancelar`),
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        setErrorMsg(err.error ?? 'No se pudo cancelar el inventario.');
        return;
      }

      setMensajeOk('Inventario cancelado sin modificaciones en el stock.');
      await cargarDetalleInventario(detalle.inventario.id);
      await cargarInventarios();
    } catch {
      setErrorMsg('Error de red al cancelar el inventario.');
    }
  };

  // Exportar a Excel
  const exportarDetalleExcel = () => {
    if (!detalle) return;

    const columnas = [
      'Código',
      'Artículo',
      'Rubro',
      'Unidad',
      'Stock Sistema',
      'Stock Físico',
      'Diferencia',
      'Costo Unitario',
      'Diferencia Valorizada',
      'Contado Por',
    ];

    const filas = detalle.items.map((it) => [
      it.productoCodigo,
      it.productoNombre,
      it.rubroNombre ?? 'Sin rubro',
      it.unidadPrincipal,
      it.stockSistema,
      it.stockContado ?? 'Pendiente',
      it.diferencia,
      it.costoUnitario,
      it.diferenciaValorizada,
      it.contadoPorNombre ?? '-',
    ]);

    exportarACSV(
      `inventario-${String(detalle.inventario.numero)}-${detalle.inventario.nombre.replace(/\s+/g, '_')}`,
      columnas,
      filas,
    );
  };

  // Ítems filtrados
  const itemsFiltrados = useMemo(() => {
    if (!detalle) return [];

    return detalle.items.filter((it) => {
      // Filtro por texto
      if (busquedaArticulo.trim().length > 0) {
        const q = busquedaArticulo.toLowerCase();
        const coincide =
          it.productoNombre.toLowerCase().includes(q) ||
          it.productoCodigo.toLowerCase().includes(q);
        if (!coincide) return false;
      }

      // Filtro por estado
      if (filtroDiferencia === 'con_diferencia') {
        return it.stockContado !== null && it.diferencia !== '0.000';
      }
      if (filtroDiferencia === 'pendientes') {
        return it.stockContado === null;
      }
      return true;
    });
  }, [detalle, busquedaArticulo, filtroDiferencia]);

  // Métricas rápidas de conciliación
  const metricas = useMemo(() => {
    if (!detalle) return null;

    let totalContados = 0;
    let sobranteTotal = 0;
    let faltanteTotal = 0;

    for (const it of detalle.items) {
      if (it.stockContado !== null) {
        totalContados++;
        const valNum = parseFloat(it.diferenciaValorizada);
        if (valNum > 0) {
          sobranteTotal += valNum;
        } else if (valNum < 0) {
          faltanteTotal += Math.abs(valNum);
        }
      }
    }

    const pendientes = detalle.items.length - totalContados;
    const neto = sobranteTotal - faltanteTotal;

    return {
      totalArticulos: detalle.items.length,
      totalContados,
      pendientes,
      sobranteTotal: sobranteTotal.toFixed(2),
      faltanteTotal: faltanteTotal.toFixed(2),
      neto: neto.toFixed(2),
    };
  }, [detalle]);

  return (
    <div data-testid="vista-inventario-fisico" className="space-y-6">
      {/* Cabecera Principal */}
      <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <span>📋</span> Control de Inventario Físico & Auditoría
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Toma de inventario en góndolas, recuento ciego, detección de
              mermas y conciliación inmutable en Kardex.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(rolUsuario === 'encargado' || rolUsuario === 'dueno') && (
              <button
                type="button"
                onClick={() => {
                  setMostrarModalNuevo(true);
                }}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow hover:bg-slate-800 transition-colors flex items-center gap-1.5"
              >
                <span>+</span> Iniciar Nuevo Recuento
              </button>
            )}
          </div>
        </div>

        {mensajeOk && (
          <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-xs font-bold text-emerald-900 flex items-center justify-between">
            <span>{mensajeOk}</span>
            <button
              type="button"
              onClick={() => {
                setMensajeOk(null);
              }}
              className="text-emerald-700 hover:text-emerald-900 text-sm font-black"
            >
              ✕
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 rounded-xl bg-rose-50 border border-rose-200 px-4 py-2.5 text-xs font-bold text-rose-900 flex items-center justify-between">
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
              }}
              className="text-rose-700 hover:text-rose-900 text-sm font-black"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Contenido: Si hay inventario seleccionado se muestra su detalle, sino la lista histórica */}
      {inventarioSeleccionadoId && cargandoDetalle && !detalle && (
        <div className="flex flex-col items-center justify-center p-12 bg-white rounded-3xl border border-slate-200">
          <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-xs font-bold text-slate-500">Cargando datos del inventario físico...</p>
        </div>
      )}

      {inventarioSeleccionadoId && detalle ? (
        <div className="space-y-6">
          {/* Barra superior del inventario activo */}
          <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setInventarioSeleccionadoId(null);
                  }}
                  className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200"
                >
                  ← Volver a la Lista
                </button>
                <h3 className="text-lg font-black text-slate-900">
                  Inventario #{detalle.inventario.numero}: {detalle.inventario.nombre}
                </h3>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase border ${
                    detalle.inventario.estado === 'aplicado'
                      ? 'bg-emerald-100 text-emerald-900 border-emerald-200'
                      : detalle.inventario.estado === 'cancelado'
                        ? 'bg-slate-200 text-slate-700 border-slate-300'
                        : 'bg-amber-100 text-amber-900 border-amber-200'
                  }`}
                >
                  {detalle.inventario.estado.replace('_', ' ')}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Rubro: <strong>{detalle.inventario.rubroNombre ?? 'Todo el catálogo'}</strong> · Iniciado por: {detalle.inventario.iniciadoPorNombre} el{' '}
                {new Date(detalle.inventario.creadoEn).toLocaleString('es-AR')}
              </p>
            </div>

            {/* Acciones principales */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Toggle de Modo Ciego */}
              <div className="flex items-center gap-1.5 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
                <label className="text-xs font-bold text-slate-700 cursor-pointer flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={modoCiego}
                    onChange={(e) => {
                      setModoCiego(e.target.checked);
                    }}
                    className="rounded text-slate-900"
                  />
                  <span>Recuento Ciego (Ocultar stock sistema)</span>
                </label>
              </div>

              <button
                type="button"
                onClick={exportarDetalleExcel}
                className="rounded-xl bg-slate-100 border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200"
              >
                📊 Exportar Excel
              </button>

              {detalle.inventario.estado === 'en_proceso' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      void guardarConteos();
                    }}
                    disabled={guardandoConteos}
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {guardandoConteos ? 'Guardando...' : '💾 Guardar Conteos'}
                  </button>

                  {(rolUsuario === 'encargado' || rolUsuario === 'dueno') && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          void aplicarInventario();
                        }}
                        disabled={aplicandoInventario}
                        className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {aplicandoInventario ? 'Aplicando...' : '✓ Conciliar Stock'}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          void cancelarInventario();
                        }}
                        className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100"
                      >
                        ✕ Cancelar
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Tarjetas de Métricas de Conciliación */}
          {metricas && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="rounded-xl bg-white p-3.5 border border-slate-200 shadow-sm">
                <div className="text-[11px] font-bold uppercase text-slate-500">
                  Total Artículos
                </div>
                <div className="text-lg font-black text-slate-900 mt-0.5">
                  {metricas.totalArticulos}
                </div>
              </div>
              <div className="rounded-xl bg-white p-3.5 border border-slate-200 shadow-sm">
                <div className="text-[11px] font-bold uppercase text-slate-500">
                  Contados
                </div>
                <div className="text-lg font-black text-indigo-600 mt-0.5">
                  {metricas.totalContados} / {metricas.totalArticulos}
                </div>
              </div>
              <div className="rounded-xl bg-white p-3.5 border border-slate-200 shadow-sm">
                <div className="text-[11px] font-bold uppercase text-slate-500">
                  Pendientes
                </div>
                <div className="text-lg font-black text-slate-400 mt-0.5">
                  {metricas.pendientes}
                </div>
              </div>
              <div className="rounded-xl bg-white p-3.5 border border-emerald-100 shadow-sm bg-emerald-50/30">
                <div className="text-[11px] font-bold uppercase text-emerald-800">
                  Sobrante Total ($)
                </div>
                <div className="text-lg font-black text-emerald-700 mt-0.5">
                  {formatearPesos(metricas.sobranteTotal)}
                </div>
              </div>
              <div className="rounded-xl bg-white p-3.5 border border-rose-100 shadow-sm bg-rose-50/30">
                <div className="text-[11px] font-bold uppercase text-rose-800">
                  Faltante / Merma ($)
                </div>
                <div className="text-lg font-black text-rose-700 mt-0.5">
                  {formatearPesos(metricas.faltanteTotal)}
                </div>
              </div>
              <div className="rounded-xl bg-white p-3.5 border border-slate-300 shadow-sm bg-slate-50">
                <div className="text-[11px] font-bold uppercase text-slate-700">
                  Balance Neto ($)
                </div>
                <div
                  className={`text-lg font-black mt-0.5 ${
                    parseFloat(metricas.neto) >= 0
                      ? 'text-emerald-700'
                      : 'text-rose-700'
                  }`}
                >
                  {formatearPesos(metricas.neto)}
                </div>
              </div>
            </div>
          )}

          {/* Filtros de la tabla de ítems */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 flex-1 max-w-md">
              <input
                type="text"
                placeholder="Buscar por código, descripción o marca..."
                value={busquedaArticulo}
                onChange={(e) => {
                  setBusquedaArticulo(e.target.value);
                }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setFiltroDiferencia('todos');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                  filtroDiferencia === 'todos'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Todos ({detalle.items.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setFiltroDiferencia('con_diferencia');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                  filtroDiferencia === 'con_diferencia'
                    ? 'bg-amber-600 text-white'
                    : 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
                }`}
              >
                Con Diferencia ({detalle.inventario.articulosConDiferencia})
              </button>
              <button
                type="button"
                onClick={() => {
                  setFiltroDiferencia('pendientes');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                  filtroDiferencia === 'pendientes'
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Pendientes ({metricas?.pendientes ?? 0})
              </button>
            </div>
          </div>

          {/* Tabla de Artículos para Recuento */}
          <div className="rounded-2xl bg-white shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-slate-700 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3.5">Código</th>
                    <th className="px-4 py-3.5">Artículo / Descripción</th>
                    <th className="px-4 py-3.5">Rubro</th>
                    <th className="px-4 py-3.5 text-center">Unidad</th>
                    {!modoCiego && (
                      <th className="px-4 py-3.5 text-right bg-slate-100/60">
                        Stock Sistema
                      </th>
                    )}
                    <th className="px-4 py-3.5 text-center bg-indigo-50/50">
                      Recuento Físico
                    </th>
                    {!modoCiego && (
                      <>
                        <th className="px-4 py-3.5 text-right">Diferencia</th>
                        <th className="px-4 py-3.5 text-right">Costo Unit.</th>
                        <th className="px-4 py-3.5 text-right">Dif. Valorizada</th>
                      </>
                    )}
                    <th className="px-4 py-3.5 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {itemsFiltrados.map((it) => {
                    const conteoActual =
                      conteosLocales[it.productoId] ?? it.stockContado ?? '';
                    const difNum = parseFloat(it.diferencia);
                    const tieneConteo = it.stockContado !== null;

                    let badgeColor = 'bg-slate-100 text-slate-500';
                    let badgeTexto = 'Pendiente';

                    if (tieneConteo) {
                      if (difNum === 0) {
                        badgeColor = 'bg-emerald-100 text-emerald-800';
                        badgeTexto = '✓ Cuadrado';
                      } else if (difNum > 0) {
                        badgeColor = 'bg-blue-100 text-blue-800';
                        badgeTexto = `+${it.diferencia} Sobrante`;
                      } else {
                        badgeColor = 'bg-rose-100 text-rose-800';
                        badgeTexto = `${it.diferencia} Faltante`;
                      }
                    }

                    return (
                      <tr key={it.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono font-bold text-slate-900">
                          {it.productoCodigo}
                        </td>
                        <td className="px-4 py-3 font-semibold">
                          {it.productoNombre}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {it.rubroNombre ?? 'Sin rubro'}
                        </td>
                        <td className="px-4 py-3 text-center text-slate-600 font-mono">
                          {it.unidadPrincipal}
                        </td>
                        {!modoCiego && (
                          <td className="px-4 py-3 text-right font-mono bg-slate-100/40">
                            {it.stockSistema}
                          </td>
                        )}
                        <td className="px-4 py-3 text-center bg-indigo-50/20">
                          {detalle.inventario.estado === 'en_proceso' ? (
                            <input
                              type="number"
                              step="any"
                              value={conteoActual}
                              onChange={(e) => {
                                actualizarConteoLocal(
                                  it.productoId,
                                  e.target.value,
                                );
                              }}
                              placeholder="Contar..."
                              className="w-24 text-center rounded-lg border border-slate-300 py-1 text-xs font-mono font-bold text-slate-900 focus:border-indigo-600 focus:outline-none"
                            />
                          ) : (
                            <span className="font-mono font-bold">
                              {it.stockContado ?? '-'}
                            </span>
                          )}
                        </td>
                        {!modoCiego && (
                          <>
                            <td
                              className={`px-4 py-3 text-right font-mono font-bold ${
                                difNum > 0
                                  ? 'text-blue-700'
                                  : difNum < 0
                                    ? 'text-rose-700'
                                    : 'text-slate-600'
                              }`}
                            >
                              {tieneConteo
                                ? (difNum > 0 ? `+${it.diferencia}` : it.diferencia)
                                : '-'}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-slate-500">
                              {formatearPesos(it.costoUnitario)}
                            </td>
                            <td
                              className={`px-4 py-3 text-right font-mono font-bold ${
                                difNum > 0
                                  ? 'text-blue-700'
                                  : difNum < 0
                                    ? 'text-rose-700'
                                    : 'text-slate-600'
                              }`}
                            >
                              {tieneConteo
                                ? formatearPesos(it.diferenciaValorizada)
                                : '-'}
                            </td>
                          </>
                        )}
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${badgeColor}`}
                          >
                            {badgeTexto}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {itemsFiltrados.length === 0 && (
                    <tr>
                      <td
                        colSpan={modoCiego ? 6 : 9}
                        className="px-4 py-8 text-center text-slate-400"
                      >
                        No se encontraron artículos con el filtro aplicado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* Directorio de Inventarios Físicos */
        <div className="rounded-2xl bg-white shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">
              Historial de Recuentos de Inventario
            </h3>
            {cargandoLista && (
              <span className="text-xs text-slate-400">Actualizando...</span>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">N°</th>
                  <th className="px-5 py-3.5">Nombre / Motivo</th>
                  <th className="px-5 py-3.5">Rubro Abarcado</th>
                  <th className="px-5 py-3.5">Estado</th>
                  <th className="px-5 py-3.5 text-center">Artículos</th>
                  <th className="px-5 py-3.5 text-center">Con Diferencia</th>
                  <th className="px-5 py-3.5 text-right">Dif. Neta ($)</th>
                  <th className="px-5 py-3.5">Fecha Inicio</th>
                  <th className="px-5 py-3.5 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {inventarios.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3.5 font-mono font-bold text-slate-900">
                      #{inv.numero}
                    </td>
                    <td className="px-5 py-3.5 font-bold text-slate-900">
                      {inv.nombre}
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">
                      {inv.rubroNombre ?? 'Todo el catálogo'}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase border ${
                          inv.estado === 'aplicado'
                            ? 'bg-emerald-100 text-emerald-900 border-emerald-200'
                            : inv.estado === 'cancelado'
                              ? 'bg-slate-200 text-slate-700 border-slate-300'
                              : 'bg-amber-100 text-amber-900 border-amber-200'
                        }`}
                      >
                        {inv.estado.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-center font-mono">
                      {inv.totalArticulos}
                    </td>
                    <td className="px-5 py-3.5 text-center font-mono font-bold text-amber-700">
                      {inv.articulosConDiferencia}
                    </td>
                    <td
                      className={`px-5 py-3.5 text-right font-mono font-bold ${
                        parseFloat(inv.diferenciaNetaValorizada) >= 0
                          ? 'text-emerald-700'
                          : 'text-rose-700'
                      }`}
                    >
                      {formatearPesos(inv.diferenciaNetaValorizada)}
                    </td>
                    <td className="px-5 py-3.5 text-slate-500">
                      {new Date(inv.creadoEn).toLocaleDateString('es-AR')}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setInventarioSeleccionadoId(inv.id);
                        }}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-slate-800"
                      >
                        {inv.estado === 'en_proceso' ? 'Continuar Conteo' : 'Ver Detalle'}
                      </button>
                    </td>
                  </tr>
                ))}
                {inventarios.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-5 py-8 text-center text-slate-400"
                    >
                      Aún no se ha realizado ninguna toma de inventario físico.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Iniciar Nuevo Inventario */}
      {mostrarModalNuevo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h4 className="text-base font-bold text-slate-900">
                Iniciar Nueva Toma de Inventario Físico
              </h4>
              <button
                type="button"
                onClick={() => {
                  setMostrarModalNuevo(false);
                }}
                className="text-slate-400 hover:text-slate-700 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={(e) => {
                void iniciarNuevoInventario(e);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nombre o Motivo del Inventario *
                </label>
                <input
                  type="text"
                  value={nuevoNombre}
                  onChange={(e) => {
                    setNuevoNombre(e.target.value);
                  }}
                  placeholder="Ej: Recuento General Anual / Muestreo Pasillo A"
                  required
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Rubro Abarcado (opcional)
                </label>
                <select
                  value={nuevoRubroId}
                  onChange={(e) => {
                    setNuevoRubroId(e.target.value);
                  }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none bg-white"
                >
                  <option value="">Todo el Catálogo (Inventario General)</option>
                  {rubros.map((r) => (
                    <option key={r.id} value={r.id}>
                      Solo Rubro: {r.nombre}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  Podés elegir auditar solo una sección específica de la ferretería (ej. Bulonería o Pinturas).
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Observaciones
                </label>
                <textarea
                  rows={2}
                  value={nuevasObservaciones}
                  onChange={(e) => {
                    setNuevasObservaciones(e.target.value);
                  }}
                  placeholder="Ej: Recuento antes del cierre fiscal..."
                  className="w-full rounded-xl border border-slate-300 p-2 text-xs focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setMostrarModalNuevo(false);
                  }}
                  className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={iniciandoInventario}
                  className="rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white shadow hover:bg-slate-800 disabled:opacity-50"
                >
                  {iniciandoInventario ? 'Iniciando...' : 'Iniciar Inventario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
