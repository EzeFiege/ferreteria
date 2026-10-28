import type { LookupEanCandidato, LookupEanResult } from '@ferreteria/shared';

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

function decodificarEntidades(texto: string): string {
  return texto
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function limpiarTituloWeb(tituloBruto: string): string {
  let t = decodificarEntidades(tituloBruto);
  // Eliminar sufijos comunes de tiendas y plataformas
  t = t.replace(
    /\s*\|\s*(Sodimac|Mercado Libre|Easy|Fravega|Carrefour|Homecenter|Gobantes|Falabella|Pricely|Jumbo|Coto)[^|]*$/i,
    '',
  );
  t = t.replace(
    /\s*-\s*(Pricely|Mercado Libre|Sodimac|Precios Claros|Jumbo|Coto)[^-]*$/i,
    '',
  );
  return t.trim();
}

function deducirRubro(texto: string): string | undefined {
  const t = texto.toLowerCase();
  if (
    t.includes('pasacable') ||
    t.includes('cable') ||
    t.includes('termic') ||
    t.includes('disyuntor') ||
    t.includes('enchufe') ||
    t.includes('lampara') ||
    t.includes('led') ||
    t.includes('electr') ||
    t.includes('interruptor') ||
    t.includes('ficha')
  ) {
    return 'Electricidad';
  }
  if (
    t.includes('tornillo') ||
    t.includes('bulon') ||
    t.includes('tuerca') ||
    t.includes('arandela') ||
    t.includes('tarugo') ||
    t.includes('remache') ||
    t.includes('autoperforante')
  ) {
    return 'Bulonería';
  }
  if (
    t.includes('taladro') ||
    t.includes('amoladora') ||
    t.includes('pinza') ||
    t.includes('llave') ||
    t.includes('destornillador') ||
    t.includes('martillo') ||
    t.includes('herramienta') ||
    t.includes('disco') ||
    t.includes('mecha') ||
    t.includes('sierra')
  ) {
    return 'Herramientas';
  }
  if (
    t.includes('pintura') ||
    t.includes('esmalte') ||
    t.includes('latex') ||
    t.includes('pincel') ||
    t.includes('rodillo') ||
    t.includes('barniz') ||
    t.includes('diluyente') ||
    t.includes('aerosol') ||
    t.includes('sintetico')
  ) {
    return 'Pinturas';
  }
  if (
    t.includes('cano') ||
    t.includes('tubo') ||
    t.includes('grifo') ||
    t.includes('valvula') ||
    t.includes('codo') ||
    t.includes('termofusion') ||
    t.includes('plomer') ||
    t.includes('canilla') ||
    t.includes('sifon') ||
    t.includes('flexible')
  ) {
    return 'Plomería';
  }
  return undefined;
}

const MARCAS_CONOCIDAS = [
  'Kalop',
  'Stanford',
  'Stanley',
  'Bosch',
  'Black & Decker',
  'DeWalt',
  'Makita',
  'Dremel',
  'Bahco',
  'Pro',
  'Enerlux',
  'Ekoline',
  'Ature',
  'Penta',
  'Sica',
  'Schneider',
  'Prysmian',
  'Plasnavi',
  'Sintex',
  'Alba',
  'Plaval',
  'Tersuave',
  'Colorin',
  'Rust-Oleum',
  'Loctite',
  'Poxipol',
  'Poxilina',
  'Suprabond',
  'Tacsa',
  '3M',
  'Bremen',
  'Crossmaster',
  'Bulit',
  'Kushiro',
  'Total',
  'Ingco',
  'Hamilton',
  'Pegamil',
  'Tigre',
  'Amanco',
  'Awaduct',
  'IPS',
  'Saladillo',
];

function deducirMarca(texto: string): string | undefined {
  for (const m of MARCAS_CONOCIDAS) {
    const reg = new RegExp(`\\b${m}\\b`, 'i');
    if (reg.test(texto)) return m;
  }
  return undefined;
}

function extraerSku(texto: string): string | undefined {
  const m = texto.match(
    /(?:modelo|sku|ref\b|art\b|c[oó]d(?:\.|igo)?\s+(?:de\s+)?(?:f[aá]brica|prov|modelo))\s*[:#.-]?\s*([A-Za-z0-9_-]{3,20})/i,
  );
  if (m && m[1]) {
    const val = m[1].trim();
    if (!/^\d{12,14}$/.test(val)) return val;
  }
  const m2 = texto.match(/\b([A-Z]{2,4}\d{3,6}[A-Z0-9]?)\b/);
  if (m2 && m2[1]) return m2[1];
  return undefined;
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
      rubroSugerido: deducirRubro(primerItem.title),
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
      rubroSugerido: prod.categories?.split(',')[0]?.trim() || deducirRubro(nombre),
    };
  } catch {
    return null;
  }
}

function puntuarCandidato(c: LookupEanCandidato, codigo: string): number {
  let score = 0;
  const texto = `${c.nombre} ${c.snippet ?? ''}`.toLowerCase();
  if (c.snippet && c.snippet.includes(codigo)) score += 100;
  if (c.nombre.includes(codigo)) score += 80;
  for (const m of MARCAS_CONOCIDAS) {
    if (new RegExp(`\\b${m}\\b`, 'i').test(texto)) {
      score += 40;
      break;
    }
  }
  if (c.rubro) score += 30;
  if (c.sku) score += 20;
  if (/ferreter[ií]a|materiales|construcci[oó]n|electricidad|profesional|cinta|alma/i.test(texto)) score += 25;
  if (/pen\b|pencil|gel pen|retractable|vinyl|funko|doll|album|t-shirt|pelicula|cd\b|cd-rom/i.test(texto)) score -= 150;
  return score;
}

/**
 * Busca productos en la web abierta por aproximación utilizando motores de consulta web limpios (DDG Lite).
 * Extrae títulos de catálogo, marcas y rubros sugeridos, permitiendo tolerar variantes de formato EAN.
 */
async function buscarEnWebPorAproximacion(codigoLimpio: string): Promise<LookupEanResult | null> {
  const intentos: string[] = [codigoLimpio];
  if (codigoLimpio.length === 13) {
    intentos.push(codigoLimpio.slice(0, 12));
  }

  const userAgents = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  ];

  for (const query of intentos) {
    for (const ua of userAgents) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => {
          controller.abort();
        }, 3000);

        const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
        const res = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent': ua,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
          },
        });

        clearTimeout(timer);

        if (res.status !== 200) {
          continue;
        }

        const html = await res.text();
        const rawTitles = [
          ...html.matchAll(/class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi),
        ].map((m) => m[1]?.replace(/<[^>]+>/g, '').trim() ?? '');
        const rawSnippets = [
          ...html.matchAll(/class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi),
        ].map((m) => m[1]?.replace(/<[^>]+>/g, '').trim() ?? '');

        const candidatos: LookupEanCandidato[] = [];

        for (let i = 0; i < rawTitles.length; i++) {
          const tit = rawTitles[i] ?? '';
          const snip = rawSnippets[i] ?? '';

          // Ignorar páginas de tracking genérico o buscadores vacíos
          if (
            /barcode lookup|17track|package tracking|upc lookup|ean search/i.test(
              tit,
            ) ||
            /track packages worldwide/i.test(snip)
          ) {
            continue;
          }

          const nombreLimpio = limpiarTituloWeb(tit);
          if (nombreLimpio && nombreLimpio.length > 5) {
            const textoCompleto = `${nombreLimpio} ${snip}`;
            candidatos.push({
              nombre: nombreLimpio,
              marca: deducirMarca(textoCompleto),
              rubro: deducirRubro(textoCompleto),
              sku: extraerSku(textoCompleto),
              snippet: snip || undefined,
            });
          }
        }

        if (candidatos.length > 0) {
          candidatos.sort((a, b) => puntuarCandidato(b, codigoLimpio) - puntuarCandidato(a, codigoLimpio));
          const seleccionado = candidatos[0];

          if (seleccionado && puntuarCandidato(seleccionado, codigoLimpio) > -50) {
            return {
              encontrado: true,
              origen: 'catalogo_externo',
              codigoBarra: codigoLimpio,
              nombre: seleccionado.nombre,
              marca: seleccionado.marca,
              sku: seleccionado.sku,
              rubroSugerido: seleccionado.rubro,
              candidatos,
            };
          }
        }
      } catch {
        // Continúa con siguiente intento
      }
    }
  }

  return null;
}

/**
 * Consulta fuentes externas (Búsqueda Web por aproximación, Catálogo Abierto y Mercado Libre)
 * para resolver cualquier producto por su código de barras EAN/UPC y autocompletar el alta.
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

  // 1. Prioridad: Búsqueda Web por aproximación directa (rápida, precisa y con catálogo de ferretería argentino)
  const resWeb = await buscarEnWebPorAproximacion(limpio);
  if (resWeb) {
    return resWeb;
  }

  // 2. Fallback: Catálogo Abierto (OpenFood/OpenProduct)
  const resCat = await buscarEnCatalogoAbierto(limpio);
  if (resCat) {
    return resCat;
  }

  // 3. Fallback: Mercado Libre Argentina
  const resMl = await buscarEnMercadoLibre(limpio);
  if (resMl) {
    return resMl;
  }

  return {
    encontrado: false,
    origen: 'no_encontrado',
    codigoBarra: limpio,
  };
}
