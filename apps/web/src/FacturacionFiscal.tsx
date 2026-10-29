import { useCallback, useEffect, useState, type ReactElement, type SyntheticEvent } from 'react';
import { formatearPesos } from './App.js';
import { apiUrl } from './api-url.js';
import { exportarACSV } from './utils/exportar-csv.js';
import type {
  ComprobanteFiscalDetalle,
  CondicionIva,
  RolUsuario,
  TipoComprobanteFiscal,
} from '@ferreteria/shared';

export interface PuntoVentaItem {
  id: string;
  numero: number;
  nombre: string;
  tipo: 'electronico_arca' | 'manual_contingencia';
  habilitado: boolean;
  cuitEmisor: string | null;
  inicioActividades: string | null;
  iibb: string | null;
  notas: string | null;
}

export interface FacturacionFiscalProps {
  token: string;
  rolUsuario: RolUsuario;
  condicionIvaEmisor?: string | undefined;
}

export function FacturacionFiscal({
  token,
  rolUsuario,
  condicionIvaEmisor,
}: FacturacionFiscalProps): ReactElement {
  const esMonotributo = condicionIvaEmisor === 'monotributo' || condicionIvaEmisor === 'exento';
  const [subpestana, setSubpestana] = useState<'comprobantes' | 'puntos_venta'>('comprobantes');
  const [comprobantes, setComprobantes] = useState<ComprobanteFiscalDetalle[]>([]);
  const [puntosVenta, setPuntosVenta] = useState<PuntoVentaItem[]>([]);
  const [cargando, setCargando] = useState<boolean>(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // Modales
  const [modalEmitirFactura, setModalEmitirFactura] = useState<boolean>(false);
  const [modalConfigPV, setModalConfigPV] = useState<boolean>(false);
  const [comprobanteDetalleModal, setComprobanteDetalleModal] =
    useState<ComprobanteFiscalDetalle | null>(null);

  // Form emisión factura
  const [formPvNumero, setFormPvNumero] = useState<number>(1);
  const [formTipoComp, setFormTipoComp] = useState<TipoComprobanteFiscal>(
    esMonotributo ? 'factura_c' : 'factura_b',
  );
  const [formRazonSocial, setFormRazonSocial] = useState<string>('Consumidor Final');
  const [formCuitCliente, setFormCuitCliente] = useState<string>('');
  const [formCondicionIva, setFormCondicionIva] = useState<CondicionIva>('consumidor_final');
  const [formAlicuotaIva, setFormAlicuotaIva] = useState<'21' | '10.5' | '27' | '0'>('21');
  const [formTotal, setFormTotal] = useState<string>('');
  const [formContingencia, setFormContingencia] = useState<boolean>(false);
  const [emitiendo, setEmitiendo] = useState<boolean>(false);

  // Form punto de venta
  const [formNuevoPvNumero, setFormNuevoPvNumero] = useState<number>(1);
  const [formNuevoPvNombre, setFormNuevoPvNombre] = useState<string>('Punto de Venta Mostrador');
  const [formNuevoPvCuit, setFormNuevoPvCuit] = useState<string>('30-71444555-9');
  const [guardandoPv, setGuardandoPv] = useState<boolean>(false);

  // Cargar Puntos de Venta
  const cargarPuntosVenta = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/facturacion/puntos-venta'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as PuntoVentaItem[];
        setPuntosVenta(data);
        if (data.length > 0 && data[0]?.numero) {
          setFormPvNumero(data[0].numero);
        }
      }
    } catch {
      // Ignorar error secundario
    }
  }, [token]);

  // Cargar Comprobantes Emitidos
  const cargarComprobantes = useCallback(async () => {
    setCargando(true);
    setAviso(null);
    try {
      const res = await fetch(apiUrl('/facturacion/comprobantes'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error('No se pudo cargar la lista de comprobantes fiscales.');
      }
      const data = (await res.json()) as ComprobanteFiscalDetalle[];
      setComprobantes(data);
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Error al cargar comprobantes.');
    } finally {
      setCargando(false);
    }
  }, [token]);

  useEffect(() => {
    void cargarPuntosVenta();
    if (subpestana === 'comprobantes') {
      void cargarComprobantes();
    }
  }, [subpestana, cargarPuntosVenta, cargarComprobantes]);

  // Manejar Emisión de Factura
  const handleEmitirFactura = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    const totalNum = parseFloat(formTotal);
    if (isNaN(totalNum) || totalNum <= 0) {
      setAviso('El importe total del comprobante debe ser mayor a cero.');
      return;
    }

    if (formTipoComp.includes('_a') && !formCuitCliente.trim()) {
      setAviso('Para emitir Factura A el CUIT del cliente es estrictamente obligatorio.');
      return;
    }

    setEmitiendo(true);
    setAviso(null);
    try {
      const res = await fetch(apiUrl('/facturacion/emitir'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          puntoVentaNumero: formPvNumero,
          tipoComprobante: formTipoComp,
          cuitCliente: formCuitCliente.trim() || undefined,
          razonSocialCliente: formRazonSocial.trim(),
          condicionIvaCliente: formCondicionIva,
          alicuotaIva: formAlicuotaIva,
          total: totalNum.toFixed(2),
          enContingenciaOffline: formContingencia,
        }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(errData.message ?? 'Error al autorizar comprobante con ARCA.');
      }

      const creado = (await res.json()) as ComprobanteFiscalDetalle;
      setModalEmitirFactura(false);
      setFormTotal('');
      void cargarComprobantes();
      setComprobanteDetalleModal(creado);
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Error al emitir factura.');
    } finally {
      setEmitiendo(false);
    }
  };

  // Manejar Guardado de Punto de Venta
  const handleGuardarPuntoVenta = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    setGuardandoPv(true);
    setAviso(null);
    try {
      const res = await fetch(apiUrl('/facturacion/puntos-venta'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          numero: formNuevoPvNumero,
          nombre: formNuevoPvNombre.trim(),
          cuitEmisor: formNuevoPvCuit.trim() || undefined,
          tipo: 'electronico_arca',
          habilitado: true,
        }),
      });

      if (!res.ok) {
        throw new Error('No se pudo guardar el punto de venta.');
      }

      setModalConfigPV(false);
      void cargarPuntosVenta();
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Error al guardar punto de venta.');
    } finally {
      setGuardandoPv(false);
    }
  };

  const exportarLibroIvaVentasCSV = (): void => {
    if (comprobantes.length === 0) return;
    const columnas = [
      'Fecha Emisión',
      'Punto Venta',
      'Tipo Comprobante',
      'Nº Comprobante',
      'Cliente / Razón Social',
      'CUIT Cliente',
      'Condición IVA',
      'Neto Gravado ($)',
      'IVA 21% ($)',
      'IVA 10.5% ($)',
      'IVA 27% ($)',
      'Exento ($)',
      'Total ($)',
      'Estado',
      'CAE',
      'Vencimiento CAE',
    ];
    const filas: (string | number | null | undefined)[][] = comprobantes.map((c) => [
      c.fechaEmision,
      c.puntoVentaNumero,
      c.tipoComprobante,
      c.numeroComprobante,
      c.razonSocialCliente,
      c.cuitCliente ?? '',
      c.condicionIvaCliente,
      c.subtotalNetoGravado,
      c.subtotalIva21,
      c.subtotalIva105,
      c.subtotalIva27,
      c.subtotalExento,
      c.total,
      c.estado,
      c.cae ?? '',
      c.vencimientoCae ?? '',
    ]);

    const hoy = new Date().toISOString().split('T')[0] ?? '';
    exportarACSV(`libro_iva_ventas_${hoy}`, columnas, filas);
  };

  return (
    <div className="space-y-6">
      {/* Alerta Superior */}
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

      {/* Navegación Subpestañas */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="tab-sub-comprobantes"
            onClick={() => {
              setSubpestana('comprobantes');
            }}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
              subpestana === 'comprobantes'
                ? 'bg-slate-900 text-white shadow'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            🧾 Comprobantes Emitidos (ARCA)
          </button>
          <button
            type="button"
            data-testid="tab-sub-pv"
            onClick={() => {
              setSubpestana('puntos_venta');
            }}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition ${
              subpestana === 'puntos_venta'
                ? 'bg-slate-900 text-white shadow'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            ⚙️ Puntos de Venta Fiscales
          </button>
        </div>

        <div className="flex gap-2">
          {subpestana === 'comprobantes' && (
            <>
              {comprobantes.length > 0 && (
                <button
                  type="button"
                  onClick={exportarLibroIvaVentasCSV}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Exportar Libro IVA 📊
                </button>
              )}
              <button
                type="button"
                data-testid="btn-emitir-factura"
                onClick={() => {
                  setModalEmitirFactura(true);
                }}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-emerald-700"
              >
                + Emitir Factura Electrónica
              </button>
            </>
          )}

          {subpestana === 'puntos_venta' && rolUsuario === 'dueno' && (
            <button
              type="button"
              onClick={() => {
                setModalConfigPV(true);
              }}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-indigo-700"
            >
              + Nuevo Punto de Venta
            </button>
          )}
        </div>
      </div>

      {/* SUBPESTAÑA 1: COMPROBANTES EMITIDOS */}
      {subpestana === 'comprobantes' && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-100 text-xs font-semibold uppercase text-slate-700 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Tipo / Número</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Receptor / CUIT</th>
                  <th className="px-4 py-3 text-right">Neto Gravado</th>
                  <th className="px-4 py-3 text-right">IVA</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-center">CAE / Estado</th>
                  <th className="px-4 py-3 text-center">Ticket</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {cargando ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-500">
                      Cargando comprobantes fiscales...
                    </td>
                  </tr>
                ) : comprobantes.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-500">
                      No hay comprobantes fiscales emitidos aún.
                    </td>
                  </tr>
                ) : (
                  comprobantes.map((c) => {
                    const letra = c.tipoComprobante.includes('_a')
                      ? 'A'
                      : c.tipoComprobante.includes('_b')
                      ? 'B'
                      : 'C';
                    const esNotaCredito = c.tipoComprobante.startsWith('nota_credito');
                    const numPtoVta = c.puntoVentaNumero.toString().padStart(5, '0');
                    const numComp = c.numeroComprobante.toString().padStart(8, '0');
                    const ivaTotal = (
                      parseFloat(c.subtotalIva21) +
                      parseFloat(c.subtotalIva105) +
                      parseFloat(c.subtotalIva27)
                    ).toFixed(2);

                    return (
                      <tr key={c.id} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 font-mono font-bold text-slate-900">
                          <span
                            className={`inline-block mr-1.5 px-1.5 py-0.5 rounded text-xs text-white font-black ${
                              letra === 'A'
                                ? 'bg-indigo-600'
                                : letra === 'B'
                                ? 'bg-emerald-600'
                                : 'bg-amber-600'
                            }`}
                          >
                            {letra}
                          </span>
                          {esNotaCredito ? 'NC ' : 'FC '}
                          {numPtoVta}-{numComp}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {new Date(c.fechaEmision).toLocaleDateString('es-AR')}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{c.razonSocialCliente}</div>
                          <div className="text-xs text-slate-500 font-mono">
                            {c.cuitCliente ? `CUIT: ${c.cuitCliente}` : 'Consumidor Final'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-700">
                          {formatearPesos(c.subtotalNetoGravado)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-700">
                          {formatearPesos(ivaTotal)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                          {formatearPesos(c.total)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {c.cae ? (
                            <div>
                              <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800 font-mono">
                                CAE: {c.cae}
                              </span>
                              {c.vencimientoCae && (
                                <div className="text-[10px] text-slate-500">
                                  Vence: {new Date(c.vencimientoCae).toLocaleDateString('es-AR')}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 uppercase">
                              {c.estado.replace('_', ' ')}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              setComprobanteDetalleModal(c);
                            }}
                            className="rounded bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200"
                          >
                            Ver Fiscal
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
      )}

      {/* SUBPESTAÑA 2: PUNTOS DE VENTA */}
      {subpestana === 'puntos_venta' && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-100 text-xs font-semibold uppercase text-slate-700 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Nº Punto de Venta</th>
                  <th className="px-4 py-3">Descripción</th>
                  <th className="px-4 py-3">Tipo de Facturación</th>
                  <th className="px-4 py-3">CUIT Emisor</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {puntosVenta.map((pv) => (
                  <tr key={pv.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 font-mono font-bold text-slate-900">
                      P.V. #{pv.numero.toString().padStart(5, '0')}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">{pv.nombre}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs uppercase font-semibold text-slate-700">
                        {pv.tipo === 'electronico_arca' ? 'Factura Electrónica (ARCA)' : 'Manual Contingencia'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600">{pv.cuitEmisor ?? '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold uppercase ${
                          pv.habilitado ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {pv.habilitado ? 'Habilitado' : 'Inactivo'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: EMITIR FACTURA ELECTRÓNICA */}
      {modalEmitirFactura && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Emitir Comprobante Fiscal ARCA / AFIP</h3>

            <form onSubmit={(e) => void handleEmitirFactura(e)} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="select-modal-pv" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Punto de Venta
                  </label>
                  <select
                    id="select-modal-pv"
                    value={formPvNumero}
                    onChange={(e) => {
                      setFormPvNumero(parseInt(e.target.value, 10));
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                  >
                    {puntosVenta.map((pv) => (
                      <option key={pv.id} value={pv.numero}>
                        P.V. #{pv.numero.toString().padStart(5, '0')} - {pv.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="select-modal-tipo-comp" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Tipo de Comprobante
                  </label>
                  <select
                    id="select-modal-tipo-comp"
                    value={formTipoComp}
                    onChange={(e) => {
                      const tc = e.target.value as TipoComprobanteFiscal;
                      setFormTipoComp(tc);
                      if (tc.includes('_a')) {
                        setFormCondicionIva('responsable_inscripto');
                      } else {
                        setFormCondicionIva('consumidor_final');
                      }
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none font-bold"
                  >
                    {esMonotributo ? (
                      <>
                        <option value="factura_c">Factura C (Oficial Monotributo)</option>
                        <option value="nota_credito_c">Nota de Crédito C</option>
                      </>
                    ) : (
                      <>
                        <option value="factura_b">Factura B (Consumidor Final / Exento)</option>
                        <option value="factura_a">Factura A (Responsable Inscripto con CUIT)</option>
                        <option value="factura_c">Factura C (Monotributo / Otros)</option>
                        <option value="nota_credito_b">Nota de Crédito B</option>
                        <option value="nota_credito_a">Nota de Crédito A</option>
                        <option value="nota_credito_c">Nota de Crédito C</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="input-modal-receptor" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Razón Social / Nombre Receptor *
                  </label>
                  <input
                    id="input-modal-receptor"
                    type="text"
                    required
                    value={formRazonSocial}
                    onChange={(e) => {
                      setFormRazonSocial(e.target.value);
                    }}
                    placeholder="Ej: Consumidor Final o Constructora SA"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="input-modal-cuit-rec" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    CUIT Receptor {formTipoComp.includes('_a') ? '(Obligatorio para Factura A)' : ''}
                  </label>
                  <input
                    id="input-modal-cuit-rec"
                    type="text"
                    required={formTipoComp.includes('_a')}
                    value={formCuitCliente}
                    onChange={(e) => {
                      setFormCuitCliente(e.target.value);
                    }}
                    placeholder="30-00000000-0"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="select-modal-alicuota" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Alícuota de IVA
                  </label>
                  <select
                    id="select-modal-alicuota"
                    value={formAlicuotaIva}
                    onChange={(e) => {
                      setFormAlicuotaIva(e.target.value as '21' | '10.5' | '27' | '0');
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                  >
                    <option value="21">21.0% (Tasa General)</option>
                    <option value="10.5">10.5% (Tasa Reducida)</option>
                    <option value="27">27.0% (Servicios / Especial)</option>
                    <option value="0">0.0% (Exento)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="input-modal-total-comp" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Importe Total Facturado ($) *
                  </label>
                  <input
                    id="input-modal-total-comp"
                    type="number"
                    step="0.01"
                    required
                    value={formTotal}
                    onChange={(e) => {
                      setFormTotal(e.target.value);
                    }}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono font-bold focus:border-slate-800 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  id="check-modal-contingencia"
                  type="checkbox"
                  checked={formContingencia}
                  onChange={(e) => {
                    setFormContingencia(e.target.checked);
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-slate-800 focus:ring-slate-800"
                />
                <label htmlFor="check-modal-contingencia" className="text-xs font-medium text-slate-700 cursor-pointer">
                  Emitir en contingencia offline (reservar numeración sin conexión directa con ARCA)
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setModalEmitirFactura(false);
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={emitiendo}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-50"
                >
                  {emitiendo ? 'Autorizando con ARCA...' : 'Emitir y Solicitar CAE'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ALTA DE PUNTO DE VENTA */}
      {modalConfigPV && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Nuevo Punto de Venta Fiscal</h3>

            <form onSubmit={(e) => void handleGuardarPuntoVenta(e)} className="space-y-4">
              <div>
                <label htmlFor="input-pv-num" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Número de Punto de Venta (1 - 99998) *
                </label>
                <input
                  id="input-pv-num"
                  type="number"
                  min={1}
                  max={99998}
                  required
                  value={formNuevoPvNumero}
                  onChange={(e) => {
                    setFormNuevoPvNumero(parseInt(e.target.value, 10) || 1);
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none font-mono"
                />
              </div>

              <div>
                <label htmlFor="input-pv-nom" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Nombre descriptivo *
                </label>
                <input
                  id="input-pv-nom"
                  type="text"
                  required
                  value={formNuevoPvNombre}
                  onChange={(e) => {
                    setFormNuevoPvNombre(e.target.value);
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="input-pv-cuit" className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  CUIT Emisor del Negocio
                </label>
                <input
                  id="input-pv-cuit"
                  type="text"
                  value={formNuevoPvCuit}
                  onChange={(e) => {
                    setFormNuevoPvCuit(e.target.value);
                  }}
                  placeholder="30-00000000-0"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none font-mono"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setModalConfigPV(false);
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoPv}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-indigo-700 disabled:opacity-50"
                >
                  {guardandoPv ? 'Guardando...' : 'Crear Punto de Venta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: VISTA PREVIA Y COMPROBANTE OFICIAL ARCA */}
      {comprobanteDetalleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start border-b border-slate-200 pb-3">
              <div>
                <span className="text-xs uppercase font-bold text-emerald-700">Comprobante Autorizado por ARCA</span>
                <h3 className="text-xl font-black text-slate-900">
                  {comprobanteDetalleModal.tipoComprobante.replace('_', ' ').toUpperCase()} #{' '}
                  {comprobanteDetalleModal.puntoVentaNumero.toString().padStart(5, '0')}-
                  {comprobanteDetalleModal.numeroComprobante.toString().padStart(8, '0')}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setComprobanteDetalleModal(null);
                }}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            {/* Ficha Fiscal */}
            <div className="space-y-3 text-xs text-slate-700">
              <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                <div>
                  <span className="block text-slate-400">Fecha de Emisión:</span>
                  <span className="font-semibold text-slate-900">
                    {new Date(comprobanteDetalleModal.fechaEmision).toLocaleDateString('es-AR')}
                  </span>
                </div>
                <div>
                  <span className="block text-slate-400">Código AFIP:</span>
                  <span className="font-semibold text-slate-900">
                    #{comprobanteDetalleModal.codigoAfip}
                  </span>
                </div>
                <div>
                  <span className="block text-slate-400">Receptor:</span>
                  <span className="font-semibold text-slate-900">
                    {comprobanteDetalleModal.razonSocialCliente}
                  </span>
                </div>
                <div>
                  <span className="block text-slate-400">Identificación:</span>
                  <span className="font-semibold font-mono text-slate-900">
                    {comprobanteDetalleModal.cuitCliente ?? 'Consumidor Final'}
                  </span>
                </div>
              </div>

              {/* Desglose impositivo */}
              <div className="border border-slate-200 rounded-lg p-3 space-y-1.5">
                <div className="flex justify-between">
                  <span>Subtotal Neto Gravado:</span>
                  <span className="font-mono font-bold">
                    {formatearPesos(comprobanteDetalleModal.subtotalNetoGravado)}
                  </span>
                </div>
                {parseFloat(comprobanteDetalleModal.subtotalIva21) > 0 && (
                  <div className="flex justify-between">
                    <span>IVA (21.0%):</span>
                    <span className="font-mono font-bold">
                      {formatearPesos(comprobanteDetalleModal.subtotalIva21)}
                    </span>
                  </div>
                )}
                {parseFloat(comprobanteDetalleModal.subtotalIva105) > 0 && (
                  <div className="flex justify-between">
                    <span>IVA (10.5%):</span>
                    <span className="font-mono font-bold">
                      {formatearPesos(comprobanteDetalleModal.subtotalIva105)}
                    </span>
                  </div>
                )}
                {parseFloat(comprobanteDetalleModal.subtotalExento) > 0 && (
                  <div className="flex justify-between">
                    <span>Exento:</span>
                    <span className="font-mono font-bold">
                      {formatearPesos(comprobanteDetalleModal.subtotalExento)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-200 pt-1.5 text-sm font-black text-slate-900">
                  <span>TOTAL FACTURADO:</span>
                  <span className="font-mono text-emerald-600">
                    {formatearPesos(comprobanteDetalleModal.total)}
                  </span>
                </div>
              </div>

              {/* CAE y QR ARCA */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="block text-[11px] font-bold text-emerald-800 uppercase">
                      CAE (Código Autorización Electrónico)
                    </span>
                    <span className="font-mono text-base font-black text-emerald-950">
                      {comprobanteDetalleModal.cae ?? '— (Contingencia)'}
                    </span>
                  </div>
                  {comprobanteDetalleModal.vencimientoCae && (
                    <div className="text-right">
                      <span className="block text-[10px] text-emerald-700">Vence:</span>
                      <span className="font-mono font-bold text-emerald-900">
                        {new Date(comprobanteDetalleModal.vencimientoCae).toLocaleDateString('es-AR')}
                      </span>
                    </div>
                  )}
                </div>

                {comprobanteDetalleModal.codigoQrArca && (
                  <div className="pt-2 text-center border-t border-emerald-200/60">
                    <span className="block text-[10px] text-emerald-700 mb-1">
                      Código QR oficial de verificación ARCA (RG 4291/4892)
                    </span>
                    <a
                      href={comprobanteDetalleModal.codigoQrArca}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-mono text-indigo-700 underline break-all"
                    >
                      {comprobanteDetalleModal.codigoQrArca}
                    </a>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => {
                  window.print();
                }}
                className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white shadow hover:bg-slate-700"
              >
                🖨️ Imprimir Ticket / Factura
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
