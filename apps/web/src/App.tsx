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
    'venta' | 'egreso' | 'arqueo' | 'reportes' | 'configuracion'
  >('venta');

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

  const montoVentaFormateado = `${montoEnteroTeclado}.00`;

  const abrirTurno = async (): Promise<void> => {
    if (!operadorActivo) {
      return;
    }
    setUltimoArqueoCerrado(null);
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

    const ventaId = generarUuid();
    const movimientoId = generarUuid();
    const payload = {
      id: ventaId,
      turnoId,
      total: montoVentaFormateado,
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
        etiqueta: `${medioSeleccionado.nombre} · ${rubroSeleccionado?.nombre ?? 'Sin rubro'}`,
      },
      creadoEn: new Date().toISOString(),
      intentos: 0,
    };

    const toquesUsados = toquesVentaActual + 1;
    setMontoEnteroTeclado('0');
    setDescripcionVenta('');
    setToquesVentaActual(0);

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

  if (!turnoId) {
    return (
      <main className="min-h-screen bg-slate-100 p-4 md:p-8">
        <div className="mx-auto max-w-lg rounded-2xl bg-white p-6 shadow-md border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">
                Apertura de Turno — {contexto.caja.nombre}
              </h1>
              <p className="text-xs text-slate-500">
                Operador: <strong>{operadorActivo.nombre}</strong> ({operadorActivo.rol})
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOperadorActivo(null);
              }}
              className="text-xs font-medium text-slate-500 underline"
            >
              Cambiar operador
            </button>
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
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 pb-10">
      <header className="bg-slate-900 text-white px-4 py-3 shadow">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-slate-400">
              {contexto.negocioNombre} · {contexto.caja.nombre}
            </div>
            <div className="text-base font-bold">
              Turno abierto · Cajón esperado:{' '}
              <span
                data-testid="header-efectivo-esperado"
                className="text-emerald-400"
              >
                {formatearPesos(efectivoEsperadoTotal)}
              </span>
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
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                modoSinConexion
                  ? 'bg-rose-600 text-white'
                  : 'bg-emerald-600 text-white'
              }`}
            >
              {modoSinConexion ? 'SIN CONEXIÓN (Offline)' : 'EN LÍNEA (Online)'}
            </button>

            <div
              data-testid="badge-cola-offline"
              className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold border border-slate-700"
            >
              <span>
                Cola local:{' '}
                <strong data-testid="contador-cola-offline">
                  {colaPendiente.length}
                </strong>
              </span>
              {colaPendiente.length > 0 && !modoSinConexion && (
                <button
                  type="button"
                  data-testid="btn-sincronizar-cola"
                  disabled={sincronizando}
                  onClick={() => void ejecutarSincronizacion()}
                  className="rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-slate-950"
                >
                  {sincronizando ? 'Sincronizando...' : 'Sincronizar'}
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 pt-4">
        {aviso && (
          <div
            data-testid="banner-aviso"
            className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-950"
          >
            {aviso}
          </div>
        )}

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

        <nav className="mb-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-200 p-1 md:grid-cols-5">
          <button
            type="button"
            data-testid="tab-venta"
            onClick={() => {
              setPestana('venta');
            }}
            className={`rounded-lg py-2.5 text-sm font-bold transition ${
              pestana === 'venta'
                ? 'bg-white text-slate-900 shadow'
                : 'text-slate-700'
            }`}
          >
            1. Venta Rápida
          </button>
          <button
            type="button"
            data-testid="tab-egreso"
            onClick={() => {
              setPestana('egreso');
            }}
            className={`rounded-lg py-2.5 text-sm font-bold transition ${
              pestana === 'egreso'
                ? 'bg-white text-slate-900 shadow'
                : 'text-slate-700'
            }`}
          >
            2. Egresos / Gastos
          </button>
          <button
            type="button"
            data-testid="tab-arqueo"
            onClick={() => {
              setPestana('arqueo');
            }}
            className={`rounded-lg py-2.5 text-sm font-bold transition ${
              pestana === 'arqueo'
                ? 'bg-white text-slate-900 shadow'
                : 'text-slate-700'
            }`}
          >
            3. Cerrar con Arqueo
          </button>
          <button
            type="button"
            data-testid="tab-reportes"
            onClick={() => {
              setPestana('reportes');
            }}
            className={`rounded-lg py-2.5 text-sm font-bold transition ${
              pestana === 'reportes'
                ? 'bg-white text-slate-900 shadow'
                : 'text-slate-700'
            }`}
          >
            4. Reportes e Historial
          </button>
          <button
            type="button"
            data-testid="tab-configuracion"
            onClick={() => {
              setPestana('configuracion');
            }}
            className={`rounded-lg py-2.5 text-sm font-bold transition ${
              pestana === 'configuracion'
                ? 'bg-white text-slate-900 shadow'
                : 'text-slate-700'
            }`}
          >
            5. Config. y Piloto
          </button>
        </nav>

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

        {pestana === 'venta' && (
          <div className="grid gap-4 md:grid-cols-12">
            <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200 md:col-span-7">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Importe a cobrar
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
        )}

        {pestana === 'egreso' && (
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
        )}

        {pestana === 'arqueo' && (
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
        )}

        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-200">
            <h3 className="text-sm font-bold text-slate-800">
              Ventas confirmadas por medio de cobro y rubro
            </h3>
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
      </div>
    </main>
  );
}
