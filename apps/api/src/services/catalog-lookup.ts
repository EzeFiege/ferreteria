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

/**
 * Consulta la API pública de Mercado Libre Argentina (MLA) para buscar un producto por su código EAN / UPC.
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

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, 4000);

    const url = `https://api.mercadolibre.com/sites/MLA/search?q=${encodeURIComponent(limpio)}&limit=1`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'FerreteriaApp/1.0',
        Accept: 'application/json',
      },
    });

    clearTimeout(timer);

    if (!res.ok) {
      return {
        encontrado: false,
        origen: 'no_encontrado',
        codigoBarra: limpio,
      };
    }

    const data = (await res.json()) as MlSearchResponse;
    const primerItem = data.results?.[0];

    if (!primerItem) {
      return {
        encontrado: false,
        origen: 'no_encontrado',
        codigoBarra: limpio,
      };
    }

    const attrMarca = primerItem.attributes?.find(
      (a) => a.id === 'BRAND' || a.id.toLowerCase().includes('marca'),
    );
    const marca = attrMarca?.value_name?.trim() || undefined;

    return {
      encontrado: true,
      origen: 'mercadolibre',
      codigoBarra: limpio,
      nombre: primerItem.title,
      marca,
      imagenUrl: primerItem.thumbnail?.replace('http://', 'https://'),
      rubroSugerido: undefined,
    };
  } catch {
    return {
      encontrado: false,
      origen: 'no_encontrado',
      codigoBarra: limpio,
    };
  }
}
