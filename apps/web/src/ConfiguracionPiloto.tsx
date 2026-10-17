import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { aCentavos, deCentavos, type RolUsuario } from '@ferreteria/shared';
import { apiUrl } from './api-url.js';
import { formatearPesos } from './App.js';

interface MedioPagoConfigItem {
  id: string;
  nombre: string;
  esEfectivo: boolean;
  diasAcreditacion: number;
  comisionPct: string;
  activo: boolean;
}

interface RubroConfigItem {
  id: string;
  nombre: string;
}

interface CategoriaConfigItem {
  id: string;
  nombre: string;
  tipo: 'ingreso' | 'egreso';
}

interface RegistroBitacoraPiloto {
  fecha: string;
  efectivoSistema: string;
  efectivoPlanilla: string;
  diferenciaConPlanilla: string;
  observacion: string;
  registradoEn: string;
}

export interface ConfiguracionPilotoProps {
  token: string;
  rolActivo: RolUsuario;
  efectivoEsperadoActual: string;
  onSolicitarRolDueno: () => void;
  onCatalogosActualizados: () => Promise<void>;
}

const STORAGE_KEY_PILOTO = 'ferreteria_bitacora_piloto_v1';

function hoyIsoLocal(): string {
  const ahora = new Date();
  const anio = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const dia = String(ahora.getDate()).padStart(2, '0');
  return `${String(anio)}-${mes}-${dia}`;
}

export function ConfiguracionPiloto({
  token,
  rolActivo,
  efectivoEsperadoActual,
  onSolicitarRolDueno,
  onCatalogosActualizados,
}: ConfiguracionPilotoProps): ReactElement {
  const [mediosPago, setMediosPago] = useState<MedioPagoConfigItem[]>([]);
  const [rubros, setRubros] = useState<RubroConfigItem[]>([]);
  const [categorias, setCategorias] = useState<CategoriaConfigItem[]>([]);
  const [estadoSalud, setEstadoSalud] = useState<string>('verificando...');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Formulario de medio de pago
  const [medioEditId, setMedioEditId] = useState<string | null>(null);
  const [medioNombre, setMedioNombre] = useState<string>('');
  const [medioEsEfectivo, setMedioEsEfectivo] = useState<boolean>(false);
  const [medioDiasAcreditacion, setMedioDiasAcreditacion] =
    useState<string>('1');
  const [medioComisionPct, setMedioComisionPct] = useState<string>('0.00');

  // Formulario de rubro
  const [nuevoRubroNombre, setNuevoRubroNombre] = useState<string>('');

  // Formulario de categoría
  const [nuevaCategoriaNombre, setNuevaCategoriaNombre] = useState<string>('');
  const [nuevaCategoriaTipo, setNuevaCategoriaTipo] = useState<
    'ingreso' | 'egreso'
  >('egreso');

  // Bitácora diaria del piloto en paralelo (comparación sistema vs planilla/cuaderno)
  const [fechaPiloto, setFechaPiloto] = useState<string>(hoyIsoLocal());
  const [efectivoPlanillaInput, setEfectivoPlanillaInput] = useState<string>(
    efectivoEsperadoActual,
  );
  const [observacionPilotoInput, setObservacionPilotoInput] =
    useState<string>('');
  const [bitacoraPiloto, setBitacoraPiloto] = useState<
    RegistroBitacoraPiloto[]
  >(() => {
    try {
      const guardado = localStorage.getItem(STORAGE_KEY_PILOTO);
      if (guardado) {
        return JSON.parse(guardado) as RegistroBitacoraPiloto[];
      }
    } catch {
      // Ignorar errores de almacenamiento local
    }
    return [];
  });

  const cargarCatalogos = useCallback(async () => {
    try {
      const [resCat, resHealth] = await Promise.all([
        fetch(apiUrl('/api/configuracion/catalogos'), {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(apiUrl('/api/health/ready')),
      ]);

      if (resHealth.ok) {
        const healthData = (await resHealth.json()) as {
          status: string;
          dbRole: string;
        };
        setEstadoSalud(
          `OK (${healthData.status} · RLS: ${healthData.dbRole})`,
        );
      }

      if (!resCat.ok) {
        return;
      }
      const data = (await resCat.json()) as {
        mediosPago: MedioPagoConfigItem[];
        rubros: RubroConfigItem[];
        categorias: CategoriaConfigItem[];
      };
      setMediosPago(data.mediosPago);
      setRubros(data.rubros);
      setCategorias(data.categorias);
    } catch {
      setErrorMsg('No se pudieron cargar los catálogos de configuración.');
    }
  }, [token]);

  useEffect(() => {
    if (rolActivo === 'dueno' || rolActivo === 'encargado') {
      void cargarCatalogos();
    }
  }, [rolActivo, cargarCatalogos]);

  const guardarMedioPago = async () => {
    setMensaje(null);
    setErrorMsg(null);
    const dias = Number.parseInt(medioDiasAcreditacion, 10);
    if (!medioNombre.trim() || Number.isNaN(dias) || dias < 0) {
      setErrorMsg('Completá nombre y días de acreditación válidos.');
      return;
    }

    const res = await fetch(apiUrl('/api/configuracion/medios-pago'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...(medioEditId !== null ? { id: medioEditId } : {}),
        nombre: medioNombre.trim(),
        esEfectivo: medioEsEfectivo,
        diasAcreditacion: dias,
        comisionPct: medioComisionPct.trim(),
        activo: true,
      }),
    });

    if (!res.ok) {
      const errBody = (await res.json()) as { error?: string };
      setErrorMsg(errBody.error ?? 'No se pudo guardar el medio de pago.');
      return;
    }

    setMedioEditId(null);
    setMedioNombre('');
    setMedioEsEfectivo(false);
    setMedioDiasAcreditacion('1');
    setMedioComisionPct('0.00');
    setMensaje('Medio de pago guardado correctamente.');
    await cargarCatalogos();
    await onCatalogosActualizados();
  };

  const guardarRubro = async () => {
    setMensaje(null);
    setErrorMsg(null);
    if (!nuevoRubroNombre.trim()) {
      setErrorMsg('Ingresá el nombre del rubro.');
      return;
    }

    const res = await fetch(apiUrl('/api/configuracion/rubros'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        nombre: nuevoRubroNombre.trim(),
        activo: true,
      }),
    });

    if (!res.ok) {
      const errBody = (await res.json()) as { error?: string };
      setErrorMsg(errBody.error ?? 'No se pudo guardar el rubro.');
      return;
    }

    setNuevoRubroNombre('');
    setMensaje('Rubro guardado correctamente.');
    await cargarCatalogos();
    await onCatalogosActualizados();
  };

  const guardarCategoria = async () => {
    setMensaje(null);
    setErrorMsg(null);
    if (!nuevaCategoriaNombre.trim()) {
      setErrorMsg('Ingresá el nombre de la categoría.');
      return;
    }

    const res = await fetch(apiUrl('/api/configuracion/categorias'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        nombre: nuevaCategoriaNombre.trim(),
        tipo: nuevaCategoriaTipo,
        activo: true,
      }),
    });

    if (!res.ok) {
      const errBody = (await res.json()) as { error?: string };
      setErrorMsg(errBody.error ?? 'No se pudo guardar la categoría.');
      return;
    }

    setNuevaCategoriaNombre('');
    setMensaje('Categoría guardada correctamente.');
    await cargarCatalogos();
    await onCatalogosActualizados();
  };

  const registrarComparacionPiloto = () => {
    setMensaje(null);
    setErrorMsg(null);
    try {
      const sistemaCents = aCentavos(efectivoEsperadoActual);
      const planillaCents = aCentavos(efectivoPlanillaInput.trim());
      const diffCents = sistemaCents - planillaCents;

      const nuevoRegistro: RegistroBitacoraPiloto = {
        fecha: fechaPiloto,
        efectivoSistema: deCentavos(sistemaCents),
        efectivoPlanilla: deCentavos(planillaCents),
        diferenciaConPlanilla: deCentavos(diffCents),
        observacion:
          observacionPilotoInput.trim() ||
          (diffCents === 0n
            ? 'Cierre verificado sin diferencias contra planilla'
            : 'Diferencia revisada en arqueo paralelo'),
        registradoEn: new Date().toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };

      const actualizada = [
        nuevoRegistro,
        ...bitacoraPiloto.filter((r) => r.fecha !== fechaPiloto),
      ];
      setBitacoraPiloto(actualizada);
      localStorage.setItem(STORAGE_KEY_PILOTO, JSON.stringify(actualizada));
      setObservacionPilotoInput('');
      setMensaje(
        `Comparación del día ${fechaPiloto} registrada en la bitácora del piloto.`,
      );
    } catch {
      setErrorMsg(
        'Ingresá un monto de planilla válido con dos decimales (ej: 5800.00).',
      );
    }
  };

  if (rolActivo !== 'dueno') {
    return (
      <div
        data-testid="panel-requiere-dueno"
        className="rounded-2xl bg-white p-6 shadow-sm border border-amber-300"
      >
        <h2 className="text-lg font-bold text-slate-900">
          Etapa 4: Configuración del Negocio y Piloto en Paralelo
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Para cargar o editar los medios de pago reales (con días de acreditación y
          comisiones), rubros y categorías de la ferretería se requiere rol{' '}
          <strong>Dueño</strong>.
        </p>
        <button
          type="button"
          data-testid="btn-autorizar-dueno"
          onClick={() => {
            onSolicitarRolDueno();
          }}
          className="mt-4 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow hover:bg-slate-800"
        >
          Autorizar como Dueño (Roberto)
        </button>
      </div>
    );
  }

  const diasSinDiferencias = bitacoraPiloto.filter(
    (r) => r.diferenciaConPlanilla === '0.00',
  ).length;

  return (
    <div data-testid="vista-configuracion-piloto" className="space-y-6">
      <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Etapa 4 — Configuración Real y Piloto en Paralelo
            </h2>
            <p className="text-xs text-slate-500">
              Medios de cobro con días de acreditación y comisiones, rubros del
              mostrador y comparación diaria contra la planilla actual.
            </p>
          </div>
          <span
            data-testid="badge-salud-sistema"
            className="rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-bold text-emerald-800"
          >
            Monitoreo API: {estadoSalud}
          </span>
        </div>

        {mensaje && (
          <div
            data-testid="config-mensaje-ok"
            className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-xs font-bold text-emerald-900"
          >
            {mensaje}
          </div>
        )}
        {errorMsg && (
          <div
            data-testid="config-mensaje-error"
            className="mt-3 rounded-xl bg-rose-50 border border-rose-200 px-4 py-2.5 text-xs font-bold text-rose-900"
          >
            {errorMsg}
          </div>
        )}
      </div>

      {/* 1. Medios de pago con días de acreditación y comisiones */}
      <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
        <h3 className="text-base font-bold text-slate-900">
          Medios de Pago (días de acreditación y comisiones)
        </h3>
        <p className="text-xs text-slate-500">
          Solo los medios marcados como <strong>Es efectivo</strong> suman al cajón
          físico. Los días de acreditación y porcentaje de comisión alimentan los
          reportes y el flujo de caja.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 uppercase">
                <th className="py-2 pr-3">Medio de Pago</th>
                <th className="py-2 pr-3">Suma al cajón</th>
                <th className="py-2 pr-3">Acreditación</th>
                <th className="py-2 pr-3">Comisión</th>
                <th className="py-2 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mediosPago.map((m) => (
                <tr key={m.id} data-testid={`fila-medio-${m.id}`}>
                  <td className="py-2.5 pr-3 font-bold text-slate-900">
                    {m.nombre}
                  </td>
                  <td className="py-2.5 pr-3">
                    {m.esEfectivo ? (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-900">
                        Sí (Efectivo)
                      </span>
                    ) : (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">
                        No (Digital/Tarjeta)
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 font-semibold text-slate-800">
                    {m.diasAcreditacion} {m.diasAcreditacion === 1 ? 'día' : 'días'}
                  </td>
                  <td className="py-2.5 pr-3 font-semibold text-slate-800">
                    {m.comisionPct} %
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setMedioEditId(m.id);
                        setMedioNombre(m.nombre);
                        setMedioEsEfectivo(m.esEfectivo);
                        setMedioDiasAcreditacion(String(m.diasAcreditacion));
                        setMedioComisionPct(m.comisionPct);
                      }}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 border border-slate-200 md:grid-cols-5">
          <div className="md:col-span-2">
            <label
              htmlFor="input-medio-nombre"
              className="block text-xs font-semibold text-slate-700"
            >
              {medioEditId !== null
                ? 'Editando medio de pago'
                : 'Nuevo medio de pago'}
            </label>
            <input
              id="input-medio-nombre"
              data-testid="input-medio-nombre"
              type="text"
              placeholder="Ej: Tarjeta Naranja / Mercado Pago QR"
              value={medioNombre}
              onChange={(e) => {
                setMedioNombre(e.target.value);
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"
            />
          </div>
          <div>
            <label
              htmlFor="input-medio-dias"
              className="block text-xs font-semibold text-slate-700"
            >
              Días acreditación
            </label>
            <input
              id="input-medio-dias"
              data-testid="input-medio-dias"
              type="number"
              min={0}
              max={365}
              value={medioDiasAcreditacion}
              onChange={(e) => {
                setMedioDiasAcreditacion(e.target.value);
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"
            />
          </div>
          <div>
            <label
              htmlFor="input-medio-comision"
              className="block text-xs font-semibold text-slate-700"
            >
              Comisión (%)
            </label>
            <input
              id="input-medio-comision"
              data-testid="input-medio-comision"
              type="text"
              placeholder="Ej: 3.50"
              value={medioComisionPct}
              onChange={(e) => {
                setMedioComisionPct(e.target.value);
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"
            />
          </div>
          <div className="flex flex-col justify-end gap-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={medioEsEfectivo}
                onChange={(e) => {
                  setMedioEsEfectivo(e.target.checked);
                }}
              />
              Suma al cajón
            </label>
            <button
              type="button"
              data-testid="btn-guardar-medio"
              onClick={() => void guardarMedioPago()}
              className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
            >
              {medioEditId !== null ? 'Actualizar medio' : 'Agregar medio'}
            </button>
          </div>
        </div>
      </div>

      {/* 2. Rubros y Categorías de la ferretería */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
          <h3 className="text-base font-bold text-slate-900">
            Rubros de la Ferretería
          </h3>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {rubros.map((r) => (
              <span
                key={r.id}
                className="rounded-lg bg-slate-100 border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-800"
              >
                {r.nombre}
              </span>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <input
              type="text"
              data-testid="input-nuevo-rubro"
              placeholder="Ej: Sanitarios y Gas"
              value={nuevoRubroNombre}
              onChange={(e) => {
                setNuevoRubroNombre(e.target.value);
              }}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold"
            />
            <button
              type="button"
              data-testid="btn-guardar-rubro"
              onClick={() => void guardarRubro()}
              className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800"
            >
              Agregar rubro
            </button>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
          <h3 className="text-base font-bold text-slate-900">
            Categorías de Egresos e Ingresos
          </h3>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {categorias.map((c) => (
              <span
                key={c.id}
                className="rounded-lg bg-slate-100 border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-800"
              >
                {c.nombre} ({c.tipo})
              </span>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <input
              type="text"
              data-testid="input-nueva-categoria"
              placeholder="Ej: Cadetería y Fletes"
              value={nuevaCategoriaNombre}
              onChange={(e) => {
                setNuevaCategoriaNombre(e.target.value);
              }}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold"
            />
            <select
              aria-label="Tipo de categoría"
              value={nuevaCategoriaTipo}
              onChange={(e) => {
                setNuevaCategoriaTipo(e.target.value as 'ingreso' | 'egreso');
              }}
              className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-semibold"
            >
              <option value="egreso">Egreso</option>
              <option value="ingreso">Ingreso</option>
            </select>
            <button
              type="button"
              data-testid="btn-guardar-categoria"
              onClick={() => void guardarCategoria()}
              className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800"
            >
              Agregar
            </button>
          </div>
        </div>
      </div>

      {/* 3. Bitácora del Piloto en Paralelo (14 días contra planilla/cuaderno) */}
      <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Control Diario del Piloto en Paralelo (Sistema vs. Planilla/Cuaderno)
            </h3>
            <p className="text-xs text-slate-500">
              Meta de aceptación: 14 días comparando el cierre del sistema contra
              el registro actual sin diferencias inexplicadas.
            </p>
          </div>
          <span
            data-testid="progreso-piloto"
            className="rounded-xl bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-900"
          >
            Días conciliados sin diferencia: {diasSinDiferencias} / 14
          </span>
        </div>

        <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 border border-slate-200 md:grid-cols-4">
          <div>
            <label
              htmlFor="input-piloto-fecha"
              className="block text-xs font-semibold text-slate-700"
            >
              Fecha del cierre
            </label>
            <input
              id="input-piloto-fecha"
              data-testid="input-piloto-fecha"
              type="date"
              value={fechaPiloto}
              onChange={(e) => {
                setFechaPiloto(e.target.value);
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold"
            />
          </div>
          <div>
            <label
              htmlFor="input-piloto-planilla"
              className="block text-xs font-semibold text-slate-700"
            >
              Efectivo según planilla/cuaderno ($)
            </label>
            <input
              id="input-piloto-planilla"
              data-testid="input-piloto-planilla"
              type="text"
              value={efectivoPlanillaInput}
              onChange={(e) => {
                setEfectivoPlanillaInput(e.target.value);
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900"
            />
          </div>
          <div>
            <label
              htmlFor="input-piloto-obs"
              className="block text-xs font-semibold text-slate-700"
            >
              Observación / Conciliación
            </label>
            <input
              id="input-piloto-obs"
              data-testid="input-piloto-obs"
              type="text"
              placeholder="Ej: Coincide exacto con cuaderno"
              value={observacionPilotoInput}
              onChange={(e) => {
                setObservacionPilotoInput(e.target.value);
              }}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
            />
          </div>
          <div className="flex flex-col justify-end">
            <button
              type="button"
              data-testid="btn-registrar-piloto"
              onClick={() => {
                registrarComparacionPiloto();
              }}
              className="rounded-lg bg-emerald-700 px-3 py-2.5 text-xs font-bold text-white shadow hover:bg-emerald-800"
            >
              Anotar comparación del día
            </button>
          </div>
        </div>

        {bitacoraPiloto.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table
              data-testid="tabla-bitacora-piloto"
              className="w-full text-left text-xs"
            >
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 uppercase">
                  <th className="py-2 pr-3">Fecha</th>
                  <th className="py-2 pr-3">Sistema</th>
                  <th className="py-2 pr-3">Planilla/Cuaderno</th>
                  <th className="py-2 pr-3">Diferencia</th>
                  <th className="py-2">Observación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bitacoraPiloto.map((item) => (
                  <tr key={item.fecha}>
                    <td className="py-2 pr-3 font-bold text-slate-900">
                      {item.fecha}
                    </td>
                    <td className="py-2 pr-3 font-semibold text-slate-800">
                      {formatearPesos(item.efectivoSistema)}
                    </td>
                    <td className="py-2 pr-3 font-semibold text-slate-800">
                      {formatearPesos(item.efectivoPlanilla)}
                    </td>
                    <td className="py-2 pr-3 font-bold">
                      <span
                        className={
                          item.diferenciaConPlanilla === '0.00'
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                        }
                      >
                        {formatearPesos(item.diferenciaConPlanilla)}
                      </span>
                    </td>
                    <td className="py-2 text-slate-600">{item.observacion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
