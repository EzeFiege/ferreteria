import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type {
  AcopioDetalleCompleto,
  AcopioResumenItem,
  CrearAcopioInput,
  RegistrarEntregaAcopioInput,
  RolUsuario,
} from '@ferreteria/shared';
import { apiUrl } from './api-url.js';
import { formatearPesos } from './App.js';

export interface AcopiosMaterialesProps {
  token: string;
  rolUsuario: RolUsuario;
}

interface ClienteBusqueda {
  id: string;
  nombre: string;
  cuitDni: string | null;
  telefono: string | null;
}

interface ProductoBusqueda {
  id: string;
  codigo: string;
  nombre: string;
  unidadPrincipal: string;
  precioVentaSugerido?: string;
  costoBase?: string;
}

export function AcopiosMateriales({
  token,
  rolUsuario: _rolUsuario,
}: AcopiosMaterialesProps): ReactElement {
  // Lista y filtros
  const [acopios, setAcopios] = useState<AcopioResumenItem[]>([]);
  const [cargando, setCargando] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'activo' | 'completado'>('todos');
  const [busquedaTexto, setBusquedaTexto] = useState<string>('');

  // Detalle del acopio seleccionado
  const [acopioSeleccionadoId, setAcopioSeleccionadoId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<AcopioDetalleCompleto | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState<boolean>(false);

  // Modal Nuevo Acopio
  const [modalNuevoAcopio, setModalNuevoAcopio] = useState<boolean>(false);
  const [nuevoClienteId, setNuevoClienteId] = useState<string>('');
  const [nuevoClienteNombre, setNuevoClienteNombre] = useState<string>('');
  const [buscarClienteTexto, setBuscarClienteTexto] = useState<string>('');
  const [clientesEncontrados, setClientesEncontrados] = useState<ClienteBusqueda[]>([]);
  const [buscandoClientes, setBuscandoClientes] = useState<boolean>(false);
  const [nuevoNotas, setNuevoNotas] = useState<string>('');
  const [nuevoItems, setNuevoItems] = useState<
    Array<{
      productoId: string;
      codigo: string;
      nombre: string;
      unidad: string;
      cantidad: string;
      precioUnitario: string;
    }>
  >([]);

  // Buscador de productos para el nuevo acopio
  const [buscarProdTexto, setBuscarProdTexto] = useState<string>('');
  const [productosEncontrados, setProductosEncontrados] = useState<ProductoBusqueda[]>([]);
  const [buscandoProductos, setBuscandoProductos] = useState<boolean>(false);

  // Modal Emitir Remito de Entrega Parcial
  const [modalEntrega, setModalEntrega] = useState<boolean>(false);
  const [retiradoPorNombre, setRetiradoPorNombre] = useState<string>('');
  const [retiradoPorDni, setRetiradoPorDni] = useState<string>('');
  const [vehiculoPatente, setVehiculoPatente] = useState<string>('');
  const [observacionesEntrega, setObservacionesEntrega] = useState<string>('');
  const [cantidadesEntrega, setCantidadesEntrega] = useState<Record<string, string>>({});
  const [guardandoEntrega, setGuardandoEntrega] = useState<boolean>(false);

  // Cargar lista de acopios
  const cargarAcopios = useCallback(async () => {
    setCargando(true);
    setErrorMsg(null);
    try {
      let url = apiUrl('/api/acopios');
      if (filtroEstado !== 'todos') {
        url += `?estado=${filtroEstado}`;
      }
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`Error ${res.status} al cargar acopios`);
      }
      const data = (await res.json()) as { acopios: AcopioResumenItem[] };
      setAcopios(data.acopios);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al cargar acopios');
    } finally {
      setCargando(false);
    }
  }, [token, filtroEstado]);

  useEffect(() => {
    void cargarAcopios();
  }, [cargarAcopios]);

  // Cargar detalle completo de acopio
  const cargarDetalleAcopio = useCallback(
    async (id: string) => {
      setCargandoDetalle(true);
      try {
        const res = await fetch(apiUrl(`/api/acopios/${id}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          throw new Error(`Error ${res.status} al cargar detalle`);
        }
        const data = (await res.json()) as AcopioDetalleCompleto;
        setDetalle(data);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Error al cargar detalle');
      } finally {
        setCargandoDetalle(false);
      }
    },
    [token],
  );

  const seleccionarAcopio = (id: string): void => {
    setAcopioSeleccionadoId(id);
    void cargarDetalleAcopio(id);
  };

  // Buscar clientes para nuevo acopio
  useEffect(() => {
    if (!buscarClienteTexto.trim() || buscarClienteTexto.length < 2) {
      setClientesEncontrados([]);
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        setBuscandoClientes(true);
        try {
          const res = await fetch(
            apiUrl(`/api/clientes?q=${encodeURIComponent(buscarClienteTexto.trim())}`),
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (res.ok) {
            const data = (await res.json()) as { clientes: ClienteBusqueda[] };
            setClientesEncontrados(data.clientes);
          }
        } catch {
          // Ignora
        } finally {
          setBuscandoClientes(false);
        }
      })();
    }, 250);
    return () => { clearTimeout(timer); };
  }, [buscarClienteTexto, token]);

  // Buscar productos para nuevo acopio
  useEffect(() => {
    if (!buscarProdTexto.trim() || buscarProdTexto.length < 2) {
      setProductosEncontrados([]);
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        setBuscandoProductos(true);
        try {
          const res = await fetch(
            apiUrl(`/api/productos?q=${encodeURIComponent(buscarProdTexto.trim())}`),
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (res.ok) {
            const data = (await res.json()) as { productos: ProductoBusqueda[] };
            setProductosEncontrados(data.productos);
          }
        } catch {
          // Ignora
        } finally {
          setBuscandoProductos(false);
        }
      })();
    }, 250);
    return () => { clearTimeout(timer); };
  }, [buscarProdTexto, token]);

  const agregarProductoANuevoAcopio = (prod: ProductoBusqueda): void => {
    if (nuevoItems.some((i) => i.productoId === prod.id)) {
      setAviso(`El artículo ${prod.nombre} ya está en la lista.`);
      return;
    }
    const precioUnit = prod.precioVentaSugerido ?? prod.costoBase ?? '0.00';
    setNuevoItems((prev) => [
      ...prev,
      {
        productoId: prod.id,
        codigo: prod.codigo,
        nombre: prod.nombre,
        unidad: prod.unidadPrincipal,
        cantidad: '1.000',
        precioUnitario: precioUnit,
      },
    ]);
    setBuscarProdTexto('');
    setProductosEncontrados([]);
  };

  const quitarItemNuevoAcopio = (index: number): void => {
    setNuevoItems((prev) => prev.filter((_, i) => i !== index));
  };

  const modificarItemNuevoAcopio = (
    index: number,
    campo: 'cantidad' | 'precioUnitario',
    valor: string,
  ): void => {
    setNuevoItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [campo]: valor } : item)),
    );
  };

  // Guardar nuevo acopio
  const handleGuardarNuevoAcopio = async (): Promise<void> => {
    if (!nuevoClienteId) {
      setErrorMsg('Debes seleccionar un cliente.');
      return;
    }
    if (nuevoItems.length === 0) {
      setErrorMsg('Debes agregar al menos un artículo al acopio.');
      return;
    }
    for (const item of nuevoItems) {
      if (parseFloat(item.cantidad) <= 0) {
        setErrorMsg(`La cantidad de ${item.nombre} debe ser mayor a 0.`);
        return;
      }
      if (parseFloat(item.precioUnitario) < 0) {
        setErrorMsg(`El precio de ${item.nombre} no puede ser negativo.`);
        return;
      }
    }

    try {
      const payload: CrearAcopioInput = {
        clienteId: nuevoClienteId,
        notas: nuevoNotas.trim() || undefined,
        items: nuevoItems.map((i) => ({
          productoId: i.productoId,
          cantidad: parseFloat(i.cantidad).toFixed(3),
          precioUnitario: parseFloat(i.precioUnitario).toFixed(2),
        })),
      };

      const res = await fetch(apiUrl('/api/acopios'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = (await res.json()) as { error?: string };
        throw new Error(errJson.error ?? `Error ${res.status} al guardar acopio`);
      }

      const resData = (await res.json()) as { id: string; numero: string };
      setAviso(`Acopio ${resData.numero} creado con éxito.`);
      setModalNuevoAcopio(false);
      setNuevoClienteId('');
      setNuevoClienteNombre('');
      setNuevoNotas('');
      setNuevoItems([]);
      await cargarAcopios();
      seleccionarAcopio(resData.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al guardar acopio');
    }
  };

  // Abrir modal de entrega parcial
  const abrirModalEntrega = (): void => {
    if (!detalle) return;
    const inicial: Record<string, string> = {};
    for (const item of detalle.items) {
      inicial[item.productoId] = '0';
    }
    setCantidadesEntrega(inicial);
    setRetiradoPorNombre(detalle.acopio.clienteNombre);
    setRetiradoPorDni(detalle.acopio.clienteCuitDni ?? '');
    setVehiculoPatente('');
    setObservacionesEntrega('');
    setModalEntrega(true);
  };

  // Confirmar emisión de remito de entrega
  const handleConfirmarEntrega = async (): Promise<void> => {
    if (!detalle) return;
    if (!retiradoPorNombre.trim()) {
      setErrorMsg('El nombre de quien retira o recibe es obligatorio.');
      return;
    }

    const itemsAEntregar: Array<{
      itemAcopioId: string;
      productoId: string;
      cantidad: string;
    }> = [];
    for (const item of detalle.items) {
      const cant = parseFloat(cantidadesEntrega[item.productoId] ?? '0');
      if (cant > 0) {
        const saldo = parseFloat(item.saldoPendiente);
        if (cant > saldo + 0.0001) {
          setErrorMsg(
            `La cantidad a entregar de ${item.productoNombre} (${cant}) supera el saldo disponible (${saldo}).`,
          );
          return;
        }
        itemsAEntregar.push({
          itemAcopioId: item.id,
          productoId: item.productoId,
          cantidad: cant.toFixed(3),
        });
      }
    }

    if (itemsAEntregar.length === 0) {
      setErrorMsg('Debes indicar una cantidad mayor a cero en al menos un artículo.');
      return;
    }

    setGuardandoEntrega(true);
    setErrorMsg(null);
    try {
      const payload: RegistrarEntregaAcopioInput = {
        retiradoPorNombre: retiradoPorNombre.trim(),
        retiradoPorDni: retiradoPorDni.trim() || undefined,
        vehiculoPatente: vehiculoPatente.trim() || undefined,
        observaciones: observacionesEntrega.trim() || undefined,
        items: itemsAEntregar,
      };

      const res = await fetch(apiUrl(`/api/acopios/${detalle.acopio.id}/entregas`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = (await res.json()) as { error?: string };
        throw new Error(errJson.error ?? `Error ${res.status} al emitir remito`);
      }

      const resData = (await res.json()) as {
        remitoId: string;
        numeroRemito: string;
        acopioCompletado: boolean;
      };

      setAviso(
        `Remito ${resData.numeroRemito} emitido con éxito.${
          resData.acopioCompletado ? ' ¡Acopio completado en su totalidad!' : ''
        }`,
      );
      setModalEntrega(false);
      await cargarAcopios();
      await cargarDetalleAcopio(detalle.acopio.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al registrar entrega');
    } finally {
      setGuardandoEntrega(false);
    }
  };

  // Filtrado en memoria por texto
  const acopiosFiltrados = acopios.filter((a) => {
    if (!busquedaTexto.trim()) return true;
    const txt = busquedaTexto.toLowerCase();
    return (
      a.numero.toLowerCase().includes(txt) ||
      a.clienteNombre.toLowerCase().includes(txt) ||
      (a.clienteCuitDni && a.clienteCuitDni.toLowerCase().includes(txt)) ||
      (a.notas && a.notas.toLowerCase().includes(txt))
    );
  });

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-600 text-white font-black text-lg">
              📦
            </span>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Acopio de Materiales y Entregas Parciales
            </h1>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Ventas congeladas por anticipado, custodia de mercadería y control de retiros con remitos oficiales.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setModalNuevoAcopio(true);
            setNuevoItems([]);
            setNuevoClienteId('');
            setNuevoClienteNombre('');
            setBuscarClienteTexto('');
            setNuevoNotas('');
          }}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-amber-700 transition"
        >
          <span>➕</span> Nuevo Acopio
        </button>
      </div>

      {/* Alertas */}
      {errorMsg && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 flex items-center justify-between">
          <span>⚠️ {errorMsg}</span>
          <button
            type="button"
            onClick={() => { setErrorMsg(null); }}
            className="text-xs font-bold underline"
          >
            Cerrar
          </button>
        </div>
      )}

      {aviso && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 flex items-center justify-between">
          <span>✅ {aviso}</span>
          <button
            type="button"
            onClick={() => { setAviso(null); }}
            className="text-xs font-bold underline"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Contenido Principal: Grilla de 2 columnas */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Columna Izquierda: Listado y Filtros (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            {/* Buscador y Filtros */}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Buscar por cliente o N°..."
                value={busquedaTexto}
                onChange={(e) => { setBusquedaTexto(e.target.value); }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void cargarAcopios()}
                className="rounded-xl bg-slate-100 px-3 py-2 text-slate-700 hover:bg-slate-200"
                title="Actualizar lista"
              >
                🔄
              </button>
            </div>

            <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 text-xs font-bold">
              <button
                type="button"
                onClick={() => { setFiltroEstado('todos'); }}
                className={`flex-1 rounded-lg py-1.5 transition ${
                  filtroEstado === 'todos'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Todos ({acopios.length})
              </button>
              <button
                type="button"
                onClick={() => { setFiltroEstado('activo'); }}
                className={`flex-1 rounded-lg py-1.5 transition ${
                  filtroEstado === 'activo'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Activos ({acopios.filter((a) => a.estado === 'activo').length})
              </button>
              <button
                type="button"
                onClick={() => { setFiltroEstado('completado'); }}
                className={`flex-1 rounded-lg py-1.5 transition ${
                  filtroEstado === 'completado'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Completados ({acopios.filter((a) => a.estado === 'completado').length})
              </button>
            </div>
          </div>

          {/* Lista de Acopios */}
          <div className="space-y-2.5 max-h-[640px] overflow-y-auto pr-1">
            {cargando ? (
              <div className="p-8 text-center text-sm text-slate-500">Cargando acopios...</div>
            ) : acopiosFiltrados.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 bg-white">
                No se encontraron acopios con los filtros seleccionados.
              </div>
            ) : (
              acopiosFiltrados.map((item) => {
                const seleccionado = acopioSeleccionadoId === item.id;
                const esCompletado = item.estado === 'completado';
                return (
                  <div
                    key={item.id}
                    onClick={() => { seleccionarAcopio(item.id); }}
                    className={`cursor-pointer rounded-2xl border p-4 transition shadow-xs ${
                      seleccionado
                        ? 'border-amber-500 bg-amber-50/50 ring-2 ring-amber-500/20'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-black text-amber-900">
                            {item.numero}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                              esCompletado
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {item.estado}
                          </span>
                        </div>
                        <h3 className="font-bold text-slate-900 text-sm mt-1">
                          {item.clienteNombre}
                        </h3>
                        {item.clienteCuitDni && (
                          <div className="text-xs text-slate-500">
                            CUIT/DNI: {item.clienteCuitDni}
                          </div>
                        )}
                      </div>

                      <div className="text-right">
                        <div className="text-xs text-slate-500">Valorizado</div>
                        <div className="text-sm font-black text-slate-900">
                          {formatearPesos(item.totalValorizado)}
                        </div>
                      </div>
                    </div>

                    {/* Barra de progreso de entrega */}
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>
                          Entregado: <strong>{parseFloat(item.totalUnidadesEntregadas).toFixed(1)}</strong> / {parseFloat(item.totalUnidadesCompradas).toFixed(1)} u.
                        </span>
                        <span className="font-bold text-slate-700">{item.pctEntregado}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full transition-all duration-300 ${
                            esCompletado ? 'bg-emerald-500' : 'bg-amber-500'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, item.pctEntregado))}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400 border-t border-slate-100 pt-2">
                      <span>Emisión: {item.fechaEmision}</span>
                      <span>
                        Pendiente:{' '}
                        <strong className="text-amber-800 font-bold">
                          {parseFloat(item.saldoUnidadesPendientes).toFixed(1)} u.
                        </strong>
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Columna Derecha: Detalle Completo del Acopio (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {!acopioSeleccionadoId ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-400">
              <span className="text-4xl block mb-2">📋</span>
              <p className="text-base font-bold text-slate-600">Ningún acopio seleccionado</p>
              <p className="text-xs text-slate-400 mt-1">
                Selecciona un acopio de la lista izquierda para consultar los materiales en custodia, emitir remitos o revisar entregas anteriores.
              </p>
            </div>
          ) : cargandoDetalle ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
              Cargando detalle del acopio...
            </div>
          ) : !detalle ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-800">
              No se pudo cargar la información del acopio.
            </div>
          ) : (
            <div className="space-y-5">
              {/* Cabecera del detalle */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xl font-black text-amber-900">
                        {detalle.acopio.numero}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${
                          detalle.acopio.estado === 'completado'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {detalle.acopio.estado}
                      </span>
                    </div>
                    <h2 className="text-lg font-black text-slate-900 mt-1">
                      {detalle.acopio.clienteNombre}
                    </h2>
                    <div className="flex flex-wrap gap-x-4 text-xs text-slate-500 mt-1">
                      {detalle.acopio.clienteCuitDni && (
                        <span>CUIT/DNI: <strong>{detalle.acopio.clienteCuitDni}</strong></span>
                      )}
                      {detalle.acopio.clienteTelefono && (
                        <span>Tel: <strong>{detalle.acopio.clienteTelefono}</strong></span>
                      )}
                      <span>Fecha emisión: <strong>{detalle.acopio.fechaEmision}</strong></span>
                    </div>
                  </div>

                  {detalle.acopio.estado === 'activo' && (
                    <button
                      type="button"
                      onClick={abrirModalEntrega}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 transition"
                    >
                      <span>🚚</span> Emitir Remito de Retiro
                    </button>
                  )}
                </div>

                {detalle.acopio.notas && (
                  <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700 border border-slate-200">
                    <span className="font-bold text-slate-900">Notas/Obra:</span> {detalle.acopio.notas}
                  </div>
                )}

                {/* Métricas rápidas */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                  <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                    <div className="text-[11px] font-bold text-slate-500 uppercase">Compradas</div>
                    <div className="text-base font-black text-slate-900 mt-0.5">
                      {parseFloat(detalle.acopio.totalUnidadesCompradas).toFixed(1)} u.
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                    <div className="text-[11px] font-bold text-slate-500 uppercase">Entregadas</div>
                    <div className="text-base font-black text-emerald-700 mt-0.5">
                      {parseFloat(detalle.acopio.totalUnidadesEntregadas).toFixed(1)} u.
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                    <div className="text-[11px] font-bold text-slate-500 uppercase">Saldo Pendiente</div>
                    <div className="text-base font-black text-amber-700 mt-0.5">
                      {parseFloat(detalle.acopio.saldoUnidadesPendientes).toFixed(1)} u.
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                    <div className="text-[11px] font-bold text-slate-500 uppercase">Total Congelado</div>
                    <div className="text-base font-black text-slate-900 mt-0.5">
                      {formatearPesos(detalle.acopio.totalValorizado)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Renglones / Artículos en Custodia */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-slate-900 text-sm uppercase tracking-wider">
                    Materiales en Custodia ({detalle.items.length})
                  </h3>
                  <span className="text-xs text-slate-400">Stock vivo comparado en depósito</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-slate-50 text-[11px] uppercase font-bold text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="p-2.5">Código / Artículo</th>
                        <th className="p-2.5 text-right">Comprado</th>
                        <th className="p-2.5 text-right">Entregado</th>
                        <th className="p-2.5 text-right">Saldo</th>
                        <th className="p-2.5 text-right">Stock Depósito</th>
                        <th className="p-2.5 text-right">P. Unitario</th>
                        <th className="p-2.5 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detalle.items.map((it) => {
                        const saldoNum = parseFloat(it.saldoPendiente);
                        const stockNum = parseFloat(it.stockActualDeposito);
                        const sinStockSuficiente = saldoNum > 0 && stockNum < saldoNum;

                        return (
                          <tr key={it.id} className="hover:bg-slate-50/50">
                            <td className="p-2.5">
                              <span className="font-mono text-[10px] text-slate-500 block">
                                {it.productoCodigo}
                              </span>
                              <span className="font-bold text-slate-900 text-xs">
                                {it.productoNombre}
                              </span>
                              <span className="text-[10px] text-slate-400 ml-1">
                                ({it.unidadPrincipal})
                              </span>
                            </td>
                            <td className="p-2.5 text-right font-medium">
                              {parseFloat(it.cantidadComprada).toFixed(2)}
                            </td>
                            <td className="p-2.5 text-right font-medium text-emerald-700">
                              {parseFloat(it.cantidadEntregada).toFixed(2)}
                            </td>
                            <td className="p-2.5 text-right font-black text-amber-800">
                              {saldoNum.toFixed(2)}
                            </td>
                            <td className="p-2.5 text-right">
                              <span
                                className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                                  sinStockSuficiente
                                    ? 'bg-rose-100 text-rose-800'
                                    : 'bg-slate-100 text-slate-800'
                                }`}
                                title={
                                  sinStockSuficiente
                                    ? 'Atención: el stock físico en depósito es menor al saldo acopiado pendiente de entrega.'
                                    : 'Stock disponible en depósito'
                                }
                              >
                                {stockNum.toFixed(2)} {sinStockSuficiente && '⚠️'}
                              </span>
                            </td>
                            <td className="p-2.5 text-right text-slate-600">
                              {formatearPesos(it.precioUnitario)}
                            </td>
                            <td className="p-2.5 text-right font-bold text-slate-900">
                              {formatearPesos(it.subtotal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Historial de Remitos de Entrega */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-slate-900 text-sm uppercase tracking-wider">
                    Historial de Remitos Emitidos ({detalle.remitos.length})
                  </h3>
                </div>

                {detalle.remitos.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                    Aún no se han realizado retiros parciales de este acopio.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {detalle.remitos.map((rem) => (
                      <div
                        key={rem.id}
                        className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-black text-sm text-slate-900">
                              {rem.numero}
                            </span>
                            <span className="text-slate-400">•</span>
                            <span className="text-slate-600">
                              {new Date(rem.fecha).toLocaleString('es-AR')}
                            </span>
                          </div>
                          <span className="text-slate-500 font-medium">
                            Por: {rem.creadoPor}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-slate-600 border-t border-slate-200/60 pt-2">
                          <div>
                            Retiró: <strong className="text-slate-900">{rem.retiradoPorNombre}</strong>
                          </div>
                          <div>
                            DNI: <strong>{rem.retiradoPorDni ?? 'No informado'}</strong>
                          </div>
                          <div>
                            Patente:{' '}
                            <strong className="font-mono uppercase">
                              {rem.vehiculoPatente ?? 'Sin vehículo'}
                            </strong>
                          </div>
                        </div>

                        {rem.observaciones && (
                          <div className="text-slate-500 italic">
                            Obs: {rem.observaciones}
                          </div>
                        )}

                        <div className="border-t border-slate-200/60 pt-2">
                          <span className="font-bold text-slate-700 block mb-1">
                            Artículos despachados:
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {rem.items.map((ri) => (
                              <span
                                key={ri.id}
                                className="rounded-lg bg-white px-2 py-1 border border-slate-200 text-slate-800 font-medium"
                              >
                                {ri.productoNombre}:{' '}
                                <strong className="text-emerald-700">
                                  {parseFloat(ri.cantidad).toFixed(2)} {ri.unidadPrincipal}
                                </strong>
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MODAL NUEVO ACOPIO */}
      {modalNuevoAcopio && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-3xl rounded-3xl bg-white p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-xl font-black text-slate-900">
                  Nuevo Acopio de Materiales
                </h2>
                <p className="text-xs text-slate-500">
                  Congela mercadería para un cliente con retiro programado en obra.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setModalNuevoAcopio(false); }}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Selección de Cliente */}
            <div className="space-y-2">
              <label className="text-xs font-black uppercase text-slate-700">
                Cliente Titular
              </label>
              {nuevoClienteId ? (
                <div className="flex items-center justify-between rounded-xl bg-amber-50 border border-amber-200 p-3">
                  <div>
                    <span className="text-xs text-amber-800 font-bold block">
                      Cliente Seleccionado:
                    </span>
                    <span className="font-black text-slate-900 text-sm">
                      {nuevoClienteNombre}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setNuevoClienteId('');
                      setNuevoClienteNombre('');
                    }}
                    className="text-xs text-rose-600 font-bold underline"
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Escribe el nombre o CUIT/DNI del cliente..."
                    value={buscarClienteTexto}
                    onChange={(e) => { setBuscarClienteTexto(e.target.value); }}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-amber-500 focus:outline-none"
                  />
                  {buscandoClientes && (
                    <span className="absolute right-3 top-3 text-xs text-slate-400">
                      Buscando...
                    </span>
                  )}
                  {clientesEncontrados.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                      {clientesEncontrados.map((cli) => (
                        <div
                          key={cli.id}
                          onClick={() => {
                            setNuevoClienteId(cli.id);
                            setNuevoClienteNombre(cli.nombre);
                            setBuscarClienteTexto('');
                            setClientesEncontrados([]);
                          }}
                          className="cursor-pointer p-3 hover:bg-amber-50 text-xs border-b border-slate-100 flex justify-between"
                        >
                          <span className="font-bold text-slate-900">{cli.nombre}</span>
                          <span className="text-slate-500">{cli.cuitDni ?? ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Notas / Obra */}
            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-slate-700">
                Identificador de Obra / Notas
              </label>
              <input
                type="text"
                placeholder="Ej: Obra calle San Martín 450 - Loteo Los Ceibos"
                value={nuevoNotas}
                onChange={(e) => { setNuevoNotas(e.target.value); }}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-amber-500 focus:outline-none"
              />
            </div>

            {/* Agregar Artículos */}
            <div className="space-y-3 border-t border-slate-100 pt-3">
              <label className="text-xs font-black uppercase text-slate-700">
                Agregar Materiales al Acopio
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Buscar material por código o nombre..."
                  value={buscarProdTexto}
                  onChange={(e) => { setBuscarProdTexto(e.target.value); }}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-amber-500 focus:outline-none"
                />
                {buscandoProductos && (
                  <span className="absolute right-3 top-2.5 text-xs text-slate-400">
                    Buscando...
                  </span>
                )}
                {productosEncontrados.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                    {productosEncontrados.map((prod) => (
                      <div
                        key={prod.id}
                        onClick={() => { agregarProductoANuevoAcopio(prod); }}
                        className="cursor-pointer p-3 hover:bg-amber-50 text-xs border-b border-slate-100 flex justify-between items-center"
                      >
                        <div>
                          <span className="font-mono text-slate-400 block text-[10px]">
                            {prod.codigo}
                          </span>
                          <span className="font-bold text-slate-900">{prod.nombre}</span>
                        </div>
                        <span className="text-slate-600 font-medium">
                          {formatearPesos(prod.precioVentaSugerido ?? prod.costoBase ?? '0.00')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tabla de artículos seleccionados */}
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 font-bold text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="p-2.5">Material</th>
                      <th className="p-2.5 w-28 text-right">Cantidad</th>
                      <th className="p-2.5 w-32 text-right">P. Unitario</th>
                      <th className="p-2.5 w-32 text-right">Subtotal</th>
                      <th className="p-2.5 w-12 text-center">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {nuevoItems.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-slate-400">
                          No hay materiales agregados al acopio. Busca y agrega los materiales arriba.
                        </td>
                      </tr>
                    ) : (
                      nuevoItems.map((item, idx) => {
                        const cant = parseFloat(item.cantidad) || 0;
                        const prec = parseFloat(item.precioUnitario) || 0;
                        const sub = cant * prec;
                        return (
                          <tr key={item.productoId}>
                            <td className="p-2.5">
                              <span className="font-mono text-[10px] text-slate-400 block">
                                {item.codigo}
                              </span>
                              <span className="font-bold text-slate-900">{item.nombre}</span>
                              <span className="text-slate-400 text-[10px] ml-1">
                                ({item.unidad})
                              </span>
                            </td>
                            <td className="p-2.5 text-right">
                              <input
                                type="number"
                                step="0.001"
                                min="0.001"
                                value={item.cantidad}
                                onChange={(e) => { modificarItemNuevoAcopio(idx, 'cantidad', e.target.value); }
                                }
                                className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right text-xs focus:border-amber-500 focus:outline-none"
                              />
                            </td>
                            <td className="p-2.5 text-right">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={item.precioUnitario}
                                onChange={(e) => { modificarItemNuevoAcopio(idx, 'precioUnitario', e.target.value); }
                                }
                                className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-right text-xs focus:border-amber-500 focus:outline-none"
                              />
                            </td>
                            <td className="p-2.5 text-right font-black text-slate-900">
                              {formatearPesos(sub.toFixed(2))}
                            </td>
                            <td className="p-2.5 text-center">
                              <button
                                type="button"
                                onClick={() => { quitarItemNuevoAcopio(idx); }}
                                className="text-rose-500 hover:text-rose-700 font-bold p-1 text-sm"
                                title="Quitar artículo"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {nuevoItems.length > 0 && (
                    <tfoot className="bg-slate-50 font-black border-t border-slate-200">
                      <tr>
                        <td colSpan={3} className="p-2.5 text-right uppercase text-slate-600">
                          Total Valorizado:
                        </td>
                        <td className="p-2.5 text-right text-sm text-slate-900">
                          {formatearPesos(
                            nuevoItems
                              .reduce(
                                (acc, cur) =>
                                  acc +
                                  (parseFloat(cur.cantidad) || 0) *
                                    (parseFloat(cur.precioUnitario) || 0),
                                0,
                              )
                              .toFixed(2),
                          )}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* Botones de acción */}
            <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => { setModalNuevoAcopio(false); }}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleGuardarNuevoAcopio()}
                className="rounded-xl bg-amber-600 px-6 py-2 text-sm font-bold text-white shadow-sm hover:bg-amber-700"
              >
                Guardar y Congelar Acopio
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EMITIR REMITO DE ENTREGA PARCIAL */}
      {modalEntrega && detalle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-xl font-black text-slate-900">
                  Emitir Remito de Retiro — {detalle.acopio.numero}
                </h2>
                <p className="text-xs text-slate-500">
                  Cliente: <strong>{detalle.acopio.clienteNombre}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setModalEntrega(false); }}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Datos de Transporte / Retiro */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-black uppercase text-slate-700">
                  Retirado por *
                </label>
                <input
                  type="text"
                  placeholder="Nombre y apellido"
                  value={retiradoPorNombre}
                  onChange={(e) => { setRetiradoPorNombre(e.target.value); }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none font-bold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-black uppercase text-slate-700">
                  DNI / Documento
                </label>
                <input
                  type="text"
                  placeholder="DNI del chofer"
                  value={retiradoPorDni}
                  onChange={(e) => { setRetiradoPorDni(e.target.value); }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-black uppercase text-slate-700">
                  Patente Camión
                </label>
                <input
                  type="text"
                  placeholder="Ej: AB123CD"
                  value={vehiculoPatente}
                  onChange={(e) => { setVehiculoPatente(e.target.value.toUpperCase()); }}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none font-mono uppercase"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-slate-700">
                Observaciones del Remito
              </label>
              <input
                type="text"
                placeholder="Ej: Entrega parcial 1er viaje, descarga en obra planta baja..."
                value={observacionesEntrega}
                onChange={(e) => { setObservacionesEntrega(e.target.value); }}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none"
              />
            </div>

            {/* Selección de cantidades a despachar */}
            <div className="space-y-2 border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black uppercase text-slate-700">
                  Cantidades a Despachar
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const todos: Record<string, string> = {};
                    for (const it of detalle.items) {
                      todos[it.productoId] = it.saldoPendiente;
                    }
                    setCantidadesEntrega(todos);
                  }}
                  className="text-xs font-bold text-amber-700 hover:underline"
                >
                  Entregar todo el saldo
                </button>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 font-bold text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="p-2.5">Material</th>
                      <th className="p-2.5 text-right">Saldo Pendiente</th>
                      <th className="p-2.5 text-right">Stock Depósito</th>
                      <th className="p-2.5 text-right w-32">Cant. a Despachar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detalle.items.map((it) => {
                      const saldo = parseFloat(it.saldoPendiente);
                      const stock = parseFloat(it.stockActualDeposito);
                      const valorActual = cantidadesEntrega[it.productoId] ?? '0';

                      return (
                        <tr key={it.id}>
                          <td className="p-2.5">
                            <span className="font-bold text-slate-900 block">
                              {it.productoNombre}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {it.productoCodigo} ({it.unidadPrincipal})
                            </span>
                          </td>
                          <td className="p-2.5 text-right font-black text-amber-800">
                            {saldo.toFixed(2)}
                          </td>
                          <td className="p-2.5 text-right font-medium text-slate-600">
                            {stock.toFixed(2)}
                          </td>
                          <td className="p-2.5 text-right">
                            <input
                              type="number"
                              step="0.001"
                              min="0"
                              max={saldo}
                              value={valorActual}
                              onChange={(e) => { setCantidadesEntrega((prev) => ({
                                  ...prev,
                                  [it.productoId]: e.target.value,
                                })); }
                              }
                              className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-right text-xs font-bold focus:border-amber-500 focus:outline-none"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Acciones */}
            <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => { setModalEntrega(false); }}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={guardandoEntrega}
                onClick={() => void handleConfirmarEntrega()}
                className="rounded-xl bg-emerald-600 px-6 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                {guardandoEntrega ? 'Emitiendo Remito...' : 'Confirmar y Emitir Remito'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
