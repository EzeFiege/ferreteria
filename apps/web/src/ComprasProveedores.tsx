import { useCallback, useEffect, useState, type ReactElement, type SyntheticEvent } from 'react';
import { formatearPesos } from './App.js';
import { apiUrl } from './api-url.js';
import { ReabastecimientoInteligente } from './ReabastecimientoInteligente.js';
import { formatearMensajeOrdenCompra, generarLinkWhatsApp, type CondicionIva, type RolUsuario } from '@ferreteria/shared';

export interface ProveedorItem {
  id: string;
  codigo: string;
  razonSocial: string;
  nombreFantasia: string | null;
  cuit: string | null;
  condicionIva: CondicionIva;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  contactoNombre: string | null;
  contactoTelefono: string | null;
  diasPlazoPago: number;
  activo: boolean;
  totalCompras: string;
  totalPagos: string;
  saldoDeudor: string;
}

export interface OrdenCompraItem {
  id: string;
  numero: string;
  proveedorId: string;
  proveedorRazonSocial?: string;
  proveedorCodigo?: string;
  estado: 'borrador' | 'enviada' | 'recibida' | 'cancelada';
  condicionPago: 'contado' | 'cuenta_corriente';
  subtotal: string;
  total: string;
  notas: string | null;
  creadoEn: string;
  recibidoEn?: string | null;
  items?: Array<{
    id: string;
    productoId: string | null;
    codigoBarra?: string | null;
    descripcion: string;
    unidadMedida: string;
    cantidadPedida: string;
    cantidadRecibida: string;
    costoUnitario: string;
    subtotal: string;
  }>;
}

export interface MovimientoCtaCteProveedorItem {
  id: string;
  tipo: string;
  sentido: 'debito' | 'credito';
  monto: string;
  descripcion: string | null;
  ordenCompraId: string | null;
  movimientoCajaId: string | null;
  creadoEn: string;
  usuarioNombre: string | null;
}

export interface ComprasProveedoresProps {
  token: string;
  rolUsuario: RolUsuario;
  turnoAbiertoId: string | null;
  mediosPago: Array<{ id: string; nombre: string; esEfectivo: boolean }>;
  onPagoRegistrado?: () => void;
}

export function ComprasProveedores({
  token,
  rolUsuario,
  turnoAbiertoId,
  mediosPago,
  onPagoRegistrado,
}: ComprasProveedoresProps): ReactElement {
  const [seccion, setSeccion] = useState<'proveedores' | 'ordenes' | 'reabastecimiento'>('proveedores');
  const [proveedores, setProveedores] = useState<ProveedorItem[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenCompraItem[]>([]);
  const [cargando, setCargando] = useState<boolean>(false);
  const [busqueda, setBusqueda] = useState<string>('');
  const [soloConDeuda, setSoloConDeuda] = useState<boolean>(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // Modales
  const [modalProveedorAbierto, setModalProveedorAbierto] = useState<boolean>(false);
  const [proveedorEnEdicion, setProveedorEnEdicion] = useState<ProveedorItem | null>(null);

  const [modalPagoAbierto, setModalPagoAbierto] = useState<boolean>(false);
  const [proveedorParaPago, setProveedorParaPago] = useState<ProveedorItem | null>(null);
  const [pagoMonto, setPagoMonto] = useState<string>('');
  const [pagoMedioId, setPagoMedioId] = useState<string>('');
  const [pagoDescripcion, setPagoDescripcion] = useState<string>('');
  const [guardandoPago, setGuardandoPago] = useState<boolean>(false);

  const [proveedorSeleccionadoFicha, setProveedorSeleccionadoFicha] = useState<ProveedorItem | null>(null);
  const [extractoCtaCte, setExtractoCtaCte] = useState<MovimientoCtaCteProveedorItem[]>([]);
  const [cargandoExtracto, setCargandoExtracto] = useState<boolean>(false);

  // Modal Orden de Compra
  const [modalOCAbierto, setModalOCAbierto] = useState<boolean>(false);
  const [ocNumero, setOcNumero] = useState<string>('');
  const [ocProveedorId, setOcProveedorId] = useState<string>('');
  const [ocCondicionPago, setOcCondicionPago] = useState<'contado' | 'cuenta_corriente'>('cuenta_corriente');
  const [ocNotas, setOcNotas] = useState<string>('');
  const [ocItems, setOcItems] = useState<
    Array<{
      productoId: string | null;
      descripcion: string;
      cantidadPedida: string;
      costoUnitario: string;
      subtotal: string;
    }>
  >([
    {
      productoId: null,
      descripcion: '',
      cantidadPedida: '1',
      costoUnitario: '0.00',
      subtotal: '0.00',
    },
  ]);
  const [guardandoOC, setGuardandoOC] = useState<boolean>(false);

  // Modal Recepción de Orden de Compra
  const [modalRecepcionAbierto, setModalRecepcionAbierto] = useState<boolean>(false);
  const [ocParaRecepcion, setOcParaRecepcion] = useState<OrdenCompraItem | null>(null);
  const [actualizarCostoBase, setActualizarCostoBase] = useState<boolean>(true);
  const [itemsRecibidosCantidades, setItemsRecibidosCantidades] = useState<Record<string, string>>({});
  const [recibiendoOC, setRecibiendoOC] = useState<boolean>(false);

  // Cargar Proveedores
  const cargarProveedores = useCallback(async () => {
    setCargando(true);
    setAviso(null);
    try {
      const params = new URLSearchParams();
      if (busqueda.trim()) params.set('q', busqueda.trim());
      if (soloConDeuda) params.set('soloConDeuda', 'true');

      const res = await fetch(apiUrl(`/proveedores?${params.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error('No se pudo cargar la lista de proveedores.');
      }
      const data = (await res.json()) as ProveedorItem[];
      setProveedores(data);
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Error al cargar proveedores.');
    } finally {
      setCargando(false);
    }
  }, [busqueda, soloConDeuda, token]);

  // Cargar Órdenes de Compra
  const cargarOrdenes = useCallback(async () => {
    setCargando(true);
    setAviso(null);
    try {
      const res = await fetch(apiUrl('/compras'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error('No se pudo cargar las órdenes de compra.');
      }
      const data = (await res.json()) as OrdenCompraItem[];
      setOrdenes(data);
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Error al cargar órdenes de compra.');
    } finally {
      setCargando(false);
    }
  }, [token]);

  // Cargar Extracto de Cuenta Corriente del Proveedor
  const cargarExtractoProveedor = useCallback(async (provId: string) => {
    setCargandoExtracto(true);
    try {
      const res = await fetch(apiUrl(`/proveedores/${provId}/cuenta-corriente`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error('No se pudo cargar el extracto de cuenta corriente.');
      }
      const data = (await res.json()) as {
        movimientos: MovimientoCtaCteProveedorItem[];
        saldoDeudor: string;
      };
      setExtractoCtaCte(data.movimientos);
      setProveedorSeleccionadoFicha((prev) =>
        prev ? { ...prev, saldoDeudor: data.saldoDeudor } : null,
      );
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Error al cargar extracto.');
    } finally {
      setCargandoExtracto(false);
    }
  }, [token]);

  useEffect(() => {
    if (seccion === 'proveedores') {
      void cargarProveedores();
    } else {
      void cargarOrdenes();
    }
  }, [seccion, cargarProveedores, cargarOrdenes]);

  // Manejar Pago a Proveedor
  const handleRegistrarPago = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (!proveedorParaPago || !turnoAbiertoId) return;

    const montoNum = parseFloat(pagoMonto);
    if (isNaN(montoNum) || montoNum <= 0) {
      setAviso('El monto del pago debe ser mayor a cero.');
      return;
    }

    setGuardandoPago(true);
    setAviso(null);
    try {
      const res = await fetch(apiUrl(`/proveedores/${proveedorParaPago.id}/pagos`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          turnoId: turnoAbiertoId,
          medioPagoId: pagoMedioId || mediosPago[0]?.id,
          monto: montoNum.toFixed(2),
          descripcion: pagoDescripcion.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(errorData.message ?? 'Error al registrar pago a proveedor.');
      }

      setModalPagoAbierto(false);
      setProveedorParaPago(null);
      setPagoMonto('');
      setPagoDescripcion('');
      void cargarProveedores();
      if (proveedorSeleccionadoFicha?.id === proveedorParaPago.id) {
        void cargarExtractoProveedor(proveedorParaPago.id);
      }
      onPagoRegistrado?.();
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Error al registrar el pago.');
    } finally {
      setGuardandoPago(false);
    }
  };

  // Crear Orden de Compra
  const handleGuardarOC = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (!ocProveedorId) {
      setAviso('Debes seleccionar un proveedor para la orden de compra.');
      return;
    }

    const itemsValidos = ocItems.filter(
      (it) => it.descripcion.trim().length > 0 && parseFloat(it.cantidadPedida) > 0,
    );
    if (itemsValidos.length === 0) {
      setAviso('Debes ingresar al menos un ítem con descripción y cantidad mayor a cero.');
      return;
    }

    const totalCalculado = itemsValidos
      .reduce((acc, it) => acc + (parseFloat(it.subtotal) || 0), 0)
      .toFixed(2);

    setGuardandoOC(true);
    setAviso(null);
    try {
      const res = await fetch(apiUrl('/compras'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          numero: ocNumero.trim() || undefined,
          proveedorId: ocProveedorId,
          condicionPago: ocCondicionPago,
          total: totalCalculado,
          notas: ocNotas.trim() || undefined,
          items: itemsValidos.map((it) => ({
            productoId: it.productoId || undefined,
            descripcion: it.descripcion.trim(),
            cantidadPedida: parseFloat(it.cantidadPedida).toFixed(3),
            costoUnitario: (parseFloat(it.costoUnitario) || 0).toFixed(2),
            subtotal: (parseFloat(it.subtotal) || 0).toFixed(2),
          })),
        }),
      });

      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(errorData.message ?? 'Error al crear la orden de compra.');
      }

      setModalOCAbierto(false);
      setOcNumero('');
      setOcProveedorId('');
      setOcNotas('');
      setOcItems([
        {
          productoId: null,
          descripcion: '',
          cantidadPedida: '1',
          costoUnitario: '0.00',
          subtotal: '0.00',
        },
      ]);
      void cargarOrdenes();
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Error al guardar la orden de compra.');
    } finally {
      setGuardandoOC(false);
    }
  };

  // Recibir Orden de Compra (Impacta Stock en Kardex y Cuenta Corriente)
  const handleRecibirOC = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (!ocParaRecepcion) return;

    setRecibiendoOC(true);
    setAviso(null);
    try {
      const itemsRecibidos = (ocParaRecepcion.items ?? []).map((it) => ({
        productoId: it.productoId || undefined,
        cantidadRecibida: parseFloat(itemsRecibidosCantidades[it.id] ?? it.cantidadPedida).toFixed(3),
        costoUnitario: it.costoUnitario,
      }));

      const res = await fetch(apiUrl(`/compras/${ocParaRecepcion.id}/recibir`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          actualizarCostoBase,
          itemsRecibidos,
        }),
      });

      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(errorData.message ?? 'Error al registrar recepción de mercadería.');
      }

      setModalRecepcionAbierto(false);
      setOcParaRecepcion(null);
      void cargarOrdenes();
      void cargarProveedores();
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Error al recibir mercadería.');
    } finally {
      setRecibiendoOC(false);
    }
  };

  // Abrir Modal de Recepción
  const abrirModalRecepcion = (oc: OrdenCompraItem): void => {
    setOcParaRecepcion(oc);
    const cantInicial: Record<string, string> = {};
    (oc.items ?? []).forEach((it) => {
      cantInicial[it.id] = it.cantidadPedida;
    });
    setItemsRecibidosCantidades(cantInicial);
    setModalRecepcionAbierto(true);
  };

  return (
    <div className="space-y-6">
      {/* Barra Superior de Notificaciones */}
      {aviso && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm flex items-center justify-between">
          <span>{aviso}</span>
          <button
            type="button"
            onClick={() => {
              setAviso(null);
            }}
            className="text-amber-700 font-bold hover:underline"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Selector de Subsección: Proveedores vs Órdenes de Compra */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="tab-sub-proveedores"
            onClick={() => {
              setSeccion('proveedores');
            }}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
              seccion === 'proveedores'
                ? 'bg-slate-900 text-white shadow'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            🏢 Directorio y Cuentas a Pagar
          </button>
          <button
            type="button"
            data-testid="tab-sub-reabastecimiento"
            onClick={() => {
              setSeccion('reabastecimiento');
            }}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
              seccion === 'reabastecimiento'
                ? 'bg-emerald-600 text-white shadow'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            🤖 Reabastecimiento Inteligente
          </button>
          <button
            type="button"
            data-testid="tab-sub-ordenes"
            onClick={() => {
              setSeccion('ordenes');
            }}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
              seccion === 'ordenes'
                ? 'bg-slate-900 text-white shadow'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            📦 Órdenes de Compra y Recepción
          </button>
        </div>

        {/* Acciones principales según sección */}
        <div className="flex gap-2">
          {seccion === 'proveedores' ? (
            <button
              type="button"
              data-testid="btn-nuevo-proveedor"
              onClick={() => {
                setProveedorEnEdicion(null);
                setModalProveedorAbierto(true);
              }}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-emerald-700"
            >
              + Nuevo Proveedor
            </button>
          ) : (
            <button
              type="button"
              data-testid="btn-nueva-oc"
              onClick={() => {
                setModalOCAbierto(true);
              }}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-indigo-700"
            >
              + Nueva Orden de Compra
            </button>
          )}
        </div>
      </div>

      {/* SECCIÓN 1: PROVEEDORES Y CUENTAS A PAGAR */}
      {seccion === 'proveedores' && (
        <div className="space-y-6">
          {/* Filtros y Búsqueda */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div className="md:col-span-2">
              <label htmlFor="input-busqueda-prov" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Buscar por razón social, CUIT o contacto
              </label>
              <div className="flex gap-2">
                <input
                  id="input-busqueda-prov"
                  type="text"
                  value={busqueda}
                  onChange={(e) => {
                    setBusqueda(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void cargarProveedores();
                  }}
                  placeholder="Ej: Loma Negra, 30-50..., Martín"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    void cargarProveedores();
                  }}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
                >
                  Buscar
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-6">
              <input
                id="check-solo-deuda"
                type="checkbox"
                checked={soloConDeuda}
                onChange={(e) => {
                  setSoloConDeuda(e.target.checked);
                }}
                className="h-4 w-4 rounded border-slate-300 text-slate-800 focus:ring-slate-800"
              />
              <label htmlFor="check-solo-deuda" className="text-sm font-medium text-slate-700 cursor-pointer">
                Solo proveedores con deuda pendiente
              </label>
            </div>
          </div>

          {/* Listado y Ficha en 2 Columnas */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Columna Izquierda: Tabla de Proveedores */}
            <div className={`space-y-4 ${proveedorSeleccionadoFicha ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-left text-sm text-slate-600">
                  <thead className="bg-slate-100 text-xs font-semibold uppercase text-slate-700 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3">Cód / Proveedor</th>
                      <th className="px-4 py-3">CUIT / Condición</th>
                      <th className="px-4 py-3">Contacto</th>
                      <th className="px-4 py-3 text-right">Saldo Deudor</th>
                      <th className="px-4 py-3 text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {cargando ? (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-slate-500">
                          Cargando proveedores...
                        </td>
                      </tr>
                    ) : proveedores.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-slate-500">
                          No se encontraron proveedores registrados.
                        </td>
                      </tr>
                    ) : (
                      proveedores.map((prov) => {
                        const tieneDeuda = parseFloat(prov.saldoDeudor) > 0;
                        const esSeleccionado = proveedorSeleccionadoFicha?.id === prov.id;
                        return (
                          <tr
                            key={prov.id}
                            className={`hover:bg-slate-50 transition ${
                              esSeleccionado ? 'bg-amber-50/60 font-medium' : ''
                            }`}
                          >
                            <td className="px-4 py-3">
                              <div className="font-bold text-slate-900">{prov.razonSocial}</div>
                              <div className="text-xs text-slate-500 font-mono">
                                {prov.codigo} {prov.nombreFantasia ? `• ${prov.nombreFantasia}` : ''}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div>{prov.cuit ?? '—'}</div>
                              <div className="text-xs text-slate-500 capitalize">
                                {prov.condicionIva.replace('_', ' ')}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs">
                              {prov.contactoNombre ? (
                                <div>
                                  <span className="font-medium text-slate-800">{prov.contactoNombre}</span>
                                  {prov.telefono && <div>📞 {prov.telefono}</div>}
                                </div>
                              ) : (
                                <span>{prov.telefono ?? '—'}</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span
                                className={`font-mono font-bold ${
                                  tieneDeuda ? 'text-rose-600' : 'text-slate-700'
                                }`}
                              >
                                {formatearPesos(prov.saldoDeudor)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  type="button"
                                  data-testid={`btn-ver-cta-cte-${prov.id}`}
                                  onClick={() => {
                                    setProveedorSeleccionadoFicha(prov);
                                    void cargarExtractoProveedor(prov.id);
                                  }}
                                  className="rounded bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                                >
                                  Cta. Cte.
                                </button>
                                <button
                                  type="button"
                                  data-testid={`btn-pagar-${prov.id}`}
                                  onClick={() => {
                                    setProveedorParaPago(prov);
                                    setPagoMonto(prov.saldoDeudor !== '0.00' ? prov.saldoDeudor : '');
                                    setPagoMedioId(mediosPago[0]?.id ?? '');
                                    setModalPagoAbierto(true);
                                  }}
                                  className="rounded bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                                >
                                  Pagar
                                </button>
                                {rolUsuario !== 'cajero' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setProveedorEnEdicion(prov);
                                      setModalProveedorAbierto(true);
                                    }}
                                    className="rounded p-1 text-slate-400 hover:text-slate-700"
                                    title="Editar datos"
                                  >
                                    ✏️
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Columna Derecha: Ficha y Extracto de Cta Cte del Proveedor */}
            {proveedorSeleccionadoFicha && (
              <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-bold text-slate-900">{proveedorSeleccionadoFicha.razonSocial}</h3>
                    <p className="text-xs text-slate-500 font-mono">
                      {proveedorSeleccionadoFicha.codigo} • CUIT: {proveedorSeleccionadoFicha.cuit ?? '—'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setProveedorSeleccionadoFicha(null);
                    }}
                    className="text-xs font-semibold text-slate-400 hover:text-slate-600"
                  >
                    ✕ Cerrar
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 text-center bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <div>
                    <span className="block text-xs font-medium text-slate-500">Total Comprado</span>
                    <span className="font-bold text-slate-800 font-mono">
                      {formatearPesos(proveedorSeleccionadoFicha.totalCompras)}
                    </span>
                  </div>
                  <div>
                    <span className="block text-xs font-medium text-slate-500">Saldo a Pagar</span>
                    <span className="font-bold text-rose-600 font-mono text-base">
                      {formatearPesos(proveedorSeleccionadoFicha.saldoDeudor)}
                    </span>
                  </div>
                </div>

                {/* Extracto Inmutable */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                    Extracto de Cuenta Corriente (Inmutable)
                  </h4>
                  {cargandoExtracto ? (
                    <div className="text-center py-4 text-xs text-slate-400">Cargando movimientos...</div>
                  ) : extractoCtaCte.length === 0 ? (
                    <div className="text-center py-4 text-xs text-slate-400">Sin movimientos registrados.</div>
                  ) : (
                    <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                      {extractoCtaCte.map((mov) => {
                        const esDebito = mov.sentido === 'debito';
                        return (
                          <div
                            key={mov.id}
                            className={`p-2.5 rounded-lg border text-xs flex justify-between items-center ${
                              esDebito
                                ? 'bg-amber-50/40 border-amber-200'
                                : 'bg-emerald-50/40 border-emerald-200'
                            }`}
                          >
                            <div>
                              <div className="font-semibold text-slate-800">
                                {mov.tipo === 'compra'
                                  ? '📦 Compra Mercadería'
                                  : mov.tipo === 'pago'
                                  ? '💵 Pago Realizado'
                                  : '⚙️ Ajuste Saldo'}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {new Date(mov.creadoEn).toLocaleDateString('es-AR')}{' '}
                                {mov.descripcion ? `• ${mov.descripcion}` : ''}
                              </div>
                            </div>
                            <div className="text-right">
                              <span
                                className={`font-mono font-bold ${
                                  esDebito ? 'text-amber-800' : 'text-emerald-700'
                                }`}
                              >
                                {esDebito ? '+' : '-'} {formatearPesos(mov.monto)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECCIÓN 2: ÓRDENES DE COMPRA Y RECEPCIÓN */}
      {seccion === 'ordenes' && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-100 text-xs font-semibold uppercase text-slate-700 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Número / Fecha</th>
                  <th className="px-4 py-3">Proveedor</th>
                  <th className="px-4 py-3">Condición</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {cargando ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">
                      Cargando órdenes de compra...
                    </td>
                  </tr>
                ) : ordenes.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">
                      No hay órdenes de compra registradas.
                    </td>
                  </tr>
                ) : (
                  ordenes.map((oc) => (
                    <tr key={oc.id} className="hover:bg-slate-50 transition">
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">{oc.numero}</div>
                        <div className="text-xs text-slate-500">
                          {new Date(oc.creadoEn).toLocaleDateString('es-AR')}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{oc.proveedorRazonSocial}</div>
                        <div className="text-xs text-slate-500 font-mono">{oc.proveedorCodigo}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="capitalize text-xs font-medium text-slate-700">
                          {oc.condicionPago.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                        {formatearPesos(oc.total)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${
                            oc.estado === 'recibida'
                              ? 'bg-emerald-100 text-emerald-800'
                              : oc.estado === 'borrador'
                              ? 'bg-amber-100 text-amber-800'
                              : oc.estado === 'enviada'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-slate-100 text-slate-800'
                          }`}
                        >
                          {oc.estado}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {oc.estado !== 'recibida' && oc.estado !== 'cancelada' && (
                          <>
                            <button
                              type="button"
                              data-testid={`btn-wsp-oc-${oc.id}`}
                              onClick={() => {
                                const prov = proveedores.find((p) => p.id === oc.proveedorId);
                                const tel = prov?.contactoTelefono ?? prov?.telefono ?? '';
                                const msg = formatearMensajeOrdenCompra({
                                  nombreNegocio: 'Ferretería & Corralón',
                                  nombreProveedor: oc.proveedorRazonSocial ?? prov?.razonSocial ?? 'Proveedor',
                                  numeroOrden: oc.numero,
                                  cantidadArticulos: oc.items ? oc.items.length : 1,
                                });
                                const link = generarLinkWhatsApp(tel, msg);
                                window.open(link, '_blank');
                              }}
                              className="mr-1.5 rounded bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 border border-emerald-200 inline-flex items-center gap-1"
                              title="Enviar orden de compra por WhatsApp al proveedor"
                            >
                              <span>📲</span> WhatsApp
                            </button>
                            <button
                              type="button"
                              data-testid={`btn-recibir-oc-${oc.id}`}
                              onClick={() => {
                                abrirModalRecepcion(oc);
                              }}
                              className="rounded bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 border border-indigo-200"
                            >
                              📥 Recibir Mercadería
                            </button>
                          </>
                        )}
                        {oc.estado === 'recibida' && (
                          <span className="text-xs text-emerald-700 font-medium">✓ Ingresada a stock</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECCIÓN 3: REABASTECIMIENTO INTELIGENTE */}
      {seccion === 'reabastecimiento' && (
        <ReabastecimientoInteligente
          token={token}
          rolActivo={rolUsuario}
          onIrAOrdenes={() => {
            setSeccion('ordenes');
          }}
        />
      )}

      {/* MODAL: PAGO A PROVEEDOR */}
      {modalPagoAbierto && proveedorParaPago && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Registrar Pago a Proveedor</h3>
            <p className="text-xs text-slate-600">
              El pago generará un egreso de categoría <span className="font-semibold text-slate-800">Proveedores</span> en el turno de caja abierto y acreditará el saldo del proveedor en el libro inmutable.
            </p>

            <form onSubmit={(e) => void handleRegistrarPago(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Proveedor
                </label>
                <input
                  type="text"
                  disabled
                  value={`${proveedorParaPago.razonSocial} (Saldo: ${formatearPesos(proveedorParaPago.saldoDeudor)})`}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 font-medium"
                />
              </div>

              <div>
                <label htmlFor="input-monto-pago" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Monto a pagar ($) *
                </label>
                <input
                  id="input-monto-pago"
                  type="number"
                  step="0.01"
                  required
                  value={pagoMonto}
                  onChange={(e) => {
                    setPagoMonto(e.target.value);
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono font-bold focus:border-slate-800 focus:outline-none"
                  placeholder="0.00"
                />
              </div>

              <div>
                <label htmlFor="select-medio-pago-prov" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Medio de Cobro / Caja *
                </label>
                <select
                  id="select-medio-pago-prov"
                  value={pagoMedioId}
                  onChange={(e) => {
                    setPagoMedioId(e.target.value);
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                >
                  {mediosPago.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre} {m.esEfectivo ? '(Cajón Efectivo)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="input-desc-pago" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Observaciones / Nro Recibo
                </label>
                <input
                  id="input-desc-pago"
                  type="text"
                  value={pagoDescripcion}
                  onChange={(e) => {
                    setPagoDescripcion(e.target.value);
                  }}
                  placeholder="Ej: Cancelación Factura A 0001-000492"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setModalPagoAbierto(false);
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoPago || !turnoAbiertoId}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-50"
                >
                  {guardandoPago ? 'Procesando...' : 'Confirmar Pago'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NUEVA ORDEN DE COMPRA */}
      {modalOCAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-slate-900">Nueva Orden de Compra</h3>

            <form onSubmit={(e) => void handleGuardarOC(e)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="select-prov-oc" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Proveedor *
                  </label>
                  <select
                    id="select-prov-oc"
                    required
                    value={ocProveedorId}
                    onChange={(e) => {
                      setOcProveedorId(e.target.value);
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                  >
                    <option value="">Seleccione un proveedor...</option>
                    {proveedores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.razonSocial} ({p.codigo})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="select-cond-pago-oc" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Condición de Pago
                  </label>
                  <select
                    id="select-cond-pago-oc"
                    value={ocCondicionPago}
                    onChange={(e) => {
                      setOcCondicionPago(e.target.value as 'contado' | 'cuenta_corriente');
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                  >
                    <option value="cuenta_corriente">Cuenta Corriente (a pagar)</option>
                    <option value="contado">Contado Inmediato</option>
                  </select>
                </div>
              </div>

              {/* Ítems del Pedido */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Artículos a Solicitar
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      setOcItems((prev) => [
                        ...prev,
                        {
                          productoId: null,
                          descripcion: '',
                          cantidadPedida: '1',
                          costoUnitario: '0.00',
                          subtotal: '0.00',
                        },
                      ]);
                    }}
                    className="text-xs font-bold text-indigo-600 hover:underline"
                  >
                    + Agregar Fila
                  </button>
                </div>

                {ocItems.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-slate-50 p-2 rounded-lg border border-slate-200">
                    <div className="col-span-5">
                      <input
                        type="text"
                        placeholder="Descripción o Producto"
                        required
                        value={item.descripcion}
                        onChange={(e) => {
                          const val = e.target.value;
                          setOcItems((prev) => {
                            const copia = [...prev];
                            const current = copia[idx];
                            if (current) current.descripcion = val;
                            return copia;
                          });
                        }}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none"
                      />
                    </div>
                    <div className="col-span-2">
                      <input
                        type="number"
                        step="0.001"
                        placeholder="Cant."
                        required
                        value={item.cantidadPedida}
                        onChange={(e) => {
                          const val = e.target.value;
                          setOcItems((prev) => {
                            const copia = [...prev];
                            const current = copia[idx];
                            if (current) {
                              current.cantidadPedida = val;
                              const c = parseFloat(val) || 0;
                              const p = parseFloat(current.costoUnitario) || 0;
                              current.subtotal = (c * p).toFixed(2);
                            }
                            return copia;
                          });
                        }}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs font-mono text-right focus:outline-none"
                      />
                    </div>
                    <div className="col-span-2">
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Costo"
                        required
                        value={item.costoUnitario}
                        onChange={(e) => {
                          const val = e.target.value;
                          setOcItems((prev) => {
                            const copia = [...prev];
                            const current = copia[idx];
                            if (current) {
                              current.costoUnitario = val;
                              const c = parseFloat(current.cantidadPedida) || 0;
                              const p = parseFloat(val) || 0;
                              current.subtotal = (c * p).toFixed(2);
                            }
                            return copia;
                          });
                        }}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-xs font-mono text-right focus:outline-none"
                      />
                    </div>
                    <div className="col-span-2 text-right font-mono font-bold text-xs text-slate-800">
                      ${item.subtotal}
                    </div>
                    <div className="col-span-1 text-center">
                      {ocItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            setOcItems((prev) => prev.filter((_, i) => i !== idx));
                          }}
                          className="text-rose-500 hover:text-rose-700 font-bold"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <label htmlFor="input-notas-oc" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Notas de Entrega / Comentarios
                </label>
                <textarea
                  id="input-notas-oc"
                  value={ocNotas}
                  onChange={(e) => {
                    setOcNotas(e.target.value);
                  }}
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                  placeholder="Ej: Entregar por portón de carga lateral antes de las 13hs"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setModalOCAbierto(false);
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoOC}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-indigo-700 disabled:opacity-50"
                >
                  {guardandoOC ? 'Guardando...' : 'Crear Orden'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RECEPCIÓN DE ORDEN DE COMPRA (Impacto en Kardex y Cta Cte) */}
      {modalRecepcionAbierto && ocParaRecepcion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">
              Confirmar Recepción de Mercadería: {ocParaRecepcion.numero}
            </h3>
            <p className="text-xs text-slate-600">
              Al confirmar la recepción, los artículos ingresarán al kardex inmutable de stock (<span className="font-mono text-slate-800">movimiento_stock</span>) y, si la condición es cuenta corriente, se debitará la deuda en el saldo del proveedor.
            </p>

            <form onSubmit={(e) => void handleRecibirOC(e)} className="space-y-4">
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Cantidades Recibidas
                </h4>
                {(ocParaRecepcion.items ?? []).map((it) => (
                  <div key={it.id} className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <div>
                      <div className="font-semibold text-sm text-slate-900">{it.descripcion}</div>
                      <div className="text-xs text-slate-500">
                        Pedido: {it.cantidadPedida} {it.unidadMedida} • Costo unit: {formatearPesos(it.costoUnitario)}
                      </div>
                    </div>
                    <div className="w-32">
                      <input
                        type="number"
                        step="0.001"
                        required
                        value={itemsRecibidosCantidades[it.id] ?? it.cantidadPedida}
                        onChange={(e) => {
                          const val = e.target.value;
                          setItemsRecibidosCantidades((prev) => ({
                            ...prev,
                            [it.id]: val,
                          }));
                        }}
                        className="w-full rounded border border-slate-300 px-2 py-1 text-sm font-mono text-right focus:outline-none focus:border-slate-800"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  id="check-actualizar-costo"
                  type="checkbox"
                  checked={actualizarCostoBase}
                  onChange={(e) => {
                    setActualizarCostoBase(e.target.checked);
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-slate-800 focus:ring-slate-800"
                />
                <label htmlFor="check-actualizar-costo" className="text-xs font-medium text-slate-700 cursor-pointer">
                  Actualizar costo base del artículo con el costo de esta orden de compra
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setModalRecepcionAbierto(false);
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={recibiendoOC}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-50"
                >
                  {recibiendoOC ? 'Ingresando a Stock...' : 'Confirmar Ingreso a Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ALTA / EDICIÓN DE PROVEEDOR */}
      {modalProveedorAbierto && (
        <ModalGuardarProveedor
          token={token}
          proveedorEnEdicion={proveedorEnEdicion}
          onGuardado={() => {
            setModalProveedorAbierto(false);
            setProveedorEnEdicion(null);
            void cargarProveedores();
          }}
          onCancelar={() => {
            setModalProveedorAbierto(false);
            setProveedorEnEdicion(null);
          }}
        />
      )}
    </div>
  );
}

// Subcomponente Modal para Guardar o Editar Proveedor
function ModalGuardarProveedor({
  token,
  proveedorEnEdicion,
  onGuardado,
  onCancelar,
}: {
  token: string;
  proveedorEnEdicion: ProveedorItem | null;
  onGuardado: () => void;
  onCancelar: () => void;
}): ReactElement {
  const [razonSocial, setRazonSocial] = useState<string>(proveedorEnEdicion?.razonSocial ?? '');
  const [nombreFantasia, setNombreFantasia] = useState<string>(proveedorEnEdicion?.nombreFantasia ?? '');
  const [cuit, setCuit] = useState<string>(proveedorEnEdicion?.cuit ?? '');
  const [condicionIva, setCondicionIva] = useState<CondicionIva>(
    proveedorEnEdicion?.condicionIva ?? 'responsable_inscripto',
  );
  const [telefono, setTelefono] = useState<string>(proveedorEnEdicion?.telefono ?? '');
  const [contactoNombre, setContactoNombre] = useState<string>(proveedorEnEdicion?.contactoNombre ?? '');
  const [diasPlazoPago, setDiasPlazoPago] = useState<number>(proveedorEnEdicion?.diasPlazoPago ?? 30);
  const [guardando, setGuardando] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (!razonSocial.trim()) {
      setError('La razón social es obligatoria.');
      return;
    }

    setGuardando(true);
    setError(null);
    try {
      const url = proveedorEnEdicion
        ? apiUrl(`/proveedores/${proveedorEnEdicion.id}`)
        : apiUrl('/proveedores');
      const method = proveedorEnEdicion ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          razonSocial: razonSocial.trim(),
          nombreFantasia: nombreFantasia.trim() || undefined,
          cuit: cuit.trim() || undefined,
          condicionIva,
          telefono: telefono.trim() || undefined,
          contactoNombre: contactoNombre.trim() || undefined,
          diasPlazoPago,
        }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(errData.message ?? 'Error al guardar el proveedor.');
      }

      onGuardado();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado al guardar.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
        <h3 className="text-lg font-bold text-slate-900">
          {proveedorEnEdicion ? 'Editar Proveedor' : 'Nuevo Proveedor'}
        </h3>

        {error && (
          <div className="p-3 text-xs bg-rose-50 text-rose-700 rounded-lg border border-rose-200">
            {error}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="input-razon-social" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Razón Social *
            </label>
            <input
              id="input-razon-social"
              type="text"
              required
              value={razonSocial}
              onChange={(e) => {
                setRazonSocial(e.target.value);
              }}
              placeholder="Ej: Loma Negra CIASA"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="input-nombre-fantasia" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Nombre de Fantasía
              </label>
              <input
                id="input-nombre-fantasia"
                type="text"
                value={nombreFantasia}
                onChange={(e) => {
                  setNombreFantasia(e.target.value);
                }}
                placeholder="Ej: Loma Negra"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="input-cuit" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                CUIT
              </label>
              <input
                id="input-cuit"
                type="text"
                value={cuit}
                onChange={(e) => {
                  setCuit(e.target.value);
                }}
                placeholder="30-50000000-9"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="select-iva" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Condición IVA
              </label>
              <select
                id="select-iva"
                value={condicionIva}
                onChange={(e) => {
                  setCondicionIva(e.target.value as CondicionIva);
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
              >
                <option value="responsable_inscripto">Responsable Inscripto</option>
                <option value="monotributo">Monotributo</option>
                <option value="exento">Exento</option>
                <option value="consumidor_final">Consumidor Final</option>
              </select>
            </div>
            <div>
              <label htmlFor="input-dias-plazo" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Plazo de Pago (Días)
              </label>
              <input
                id="input-dias-plazo"
                type="number"
                min={0}
                value={diasPlazoPago}
                onChange={(e) => {
                  setDiasPlazoPago(parseInt(e.target.value, 10) || 0);
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="input-contacto-nombre" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Nombre de Contacto
              </label>
              <input
                id="input-contacto-nombre"
                type="text"
                value={contactoNombre}
                onChange={(e) => {
                  setContactoNombre(e.target.value);
                }}
                placeholder="Ej: Marcelo Vendedor"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="input-telefono" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                Teléfono / WhatsApp
              </label>
              <input
                id="input-telefono"
                type="text"
                value={telefono}
                onChange={(e) => {
                  setTelefono(e.target.value);
                }}
                placeholder="011-4000-0000"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onCancelar}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-50"
            >
              {guardando ? 'Guardando...' : 'Guardar Proveedor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
