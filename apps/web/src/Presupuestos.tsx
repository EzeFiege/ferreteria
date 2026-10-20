import { useCallback, useEffect, useState, type ReactElement, type SyntheticEvent } from 'react';
import { formatearPesos } from './App.js';
import { apiUrl } from './api-url.js';
import type {
  ItemCarrito,
  ListaPrecioItem,
} from './App.js';
import type {
  PresupuestoDetalle,
  RolUsuario,
} from '@ferreteria/shared';

export interface PresupuestosProps {
  token: string;
  rolUsuario: RolUsuario;
  listasPrecios: ListaPrecioItem[];
  onCargarAlCarrito?: (items: ItemCarrito[], contactoNombre?: string, presupuestoId?: string) => void;
}

interface ItemFormState {
  productoId?: string;
  codigo: string;
  nombre: string;
  unidad: 'principal' | 'secundaria';
  nombreUnidad: string;
  factorConversion: string;
  permiteFraccion: boolean;
  cantidad: string;
  precioUnitario: string;
  descuentoPct: string;
  subtotal: string;
}

interface ProductoCatalogoItem {
  id: string;
  codigoBarras: string | null;
  nombre: string;
  unidad: 'principal' | 'secundaria';
  unidadMedidaPrincipal: string;
  unidadMedidaSecundaria: string | null;
  factorConversion: string;
  permiteFraccion: boolean;
  costoBase: string;
  precioFinal?: string;
}

export function Presupuestos({
  token,
  rolUsuario,
  listasPrecios,
  onCargarAlCarrito,
}: PresupuestosProps): ReactElement {
  const [presupuestos, setPresupuestos] = useState<PresupuestoDetalle[]>([]);
  const [cargando, setCargando] = useState<boolean>(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // Filtros
  const [filtroEstado, setFiltroEstado] = useState<string>('todos');
  const [busqueda, setBusqueda] = useState<string>('');

  // Modales
  const [modalNuevo, setModalNuevo] = useState<boolean>(false);
  const [presupuestoSeleccionado, setPresupuestoSeleccionado] = useState<PresupuestoDetalle | null>(null);

  // Form nuevo presupuesto
  const [nombreContacto, setNombreContacto] = useState<string>('');
  const [telefonoContacto, setTelefonoContacto] = useState<string>('');
  const [emailContacto, setEmailContacto] = useState<string>('');
  const [diasValidez, setDiasValidez] = useState<number>(15);
  const [listaPrecioId, setListaPrecioId] = useState<string>('');
  const [observaciones, setObservaciones] = useState<string>('');
  const [descuentoGeneral, setDescuentoGeneral] = useState<string>('0.00');
  const [items, setItems] = useState<ItemFormState[]>([]);
  const [guardando, setGuardando] = useState<boolean>(false);

  // Búsqueda de productos en modal
  const [busquedaProducto, setBusquedaProducto] = useState<string>('');
  const [productosSugeridos, setProductosSugeridos] = useState<ProductoCatalogoItem[]>([]);
  const [buscandoProducto, setBuscandoProducto] = useState<boolean>(false);

  const puedeGestionar = rolUsuario === 'dueno' || rolUsuario === 'encargado';

  // 1. Cargar presupuestos
  const cargarPresupuestos = useCallback(async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams();
      if (filtroEstado !== 'todos') {
        params.set('estado', filtroEstado);
      }
      if (busqueda.trim()) {
        params.set('q', busqueda.trim());
      }
      const queryStr = params.toString() ? `?${params.toString()}` : '';

      const res = await fetch(apiUrl(`/presupuestos${queryStr}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as PresupuestoDetalle[];
        setPresupuestos(data);
      }
    } catch {
      setAviso('Error de red al cargar presupuestos');
    } finally {
      setCargando(false);
    }
  }, [token, filtroEstado, busqueda]);

  useEffect(() => {
    void cargarPresupuestos();
  }, [cargarPresupuestos]);

  // 2. Buscar producto de catálogo para agregar al presupuesto
  const buscarProductos = useCallback(
    async (termino: string) => {
      if (!termino.trim()) {
        setProductosSugeridos([]);
        return;
      }
      setBuscandoProducto(true);
      try {
        const res = await fetch(
          apiUrl(`/productos?q=${encodeURIComponent(termino.trim())}`),
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (res.ok) {
          const data = (await res.json()) as ProductoCatalogoItem[];
          setProductosSugeridos(data.slice(0, 8));
        }
      } catch {
        // Ignorar error transitorio
      } finally {
        setBuscandoProducto(false);
      }
    },
    [token],
  );

  const agregarProductoAlPresupuesto = (p: ProductoCatalogoItem): void => {
    // Si la lista de precios seleccionada tiene margen, calculamos el precio sugerido
    const lista = listasPrecios.find((l) => l.id === listaPrecioId);
    let precio = p.costoBase || '100.00';
    if (lista && parseFloat(lista.margenPct) > 0) {
      const costo = parseFloat(p.costoBase) || 0;
      const margen = parseFloat(lista.margenPct) || 0;
      precio = (costo * (1 + margen / 100)).toFixed(2);
    }

    const nuevoItem: ItemFormState = {
      productoId: p.id,
      codigo: p.codigoBarras ?? '',
      nombre: p.nombre,
      unidad: 'principal',
      nombreUnidad: p.unidadMedidaPrincipal || 'unidad',
      factorConversion: p.factorConversion || '1.000',
      permiteFraccion: p.permiteFraccion,
      cantidad: '1.000',
      precioUnitario: precio,
      descuentoPct: '0.00',
      subtotal: precio,
    };

    setItems([...items, nuevoItem]);
    setBusquedaProducto('');
    setProductosSugeridos([]);
  };

  const agregarItemLibre = (): void => {
    const nuevoItem: ItemFormState = {
      codigo: '',
      nombre: 'Artículo de Ferretería',
      unidad: 'principal',
      nombreUnidad: 'unidad',
      factorConversion: '1.000',
      permiteFraccion: true,
      cantidad: '1.000',
      precioUnitario: '1000.00',
      descuentoPct: '0.00',
      subtotal: '1000.00',
    };
    setItems([...items, nuevoItem]);
  };

  const actualizarItem = (
    index: number,
    campo: keyof ItemFormState,
    valor: string,
  ): void => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== index) return it;
        const actualizado = { ...it, [campo]: valor };

        // Recalcular subtotal
        if (
          campo === 'cantidad' ||
          campo === 'precioUnitario' ||
          campo === 'descuentoPct'
        ) {
          const cant = parseFloat(campo === 'cantidad' ? valor : it.cantidad) || 0;
          const pre = parseFloat(campo === 'precioUnitario' ? valor : it.precioUnitario) || 0;
          const desc = parseFloat(campo === 'descuentoPct' ? valor : it.descuentoPct) || 0;
          const sub = (cant * pre * (1 - desc / 100)).toFixed(2);
          actualizado.subtotal = sub;
        }

        return actualizado;
      }),
    );
  };

  const quitarItem = (index: number): void => {
    setItems(items.filter((_, i) => i !== index));
  };

  // Cálculo de totales del presupuesto
  const subtotalPresupuestoCentavos = items.reduce((acc, it) => {
    const val = parseFloat(it.subtotal) || 0;
    return acc + Math.round(val * 100);
  }, 0);

  const descuentoGeneralCentavos = Math.round((parseFloat(descuentoGeneral) || 0) * 100);
  const totalPresupuestoCentavos = Math.max(0, subtotalPresupuestoCentavos - descuentoGeneralCentavos);

  // 3. Guardar presupuesto
  const handleGuardarPresupuesto = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (items.length === 0) {
      setAviso('El presupuesto debe tener al menos un artículo');
      return;
    }

    setGuardando(true);
    setAviso(null);
    try {
      const payload = {
        diasValidez,
        nombreContacto: nombreContacto.trim() || undefined,
        telefonoContacto: telefonoContacto.trim() || undefined,
        emailContacto: emailContacto.trim() || undefined,
        listaPrecioId: listaPrecioId || undefined,
        subtotal: (subtotalPresupuestoCentavos / 100).toFixed(2),
        descuentoGeneral: (descuentoGeneralCentavos / 100).toFixed(2),
        total: (totalPresupuestoCentavos / 100).toFixed(2),
        observaciones: observaciones.trim() || undefined,
        items: items.map((it) => ({
          productoId: it.productoId || undefined,
          codigo: it.codigo.trim() || undefined,
          nombre: it.nombre.trim(),
          unidad: it.nombreUnidad,
          cantidad: (parseFloat(it.cantidad) || 1).toFixed(3),
          precioUnitario: (parseFloat(it.precioUnitario) || 0).toFixed(2),
          descuentoPct: (parseFloat(it.descuentoPct) || 0).toFixed(2),
          subtotal: it.subtotal,
        })),
      };

      const res = await fetch(apiUrl('/presupuestos'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = (await res.json()) as { error?: string };
        setAviso(errorData.error ?? 'Error al guardar el presupuesto');
        return;
      }

      setModalNuevo(false);
      setNombreContacto('');
      setTelefonoContacto('');
      setEmailContacto('');
      setObservaciones('');
      setDescuentoGeneral('0.00');
      setItems([]);
      setAviso('Presupuesto emitido con éxito');
      void cargarPresupuestos();
    } catch {
      setAviso('Error de red al emitir el presupuesto');
    } finally {
      setGuardando(false);
    }
  };

  // 4. Cargar presupuesto al carrito de mostrador
  const handleCargarAlCarrito = (presupuesto: PresupuestoDetalle): void => {
    if (!onCargarAlCarrito) return;

    const itemsCarrito: ItemCarrito[] = presupuesto.items.map((it) => ({
      id: crypto.randomUUID(),
      productoId: it.productoId ?? undefined,
      codigo: it.codigo ?? undefined,
      nombre: it.nombre,
      unidad: 'principal',
      nombreUnidad: it.unidad,
      factorConversion: '1.000',
      permiteFraccion: true,
      cantidad: (parseFloat(it.cantidad) || 1).toString(),
      precioUnitario: it.precioUnitario,
      descuentoPct: it.descuentoPct,
      descuentoMonto: '0.00',
      subtotal: it.subtotal,
    }));

    onCargarAlCarrito(
      itemsCarrito,
      presupuesto.nombreContacto ?? undefined,
      presupuesto.id,
    );
    setPresupuestoSeleccionado(null);
  };

  // 5. Cancelar presupuesto
  const handleCancelarPresupuesto = async (id: string): Promise<void> => {
    if (!confirm('¿Seguro que deseás cancelar este presupuesto?')) return;
    try {
      const res = await fetch(apiUrl(`/presupuestos/${id}/cancelar`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setAviso('Presupuesto cancelado');
        void cargarPresupuestos();
      }
    } catch {
      setAviso('Error al cancelar el presupuesto');
    }
  };

  // 6. Ver detalle completo
  const verDetallePresupuesto = async (p: PresupuestoDetalle): Promise<void> => {
    try {
      const res = await fetch(apiUrl(`/presupuestos/${p.id}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const full = (await res.json()) as PresupuestoDetalle;
        setPresupuestoSeleccionado(full);
      } else {
        setPresupuestoSeleccionado(p);
      }
    } catch {
      setPresupuestoSeleccionado(p);
    }
  };

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-900">
              Presupuestos y Cotizaciones de Mostrador
            </h2>
            <span className="rounded-full bg-blue-100 px-3 py-0.5 text-xs font-semibold text-blue-800">
              Cotizaciones de Obra
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Armá presupuestos para clientes y gremios con fecha de vencimiento y convertilos directamente en ventas de mostrador con un solo clic.
          </p>
        </div>

        <div>
          <button
            type="button"
            data-testid="btn-nuevo-presupuesto"
            onClick={() => {
              setModalNuevo(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <span>+</span>
            <span>Nuevo Presupuesto</span>
          </button>
        </div>
      </div>

      {aviso && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
        >
          <span>{aviso}</span>
          <button
            type="button"
            onClick={() => {
              setAviso(null);
            }}
            className="text-xs font-bold uppercase underline"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Barra de Filtros */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="w-48">
          <label htmlFor="filtro-estado-presupuesto" className="block text-xs font-medium text-slate-700">
            Estado
          </label>
          <select
            id="filtro-estado-presupuesto"
            value={filtroEstado}
            onChange={(e) => {
              setFiltroEstado(e.target.value);
            }}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
          >
            <option value="todos">Todos los estados</option>
            <option value="pendiente">Pendientes (Vigentes)</option>
            <option value="aprobado_convertido">Aprobados / Vendidos</option>
            <option value="vencido">Vencidos</option>
            <option value="cancelado">Cancelados</option>
          </select>
        </div>

        <div className="flex-1 min-w-[220px]">
          <label htmlFor="busqueda-presupuesto" className="block text-xs font-medium text-slate-700">
            Buscar por contacto, detalle o Nº
          </label>
          <input
            id="busqueda-presupuesto"
            type="text"
            placeholder="Ej. Arq. Gómez o refacción baño..."
            value={busqueda}
            onChange={(e) => {
              setBusqueda(e.target.value);
            }}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>

        <div className="flex items-end pt-5">
          <button
            type="button"
            onClick={() => {
              void cargarPresupuestos();
            }}
            className="rounded-md bg-slate-800 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"
          >
            Buscar
          </button>
        </div>
      </div>

      {/* Tabla de presupuestos */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {cargando ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Cargando presupuestos...
          </div>
        ) : presupuestos.length === 0 ? (
          <div className="p-10 text-center text-slate-600">
            <p className="font-semibold">No se encontraron presupuestos registrados.</p>
            <p className="mt-1 text-xs text-slate-500">
              Creá una nueva cotización de materiales con el botón superior.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-4 py-3 font-semibold">Nº Presupuesto</th>
                  <th className="px-4 py-3 font-semibold">Fecha Emisión</th>
                  <th className="px-4 py-3 font-semibold">Vencimiento</th>
                  <th className="px-4 py-3 font-semibold">Contacto / Cliente</th>
                  <th className="px-4 py-3 font-semibold">Observaciones</th>
                  <th className="px-4 py-3 text-right font-semibold">Total Cotizado</th>
                  <th className="px-4 py-3 text-center font-semibold">Estado</th>
                  <th className="px-4 py-3 text-right font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-sans text-slate-800">
                {presupuestos.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-mono font-bold text-blue-700">
                      #{p.numero.toString().padStart(5, '0')}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {new Date(p.fechaEmision).toLocaleDateString('es-AR')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-slate-700">
                          {p.fechaVencimiento}
                        </span>
                        {p.estaVencido ? (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-800">
                            Vencido
                          </span>
                        ) : p.estado === 'pendiente' ? (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                            Vigente
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {p.nombreContacto || 'Consumidor'}
                      {p.telefonoContacto && (
                        <div className="text-[11px] font-normal text-slate-500">
                          Tel: {p.telefonoContacto}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-xs truncate">
                      {p.observaciones || '-'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                      {formatearPesos(p.total)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                          p.estado === 'aprobado_convertido'
                            ? 'bg-emerald-100 text-emerald-800'
                            : p.estado === 'cancelado'
                            ? 'bg-slate-200 text-slate-700'
                            : p.estaVencido
                            ? 'bg-red-100 text-red-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {p.estado === 'aprobado_convertido'
                          ? 'Vendido ✓'
                          : p.estado === 'cancelado'
                          ? 'Cancelado'
                          : p.estaVencido
                          ? 'Vencido'
                          : 'Pendiente'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            void verDetallePresupuesto(p);
                          }}
                          className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Ver
                        </button>
                        {p.estado === 'pendiente' && onCargarAlCarrito && (
                          <button
                            type="button"
                            onClick={() => {
                              void verDetallePresupuesto(p).then(() => {
                                handleCargarAlCarrito(p);
                              });
                            }}
                            className="rounded bg-emerald-600 px-2 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
                            title="Cargar al carrito de mostrador y facturar"
                          >
                            Vender 🛒
                          </button>
                        )}
                        {p.estado === 'pendiente' && puedeGestionar && (
                          <button
                            type="button"
                            onClick={() => {
                              void handleCancelarPresupuesto(p.id);
                            }}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                            title="Cancelar cotización"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: NUEVO PRESUPUESTO */}
      {modalNuevo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[95vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Confeccionar Nuevo Presupuesto de Mostrador
                </h3>
                <p className="text-xs text-slate-500">
                  Seleccioná artículos del catálogo o agregá materiales libres con precio pactado.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setModalNuevo(false);
                }}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={(e) => {
                void handleGuardarPresupuesto(e);
              }}
              className="mt-4 space-y-4"
            >
              {/* Datos de contacto y condiciones */}
              <div className="grid gap-3 sm:grid-cols-4">
                <div>
                  <label htmlFor="contacto-presupuesto" className="block text-xs font-medium text-slate-700">
                    Cliente / Contacto
                  </label>
                  <input
                    id="contacto-presupuesto"
                    type="text"
                    placeholder="Ej. Juan Pérez o Constructora"
                    value={nombreContacto}
                    onChange={(e) => {
                      setNombreContacto(e.target.value);
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="telefono-presupuesto" className="block text-xs font-medium text-slate-700">
                    Teléfono / WhatsApp
                  </label>
                  <input
                    id="telefono-presupuesto"
                    type="text"
                    placeholder="Ej. 11-4455-6677"
                    value={telefonoContacto}
                    onChange={(e) => {
                      setTelefonoContacto(e.target.value);
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="validez-presupuesto" className="block text-xs font-medium text-slate-700">
                    Validez de Precios
                  </label>
                  <select
                    id="validez-presupuesto"
                    value={diasValidez}
                    onChange={(e) => {
                      setDiasValidez(Number(e.target.value));
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
                  >
                    <option value={7}>7 días</option>
                    <option value={15}>15 días (estándar)</option>
                    <option value={30}>30 días (obra)</option>
                    <option value={60}>60 días</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="lista-precio-presupuesto" className="block text-xs font-medium text-slate-700">
                    Lista de Precios Base
                  </label>
                  <select
                    id="lista-precio-presupuesto"
                    value={listaPrecioId}
                    onChange={(e) => {
                      setListaPrecioId(e.target.value);
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
                  >
                    <option value="">Lista Estándar</option>
                    {listasPrecios.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nombre} (+{l.margenPct}%)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Buscador de artículos de catálogo */}
              <div className="relative rounded-lg border border-blue-200 bg-blue-50/50 p-3">
                <label htmlFor="buscar-producto-presupuesto" className="block text-xs font-bold text-blue-900 uppercase tracking-wide">
                  Buscar artículo en catálogo para cotizar
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="buscar-producto-presupuesto"
                    type="text"
                    placeholder="Escribí código de barras o nombre del producto..."
                    value={busquedaProducto}
                    onChange={(e) => {
                      setBusquedaProducto(e.target.value);
                      void buscarProductos(e.target.value);
                    }}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
                  />
                  <button
                    type="button"
                    onClick={agregarItemLibre}
                    className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    + Ítem Libre
                  </button>
                </div>

                {/* Sugerencias de productos */}
                {productosSugeridos.length > 0 && (
                  <div className="absolute left-3 right-3 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                    {productosSugeridos.map((prod) => (
                      <div
                        key={prod.id}
                        onClick={() => {
                          agregarProductoAlPresupuesto(prod);
                        }}
                        className="flex cursor-pointer items-center justify-between rounded p-2 text-xs hover:bg-blue-50"
                      >
                        <div>
                          <span className="font-semibold text-slate-900">{prod.nombre}</span>
                          <span className="ml-2 font-mono text-[11px] text-slate-500">
                            {prod.codigoBarras ? `[${prod.codigoBarras}]` : ''}
                          </span>
                        </div>
                        <div className="font-mono font-bold text-blue-700">
                          Base: {formatearPesos(prod.costoBase)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {buscandoProducto && (
                  <div className="mt-1 text-xs text-slate-500">Buscando artículos...</div>
                )}
              </div>

              {/* Grilla de Ítems */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                  Artículos Cotizados ({items.length})
                </span>

                {items.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-slate-500">
                    No agregaste artículos aún. Buscá un producto del catálogo o agregá un ítem libre.
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto space-y-2">
                    {items.map((it, idx) => (
                      <div
                        key={`item-${idx}`}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs"
                      >
                        <div className="flex-1 min-w-[200px]">
                          <input
                            type="text"
                            required
                            placeholder="Descripción del material"
                            value={it.nombre}
                            onChange={(e) => {
                              actualizarItem(idx, 'nombre', e.target.value);
                            }}
                            className="w-full rounded border border-slate-300 px-2 py-1 font-medium"
                          />
                        </div>

                        <div className="w-20">
                          <input
                            type="text"
                            placeholder="Unidad"
                            value={it.nombreUnidad}
                            onChange={(e) => {
                              actualizarItem(idx, 'nombreUnidad', e.target.value);
                            }}
                            className="w-full rounded border border-slate-300 px-2 py-1 text-center"
                          />
                        </div>

                        <div className="w-24">
                          <input
                            type="text"
                            required
                            placeholder="Cantidad"
                            value={it.cantidad}
                            onChange={(e) => {
                              actualizarItem(idx, 'cantidad', e.target.value);
                            }}
                            className="w-full rounded border border-slate-300 px-2 py-1 text-right font-mono"
                          />
                        </div>

                        <div className="w-28">
                          <input
                            type="text"
                            required
                            placeholder="Precio Unit."
                            value={it.precioUnitario}
                            onChange={(e) => {
                              actualizarItem(idx, 'precioUnitario', e.target.value);
                            }}
                            className="w-full rounded border border-slate-300 px-2 py-1 text-right font-mono"
                          />
                        </div>

                        <div className="w-20">
                          <input
                            type="text"
                            placeholder="Desc %"
                            value={it.descuentoPct}
                            onChange={(e) => {
                              actualizarItem(idx, 'descuentoPct', e.target.value);
                            }}
                            className="w-full rounded border border-slate-300 px-2 py-1 text-right font-mono"
                          />
                        </div>

                        <div className="w-28 text-right font-mono font-bold text-slate-900">
                          {formatearPesos(it.subtotal)}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            quitarItem(idx);
                          }}
                          className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-red-600"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Observaciones y Totales */}
              <div className="grid gap-4 border-t border-slate-200 pt-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="observaciones-presupuesto" className="block text-xs font-medium text-slate-700">
                    Observaciones y Condiciones (Entrega, forma de pago, acopio)
                  </label>
                  <textarea
                    id="observaciones-presupuesto"
                    rows={3}
                    placeholder="Ej. Precios sujetos a modificación sin previo aviso. Flete a convenir."
                    value={observaciones}
                    onChange={(e) => {
                      setObservaciones(e.target.value);
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs"
                  />
                </div>

                <div className="flex flex-col justify-end space-y-2 rounded-lg bg-slate-50 p-3 font-mono text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal Artículos:</span>
                    <span className="font-semibold text-slate-900">
                      {formatearPesos((subtotalPresupuestoCentavos / 100).toFixed(2))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Descuento General ($):</span>
                    <input
                      type="text"
                      value={descuentoGeneral}
                      onChange={(e) => {
                        setDescuentoGeneral(e.target.value);
                      }}
                      className="w-24 rounded border border-slate-300 px-2 py-0.5 text-right font-mono text-xs"
                    />
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-1 text-sm font-bold text-slate-900">
                    <span>Total Presupuestado:</span>
                    <span className="text-blue-700">
                      {formatearPesos((totalPresupuestoCentavos / 100).toFixed(2))}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setModalNuevo(false);
                  }}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardando || items.length === 0}
                  className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {guardando ? 'Guardando...' : 'Emitir Presupuesto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: VER DETALLE DEL PRESUPUESTO */}
      {presupuestoSeleccionado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-3">
                <span className="rounded bg-blue-700 px-2.5 py-1 font-mono text-xs font-bold text-white">
                  PRESUPUESTO #{presupuestoSeleccionado.numero.toString().padStart(5, '0')}
                </span>
                <span className="text-xs text-slate-500">
                  Emitido: {new Date(presupuestoSeleccionado.fechaEmision).toLocaleDateString('es-AR')}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPresupuestoSeleccionado(null);
                }}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              {/* Encabezado */}
              <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3">
                <div>
                  <span className="font-semibold text-slate-700">Cliente / Contacto: </span>
                  <span className="text-slate-900 font-medium">
                    {presupuestoSeleccionado.nombreContacto || 'Consumidor Final'}
                  </span>
                  {presupuestoSeleccionado.telefonoContacto && (
                    <div className="text-slate-500">
                      Tel: {presupuestoSeleccionado.telefonoContacto}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <span className="font-semibold text-slate-700">Validez hasta: </span>
                  <span className="font-mono font-bold text-slate-900">
                    {presupuestoSeleccionado.fechaVencimiento}
                  </span>
                  <div>
                    {presupuestoSeleccionado.estaVencido ? (
                      <span className="text-red-700 font-bold">Cotización Vencida</span>
                    ) : (
                      <span className="text-emerald-700 font-semibold">Cotización Vigente</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Artículos */}
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 font-semibold text-slate-700">
                    <tr>
                      <th className="px-3 py-2">Material / Artículo</th>
                      <th className="px-3 py-2 text-center">Unidad</th>
                      <th className="px-3 py-2 text-right">Cantidad</th>
                      <th className="px-3 py-2 text-right">Precio Unit.</th>
                      <th className="px-3 py-2 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono text-slate-800">
                    {presupuestoSeleccionado.items.map((it) => (
                      <tr key={it.id}>
                        <td className="px-3 py-2 font-sans font-medium text-slate-900">
                          {it.nombre}
                          {it.notas && <span className="ml-1 text-slate-500">({it.notas})</span>}
                        </td>
                        <td className="px-3 py-2 text-center font-sans">{it.unidad}</td>
                        <td className="px-3 py-2 text-right">{it.cantidad}</td>
                        <td className="px-3 py-2 text-right">{formatearPesos(it.precioUnitario)}</td>
                        <td className="px-3 py-2 text-right font-bold text-slate-900">
                          {formatearPesos(it.subtotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-bold text-slate-900">
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-right font-sans">
                        Total Presupuesto:
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-blue-700 text-sm">
                        {formatearPesos(presupuestoSeleccionado.total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {presupuestoSeleccionado.observaciones && (
                <div className="rounded-lg border border-slate-200 p-3 text-slate-600">
                  <span className="font-semibold text-slate-700">Observaciones: </span>
                  {presupuestoSeleccionado.observaciones}
                </div>
              )}

              {/* Botones de acción */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    window.print();
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Imprimir Comprobante 🖨
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPresupuestoSeleccionado(null);
                    }}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cerrar
                  </button>

                  {presupuestoSeleccionado.estado === 'pendiente' && onCargarAlCarrito && (
                    <button
                      type="button"
                      onClick={() => {
                        handleCargarAlCarrito(presupuestoSeleccionado);
                      }}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700"
                    >
                      Cargar en Carrito y Vender 🛒
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
