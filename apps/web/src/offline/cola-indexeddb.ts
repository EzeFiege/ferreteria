import { apiUrl } from '../api-url.js';
import type {
  RegistrarMovimientoCajaInput,
  RegistrarVentaInput,
} from '@ferreteria/shared';

export interface ResumenOperacionLocal {
  monto: string;
  esEfectivo: boolean;
  medioPagoNombre: string;
  etiqueta: string;
}

export type OperacionCola =
  | {
      id: string;
      tipo: 'venta';
      endpoint: '/api/ventas';
      payload: RegistrarVentaInput;
      token: string;
      resumenLocal: ResumenOperacionLocal;
      creadoEn: string;
      intentos: number;
    }
  | {
      id: string;
      tipo: 'egreso';
      endpoint: '/api/movimientos/egreso';
      payload: RegistrarMovimientoCajaInput;
      token: string;
      resumenLocal: ResumenOperacionLocal;
      creadoEn: string;
      intentos: number;
    };

const DB_NAME = 'ferreteria_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'cola_operaciones';

const fallbackMemoryStore = new Map<string, OperacionCola>();

function tieneIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

function abrirBaseIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('No se pudo abrir IndexedDB'));
    };
  });
}

export async function encolarOperacion(op: OperacionCola): Promise<void> {
  if (!tieneIndexedDB()) {
    fallbackMemoryStore.set(op.id, op);
    return;
  }

  const db = await abrirBaseIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(op);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Error al guardar en IndexedDB'));
    };
  });
}

export async function listarOperacionesPendientes(): Promise<OperacionCola[]> {
  if (!tieneIndexedDB()) {
    return Array.from(fallbackMemoryStore.values()).sort((a, b) =>
      a.creadoEn.localeCompare(b.creadoEn),
    );
  }

  const db = await abrirBaseIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      const lista = (req.result as OperacionCola[]).sort((a, b) =>
        a.creadoEn.localeCompare(b.creadoEn),
      );
      resolve(lista);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error('Error al leer cola de IndexedDB'));
    };
  });
}

export async function eliminarOperacionPendiente(id: string): Promise<void> {
  if (!tieneIndexedDB()) {
    fallbackMemoryStore.delete(id);
    return;
  }

  const db = await abrirBaseIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Error al eliminar de IndexedDB'));
    };
  });
}

export async function limpiarCola(): Promise<void> {
  if (!tieneIndexedDB()) {
    fallbackMemoryStore.clear();
    return;
  }

  const db = await abrirBaseIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Error al limpiar IndexedDB'));
    };
  });
}

/**
 * Sincroniza en orden FIFO todas las operaciones pendientes usando los mismos UUIDs
 * generados por el cliente. Gracias a `ON CONFLICT (id) DO NOTHING` en la API,
 * reintentar una operación nunca duplica ventas ni movimientos.
 */
export async function sincronizarColaPendiente(
  fetchImpl: typeof fetch = fetch,
): Promise<{ sincronizadas: number; pendientes: number }> {
  const pendientesIniciales = await listarOperacionesPendientes();
  let sincronizadas = 0;

  for (const op of pendientesIniciales) {
    try {
      const response = await fetchImpl(apiUrl(op.endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${op.token}`,
        },
        body: JSON.stringify(op.payload),
      });

      if (response.status === 200 || response.status === 201) {
        await eliminarOperacionPendiente(op.id);
        sincronizadas++;
      } else {
        await encolarOperacion({
          ...op,
          intentos: op.intentos + 1,
        });
      }
    } catch {
      await encolarOperacion({
        ...op,
        intentos: op.intentos + 1,
      });
    }
  }

  const restantes = await listarOperacionesPendientes();
  return {
    sincronizadas,
    pendientes: restantes.length,
  };
}
