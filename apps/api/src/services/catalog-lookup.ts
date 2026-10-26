import type { LookupEanResult } from '@ferreteria/shared';

interface MlSearchItem {
  id: string;
  title: string;
  thumbnail?: string;
  attributes?: Array<{
    id: string;
    name: string;
    value_name?: string | null;
  }>;
}

interface MlSearchResponse {
  results?: MlSearchItem[];
}

interface OpenProductResponse {
  status: number;
  product?: {
    product_name?: string;
    generic_name?: string;
    brands?: string;
    image_front_url?: string;
    image_url?: string;
    categories?: string;
  };
}

async function buscarEnMercadoLibre(codigoLimpio: string): Promise<LookupEanResult | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, 3500);

    const url = `https://api.mercadolibre.com/sites/MLA/search?q=${encodeURIComponent(codigoLimpio)}&limit=1`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'FerreteriaApp/1.0',
        Accept: 'application/json',
      },
    });

    clearTimeout(timer);

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as MlSearchResponse;
    const primerItem = data.results?.[0];

    if (!primerItem) {
      return null;
    }

    const attrMarca = primerItem.attributes?.find(
      (a) => a.id === 'BRAND' || a.id.toLowerCase().includes('marca'),
    );
    const marca = attrMarca?.value_name?.trim() || undefined;

    return {
      encontrado: true,
      origen: 'mercadolibre',
      codigoBarra: codigoLimpio,
      nombre: primerItem.title,
      marca,
      imagenUrl: primerItem.thumbnail?.replace('http://', 'https://'),
      rubroSugerido: undefined,
    };
  } catch {
    return null;
  }
}

async function buscarEnCatalogoAbierto(codigoLimpio: string): Promise<LookupEanResult | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, 3500);

    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(codigoLimpio)}.json`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'FerreteriaApp/1.0',
        Accept: 'application/json',
      },
    });

    clearTimeout(timer);

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as OpenProductResponse;
    if (data.status !== 1 || !data.product) {
      return null;
    }

    const prod = data.product;
    const nombre = prod.product_name?.trim() || prod.generic_name?.trim();
    if (!nombre) {
      return null;
    }

    const marca = prod.brands?.split(',')[0]?.trim() || undefined;
    const imagenUrl = prod.image_front_url || prod.image_url;

    return {
      encontrado: true,
      origen: 'catalogo_externo',
      codigoBarra: codigoLimpio,
      nombre,
      marca,
      imagenUrl: imagenUrl?.replace('http://', 'https://'),
      rubroSugerido: prod.categories?.split(',')[0]?.trim() || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Consulta APIs externas (Mercado Libre Argentina y Catálogo Abierto) para buscar un producto por su código EAN / UPC.
 * Si encuentra resultados, extrae título, marca y foto para autocompletar el alta de artículos.
 */
export async function lookupEanExterno(
  codigoBarra: string,
): Promise<LookupEanResult> {
  const limpio = codigoBarra.trim();
  if (!limpio) {
    return {
      encontrado: false,
      origen: 'no_encontrado',
      codigoBarra: limpio,
    };
  }

  // 1. Intenta en Mercado Libre Argentina
  const resMl = await buscarEnMercadoLibre(limpio);
  if (resMl) {
    return resMl;
  }

  // 2. Fallback a Catálogo Abierto
  const resCat = await buscarEnCatalogoAbierto(limpio);
  if (resCat) {
    return resCat;
  }

  return {
    encontrado: false,
    origen: 'no_encontrado',
    codigoBarra: limpio,
  };
}
