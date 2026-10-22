import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  aCentavos,
  deCentavos,
  type RolUsuario,
} from '@ferreteria/shared';
import {
  encolarOperacion,
  listarOperacionesPendientes,
  sincronizarColaPendiente,
  type OperacionCola,
} from './offline/cola-indexeddb.js';
import { apiUrl } from './api-url.js';
import { ConfiguracionPiloto } from './ConfiguracionPiloto.js';
import { ReportesHistorial } from './ReportesHistorial.js';
import { CatalogoStock } from './CatalogoStock.js';
import {
  ClientesCtaCte,
  type ClienteItem,
  type ClienteAutorizadoItem,
} from './ClientesCtaCte.js';
import { ComprasProveedores } from './ComprasProveedores.js';
import { TesoreriaFlujo } from './TesoreriaFlujo.js';
import { FacturacionFiscal } from './FacturacionFiscal.js';
import { Contabilidad } from './Contabilidad.js';
import { Presupuestos } from './Presupuestos.js';
import { AuditoriaSistema } from './AuditoriaSistema.js';
import { InicioDashboard } from './InicioDashboard.js';
import {
  imprimirTicketTermico,
  type DatosTicketTermico,
} from './utils/impresion-ticket.js';
import { exportarACSV } from './utils/exportar-csv.js';
import { imprimirComprobanteFiscal } from './utils/impresion-factura.js';
import type { ComprobanteFiscalDetalle } from '@ferreteria/shared';

export interface ItemCarrito {
  id: string;
  productoId?: string | undefined;
  codigo?: string | undefined;
  nombre: string;
  rubroId?: string | undefined;
  unidad: 'principal' | 'secundaria';
  nombreUnidad: string;
  factorConversion: string;
  permiteFraccion: boolean;
  cantidad: string;
  precioUnitario: string;
  descuentoPct: string;
  descuentoMonto: string;
  subtotal: string;
}

export interface ListaPrecioItem {
  id: string;
  nombre: string;
  margenPct: string;
  orden: number;
}

export function calcularSubtotalCentavos(
  precioUnitario: string,
  cantidad: number,
  descuentoPct: string,
  descuentoMonto: string,
): bigint {
  const precioUnitCent = aCentavos(precioUnitario);
  const brutoCent =
    (precioUnitCent * BigInt(Math.round(cantidad * 1000))) / 1000n;
  const pct = Math.min(100, Math.max(0, parseFloat(descuentoPct) || 0));
  const conPct = (brutoCent * BigInt(Math.round((100 - pct) * 100))) / 10000n;
  const descMontoCent = aCentavos(descuentoMonto || '0.00');
  const neto = conPct - descMontoCent;
  return neto > 0n ? neto : 0n;
}

export function formatearPesos(importeDecimal: string): string {
  const limpio = importeDecimal.trim();
  const esNegativo = limpio.startsWith('-');
  const sinSigno = esNegativo ? limpio.slice(1) : limpio;
  const [enteroRaw = '0', decimalRaw = '00'] = sinSigno.split('.');
  const enteroFormateado = enteroRaw.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decimalFormateado = decimalRaw.padEnd(2, '0').slice(0, 2);
  return `${esNegativo ? '- ' : ''}$ ${enteroFormateado},${decimalFormateado}`;
}

export function agregarDigitoTeclado(actual: string, digito: string): string {
  if (digito === 'C') {
    return '0';
  }
  if (digito === 'BACK') {
    const reducido = actual.length <= 1 ? '0' : actual.slice(0, -1);
    return reducido === '' ? '0' : reducido;
  }
  if (actual === '0') {
    return digito === '00' ? '0' : digito;
  }
  const candidato = `${actual}${digito}`;
  if (candidato.length > 9) {
    return actual;
  }
  return candidato;
}

interface MedioPagoItem {
  id: string;
  nombre: string;
  esEfectivo: boolean;
}

interface RubroItem {
  id: string;
  nombre: string;
}

interface CategoriaItem {
  id: string;
  nombre: string;
  tipo: 'ingreso' | 'egreso';
}

interface OperadorItem {
  id: string;
  nombre: string;
  rol: RolUsuario;
  token: string;
}

interface ContextoMostrador {
  negocioId: string;
  negocioNombre: string;
  caja: { id: string; nombre: string };
  cajas?: Array<{ id: string; nombre: string }>;
  mediosPago: MedioPagoItem[];
  rubros: RubroItem[];
  categorias: CategoriaItem[];
  turnoAbiertoId: string | null;
  operadores: OperadorItem[];
}

interface ResumenTurnoEstado {
  turnoId: string;
  efectivoInicial: string;
  entradasEfectivo: string;
  salidasEfectivo: string;
  efectivoEsperado: string;
  efectivoContado: string | null;
  diferencia: string | null;
}

interface VentaPorMedioRubro {
  medioPago: string;
  rubro: string;
  total: string;
}

const CONTEXTO_FALLBACK: ContextoMostrador = {
  negocioId: '10000000-0000-4000-8000-000000000001',
  negocioNombre: 'Ferretería El Tornillo',
  caja: {
    id: '10000000-0000-4000-8000-000000000003',
    nombre: 'Caja Mostrador 1',
  },
  mediosPago: [
    {
      id: '20000000-0000-4000-8000-000000000001',
      nombre: 'Efectivo',
      esEfectivo: true,
    },
    {
      id: '20000000-0000-4000-8000-000000000002',
      nombre: 'Tarjeta',
      esEfectivo: false,
    },
    {
      id: '20000000-0000-4000-8000-000000000003',
      nombre: 'Transferencia/QR',
      esEfectivo: false,
    },
  ],
  rubros: [
    { id: '30000000-0000-4000-8000-000000000001', nombre: 'Herramientas' },
    { id: '30000000-0000-4000-8000-000000000002', nombre: 'Electricidad' },
    { id: '30000000-0000-4000-8000-000000000003', nombre: 'Pinturas' },
    { id: '30000000-0000-4000-8000-000000000004', nombre: 'Bulonería' },
  ],
  categorias: [
    {
      id: '40000000-0000-4000-8000-000000000001',
      nombre: 'Proveedores',
      tipo: 'egreso',
    },
    {
      id: '40000000-0000-4000-8000-000000000002',
      nombre: 'Servicios',
      tipo: 'egreso',
    },
    {
      id: '40000000-0000-4000-8000-000000000003',
      nombre: 'Varios',
      tipo: 'egreso',
    },
  ],
  turnoAbiertoId: null,
  operadores: [
    {
      id: '10000000-0000-4000-8000-000000000004',
      nombre: 'Juan (Cajero)',
      rol: 'cajero',
      token: 'demo-token-cajero',
    },
    {
      id: '10000000-0000-4000-8000-000000000005',
      nombre: 'Marta (Encargada)',
      rol: 'encargado',
      token: 'demo-token-encargado',
    },
    {
      id: '10000000-0000-4000-8000-000000000006',
      nombre: 'Roberto (Dueño)',
      rol: 'dueno',
      token: 'demo-token-dueno',
    },
  ],
};

function generarUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function App(): ReactElement {
  const [contexto, setContexto] = useState<ContextoMostrador>(CONTEXTO_FALLBACK);
  const [operadorActivo, setOperadorActivo] = useState<OperadorItem | null>(
    null,
  );
  const [turnoId, setTurnoId] = useState<string | null>(null);
  const [efectivoSugerido, setEfectivoSugerido] = useState<string>('0.00');
  const [efectivoInicialInput, setEfectivoInicialInput] =
    useState<string>('0.00');

  const [resumen, setResumen] = useState<ResumenTurnoEstado | null>(null);
  const [ventasPorMedio, setVentasPorMedio] = useState<VentaPorMedioRubro[]>([]);
  const [ultimoArqueoCerrado, setUltimoArqueoCerrado] =
    useState<ResumenTurnoEstado | null>(null);

  const [pestana, setPestana] = useState<
    | 'inicio'
    | 'venta'
    | 'egreso'
    | 'arqueo'
    | 'reportes'
    | 'configuracion'
    | 'catalogo'
    | 'clientes'
    | 'compras'
    | 'tesoreria'
    | 'facturacion'
    | 'contabilidad'
    | 'presupuestos'
    | 'auditoria'
  >('inicio');
  const [sidebarAbierto, setSidebarAbierto] = useState<boolean>(false);

  // Cliente para venta rápida en mostrador
  const [clienteSeleccionadoVenta, setClienteSeleccionadoVenta] =
    useState<ClienteItem | null>(null);
  const [autorizadosClienteVenta, setAutorizadosClienteVenta] = useState<
    ClienteAutorizadoItem[]
  >([]);
  const [autorizadoRetiroIdSeleccionado, setAutorizadoRetiroIdSeleccionado] =
    useState<string>('');
  const [modalBuscarClienteVenta, setModalBuscarClienteVenta] =
    useState<boolean>(false);
  const [busquedaClienteVenta, setBusquedaClienteVenta] = useState<string>('');
  const [clientesSugeridosVenta, setClientesSugeridosVenta] = useState<
    ClienteItem[]
  >([]);
  const [buscandoClienteVenta, setBuscandoClienteVenta] =
    useState<boolean>(false);

  const [listasPrecios, setListasPrecios] = useState<ListaPrecioItem[]>([]);
  const [listaPrecioIdSeleccionada, setListaPrecioIdSeleccionada] =
    useState<string>('');
  const [itemsCarrito, setItemsCarrito] = useState<ItemCarrito[]>([]);
  const [busquedaProducto, setBusquedaProducto] = useState<string>('');
  const [buscandoProducto, setBuscandoProducto] = useState<boolean>(false);
  const [mensajePistola, setMensajePistola] = useState<string | null>(null);

  const [montoEnteroTeclado, setMontoEnteroTeclado] = useState<string>('0');
  const [medioPagoIdSeleccionado, setMedioPagoIdSeleccionado] =
    useState<string>('');
  const [rubroIdSeleccionado, setRubroIdSeleccionado] = useState<string>('');
  const [descripcionVenta, setDescripcionVenta] = useState<string>('');
  const [toquesVentaActual, setToquesVentaActual] = useState<number>(0);

  const [montoEgresoInput, setMontoEgresoInput] = useState<string>('');
  const [categoriaEgresoId, setCategoriaEgresoId] = useState<string>('');
  const [descripcionEgreso, setDescripcionEgreso] = useState<string>('');

  const [efectivoContadoInput, setEfectivoContadoInput] = useState<string>('');
  const [notasCierreInput, setNotasCierreInput] = useState<string>('');

  const [modoSinConexion, setModoSinConexion] = useState<boolean>(false);
  const [colaPendiente, setColaPendiente] = useState<OperacionCola[]>([]);
  const [sincronizando, setSincronizando] = useState<boolean>(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ultimaVentaParaTicket, setUltimaVentaParaTicket] = useState<DatosTicketTermico | null>(null);
  const [emitirFacturaElectronica, setEmitirFacturaElectronica] = useState<boolean>(false);
  const [ultimaFacturaEmitida, setUltimaFacturaEmitida] = useState<ComprobanteFiscalDetalle | null>(null);

  const recargarCola = useCallback(async () => {
    const lista = await listarOperacionesPendientes();
    setColaPendiente(lista);
  }, []);

  const recargarContextoMostrador = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/contexto-mostrador'));
      if (!res.ok) {
        return;
      }
      const data = (await res.json()) as ContextoMostrador;
      setContexto(data);
    } catch {
      // Mantiene el contexto local si está sin conexión
    }
  }, []);

  const cargarResumenTurno = useCallback(
    async (idTurno: string, token: string) => {
      try {
        const res = await fetch(apiUrl(`/api/turnos/${idTurno}/resumen`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          return;
        }
        const data = (await res.json()) as {
          resumen: ResumenTurnoEstado;
          ventasPorMedioRubro: VentaPorMedioRubro[];
        };
        setResumen(data.resumen);
        setVentasPorMedio(data.ventasPorMedioRubro);
      } catch {
        // Si está sin conexión se mantiene el último resumen local
      }
    },
    [],
  );

  useEffect(() => {
    void recargarCola();
    void (async () => {
      try {
        const res = await fetch(apiUrl('/api/contexto-mostrador'));
        if (!res.ok) {
          return;
        }
        const data = (await res.json()) as ContextoMostrador;
        setContexto(data);

        const medioEfectivo =
          data.mediosPago.find((m) => m.esEfectivo) ?? data.mediosPago[0];
        if (medioEfectivo) {
          setMedioPagoIdSeleccionado(medioEfectivo.id);
        }
        if (data.rubros[0]) {
          setRubroIdSeleccionado(data.rubros[0].id);
        }
        if (data.categorias[0]) {
          setCategoriaEgresoId(data.categorias[0].id);
        }

        const opInicial = data.operadores[0] ?? null;
        if (opInicial) {
          const resSug = await fetch(
            apiUrl(`/api/cajas/${data.caja.id}/sugerencia-apertura`),
            {
              headers: { Authorization: `Bearer ${opInicial.token}` },
            },
          );
          if (resSug.ok) {
            const sugData = (await resSug.json()) as {
              efectivoSugerido: string;
            };
            setEfectivoSugerido(sugData.efectivoSugerido);
            setEfectivoInicialInput(sugData.efectivoSugerido);
          }

          if (data.turnoAbiertoId) {
            setTurnoId(data.turnoAbiertoId);
            await cargarResumenTurno(data.turnoAbiertoId, opInicial.token);
          }
        }
      } catch {
        // Fallback offline inicial
      }
    })();
  }, [cargarResumenTurno, recargarCola]);

  const ejecutarSincronizacion = useCallback(async () => {
    if (modoSinConexion) {
      setAviso('Seguís en modo sin conexión. Conectate para sincronizar.');
      return;
    }
    setSincronizando(true);
    try {
      const resultado = await sincronizarColaPendiente();
      await recargarCola();
      if (turnoId && operadorActivo) {
        await cargarResumenTurno(turnoId, operadorActivo.token);
      }
      if (resultado.sincronizadas > 0) {
        setAviso(
          `Se sincronizaron ${resultado.sincronizadas} operaciones pendientes sin duplicar.`,
        );
      }
    } finally {
      setSincronizando(false);
    }
  }, [cargarResumenTurno, modoSinConexion, operadorActivo, recargarCola, turnoId]);

  useEffect(() => {
    if (!modoSinConexion && colaPendiente.length > 0) {
      void ejecutarSincronizacion();
    }
  }, [modoSinConexion, colaPendiente.length, ejecutarSincronizacion]);

  const entradasEfectivoColaCentavos = colaPendiente.reduce((acc, op) => {
    if (op.tipo === 'venta' && op.resumenLocal.esEfectivo) {
      return acc + aCentavos(op.resumenLocal.monto);
    }
    return acc;
  }, 0n);

  const salidasEfectivoColaCentavos = colaPendiente.reduce((acc, op) => {
    if (op.tipo === 'egreso' && op.resumenLocal.esEfectivo) {
      return acc + aCentavos(op.resumenLocal.monto);
    }
    return acc;
  }, 0n);

  const efectivoInicialCentavos = aCentavos(
    resumen?.efectivoInicial ?? efectivoInicialInput,
  );
  const entradasConfirmadasCentavos = aCentavos(
    resumen?.entradasEfectivo ?? '0.00',
  );
  const salidasConfirmadasCentavos = aCentavos(
    resumen?.salidasEfectivo ?? '0.00',
  );

  const entradasTotalesEfectivo = deCentavos(
    entradasConfirmadasCentavos + entradasEfectivoColaCentavos,
  );
  const salidasTotalesEfectivo = deCentavos(
    salidasConfirmadasCentavos + salidasEfectivoColaCentavos,
  );
  const efectivoEsperadoTotal = deCentavos(
    efectivoInicialCentavos +
      entradasConfirmadasCentavos +
      entradasEfectivoColaCentavos -
      salidasConfirmadasCentavos -
      salidasEfectivoColaCentavos,
  );

  const totalCarritoCentavos = itemsCarrito.reduce(
    (acc, it) => acc + aCentavos(it.subtotal),
    0n,
  );
  const montoVentaFormateado =
    itemsCarrito.length > 0
      ? deCentavos(totalCarritoCentavos)
      : `${montoEnteroTeclado}.00`;

  const cargarListasPrecios = useCallback(async (token: string) => {
    try {
      const res = await fetch(apiUrl('/api/listas-precios'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as ListaPrecioItem[];
        setListasPrecios(data);
        if (data.length > 0 && !listaPrecioIdSeleccionada && data[0]) {
          setListaPrecioIdSeleccionada(data[0].id);
        }
      }
    } catch {
      // Ignora fallo offline
    }
  }, [listaPrecioIdSeleccionada]);

  useEffect(() => {
    if (operadorActivo?.token) {
      void cargarListasPrecios(operadorActivo.token);
    }
  }, [cargarListasPrecios, operadorActivo?.token]);

  const buscarClientesParaVenta = useCallback(
    async (termino: string, token: string) => {
      setBuscandoClienteVenta(true);
      try {
        const params = new URLSearchParams();
        if (termino.trim()) {
          params.set('q', termino.trim());
        }
        const res = await fetch(apiUrl(`/api/clientes?${params.toString()}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as ClienteItem[];
          setClientesSugeridosVenta(data);
        }
      } catch {
        // Ignora fallo offline
      } finally {
        setBuscandoClienteVenta(false);
      }
    },
    [],
  );

  const seleccionarClienteVenta = useCallback(
    async (c: ClienteItem | null) => {
      setClienteSeleccionadoVenta(c);
      setAutorizadoRetiroIdSeleccionado('');
      setAutorizadosClienteVenta([]);
      setModalBuscarClienteVenta(false);

      if (c && operadorActivo) {
        if (c.listaPrecioId) {
          setListaPrecioIdSeleccionada(c.listaPrecioId);
        }
        try {
          const res = await fetch(apiUrl(`/api/clientes/${c.id}`), {
            headers: { Authorization: `Bearer ${operadorActivo.token}` },
          });
          if (res.ok) {
            const data = (await res.json()) as {
              cliente: ClienteItem;
              autorizados: ClienteAutorizadoItem[];
            };
            setAutorizadosClienteVenta(data.autorizados);
          }
        } catch {
          // Ignora fallo offline
        }
      }
    },
    [operadorActivo],
  );

  const agregarProductoPorCodigo = useCallback(
    async (codigoOTexto: string) => {
      if (!operadorActivo || !codigoOTexto.trim()) {
        return;
      }
      const query = codigoOTexto.trim();
      setBuscandoProducto(true);
      setMensajePistola(null);

      try {
        let productoEncontrado: {
          id: string;
          codigo: string;
          nombre: string;
          costoBase: string;
          stockActualBase?: string | undefined;
          unidadPrincipal: string;
          unidadSecundaria?: string | null | undefined;
          factorConversion: string;
          permiteFraccion: boolean;
          precios: Record<string, string>;
          rubroId?: string | null | undefined;
        } | null = null;

        // 1. Intentar lookup-ean
        try {
          const resEan = await fetch(
            apiUrl(`/api/productos/lookup-ean/${encodeURIComponent(query)}`),
            {
              headers: { Authorization: `Bearer ${operadorActivo.token}` },
            },
          );
          if (resEan.ok) {
            const eanData = (await resEan.json()) as {
              encontrado: boolean;
              productoId?: string;
              codigo?: string;
              nombre?: string;
              costoBase?: string;
              stockActualBase?: string;
              unidadPrincipal?: string;
              unidadSecundaria?: string;
              factorConversion?: string;
              permiteFraccion?: boolean;
              precios?: Record<string, string>;
            };
            if (eanData.encontrado && eanData.productoId) {
              productoEncontrado = {
                id: eanData.productoId,
                codigo: eanData.codigo ?? query,
                nombre: eanData.nombre ?? 'Artículo',
                costoBase: eanData.costoBase ?? '0.00',
                stockActualBase: eanData.stockActualBase,
                unidadPrincipal: eanData.unidadPrincipal ?? 'Unidad',
                unidadSecundaria: eanData.unidadSecundaria,
                factorConversion: eanData.factorConversion ?? '1.000',
                permiteFraccion: Boolean(eanData.permiteFraccion),
                precios: eanData.precios ?? {},
              };
            }
          }
        } catch {
          // Ignora fallo de lookup-ean
        }

        // 2. Si no es EAN directo, buscar en catálogo por nombre o código interno
        if (!productoEncontrado) {
          const resCat = await fetch(
            apiUrl(`/api/productos?busqueda=${encodeURIComponent(query)}`),
            {
              headers: { Authorization: `Bearer ${operadorActivo.token}` },
            },
          );
          if (resCat.ok) {
            const listData = (await resCat.json()) as Array<{
              id: string;
              codigo: string;
              nombre: string;
              costo_base: string;
              stock_actual_base: string;
              unidad_principal: string;
              unidad_secundaria: string | null;
              factor_conversion: string;
              permite_fraccion: boolean;
              precios: Record<string, string>;
              rubro_id: string | null;
            }>;
            if (listData.length > 0 && listData[0]) {
              const p = listData[0];
              productoEncontrado = {
                id: p.id,
                codigo: p.codigo,
                nombre: p.nombre,
                costoBase: p.costo_base,
                stockActualBase: p.stock_actual_base,
                unidadPrincipal: p.unidad_principal,
                unidadSecundaria: p.unidad_secundaria,
                factorConversion: p.factor_conversion,
                permiteFraccion: p.permite_fraccion,
                precios: p.precios,
                rubroId: p.rubro_id,
              };
            }
          }
        }

        if (!productoEncontrado) {
          setMensajePistola(`No se encontró "${query}" en el catálogo.`);
          return;
        }

        const prod = productoEncontrado;
        const precioUnit =
          prod.precios[listaPrecioIdSeleccionada] ?? prod.costoBase;

        setItemsCarrito((prev) => {
          const idx = prev.findIndex(
            (it) => it.productoId === prod.id && it.unidad === 'principal',
          );
          if (idx >= 0 && prev[idx]) {
            const item = prev[idx];
            const cantNum = (parseFloat(item.cantidad) || 0) + 1;
            const cantStr = cantNum.toFixed(3);
            const subtotalCent = calcularSubtotalCentavos(
              item.precioUnitario,
              cantNum,
              item.descuentoPct,
              item.descuentoMonto,
            );
            const itemActualizado: ItemCarrito = {
              ...item,
              cantidad: cantStr,
              subtotal: deCentavos(subtotalCent),
            };
            const copia = [...prev];
            copia[idx] = itemActualizado;
            return copia;
          }

          const nuevoItem: ItemCarrito = {
            id: generarUuid(),
            productoId: prod.id,
            codigo: prod.codigo,
            nombre: prod.nombre,
            rubroId: prod.rubroId ?? undefined,
            unidad: 'principal',
            nombreUnidad: prod.unidadPrincipal,
            factorConversion: prod.factorConversion,
            permiteFraccion: prod.permiteFraccion,
            cantidad: '1.000',
            precioUnitario: precioUnit,
            descuentoPct: '0',
            descuentoMonto: '0.00',
            subtotal: precioUnit,
          };
          return [...prev, nuevoItem];
        });

        setMensajePistola(
          `✓ ${prod.nombre} agregado (${formatearPesos(precioUnit)})`,
        );
        setBusquedaProducto('');
      } catch {
        setMensajePistola('Error al consultar producto.');
      } finally {
        setBuscandoProducto(false);
      }
    },
    [listaPrecioIdSeleccionada, operadorActivo],
  );

  useEffect(() => {
    if (pestana !== 'venta') {
      return;
    }
    let buffer = '';
    let ultimoTiempo = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const esInput =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';

      const ahora = Date.now();
      const delta = ahora - ultimoTiempo;
      ultimoTiempo = ahora;

      if (e.key === 'Enter') {
        if (buffer.length >= 3) {
          e.preventDefault();
          const codigo = buffer.trim();
          buffer = '';
          void agregarProductoPorCodigo(codigo);
        } else {
          buffer = '';
        }
        return;
      }

      if (e.key.length === 1) {
        if (delta > 80 && buffer.length > 0 && !esInput) {
          buffer = '';
        }
        if (!esInput || delta < 60) {
          buffer += e.key;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [agregarProductoPorCodigo, pestana]);

  const cambiarUnidadItem = (
    itemId: string,
    nuevaUnidad: 'principal' | 'secundaria',
  ) => {
    setItemsCarrito((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) {
          return it;
        }
        const factor = parseFloat(it.factorConversion) || 1;
        const precioPrincipalCent = aCentavos(it.precioUnitario);
        let nuevoPrecioUnitario = it.precioUnitario;
        if (
          it.unidad === 'principal' &&
          nuevaUnidad === 'secundaria' &&
          factor > 0
        ) {
          const precioSecCent =
            (precioPrincipalCent * 1000n) / BigInt(Math.round(factor * 1000));
          nuevoPrecioUnitario = deCentavos(precioSecCent);
        } else if (
          it.unidad === 'secundaria' &&
          nuevaUnidad === 'principal' &&
          factor > 0
        ) {
          const precioPrincCent =
            (precioPrincipalCent * BigInt(Math.round(factor * 1000))) / 1000n;
          nuevoPrecioUnitario = deCentavos(precioPrincCent);
        }
        const cant = parseFloat(it.cantidad) || 1;
        const subtotalCent = calcularSubtotalCentavos(
          nuevoPrecioUnitario,
          cant,
          it.descuentoPct,
          it.descuentoMonto,
        );
        return {
          ...it,
          unidad: nuevaUnidad,
          precioUnitario: nuevoPrecioUnitario,
          subtotal: deCentavos(subtotalCent),
        };
      }),
    );
  };

  const actualizarCantidadItem = (itemId: string, nuevaCantidad: string) => {
    setItemsCarrito((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) {
          return it;
        }
        const cant = Math.max(0.001, parseFloat(nuevaCantidad) || 0);
        const subtotalCent = calcularSubtotalCentavos(
          it.precioUnitario,
          cant,
          it.descuentoPct,
          it.descuentoMonto,
        );
        return {
          ...it,
          cantidad: cant.toFixed(3),
          subtotal: deCentavos(subtotalCent),
        };
      }),
    );
  };

  const actualizarDescuentoPctItem = (itemId: string, pctStr: string) => {
    setItemsCarrito((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) {
          return it;
        }
        const cant = parseFloat(it.cantidad) || 1;
        const subtotalCent = calcularSubtotalCentavos(
          it.precioUnitario,
          cant,
          pctStr,
          it.descuentoMonto,
        );
        return {
          ...it,
          descuentoPct: pctStr,
          subtotal: deCentavos(subtotalCent),
        };
      }),
    );
  };

  const eliminarItemCarrito = (itemId: string) => {
    setItemsCarrito((prev) => prev.filter((it) => it.id !== itemId));
  };

  const abrirTurno = async (): Promise<void> => {
    if (!operadorActivo) {
      return;
    }
    setUltimoArqueoCerrado(null);
    try {
      const res = await fetch(apiUrl('/api/turnos/abrir'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${operadorActivo.token}`,
        },
        body: JSON.stringify({
          cajaId: contexto.caja.id,
          efectivoInicial: efectivoInicialInput,
        }),
      });

      if (!res.ok) {
        const errData = (await res.json()) as { error?: string };
        setAviso(errData.error ?? 'No se pudo abrir el turno');
        return;
      }

      const data = (await res.json()) as {
        turno: { id: string; efectivoInicial: string };
      };
      setTurnoId(data.turno.id);
      await cargarResumenTurno(data.turno.id, operadorActivo.token);
      setAviso(
        `Turno abierto con efectivo inicial ${formatearPesos(data.turno.efectivoInicial)}`,
      );
    } catch (err: unknown) {
      setAviso(
        `Error de red al abrir turno: ${err instanceof Error ? err.message : 'Error desconocido'}`,
      );
    }
  };

  const registrarVentaRapida = async (): Promise<void> => {
    if (!operadorActivo || !turnoId) {
      return;
    }
    if (aCentavos(montoVentaFormateado) <= 0n) {
      setAviso('Ingresá un monto mayor a $ 0,00 para cobrar la venta.');
      return;
    }

    const medioSeleccionado =
      contexto.mediosPago.find((m) => m.id === medioPagoIdSeleccionado) ??
      contexto.mediosPago[0];
    const rubroSeleccionado =
      contexto.rubros.find((r) => r.id === rubroIdSeleccionado) ??
      contexto.rubros[0];

    if (!medioSeleccionado) {
      return;
    }

    if (medioSeleccionado.nombre.toLowerCase().includes('cuenta corriente')) {
      if (!clienteSeleccionadoVenta) {
        setAviso('Para cobrar con Cuenta Corriente debés seleccionar un cliente.');
        return;
      }
    }

    const ventaId = generarUuid();
    const movimientoId = generarUuid();
    const payload = {
      id: ventaId,
      turnoId,
      ...(clienteSeleccionadoVenta ? { clienteId: clienteSeleccionadoVenta.id } : {}),
      ...(autorizadoRetiroIdSeleccionado
        ? { autorizadoRetiroId: autorizadoRetiroIdSeleccionado }
        : {}),
      total: montoVentaFormateado,
      items:
        itemsCarrito.length > 0
          ? itemsCarrito.map((it) => ({
              productoId: it.productoId,
              descripcion: it.nombre,
              cantidad: it.cantidad,
              unidad: it.unidad,
              precioUnit: it.precioUnitario,
              descuentoPct:
                it.descuentoPct !== '0' && it.descuentoPct !== ''
                  ? it.descuentoPct
                  : undefined,
              descuentoMonto:
                it.descuentoMonto !== '0.00' && it.descuentoMonto !== ''
                  ? it.descuentoMonto
                  : undefined,
              subtotal: it.subtotal,
            }))
          : undefined,
      pagos: [
        {
          movimientoId,
          medioPagoId: medioSeleccionado.id,
          monto: montoVentaFormateado,
          ...(rubroSeleccionado ? { rubroId: rubroSeleccionado.id } : {}),
          ...(descripcionVenta.trim()
            ? { descripcion: descripcionVenta.trim() }
            : {}),
        },
      ],
    };

    const operacion: OperacionCola = {
      id: ventaId,
      tipo: 'venta',
      endpoint: '/api/ventas',
      payload,
      token: operadorActivo.token,
      resumenLocal: {
        monto: montoVentaFormateado,
        esEfectivo: medioSeleccionado.esEfectivo,
        medioPagoNombre: medioSeleccionado.nombre,
        etiqueta: `${medioSeleccionado.nombre} · ${rubroSeleccionado?.nombre ?? 'Sin rubro'}${clienteSeleccionadoVenta ? ` (${clienteSeleccionadoVenta.nombre})` : ''}`,
      },
      creadoEn: new Date().toISOString(),
      intentos: 0,
    };

    const toquesUsados = toquesVentaActual + 1;
    const itemsParaFactura =
      itemsCarrito.length > 0
        ? itemsCarrito.map((it) => ({
            productoId: it.productoId ?? null,
            codigo: it.codigo ?? null,
            descripcion: it.nombre,
            unidad: it.nombreUnidad || 'unidad',
            cantidad: it.cantidad,
            precioUnitario: it.precioUnitario,
            alicuotaIva: '21' as const,
            subtotal: it.subtotal,
          }))
        : [
            {
              descripcion: descripcionVenta.trim() || 'Artículos de ferretería varios',
              unidad: 'unidad',
              cantidad: '1.000',
              precioUnitario: montoVentaFormateado,
              alicuotaIva: '21' as const,
              subtotal: montoVentaFormateado,
            },
          ];

    const debeFacturar = emitirFacturaElectronica && !modoSinConexion;
    const tipoCmp =
      clienteSeleccionadoVenta?.condicionIva === 'responsable_inscripto'
        ? ('factura_a' as const)
        : ('factura_b' as const);
    const clienteIdFact = clienteSeleccionadoVenta?.id ?? null;
    const razonSocialCli = clienteSeleccionadoVenta?.nombre || 'Consumidor Final';
    const cuitCli = clienteSeleccionadoVenta?.cuitDni || null;
    const condIvaCli = clienteSeleccionadoVenta?.condicionIva || 'consumidor_final';
    const datosTicket: DatosTicketTermico = {
      nombreComercio: 'FERRETERÍA & CORRALÓN',
      numeroTicket: ventaId.slice(0, 8).toUpperCase(),
      fechaHora: new Date().toLocaleString('es-AR'),
      cajeroNombre: operadorActivo.nombre,
      ...(clienteSeleccionadoVenta ? { clienteNombre: clienteSeleccionadoVenta.nombre } : {}),
      items: itemsCarrito.map((it) => ({
        descripcion: it.nombre,
        cantidad: it.cantidad,
        precioUnitario: it.precioUnitario,
        subtotal: it.subtotal,
      })),
      subtotal: montoVentaFormateado,
      medioCobro: medioSeleccionado.nombre,
      total: montoVentaFormateado,
    };
    setUltimaVentaParaTicket(datosTicket);
    setUltimaFacturaEmitida(null);

    setMontoEnteroTeclado('0');
    setDescripcionVenta('');
    setToquesVentaActual(0);
    setItemsCarrito([]);
    setClienteSeleccionadoVenta(null);
    setAutorizadoRetiroIdSeleccionado('');
    setAutorizadosClienteVenta([]);

    if (modoSinConexion) {
      await encolarOperacion(operacion);
      await recargarCola();
      setAviso(
        `Sin internet: venta de ${formatearPesos(montoVentaFormateado)} (${medioSeleccionado.nombre}) guardada en cola local IndexedDB (ID ${ventaId.slice(0, 8)}).`,
      );
      return;
    }

    try {
      const res = await fetch(apiUrl('/api/ventas'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${operadorActivo.token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error('Error al registrar venta');
      }

      await cargarResumenTurno(turnoId, operadorActivo.token);
      setAviso(
        `Venta cobrada en ${toquesUsados} toques: ${formatearPesos(montoVentaFormateado)} (${medioSeleccionado.nombre} · ${rubroSeleccionado?.nombre ?? 'Sin rubro'})`,
      );

      if (debeFacturar) {
        try {
          const resFact = await fetch(apiUrl('/facturacion/emitir'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${operadorActivo.token}`,
            },
            body: JSON.stringify({
              ventaId,
              puntoVentaNumero: 1,
              tipoComprobante: tipoCmp,
              clienteId: clienteIdFact,
              cuitCliente: cuitCli,
              razonSocialCliente: razonSocialCli,
              condicionIvaCliente: condIvaCli,
              alicuotaIva: '21',
              total: montoVentaFormateado,
              items: itemsParaFactura,
            }),
          });
          if (resFact.ok) {
            const facturaEmitida = (await resFact.json()) as ComprobanteFiscalDetalle;
            setUltimaFacturaEmitida(facturaEmitida);
            setAviso(
              `Venta cobrada y Factura ${facturaEmitida.tipoComprobante.toUpperCase()} autorizada por ARCA (CAE: ${facturaEmitida.cae ?? 'OK'}).`,
            );
          }
        } catch {
          // Si falla emisión la venta ya está cobrada en caja
        }
      }
    } catch {
      await encolarOperacion(operacion);
      await recargarCola();
      setAviso(
        `Conexión interrumpida: venta de ${formatearPesos(montoVentaFormateado)} encolada en IndexedDB para sincronizar luego.`,
      );
    }
  };

  const registrarEgreso = async (): Promise<void> => {
    if (!operadorActivo || !turnoId) {
      return;
    }
    const montoLimpio = montoEgresoInput.trim().includes('.')
      ? montoEgresoInput.trim()
      : `${montoEgresoInput.trim() || '0'}.00`;

    if (aCentavos(montoLimpio) <= 0n) {
      setAviso('Ingresá un monto de egreso mayor a $ 0,00.');
      return;
    }

    const medioEfectivo =
      contexto.mediosPago.find((m) => m.esEfectivo) ?? contexto.mediosPago[0];
    const categoriaSel = contexto.categorias.find(
      (c) => c.id === categoriaEgresoId,
    );

    if (!medioEfectivo) {
      return;
    }

    const egresoId = generarUuid();
    const payload = {
      id: egresoId,
      turnoId,
      medioPagoId: medioEfectivo.id,
      ...(categoriaSel ? { categoriaId: categoriaSel.id } : {}),
      monto: montoLimpio,
      ...(descripcionEgreso.trim()
        ? { descripcion: descripcionEgreso.trim() }
        : {}),
    };

    const operacion: OperacionCola = {
      id: egresoId,
      tipo: 'egreso',
      endpoint: '/api/movimientos/egreso',
      payload,
      token: operadorActivo.token,
      resumenLocal: {
        monto: montoLimpio,
        esEfectivo: medioEfectivo.esEfectivo,
        medioPagoNombre: medioEfectivo.nombre,
        etiqueta: `Egreso · ${categoriaSel?.nombre ?? 'Varios'}`,
      },
      creadoEn: new Date().toISOString(),
      intentos: 0,
    };

    setMontoEgresoInput('');
    setDescripcionEgreso('');

    if (modoSinConexion) {
      await encolarOperacion(operacion);
      await recargarCola();
      setAviso(
        `Sin internet: egreso de ${formatearPesos(montoLimpio)} guardado en cola local IndexedDB.`,
      );
      return;
    }

    try {
      const res = await fetch(apiUrl('/api/movimientos/egreso'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${operadorActivo.token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error('Error al registrar egreso');
      }

      await cargarResumenTurno(turnoId, operadorActivo.token);
      setAviso(
        `Egreso registrado: ${formatearPesos(montoLimpio)} (${categoriaSel?.nombre ?? 'Varios'})`,
      );
    } catch {
      await encolarOperacion(operacion);
      await recargarCola();
      setAviso(
        `Sin conexión: egreso de ${formatearPesos(montoLimpio)} guardado en cola local.`,
      );
    }
  };

  const cerrarTurnoConArqueo = async (): Promise<void> => {
    if (!operadorActivo || !turnoId) {
      return;
    }
    if (colaPendiente.length > 0) {
      setAviso(
        'Sincronizá las operaciones pendientes de la cola local antes de cerrar el turno.',
      );
      return;
    }

    const contadoNormalizado = efectivoContadoInput.trim().includes('.')
      ? efectivoContadoInput.trim()
      : `${efectivoContadoInput.trim() || '0'}.00`;

    const res = await fetch(apiUrl(`/api/turnos/${turnoId}/cerrar`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${operadorActivo.token}`,
      },
      body: JSON.stringify({
        efectivoContado: contadoNormalizado,
        ...(notasCierreInput.trim() ? { notas: notasCierreInput.trim() } : {}),
      }),
    });

    if (!res.ok) {
      const errData = (await res.json()) as { error?: string };
      setAviso(errData.error ?? 'No se pudo cerrar el turno');
      return;
    }

    const arqueoFinal = (await res.json()) as ResumenTurnoEstado;
    setUltimoArqueoCerrado(arqueoFinal);
    setTurnoId(null);
    setResumen(null);
    setVentasPorMedio([]);
    setEfectivoSugerido(arqueoFinal.efectivoContado ?? '0.00');
    setEfectivoInicialInput(arqueoFinal.efectivoContado ?? '0.00');
    setEfectivoContadoInput('');
    setNotasCierreInput('');
    setAviso(
      `Turno cerrado con arqueo. Contado: ${formatearPesos(arqueoFinal.efectivoContado ?? '0.00')} | Diferencia: ${formatearPesos(arqueoFinal.diferencia ?? '0.00')}`,
    );
  };

  const contadoPreviewDecimal =
    efectivoContadoInput.trim().length > 0
      ? efectivoContadoInput.trim().includes('.')
        ? efectivoContadoInput.trim()
        : `${efectivoContadoInput.trim()}.00`
      : null;

  const diferenciaPreviewDecimal =
    contadoPreviewDecimal !== null
      ? deCentavos(
          aCentavos(contadoPreviewDecimal) - aCentavos(efectivoEsperadoTotal),
        )
      : null;

  if (!operadorActivo) {
    return (
      <main className="min-h-screen bg-slate-100 p-4 md:p-8">
        <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow-md border border-slate-200">
          <span className="inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            {contexto.negocioNombre} · {contexto.caja.nombre}
          </span>
          <h1 className="mt-3 text-2xl font-bold text-slate-900">
            Ingreso a Caja de Mostrador
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Elegí tu usuario para operar el turno de caja.
          </p>

          <div className="mt-6 space-y-3">
            {contexto.operadores.map((op) => (
              <button
                key={op.id}
                type="button"
                data-testid={`login-${op.rol}`}
                onClick={() => {
                  setOperadorActivo(op);
                }}
                className="flex w-full items-center justify-between rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-blue-600 hover:bg-blue-50"
              >
                <div>
                  <div className="text-base font-bold text-slate-900">
                    {op.nombre}
                  </div>
                  <div className="text-xs text-slate-500 uppercase tracking-wider">
                    Rol: {op.rol}
                  </div>
                </div>
                <span className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">
                  Entrar
                </span>
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100">
      {/* Backdrop móvil */}
      {sidebarAbierto && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm lg:hidden"
          onClick={() => { setSidebarAbierto(false); }}
        />
      )}

      {/* SIDEBAR LATERAL PROFESIONAL Y AGRUPADO */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-slate-950 text-slate-300 shadow-xl transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 ${
          sidebarAbierto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Identidad del Negocio */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 to-amber-600 text-xl font-black text-slate-950 shadow-md">
              🛠️
            </div>
            <div className="truncate">
              <div className="truncate text-sm font-black text-white leading-tight">
                {contexto.negocioNombre}
              </div>
              <div className="truncate text-[11px] font-semibold text-emerald-400">
                {contexto.caja.nombre}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setSidebarAbierto(false); }}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
          >
            ✕
          </button>
        </div>

        {/* Menú de Navegación Organizado por Áreas */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5 text-xs">
          {/* ÁREA GENERAL */}
          <div>
            <div className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              General
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                data-testid="tab-inicio"
                onClick={() => {
                  setPestana('inicio');
                  setSidebarAbierto(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 font-bold transition ${
                  pestana === 'inicio'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <span className="text-base">🏠</span>
                <span>Inicio / Tablero</span>
              </button>
            </div>
          </div>

          {/* ÁREA MOSTRADOR & CAJA */}
          <div>
            <div className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Mostrador & Caja
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                data-testid="tab-venta"
                onClick={() => {
                  setPestana('venta');
                  setSidebarAbierto(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 font-bold transition ${
                  pestana === 'venta'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <span className="text-base">🛒</span>
                <span>Venta en Mostrador</span>
              </button>

              <button
                type="button"
                data-testid="tab-presupuestos"
                onClick={() => {
                  setPestana('presupuestos');
                  setSidebarAbierto(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 font-bold transition ${
                  pestana === 'presupuestos'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <span className="text-base">📝</span>
                <span>Presupuestos y Cotiz.</span>
              </button>

              <button
                type="button"
                data-testid="tab-egreso"
                onClick={() => {
                  setPestana('egreso');
                  setSidebarAbierto(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 font-bold transition ${
                  pestana === 'egreso'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <span className="text-base">💸</span>
                <span>Egresos y Gastos</span>
              </button>

              <button
                type="button"
                data-testid="tab-arqueo"
                onClick={() => {
                  setPestana('arqueo');
                  setSidebarAbierto(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 font-bold transition ${
                  pestana === 'arqueo'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <span className="text-base">🔒</span>
                <span>Cierre con Arqueo</span>
              </button>
            </div>
          </div>

          {/* ÁREA STOCK & CLIENTES */}
          <div>
            <div className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Stock & Clientes
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                data-testid="tab-catalogo"
                onClick={() => {
                  setPestana('catalogo');
                  setSidebarAbierto(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 font-bold transition ${
                  pestana === 'catalogo'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <span className="text-base">📦</span>
                <span>Artículos y Stock</span>
              </button>

              <button
                type="button"
                data-testid="tab-clientes"
                onClick={() => {
                  setPestana('clientes');
                  setSidebarAbierto(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 font-bold transition ${
                  pestana === 'clientes'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <span className="text-base">👥</span>
                <span>Clientes y Cta. Cte.</span>
              </button>

              <button
                type="button"
                data-testid="tab-compras"
                onClick={() => {
                  setPestana('compras');
                  setSidebarAbierto(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 font-bold transition ${
                  pestana === 'compras'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <span className="text-base">🚚</span>
                <span>Compras y Proveedores</span>
              </button>
            </div>
          </div>

          {/* ÁREA FINANZAS & CONTABILIDAD */}
          <div>
            <div className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Finanzas & Fiscal
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                data-testid="tab-tesoreria"
                onClick={() => {
                  setPestana('tesoreria');
                  setSidebarAbierto(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 font-bold transition ${
                  pestana === 'tesoreria'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <span className="text-base">🏦</span>
                <span>Tesorería y Cheques</span>
              </button>

              <button
                type="button"
                data-testid="tab-facturacion"
                onClick={() => {
                  setPestana('facturacion');
                  setSidebarAbierto(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 font-bold transition ${
                  pestana === 'facturacion'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <span className="text-base">🧾</span>
                <span>Facturación ARCA / AFIP</span>
              </button>

              <button
                type="button"
                data-testid="tab-contabilidad"
                onClick={() => {
                  setPestana('contabilidad');
                  setSidebarAbierto(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 font-bold transition ${
                  pestana === 'contabilidad'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <span className="text-base">⚖️</span>
                <span>Contabilidad y Diario</span>
              </button>
            </div>
          </div>

          {/* ÁREA CONTROL & CONFIGURACIÓN */}
          <div>
            <div className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Control & Sistema
            </div>
            <div className="space-y-0.5">
              <button
                type="button"
                data-testid="tab-reportes"
                onClick={() => {
                  setPestana('reportes');
                  setSidebarAbierto(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 font-bold transition ${
                  pestana === 'reportes'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <span className="text-base">📊</span>
                <span>Reportes e Historial</span>
              </button>

              <button
                type="button"
                data-testid="tab-auditoria"
                onClick={() => {
                  setPestana('auditoria');
                  setSidebarAbierto(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 font-bold transition ${
                  pestana === 'auditoria'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <span className="text-base">🛡️</span>
                <span>Auditoría del Sistema</span>
              </button>

              <button
                type="button"
                data-testid="tab-configuracion"
                onClick={() => {
                  setPestana('configuracion');
                  setSidebarAbierto(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 font-bold transition ${
                  pestana === 'configuracion'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/40'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <span className="text-base">⚙️</span>
                <span>Configuración</span>
              </button>
            </div>
          </div>
        </nav>

        {/* Pie del Sidebar: Operador */}
        <div className="border-t border-slate-800 bg-slate-900/80 p-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs font-black text-white">
              {operadorActivo.nombre.charAt(0)}
            </div>
            <div className="truncate">
              <div className="truncate text-xs font-bold text-white">{operadorActivo.nombre}</div>
              <div className="text-[10px] capitalize text-slate-400">Rol: {operadorActivo.rol}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ÁREA PRINCIPAL */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* HEADER SUPERIOR */}
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-4 text-white shadow-sm">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { setSidebarAbierto(true); }}
              className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white lg:hidden"
              aria-label="Abrir menú"
            >
              <span className="text-xl leading-none">☰</span>
            </button>

            <div>
              <div className="text-xs text-slate-400 font-medium">
                {contexto.negocioNombre} · {contexto.caja.nombre}
              </div>
              <div className="text-sm font-bold flex items-center gap-2">
                {turnoId ? (
                  <>
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Cajón esperado:</span>
                    <span
                      data-testid="header-efectivo-esperado"
                      className="text-emerald-400 font-black"
                    >
                      {formatearPesos(efectivoEsperadoTotal)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                    <span className="text-amber-300">Caja cerrada</span>
                    <span className="text-xs text-slate-400">
                      (Sugerido: {formatearPesos(efectivoSugerido)})
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Operador activo"
              data-testid="selector-operador"
              value={operadorActivo.id}
              onChange={(e) => {
                const encontrado = contexto.operadores.find(
                  (o) => o.id === e.target.value,
                );
                if (encontrado) {
                  setOperadorActivo(encontrado);
                }
              }}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white border border-slate-700"
            >
              {contexto.operadores.map((op) => (
                <option key={op.id} value={op.id}>
                  {op.nombre} ({op.rol})
                </option>
              ))}
            </select>

            <button
              type="button"
              data-testid="toggle-conexion"
              onClick={() => {
                setModoSinConexion((prev) => !prev);
              }}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                modoSinConexion
                  ? 'bg-rose-600 text-white'
                  : 'bg-emerald-600 text-white'
              }`}
            >
              {modoSinConexion ? 'OFFLINE' : 'ONLINE'}
            </button>

            <div
              data-testid="badge-cola-offline"
              className="flex items-center gap-2 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-semibold border border-slate-700"
            >
              <span>
                Cola:{' '}
                <strong data-testid="contador-cola-offline">
                  {colaPendiente.length}
                </strong>
              </span>
              {colaPendiente.length > 0 && !modoSinConexion && (
                <button
                  type="button"
                  data-testid="btn-sincronizar-cola"
                  disabled={sincronizando}
                  onClick={() => { void ejecutarSincronizacion(); }}
                  className="rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-slate-950"
                >
                  {sincronizando ? '...' : 'Sync'}
                </button>
              )}
            </div>
          </div>
        </header>

        {/* CONTENIDO PRINCIPAL */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 lg:pb-8">
          <div className="mx-auto max-w-5xl">
            {aviso && (
              <div
                data-testid="banner-aviso"
                className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-950"
              >
                {aviso}
              </div>
            )}

            {ultimaVentaParaTicket && (
              <div
                data-testid="banner-ticket-termico"
                className={`mb-4 rounded-xl border px-4 py-3 text-sm font-medium flex flex-wrap items-center justify-between gap-3 shadow-sm ${
                  ultimaFacturaEmitida
                    ? 'border-blue-300 bg-blue-50 text-blue-950'
                    : 'border-emerald-300 bg-emerald-50 text-emerald-950'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xl">
                    {ultimaFacturaEmitida ? '🧾' : '🖨'}
                  </span>
                  <div>
                    <div className="font-bold">
                      {ultimaFacturaEmitida
                        ? `Factura ${ultimaFacturaEmitida.tipoComprobante.toUpperCase()} Autorizada por ARCA (CAE: ${ultimaFacturaEmitida.cae ?? 'OK'})`
                        : `Comprobante listo (${formatearPesos(ultimaVentaParaTicket.total)} - ${ultimaVentaParaTicket.medioCobro}):`}
                    </div>
                    {ultimaFacturaEmitida && (
                      <div className="text-xs text-blue-800">
                        Total {formatearPesos(ultimaFacturaEmitida.total)} · Cliente: {ultimaFacturaEmitida.razonSocialCliente}
                        {ultimaFacturaEmitida.cuitCliente ? ` (${ultimaFacturaEmitida.cuitCliente})` : ''}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {ultimaFacturaEmitida ? (
                    <>
                      <button
                        type="button"
                        data-testid="btn-imprimir-factura-a4"
                        onClick={() => {
                          imprimirComprobanteFiscal(
                            ultimaFacturaEmitida,
                            {
                              razonSocial: 'FERRETERÍA & CORRALÓN S.R.L.',
                              cuit: '30-71234567-8',
                              iibb: '30-71234567-8',
                              inicioActividades: '2020-01-01',
                              domicilio: 'Av. Libertador 1234, CABA',
                              condicionIva: 'IVA Responsable Inscripto',
                            },
                            { formato: 'a4' },
                          );
                        }}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 shadow-sm"
                      >
                        Factura Oficial (A4)
                      </button>
                      <button
                        type="button"
                        data-testid="btn-imprimir-factura-termica"
                        onClick={() => {
                          imprimirTicketTermico({
                            ...ultimaVentaParaTicket,
                            nombreComercio: `FACTURA ${ultimaFacturaEmitida.tipoComprobante.toUpperCase()}`,
                            anchoPapelMm: 80,
                          });
                        }}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 shadow-sm"
                      >
                        Factura Ticket (80mm)
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          imprimirTicketTermico({ ...ultimaVentaParaTicket, anchoPapelMm: 80 });
                        }}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm"
                      >
                        Imprimir 80mm
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          imprimirTicketTermico({ ...ultimaVentaParaTicket, anchoPapelMm: 58 });
                        }}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm"
                      >
                        Imprimir 58mm
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setUltimaVentaParaTicket(null);
                      setUltimaFacturaEmitida(null);
                    }}
                    className="rounded-lg bg-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-300"
                  >
                    ✕ Cerrar
                  </button>
                </div>
              </div>
            )}

                {/* TABLERO DE INICIO */}
            {pestana === 'inicio' && (
              <InicioDashboard
                turnoId={turnoId}
                operadorActivo={operadorActivo}
                nombreCaja={contexto.caja.nombre}
                efectivoEsperado={efectivoEsperadoTotal}
                efectivoInicial={resumen?.efectivoInicial ?? efectivoInicialInput}
                entradasEfectivo={entradasTotalesEfectivo}
                salidasEfectivo={salidasTotalesEfectivo}
                ventasPorMedio={ventasPorMedio}
                ultimoArqueoCerrado={ultimoArqueoCerrado}
                colaPendienteCount={colaPendiente.length}
                modoSinConexion={modoSinConexion}
                onNavegar={setPestana}
              />
            )}

            {/* Tarjetas de Caja / Mostrador (en venta, egreso, arqueo) */}
            {(pestana === 'venta' || pestana === 'egreso' || pestana === 'arqueo') && (
              <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-xl bg-white p-3.5 shadow-sm border border-slate-200">
                  <div className="text-xs text-slate-500">Efectivo inicial</div>
                  <div
                    data-testid="card-efectivo-inicial"
                    className="mt-1 text-lg font-bold text-slate-900"
                  >
                    {formatearPesos(resumen?.efectivoInicial ?? efectivoInicialInput)}
                  </div>
                </div>
                <div className="rounded-xl bg-white p-3.5 shadow-sm border border-slate-200">
                  <div className="text-xs text-slate-500">Entradas en efectivo</div>
                  <div
                    data-testid="card-entradas-efectivo"
                    className="mt-1 text-lg font-bold text-emerald-700"
                  >
                    {formatearPesos(entradasTotalesEfectivo)}
                  </div>
                </div>
                <div className="rounded-xl bg-white p-3.5 shadow-sm border border-slate-200">
                  <div className="text-xs text-slate-500">Salidas / Egresos</div>
                  <div
                    data-testid="card-salidas-efectivo"
                    className="mt-1 text-lg font-bold text-rose-700"
                  >
                    {formatearPesos(salidasTotalesEfectivo)}
                  </div>
                </div>
                <div className="rounded-xl bg-emerald-900 p-3.5 text-white shadow-sm">
                  <div className="text-xs text-emerald-200">
                    Efectivo esperado en cajón
                  </div>
                  <div
                    data-testid="card-efectivo-esperado"
                    className="mt-1 text-xl font-black"
                  >
                    {formatearPesos(efectivoEsperadoTotal)}
                  </div>
                </div>
              </section>
            )}


                {pestana === 'presupuestos' && (
          <Presupuestos
            token={operadorActivo.token}
            rolUsuario={operadorActivo.rol}
            listasPrecios={listasPrecios}
            onCargarAlCarrito={(nuevosItems, contactoNombre) => {
              setItemsCarrito(nuevosItems);
              if (contactoNombre) {
                setDescripcionVenta('Presupuesto ' + contactoNombre);
              }
              setPestana('venta');
              setAviso('Artículos del presupuesto cargados al carrito de mostrador');
            }}
          />
        )}
        {pestana === 'contabilidad' && (
          <Contabilidad
            token={operadorActivo.token}
            rolUsuario={operadorActivo.rol}
          />
        )}
        {pestana === 'facturacion' && (
          <FacturacionFiscal
            token={operadorActivo.token}
            rolUsuario={operadorActivo.rol}
          />
        )}
        {pestana === 'tesoreria' && (
          <TesoreriaFlujo
            token={operadorActivo.token}
            rolUsuario={operadorActivo.rol}
            turnoAbiertoId={turnoId}
          />
        )}

        {pestana === 'compras' && (
          <ComprasProveedores
            token={operadorActivo.token}
            rolUsuario={operadorActivo.rol}
            turnoAbiertoId={turnoId}
            mediosPago={contexto.mediosPago}
            onPagoRegistrado={() => {
              if (turnoId) {
                void cargarResumenTurno(turnoId, operadorActivo.token);
              }
            }}
          />
        )}

        {pestana === 'clientes' && (
          <ClientesCtaCte
            token={operadorActivo.token}
            rolUsuario={operadorActivo.rol}
            turnoAbiertoId={turnoId}
            mediosPago={contexto.mediosPago}
            listasPrecios={listasPrecios}
            onCobranzaRegistrada={() => {
              if (turnoId) {
                void cargarResumenTurno(turnoId, operadorActivo.token);
              }
            }}
          />
        )}

        {pestana === 'catalogo' && (
          <CatalogoStock
            token={operadorActivo.token}
            rolUsuario={operadorActivo.rol}
            rubros={contexto.rubros}
          />
        )}

        {pestana === 'reportes' && (
          <ReportesHistorial
            token={operadorActivo.token}
            cajas={contexto.cajas ?? [contexto.caja]}
            operadores={contexto.operadores}
            rolActivo={operadorActivo.rol}
            onSolicitarRolEncargado={() => {
              const enc = contexto.operadores.find(
                (o) => o.rol === 'encargado' || o.rol === 'dueno',
              );
              if (enc) {
                setOperadorActivo(enc);
              }
            }}
          />
        )}

        {pestana === 'configuracion' && (
          <ConfiguracionPiloto
            token={operadorActivo.token}
            rolActivo={operadorActivo.rol}
            efectivoEsperadoActual={efectivoEsperadoTotal}
            onSolicitarRolDueno={() => {
              const dueno = contexto.operadores.find((o) => o.rol === 'dueno');
              if (dueno) {
                setOperadorActivo(dueno);
              }
            }}
            onCatalogosActualizados={recargarContextoMostrador}
          />
        )}

        {pestana === 'auditoria' && (
          <AuditoriaSistema
            token={operadorActivo.token}
            rolUsuario={operadorActivo.rol}
          />
        )}

        {pestana === 'venta' && (
          !turnoId ? (
            <div className="mx-auto max-w-lg rounded-2xl bg-white p-6 shadow-md border border-slate-200">
              <div className="border-b border-slate-100 pb-4">
                <h2 className="text-xl font-bold text-slate-900">
                  Apertura de Turno — {contexto.caja.nombre}
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Operador: <strong>{operadorActivo.nombre}</strong> ({operadorActivo.rol})
                </p>
              </div>

              {ultimoArqueoCerrado && (
                <div
                  data-testid="resumen-ultimo-arqueo"
                  className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4"
                >
                  <div className="text-sm font-bold text-emerald-900">
                    Último turno cerrado con arqueo
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-emerald-800">
                    <div>
                      Esperado:{' '}
                      <strong>
                        {formatearPesos(ultimoArqueoCerrado.efectivoEsperado)}
                      </strong>
                    </div>
                    <div>
                      Contado:{' '}
                      <strong>
                        {formatearPesos(
                          ultimoArqueoCerrado.efectivoContado ?? '0.00',
                        )}
                      </strong>
                    </div>
                    <div>
                      Diferencia:{' '}
                      <strong data-testid="arqueo-cerrado-diferencia">
                        {formatearPesos(ultimoArqueoCerrado.diferencia ?? '0.00')}
                      </strong>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-5 rounded-xl bg-amber-50 p-4 border border-amber-200">
                <div className="text-xs font-semibold uppercase text-amber-800">
                  Efectivo contado en el último cierre (sugerido)
                </div>
                <div
                  data-testid="efectivo-sugerido"
                  className="mt-1 text-2xl font-black text-amber-950"
                >
                  {formatearPesos(efectivoSugerido)}
                </div>
              </div>

              <div className="mt-4">
                <label
                  htmlFor="input-efectivo-inicial"
                  className="block text-sm font-semibold text-slate-700"
                >
                  Efectivo inicial en el cajón ($)
                </label>
                <input
                  id="input-efectivo-inicial"
                  data-testid="input-efectivo-inicial"
                  type="text"
                  value={efectivoInicialInput}
                  onChange={(e) => {
                    setEfectivoInicialInput(e.target.value);
                  }}
                  className="mt-1 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-xl font-bold text-slate-900"
                />
              </div>

              <button
                type="button"
                data-testid="btn-abrir-turno"
                onClick={() => void abrirTurno()}
                className="mt-6 w-full rounded-xl bg-blue-600 py-4 text-lg font-bold text-white shadow hover:bg-blue-700"
              >
                Abrir turno de caja
              </button>
            </div>
          ) : (
            <div className="space-y-4">
            {/* Barra superior de Venta: Selector de Lista de Precios + Pistola / Buscador */}
            <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Lista de Precios:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {listasPrecios.map((lp) => {
                      const activa = lp.id === listaPrecioIdSeleccionada;
                      return (
                        <button
                          key={lp.id}
                          type="button"
                          data-testid={`btn-lista-precio-${lp.nombre.toLowerCase()}`}
                          onClick={() => {
                            setListaPrecioIdSeleccionada(lp.id);
                          }}
                          className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                            activa
                              ? 'bg-blue-600 text-white shadow'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {lp.nombre} (+{lp.margenPct}%)
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-1 items-center gap-2 min-w-[280px]">
                  <div className="relative flex-1">
                    <input
                      data-testid="input-pistola-codigo"
                      type="text"
                      placeholder="Escanear con pistola o buscar código/artículo (Enter)..."
                      value={busquedaProducto}
                      onChange={(e) => {
                        setBusquedaProducto(e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && busquedaProducto.trim()) {
                          e.preventDefault();
                          void agregarProductoPorCodigo(busquedaProducto);
                        }
                      }}
                      className="w-full rounded-xl border-2 border-blue-400 bg-blue-50/40 px-3.5 py-2 text-sm font-semibold text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-blue-600 font-bold">
                      🔫 Pistola lista
                    </span>
                  </div>
                  <button
                    type="button"
                    data-testid="btn-agregar-codigo"
                    disabled={buscandoProducto || !busquedaProducto.trim()}
                    onClick={() => {
                      void agregarProductoPorCodigo(busquedaProducto);
                    }}
                    className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-blue-700 disabled:opacity-50"
                  >
                    {buscandoProducto ? 'Buscando...' : 'Agregar'}
                  </button>
                </div>
              </div>

              {mensajePistola && (
                <div
                  data-testid="mensaje-pistola"
                  className={`mt-2 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    mensajePistola.startsWith('✓')
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {mensajePistola}
                </div>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-12">
              <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200 md:col-span-7">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    {itemsCarrito.length > 0
                      ? `Detalle de artículos (${itemsCarrito.length})`
                      : 'Importe libre en 1 toque'}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                    Toques en esta venta: {toquesVentaActual}
                  </span>
                </div>

                <div
                  data-testid="visor-monto-venta"
                  className="mt-2 rounded-xl bg-slate-900 px-4 py-4 text-right text-4xl font-black tracking-tight text-white"
                >
                  {formatearPesos(montoVentaFormateado)}
                </div>

                {itemsCarrito.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-600">
                        Ítems en el carrito (descuentan stock al cobrar)
                      </span>
                      <button
                        type="button"
                        data-testid="btn-vaciar-carrito"
                        onClick={() => {
                          setItemsCarrito([]);
                        }}
                        className="text-xs font-bold text-rose-600 hover:underline"
                      >
                        Vaciar carrito
                      </button>
                    </div>

                    <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 border rounded-xl border-slate-200">
                      {itemsCarrito.map((item) => (
                        <div
                          key={item.id}
                          className="p-3 bg-white hover:bg-slate-50 flex flex-col gap-2"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="text-sm font-bold text-slate-900">
                                {item.nombre}
                              </div>
                              <div className="text-xs text-slate-400">
                                Cód: {item.codigo ?? 'S/C'} · Unit: {formatearPesos(item.precioUnitario)}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                eliminarItemCarrito(item.id);
                              }}
                              className="text-slate-400 hover:text-rose-600 p-1"
                              title="Quitar"
                            >
                              ✕
                            </button>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            {item.permiteFraccion ? (
                              <div className="flex items-center gap-1">
                                <span className="text-slate-500">Unidad:</span>
                                <select
                                  value={item.unidad}
                                  onChange={(e) => {
                                    cambiarUnidadItem(
                                      item.id,
                                      e.target.value as 'principal' | 'secundaria',
                                    );
                                  }}
                                  className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-slate-800"
                                >
                                  <option value="principal">
                                    Principal (x{item.factorConversion})
                                  </option>
                                  <option value="secundaria">
                                    Fraccionada (1 u.)
                                  </option>
                                </select>
                              </div>
                            ) : (
                              <span className="text-slate-500 font-semibold">
                                {item.nombreUnidad}
                              </span>
                            )}

                            <div className="flex items-center gap-1">
                              <span className="text-slate-500">Cant:</span>
                              <button
                                type="button"
                                onClick={() => {
                                  const c = Math.max(
                                    0.001,
                                    (parseFloat(item.cantidad) || 1) - 1,
                                  );
                                  actualizarCantidadItem(
                                    item.id,
                                    c.toFixed(3),
                                  );
                                }}
                                className="h-6 w-6 rounded bg-slate-200 font-black text-slate-700 hover:bg-slate-300"
                              >
                                -
                              </button>
                              <input
                                type="text"
                                value={item.cantidad}
                                onChange={(e) => {
                                  actualizarCantidadItem(
                                    item.id,
                                    e.target.value,
                                  );
                                }}
                                className="w-14 rounded border border-slate-300 px-1.5 py-0.5 text-center font-bold text-slate-900"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const c =
                                    (parseFloat(item.cantidad) || 0) + 1;
                                  actualizarCantidadItem(
                                    item.id,
                                    c.toFixed(3),
                                  );
                                }}
                                className="h-6 w-6 rounded bg-slate-200 font-black text-slate-700 hover:bg-slate-300"
                              >
                                +
                              </button>
                            </div>

                            <div className="flex items-center gap-1">
                              <span className="text-slate-500">Desc%:</span>
                              <input
                                type="text"
                                placeholder="0"
                                value={item.descuentoPct}
                                onChange={(e) => {
                                  actualizarDescuentoPctItem(
                                    item.id,
                                    e.target.value,
                                  );
                                }}
                                className="w-10 rounded border border-slate-300 px-1 py-0.5 text-center font-bold text-slate-900"
                              />
                            </div>

                            <div className="font-extrabold text-slate-900 text-sm">
                              {formatearPesos(item.subtotal)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mt-3 grid grid-cols-5 gap-2">
                      {['200', '1000', '2600', '3300', '4700'].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          data-testid={`preset-${preset}`}
                          onClick={() => {
                            setMontoEnteroTeclado(preset);
                            setToquesVentaActual((t) => t + 1);
                          }}
                          className="rounded-lg border border-blue-200 bg-blue-50 py-2 text-xs font-bold text-blue-900 hover:bg-blue-100"
                        >
                          $ {preset.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
                        </button>
                      ))}
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2.5">
                      {['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00', 'C'].map(
                        (tecla) => (
                          <button
                            key={tecla}
                            type="button"
                            data-testid={`tecla-${tecla}`}
                            onClick={() => {
                              setMontoEnteroTeclado((prev) =>
                                agregarDigitoTeclado(prev, tecla),
                              );
                              setToquesVentaActual((t) => t + 1);
                            }}
                            className={`rounded-xl py-4 text-2xl font-extrabold shadow-xs transition active:scale-95 ${
                              tecla === 'C'
                                ? 'bg-rose-100 text-rose-800 hover:bg-rose-200'
                                : 'bg-slate-100 text-slate-900 hover:bg-slate-200'
                            }`}
                          >
                            {tecla === 'C' ? 'Borrar' : tecla}
                          </button>
                        ),
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="flex flex-col justify-between rounded-2xl bg-white p-5 shadow-sm border border-slate-200 md:col-span-5">
                <div className="space-y-5">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Medio de pago (1 toque)
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2">
                      {contexto.mediosPago.map((mp) => {
                        const activo = mp.id === medioPagoIdSeleccionado;
                        return (
                          <button
                            key={mp.id}
                            type="button"
                            data-testid={`medio-${mp.nombre}`}
                            onClick={() => {
                              setMedioPagoIdSeleccionado(mp.id);
                              setToquesVentaActual((t) => t + 1);
                            }}
                            className={`flex items-center justify-between rounded-xl border-2 px-4 py-3 text-left font-bold transition ${
                              activo
                                ? 'border-blue-600 bg-blue-50 text-blue-950'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <span>{mp.nombre}</span>
                            <span className="text-xs font-semibold text-slate-500">
                              {mp.esEfectivo ? 'Suma al cajón' : 'No suma al cajón'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Rubro (1 toque)
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {contexto.rubros.map((r) => {
                        const activo = r.id === rubroIdSeleccionado;
                        return (
                          <button
                            key={r.id}
                            type="button"
                            data-testid={`rubro-${r.nombre}`}
                            onClick={() => {
                              setRubroIdSeleccionado(r.id);
                              setToquesVentaActual((t) => t + 1);
                            }}
                            className={`rounded-xl border-2 px-3.5 py-2 text-sm font-bold transition ${
                              activo
                                ? 'border-amber-500 bg-amber-100 text-amber-950'
                                : 'border-slate-200 bg-slate-50 text-slate-700'
                            }`}
                          >
                            {r.nombre}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Selector de Cliente y Autorizado */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Cliente (Cuenta Corriente / Ficha)
                      </div>
                      {clienteSeleccionadoVenta ? (
                        <button
                          type="button"
                          onClick={() => void seleccionarClienteVenta(null)}
                          className="text-xs font-bold text-rose-600 hover:underline"
                        >
                          Quitar cliente
                        </button>
                      ) : (
                        <button
                          type="button"
                          data-testid="btn-seleccionar-cliente"
                          onClick={() => {
                            setModalBuscarClienteVenta(true);
                            void buscarClientesParaVenta('', operadorActivo.token);
                          }}
                          className="text-xs font-bold text-indigo-600 hover:underline"
                        >
                          + Asignar Cliente
                        </button>
                      )}
                    </div>

                    {clienteSeleccionadoVenta ? (
                      <div className="mt-2 space-y-2">
                        <div className="flex items-center justify-between rounded-lg bg-white p-2.5 border border-slate-200 shadow-sm">
                          <div>
                            <div className="font-bold text-sm text-slate-900">
                              <span className="font-mono text-xs text-indigo-600 font-bold mr-1.5">
                                {clienteSeleccionadoVenta.codigo}
                              </span>
                              {clienteSeleccionadoVenta.nombre}
                            </div>
                            <div className="text-xs text-slate-500">
                              {clienteSeleccionadoVenta.cuitDni
                                ? `CUIT/DNI ${clienteSeleccionadoVenta.cuitDni} · `
                                : ''}
                              Lista: {clienteSeleccionadoVenta.listaPrecioNombre ?? 'Mostrador'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs font-bold text-slate-500">Saldo Deudor</div>
                            <div
                              className={`font-mono text-xs font-bold ${
                                parseFloat(clienteSeleccionadoVenta.saldoDeudor) > 0
                                  ? 'text-rose-600'
                                  : 'text-emerald-700'
                              }`}
                            >
                              {formatearPesos(clienteSeleccionadoVenta.saldoDeudor)}
                            </div>
                          </div>
                        </div>

                        {/* Si el medio de pago seleccionado es Cuenta Corriente */}
                        {contexto.mediosPago
                          .find((m) => m.id === medioPagoIdSeleccionado)
                          ?.nombre.toLowerCase()
                          .includes('corriente') && (
                          <div className="rounded-lg bg-amber-50 p-2.5 border border-amber-200">
                            <label className="block text-xs font-bold text-amber-900 mb-1">
                              Persona que retira mercadería:
                            </label>
                            <select
                              value={autorizadoRetiroIdSeleccionado}
                              onChange={(e) => {
                                setAutorizadoRetiroIdSeleccionado(e.target.value);
                              }}
                              className="w-full rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none"
                            >
                              <option value="">
                                Titular de la cuenta ({clienteSeleccionadoVenta.nombre})
                              </option>
                              {autorizadosClienteVenta.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.nombre} {a.dni ? `(DNI ${a.dni})` : ''}{' '}
                                  {a.rolParentesco ? `- ${a.rolParentesco}` : ''}
                                </option>
                              ))}
                            </select>
                            {clienteSeleccionadoVenta.excedidoLimite && (
                              <p className="mt-1 text-[11px] font-bold text-rose-700">
                                ⚠️ Atención: este cliente superó su límite de crédito asignado.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-1 flex items-center justify-between text-xs text-slate-600">
                        <span>Consumidor Final (Mostrador)</span>
                        <button
                          type="button"
                          onClick={() => {
                            setModalBuscarClienteVenta(true);
                            void buscarClientesParaVenta('', operadorActivo.token);
                          }}
                          className="rounded-lg bg-white px-2.5 py-1 font-semibold text-slate-700 border border-slate-200 hover:bg-slate-100"
                        >
                          Buscar
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="input-descripcion-venta"
                      className="block text-xs font-bold uppercase tracking-wider text-slate-500"
                    >
                      Descripción (opcional)
                    </label>
                    <input
                      id="input-descripcion-venta"
                      data-testid="input-descripcion-venta"
                      type="text"
                      placeholder="Ej: Tornillos autoperforantes / cable 2.5mm"
                      value={descripcionVenta}
                      onChange={(e) => {
                        setDescripcionVenta(e.target.value);
                      }}
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm"
                    />
                  </div>

                  {/* Opción de Facturación Electrónica ARCA */}
                  <div
                    data-testid="caja-facturacion-mostrador"
                    className={`rounded-xl border p-3 transition ${
                      emitirFacturaElectronica
                        ? 'border-blue-400 bg-blue-50/70 shadow-xs'
                        : 'border-slate-200 bg-slate-50/50'
                    }`}
                  >
                    <label className="flex items-center justify-between cursor-pointer">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          data-testid="check-emitir-factura"
                          checked={emitirFacturaElectronica}
                          onChange={(e) => {
                            setEmitirFacturaElectronica(e.target.checked);
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div>
                          <span className="text-xs font-bold text-slate-800">
                            🧾 Emitir Factura Electrónica ARCA
                          </span>
                          <p className="text-[11px] text-slate-500">
                            {clienteSeleccionadoVenta?.condicionIva === 'responsable_inscripto'
                              ? 'Emitirá Factura A (Cliente Resp. Inscripto)'
                              : 'Emitirá Factura B (Consumidor Final)'}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                          emitirFacturaElectronica
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {clienteSeleccionadoVenta?.condicionIva === 'responsable_inscripto'
                          ? 'FACTURA A'
                          : 'FACTURA B'}
                      </span>
                    </label>
                  </div>
                </div>

                <button
                  type="button"
                  data-testid="btn-cobrar-venta"
                  onClick={() => void registrarVentaRapida()}
                  className="mt-6 w-full rounded-2xl bg-emerald-600 py-5 text-xl font-black text-white shadow-lg transition hover:bg-emerald-700 active:scale-98"
                >
                  COBRAR {formatearPesos(montoVentaFormateado)}
                </button>
              </div>
            </div>
          </div>
        )
      )}

        {pestana === 'egreso' && (
          !turnoId ? (
            <div className="rounded-2xl bg-white p-8 text-center shadow-sm border border-slate-200">
              <div className="text-4xl mb-2">🔒</div>
              <h3 className="text-lg font-bold text-slate-800">Turno de caja cerrado</h3>
              <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                Para registrar egresos o gastos del turno, primero abrí un turno en la pestaña <strong>1. Venta Rápida</strong>.
              </p>
              <button
                type="button"
                onClick={() => {
                  setPestana('venta');
                }}
                className="mt-4 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
              >
                Ir a apertura de turno
              </button>
            </div>
          ) : (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200">
            <h2 className="text-lg font-bold text-slate-900">
              Registrar Egreso de Caja
            </h2>
            <p className="text-xs text-slate-500">
              Descuenta del efectivo esperado del turno y queda registrado por categoría.
            </p>

            <div className="mt-4">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Categoría del gasto (1 toque)
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {contexto.categorias.map((cat) => {
                  const activa = cat.id === categoriaEgresoId;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      data-testid={`categoria-${cat.nombre}`}
                      onClick={() => {
                        setCategoriaEgresoId(cat.id);
                      }}
                      className={`rounded-xl border-2 px-4 py-2.5 text-sm font-bold ${
                        activa
                          ? 'border-rose-600 bg-rose-50 text-rose-950'
                          : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      {cat.nombre}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label
                  htmlFor="input-monto-egreso"
                  className="block text-sm font-semibold text-slate-700"
                >
                  Monto del egreso ($)
                </label>
                <input
                  id="input-monto-egreso"
                  data-testid="input-monto-egreso"
                  type="text"
                  placeholder="Ej: 300.00"
                  value={montoEgresoInput}
                  onChange={(e) => {
                    setMontoEgresoInput(e.target.value);
                  }}
                  className="mt-1 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-xl font-bold"
                />
              </div>
              <div>
                <label
                  htmlFor="input-descripcion-egreso"
                  className="block text-sm font-semibold text-slate-700"
                >
                  Motivo / Comprobante
                </label>
                <input
                  id="input-descripcion-egreso"
                  data-testid="input-descripcion-egreso"
                  type="text"
                  placeholder="Ej: Pago flete proveedor bulones"
                  value={descripcionEgreso}
                  onChange={(e) => {
                    setDescripcionEgreso(e.target.value);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                />
              </div>
            </div>

            <button
              type="button"
              data-testid="btn-registrar-egreso"
              onClick={() => void registrarEgreso()}
              className="mt-6 w-full rounded-xl bg-rose-600 py-4 text-lg font-bold text-white shadow hover:bg-rose-700"
            >
              Registrar Egreso
            </button>
          </div>
        )
      )}

        {pestana === 'arqueo' && (
          !turnoId ? (
            <div className="rounded-2xl bg-white p-8 text-center shadow-sm border border-slate-200">
              <div className="text-4xl mb-2">📋</div>
              <h3 className="text-lg font-bold text-slate-800">No hay un turno abierto para arquear</h3>
              <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                El turno actual se encuentra cerrado. Podés abrir uno nuevo en la pestaña <strong>1. Venta Rápida</strong> o consultar el historial en <strong>4. Reportes e Historial</strong>.
              </p>
              <button
                type="button"
                onClick={() => {
                  setPestana('venta');
                }}
                className="mt-4 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
              >
                Ir a apertura de turno
              </button>
            </div>
          ) : (
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Cierre de Turno con Arqueo de Caja
                </h2>
                <p className="text-xs text-slate-500">
                  Contá los billetes del cajón y compará contra el efectivo esperado.
                </p>
              </div>
              {operadorActivo.rol === 'cajero' && (
                <button
                  type="button"
                  data-testid="btn-cambiar-a-encargado"
                  onClick={() => {
                    const enc = contexto.operadores.find(
                      (o) => o.rol === 'encargado' || o.rol === 'dueno',
                    );
                    if (enc) {
                      setOperadorActivo(enc);
                    }
                  }}
                  className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900 border border-amber-300"
                >
                  Autorizar como Encargado ({contexto.operadores[1]?.nombre})
                </button>
              )}
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-4 border border-slate-200">
                <div className="text-xs font-semibold uppercase text-slate-500">
                  Efectivo esperado
                </div>
                <div
                  data-testid="arqueo-esperado"
                  className="mt-1 text-2xl font-black text-slate-900"
                >
                  {formatearPesos(efectivoEsperadoTotal)}
                </div>
              </div>

              <div className="rounded-xl bg-blue-50 p-4 border border-blue-200">
                <label
                  htmlFor="input-efectivo-contado"
                  className="block text-xs font-semibold uppercase text-blue-900"
                >
                  Efectivo contado en cajón ($)
                </label>
                <input
                  id="input-efectivo-contado"
                  data-testid="input-efectivo-contado"
                  type="text"
                  placeholder="Ej: 5800.00"
                  value={efectivoContadoInput}
                  onChange={(e) => {
                    setEfectivoContadoInput(e.target.value);
                  }}
                  className="mt-1 w-full rounded-lg border-2 border-blue-400 bg-white px-3 py-2 text-xl font-black text-slate-900"
                />
              </div>

              <div className="rounded-xl bg-amber-50 p-4 border border-amber-200">
                <div className="text-xs font-semibold uppercase text-amber-900">
                  Diferencia (Contado - Esperado)
                </div>
                <div
                  data-testid="arqueo-diferencia"
                  className="mt-1 text-2xl font-black text-amber-950"
                >
                  {diferenciaPreviewDecimal !== null
                    ? formatearPesos(diferenciaPreviewDecimal)
                    : '—'}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <label
                htmlFor="input-notas-cierre"
                className="block text-sm font-semibold text-slate-700"
              >
                Observaciones del arqueo (opcional)
              </label>
              <input
                id="input-notas-cierre"
                data-testid="input-notas-cierre"
                type="text"
                placeholder="Ej: Arqueo conforme al cierre del día"
                value={notasCierreInput}
                onChange={(e) => {
                  setNotasCierreInput(e.target.value);
                }}
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
              />
            </div>

            <button
              type="button"
              data-testid="btn-cerrar-turno"
              onClick={() => void cerrarTurnoConArqueo()}
              className="mt-6 w-full rounded-xl bg-slate-900 py-4 text-lg font-bold text-white shadow hover:bg-slate-800"
            >
              Confirmar Arqueo y Cerrar Turno
            </button>
          </div>
        )
      )}

        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">
                Ventas confirmadas por medio de cobro y rubro
              </h3>
              {ventasPorMedio.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const columnas = ['Medio de Cobro', 'Rubro', 'Total ($)'];
                    const filas = ventasPorMedio.map((v) => [v.medioPago, v.rubro, v.total]);
                    exportarACSV(`ventas_turno_${turnoId ?? 'actual'}`, columnas, filas);
                  }}
                  className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 shadow-sm"
                >
                  Exportar a Excel 📊
                </button>
              )}
            </div>
            {ventasPorMedio.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                Todavía no hay ventas confirmadas en este turno.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100 text-sm">
                {ventasPorMedio.map((v, idx) => (
                  <li
                    key={`${v.medioPago}-${v.rubro}-${idx}`}
                    className="flex items-center justify-between py-2"
                  >
                    <span className="font-medium text-slate-700">
                      {v.medioPago} · <span className="text-slate-500">{v.rubro}</span>
                    </span>
                    <span className="font-bold text-slate-900">
                      {formatearPesos(v.total)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200">
            <h3 className="text-sm font-bold text-slate-800">
              Cola local sin conexión (IndexedDB)
            </h3>
            {colaPendiente.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                Todas las operaciones están sincronizadas con el servidor.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100 text-sm">
                {colaPendiente.map((op) => (
                  <li
                    key={op.id}
                    className="flex items-center justify-between py-2"
                  >
                    <div>
                      <span className="font-semibold text-amber-800">
                        {op.resumenLocal.etiqueta}
                      </span>
                      <span className="ml-2 text-xs text-slate-400">
                        ID: {op.id.slice(0, 8)}
                      </span>
                    </div>
                    <span className="font-bold text-slate-900">
                      {formatearPesos(op.resumenLocal.monto)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Modal Selección de Cliente en Venta Mostrador */}
        {modalBuscarClienteVenta && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
            data-testid="modal-buscar-cliente-venta"
          >
            <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
                <h3 className="text-base font-black text-slate-900">
                  Seleccionar Cliente para la Venta
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setModalBuscarClienteVenta(false);
                  }}
                  className="text-slate-400 hover:text-slate-700 text-lg"
                >
                  ✕
                </button>
              </div>

              <div className="mb-4">
                <input
                  type="text"
                  autoFocus
                  placeholder="Buscar por nombre, código o CUIT/DNI..."
                  value={busquedaClienteVenta}
                  onChange={(e) => {
                    const val = e.target.value;
                    setBusquedaClienteVenta(val);
                    void buscarClientesParaVenta(val, operadorActivo.token);
                  }}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="max-h-64 overflow-y-auto space-y-2">
                {buscandoClienteVenta ? (
                  <div className="py-6 text-center text-xs text-slate-400">Buscando...</div>
                ) : clientesSugeridosVenta.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400">
                    No se encontraron clientes con ese criterio.
                  </div>
                ) : (
                  clientesSugeridosVenta.map((c) => (
                    <div
                      key={c.id}
                      data-testid={`opcion-cliente-${c.codigo}`}
                      onClick={() => {
                        void seleccionarClienteVenta(c);
                      }}
                      className="flex items-center justify-between rounded-xl border border-slate-200 p-3 hover:border-indigo-500 hover:bg-indigo-50/50 cursor-pointer transition"
                    >
                      <div>
                        <div className="font-bold text-sm text-slate-900">
                          <span className="font-mono text-xs text-indigo-600 mr-2 font-bold">
                            {c.codigo}
                          </span>
                          {c.nombre}
                        </div>
                        <div className="text-xs text-slate-500">
                          {c.cuitDni || 'Sin CUIT'} · {c.condicionIva.replace('_', ' ')} · Lista:{' '}
                          {c.listaPrecioNombre ?? 'Mostrador'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-bold text-slate-500">Saldo</div>
                        <div
                          className={`font-mono text-xs font-bold ${
                            parseFloat(c.saldoDeudor) > 0
                              ? 'text-rose-600'
                              : 'text-emerald-700'
                          }`}
                        >
                          {formatearPesos(c.saldoDeudor)}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-4 flex justify-between border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    void seleccionarClienteVenta(null);
                  }}
                  className="text-xs font-bold text-slate-600 hover:underline"
                >
                  Mantener Consumidor Final
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModalBuscarClienteVenta(false);
                  }}
                  className="rounded-xl border border-slate-300 px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
        </main>

        {/* BOTTOM NAV PARA MÓVILES */}
        <nav className="fixed bottom-0 inset-x-0 z-30 flex h-14 border-t border-slate-200 bg-white shadow-lg lg:hidden items-center justify-around text-[10px] font-bold text-slate-600">
          <button
            type="button"
            onClick={() => { setPestana('inicio'); }}
            className={`flex flex-col items-center gap-0.5 py-1 ${pestana === 'inicio' ? 'text-emerald-600' : ''}`}
          >
            <span className="text-base">🏠</span>
            <span>Inicio</span>
          </button>
          <button
            type="button"
            onClick={() => { setPestana('venta'); }}
            className={`flex flex-col items-center gap-0.5 py-1 ${pestana === 'venta' ? 'text-emerald-600' : ''}`}
          >
            <span className="text-base">🛒</span>
            <span>Vender</span>
          </button>
          <button
            type="button"
            onClick={() => { setPestana('presupuestos'); }}
            className={`flex flex-col items-center gap-0.5 py-1 ${pestana === 'presupuestos' ? 'text-emerald-600' : ''}`}
          >
            <span className="text-base">📝</span>
            <span>Cotizar</span>
          </button>
          <button
            type="button"
            onClick={() => { setPestana('catalogo'); }}
            className={`flex flex-col items-center gap-0.5 py-1 ${pestana === 'catalogo' ? 'text-emerald-600' : ''}`}
          >
            <span className="text-base">📦</span>
            <span>Stock</span>
          </button>
          <button
            type="button"
            onClick={() => { setSidebarAbierto(true); }}
            className="flex flex-col items-center gap-0.5 py-1 text-slate-700"
          >
            <span className="text-base">☰</span>
            <span>Menú</span>
          </button>
        </nav>
      </div>
    </div>
  );
}