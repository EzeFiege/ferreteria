/**
 * Utilidad para impresión de Comprobantes Fiscales Electrónicos ARCA / AFIP
 * (Factura A, B, C con CAE, Código QR y detalle completo de ítems).
 * Soporta formato oficial A4 y formato térmico de 80mm para comanderas.
 */

import type { ComprobanteFiscalDetalle } from '@ferreteria/shared';

export interface DatosEmisorFiscal {
  razonSocial: string;
  nombreFantasia?: string | undefined;
  cuit: string;
  iibb?: string | undefined;
  inicioActividades?: string | undefined;
  domicilio?: string | undefined;
  condicionIva?: string | undefined;
  telefono?: string | undefined;
  logoUrl?: string | undefined;
}

export interface OpcionesImpresionFactura {
  formato?: 'a4' | 'termico_80mm';
}

function formatearCondicionIva(cond?: string): string {
  if (!cond) return 'Consumidor Final';
  const mapa: Record<string, string> = {
    monotributo: 'Responsable Monotributo',
    responsable_inscripto: 'IVA Responsable Inscripto',
    exento: 'IVA Exento',
    consumidor_final: 'Consumidor Final',
    no_responsable: 'No Responsable',
  };
  return mapa[cond] ?? cond.toUpperCase().replace(/_/g, ' ');
}

export function imprimirComprobanteFiscal(
  comprobante: ComprobanteFiscalDetalle,
  emisor: DatosEmisorFiscal,
  opciones: OpcionesImpresionFactura = {},
): void {
  const formato = opciones.formato ?? 'a4';
  const esTermico = formato === 'termico_80mm';

  const ventana = window.open(
    '',
    '_blank',
    esTermico ? 'width=460,height=750' : 'width=950,height=900',
  );
  if (!ventana) {
    alert('Por favor habilitá las ventanas emergentes (popups) para imprimir el comprobante.');
    return;
  }

  // Determinar letra, código y título
  let letra = 'C';
  let tituloCmp = 'FACTURA C';
  let codigoAfip = comprobante.codigoAfip || 11;

  if (comprobante.tipoComprobante.includes('factura_a')) {
    letra = 'A';
    tituloCmp = 'FACTURA A';
    codigoAfip = comprobante.codigoAfip || 1;
  } else if (comprobante.tipoComprobante.includes('factura_b')) {
    letra = 'B';
    tituloCmp = 'FACTURA B';
    codigoAfip = comprobante.codigoAfip || 6;
  } else if (comprobante.tipoComprobante.includes('factura_c')) {
    letra = 'C';
    tituloCmp = 'FACTURA C';
    codigoAfip = comprobante.codigoAfip || 11;
  } else if (comprobante.tipoComprobante.includes('nota_credito_a')) {
    letra = 'A';
    tituloCmp = 'NOTA DE CRÉDITO A';
    codigoAfip = comprobante.codigoAfip || 3;
  } else if (comprobante.tipoComprobante.includes('nota_credito_b')) {
    letra = 'B';
    tituloCmp = 'NOTA DE CRÉDITO B';
    codigoAfip = comprobante.codigoAfip || 8;
  } else if (comprobante.tipoComprobante.includes('nota_credito_c')) {
    letra = 'C';
    tituloCmp = 'NOTA DE CRÉDITO C';
    codigoAfip = comprobante.codigoAfip || 13;
  }

  const esFacturaC = letra === 'C';
  const ptoVtaStr = String(comprobante.puntoVentaNumero).padStart(4, '0');
  const nroCmpStr = String(comprobante.numeroComprobante).padStart(8, '0');
  const qrUrl = comprobante.codigoQrArca
    ? `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(comprobante.codigoQrArca)}`
    : null;

  const items = comprobante.items ?? [];

  let htmlFinal = '';

  if (esTermico) {
    // -------------------------------------------------------------
    // FORMATO TÉRMICO 80MM (Ticket Fiscal ARCA)
    // -------------------------------------------------------------
    const filasTermicas = items.length > 0
      ? items
          .map(
            (it) => `
            <tr>
              <td style="padding: 2px 0; text-align: left; vertical-align: top;">
                <div>${it.descripcion}</div>
                <div style="font-size: 10px; color: #555;">${it.cantidad} ${it.unidad} x $ ${it.precioUnitario}</div>
              </td>
              <td style="padding: 2px 0; text-align: right; vertical-align: top; font-weight: bold; white-space: nowrap;">
                $ ${it.subtotal}
              </td>
            </tr>
          `,
          )
          .join('')
      : `
        <tr>
          <td style="padding: 4px 0;">Venta global</td>
          <td style="padding: 4px 0; text-align: right; font-weight: bold;">$ ${comprobante.total}</td>
        </tr>
      `;

    htmlFinal = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>${tituloCmp} ${ptoVtaStr}-${nroCmpStr}</title>
        <style>
          @page {
            size: 80mm auto;
            margin: 3mm 4mm;
          }
          * {
            box-sizing: border-box;
          }
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: 11px;
            color: #000;
            background: #fff;
            margin: 0;
            padding: 8px 6px;
            width: 72mm;
            max-width: 72mm;
            line-height: 1.25;
          }
          .no-print {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #0f172a;
            color: #fff;
            padding: 8px 10px;
            margin: -8px -6px 12px -6px;
            font-family: Arial, sans-serif;
            font-size: 11px;
          }
          .no-print button {
            background: #2563eb;
            color: #fff;
            border: none;
            padding: 5px 10px;
            border-radius: 4px;
            font-weight: bold;
            cursor: pointer;
            font-size: 11px;
          }
          .divider {
            border-top: 1px dashed #000;
            margin: 6px 0;
          }
          .double-divider {
            border-top: 2px solid #000;
            margin: 6px 0;
          }
          .letra-box {
            display: inline-block;
            border: 2px solid #000;
            padding: 2px 8px;
            font-size: 16px;
            font-weight: 900;
            margin-bottom: 2px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          @media print {
            .no-print { display: none !important; }
            body {
              width: 100%;
              max-width: 100%;
              padding: 0;
              margin: 0;
            }
          }
        </style>
      </head>
      <body>
        <div class="no-print">
          <span>Vista Previa 80mm</span>
          <div>
            <button onclick="window.print()">🖨️ Imprimir</button>
            <button onclick="window.close()" style="background:#64748b; margin-left:4px;">✕</button>
          </div>
        </div>

        <div style="text-align: center;">
          <div class="letra-box">${letra}</div>
          <div style="font-size: 10px; font-weight: bold;">CÓDIGO AFIP ${String(codigoAfip).padStart(2, '0')}</div>
          <div style="font-size: 13px; font-weight: bold; margin-top: 4px;">${tituloCmp}</div>
          <div style="font-size: 12px; font-weight: bold;">Nº ${ptoVtaStr}-${nroCmpStr}</div>
        </div>

        <div class="divider"></div>

        <div style="text-align: center;">
          <div style="font-size: 12px; font-weight: bold;">${emisor.razonSocial}</div>
          ${emisor.nombreFantasia ? `<div style="font-size: 11px;">${emisor.nombreFantasia}</div>` : ''}
          <div>CUIT: ${emisor.cuit}</div>
          <div>Cond. IVA: <strong>${formatearCondicionIva(emisor.condicionIva)}</strong></div>
          ${emisor.domicilio ? `<div>${emisor.domicilio}</div>` : ''}
          ${emisor.iibb ? `<div>Ing. Brutos: ${emisor.iibb}</div>` : ''}
          <div>Inicio Actividades: ${emisor.inicioActividades ?? '-'}</div>
        </div>

        <div class="divider"></div>

        <div>
          <div><strong>Fecha Emisión:</strong> ${comprobante.fechaEmision}</div>
          <div><strong>Receptor:</strong> ${comprobante.razonSocialCliente}</div>
          <div><strong>CUIT/DNI:</strong> ${comprobante.cuitCliente || 'Consumidor Final'}</div>
          <div><strong>Cond. IVA:</strong> ${formatearCondicionIva(comprobante.condicionIvaCliente)}</div>
        </div>

        <div class="divider"></div>

        <table>
          <thead>
            <tr style="border-bottom: 1px dashed #000;">
              <th style="text-align: left; padding-bottom: 3px;">Detalle</th>
              <th style="text-align: right; padding-bottom: 3px;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${filasTermicas}
          </tbody>
        </table>

        <div class="double-divider"></div>

        <table>
          ${
            !esFacturaC && letra === 'A'
              ? `
              <tr>
                <td>Neto Gravado:</td>
                <td style="text-align: right;">$ ${comprobante.subtotalNetoGravado}</td>
              </tr>
              <tr>
                <td>IVA 21%:</td>
                <td style="text-align: right;">$ ${comprobante.subtotalIva21}</td>
              </tr>
              ${
                parseFloat(comprobante.subtotalIva105) > 0
                  ? `<tr><td>IVA 10.5%:</td><td style="text-align: right;">$ ${comprobante.subtotalIva105}</td></tr>`
                  : ''
              }
            `
              : ''
          }
          <tr style="font-size: 13px; font-weight: bold;">
            <td>TOTAL:</td>
            <td style="text-align: right;">$ ${comprobante.total}</td>
          </tr>
        </table>

        <div class="divider"></div>

        <div style="text-align: center;">
          ${
            qrUrl
              ? `<div style="margin: 6px 0;"><img src="${qrUrl}" alt="QR ARCA" style="width: 90px; height: 90px; display: inline-block;" /></div>`
              : ''
          }
          <div style="font-weight: bold; font-size: 10px;">COMPROBANTE AUTORIZADO POR ARCA</div>
          <div><strong>CAE:</strong> ${comprobante.cae ?? 'EN TRÁMITE'}</div>
          <div><strong>Vto. CAE:</strong> ${comprobante.vencimientoCae ?? '-'}</div>
          ${
            esFacturaC
              ? `<div style="font-size: 9px; margin-top: 4px; color: #333;">Régimen Simplificado para Pequeños Contribuyentes (Monotributo)</div>`
              : ''
          }
        </div>

        <script>
          window.addEventListener('load', function() {
            setTimeout(function() { window.print(); }, 200);
          });
        </script>
      </body>
      </html>
    `;
  } else {
    // -------------------------------------------------------------
    // FORMATO HOJA A4 OFICIAL ARCA / AFIP
    // -------------------------------------------------------------
    const itemsHtmlA4 = items.length > 0
      ? items
          .map(
            (it) => `
          <tr>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${it.codigo ?? '-'}</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${it.descripcion}</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: center;">${it.cantidad} ${it.unidad}</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right;">$ ${it.precioUnitario}</td>
            ${!esFacturaC ? `<td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: center;">${it.alicuotaIva}%</td>` : ''}
            <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px; text-align: right; font-weight: bold;">$ ${it.subtotal}</td>
          </tr>
        `,
          )
          .join('')
      : `
        <tr>
          <td colspan="${esFacturaC ? 5 : 6}" style="padding: 12px; text-align: center; color: #64748b; font-size: 12px;">
            Detalle global por venta $ ${comprobante.total}
          </td>
        </tr>
      `;

    htmlFinal = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>${tituloCmp} Nº ${ptoVtaStr}-${nroCmpStr}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 10mm 12mm;
          }
          * {
            box-sizing: border-box;
          }
          body {
            font-family: Arial, Helvetica, sans-serif;
            color: #0f172a;
            background: #fff;
            margin: 0;
            padding: 0;
            font-size: 12px;
            line-height: 1.35;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .no-print {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #1e293b;
            color: #fff;
            padding: 10px 16px;
            margin-bottom: 16px;
            border-radius: 8px;
            font-family: Arial, sans-serif;
          }
          .no-print button {
            background: #2563eb;
            color: #fff;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            font-weight: bold;
            cursor: pointer;
            font-size: 12px;
          }
          .factura-box {
            border: 2px solid #0f172a;
            border-radius: 6px;
            overflow: hidden;
            background: #fff;
          }
          .header-table {
            width: 100%;
            border-collapse: collapse;
            border-bottom: 2px solid #0f172a;
            background: #fafafa;
          }
          .header-table td {
            vertical-align: top;
            padding: 14px 16px;
          }
          .letra-central {
            width: 70px;
            text-align: center;
            border-left: 2px solid #0f172a;
            border-right: 2px solid #0f172a;
            border-bottom: 2px solid #0f172a;
            background: #fff;
            border-radius: 0 0 6px 6px;
            padding: 4px 0 6px 0 !important;
          }
          .letra-central .letra {
            font-size: 30px;
            font-weight: 900;
            line-height: 1;
          }
          .letra-central .cod {
            font-size: 9px;
            font-weight: bold;
            color: #475569;
            margin-top: 2px;
          }
          .datos-cliente {
            padding: 10px 16px;
            border-bottom: 2px solid #0f172a;
            background: #f8fafc;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 4px 20px;
            font-size: 12px;
          }
          table.items-table {
            width: 100%;
            border-collapse: collapse;
          }
          table.items-table th {
            background: #f1f5f9;
            padding: 8px;
            border-bottom: 2px solid #cbd5e1;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }
          .totales-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px;
            border-top: 2px solid #0f172a;
            background: #fafafa;
          }
          .cae-qr-box {
            display: flex;
            align-items: center;
            gap: 16px;
          }
          .totales-resumen {
            min-width: 240px;
          }
          .totales-resumen table {
            width: 100%;
          }
          .totales-resumen td {
            padding: 3px 0;
            font-size: 12px;
          }
          .total-destacado {
            font-size: 15px;
            font-weight: bold;
            border-top: 1px solid #0f172a;
            padding-top: 6px !important;
          }
          @media print {
            .no-print { display: none !important; }
            body { padding: 0; margin: 0; }
            .factura-box { border-color: #000; }
          }
        </style>
      </head>
      <body>
        <div class="no-print">
          <span style="font-weight: bold;">Vista Previa de Factura A4 Oficial</span>
          <div>
            <button onclick="window.print()">🖨️ Imprimir / Guardar en PDF</button>
            <button onclick="window.close()" style="background: #475569; margin-left: 8px;">✕ Cerrar</button>
          </div>
        </div>

        <div class="factura-box">
          <!-- Encabezado con Letra Central Oficial -->
          <table class="header-table">
            <tr>
              <td style="width: 45%;">
                ${emisor.logoUrl ? `<img src="${emisor.logoUrl}" alt="Logo" style="max-height: 48px; margin-bottom: 6px; display:block;" />` : ''}
                <div style="font-size: 17px; font-weight: bold; color: #0f172a;">${emisor.razonSocial}</div>
                ${emisor.nombreFantasia ? `<div style="font-size: 13px; color: #475569; font-weight: 600;">${emisor.nombreFantasia}</div>` : ''}
                <div style="margin-top: 6px; font-size: 11px; color: #475569; line-height: 1.4;">
                  ${emisor.domicilio ? `<div>${emisor.domicilio}</div>` : ''}
                  ${emisor.telefono ? `<div>Tel: ${emisor.telefono}</div>` : ''}
                  <div>Condición IVA: <strong>${formatearCondicionIva(emisor.condicionIva)}</strong></div>
                </div>
              </td>

              <td class="letra-central">
                <div class="letra">${letra}</div>
                <div class="cod">CÓD. ${String(codigoAfip).padStart(2, '0')}</div>
              </td>

              <td style="width: 45%; padding-left: 20px;">
                <div style="font-size: 19px; font-weight: 800; color: #1e3a8a;">${tituloCmp}</div>
                <div style="font-size: 14px; font-weight: bold; margin-top: 4px;">
                  Punto de Venta: ${ptoVtaStr} &nbsp;&nbsp; Comp. Nro: ${nroCmpStr}
                </div>
                <div style="font-size: 12px; margin-top: 6px;">
                  <strong>Fecha de Emisión:</strong> ${comprobante.fechaEmision}
                </div>
                <div style="font-size: 11px; margin-top: 6px; color: #475569; line-height: 1.4;">
                  <div><strong>CUIT Emisor:</strong> ${emisor.cuit}</div>
                  <div><strong>Ingresos Brutos:</strong> ${emisor.iibb ?? emisor.cuit}</div>
                  <div><strong>Fecha Inicio Actividades:</strong> ${emisor.inicioActividades ?? '-'}</div>
                </div>
              </td>
            </tr>
          </table>

          <!-- Datos del Cliente / Receptor -->
          <div class="datos-cliente">
            <div><strong>Receptor:</strong> ${comprobante.razonSocialCliente}</div>
            <div><strong>CUIT / DNI:</strong> ${comprobante.cuitCliente || 'Consumidor Final'}</div>
            <div><strong>Condición frente al IVA:</strong> ${formatearCondicionIva(comprobante.condicionIvaCliente)}</div>
            <div><strong>Condición de Venta:</strong> Contado / Mostrador</div>
          </div>

          <!-- Tabla de Conceptos / Artículos -->
          <table class="items-table">
            <thead>
              <tr>
                <th style="text-align: left; width: 12%;">Código</th>
                <th style="text-align: left;">Descripción</th>
                <th style="text-align: center; width: 12%;">Cantidad</th>
                <th style="text-align: right; width: 14%;">Precio Unit.</th>
                ${!esFacturaC ? `<th style="text-align: center; width: 10%;">Alíc. IVA</th>` : ''}
                <th style="text-align: right; width: 16%;">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtmlA4}
            </tbody>
          </table>

          <!-- Totales, CAE y QR Oficial ARCA -->
          <div class="totales-footer">
            <div class="cae-qr-box">
              ${qrUrl ? `<img src="${qrUrl}" alt="QR ARCA" style="width: 100px; height: 100px; border: 1px solid #cbd5e1; padding: 4px; background: #fff;" />` : ''}
              <div>
                <div style="font-weight: 800; font-size: 13px; color: #1e3a8a;">
                  Comprobante Autorizado por ARCA
                </div>
                <div style="margin-top: 4px; font-size: 12px;">
                  <strong>CAE Nº:</strong> ${comprobante.cae ?? 'EN TRÁMITE / CONTINGENCIA'}
                </div>
                <div style="font-size: 12px;">
                  <strong>Fecha de Vto. de CAE:</strong> ${comprobante.vencimientoCae ?? '-'}
                </div>
                <div style="font-size: 10px; color: #64748b; margin-top: 4px;">
                  ${esFacturaC ? 'Régimen Simplificado para Pequeños Contribuyentes (Monotributo)' : 'Régimen de Facturación Electrónica RG AFIP / ARCA'}
                </div>
              </div>
            </div>

            <div class="totales-resumen">
              <table>
                ${
                  !esFacturaC && letra === 'A'
                    ? `
                  <tr>
                    <td>Importe Neto Gravado:</td>
                    <td style="text-align: right; font-weight: 600;">$ ${comprobante.subtotalNetoGravado}</td>
                  </tr>
                  <tr>
                    <td>IVA 21%:</td>
                    <td style="text-align: right;">$ ${comprobante.subtotalIva21}</td>
                  </tr>
                  ${
                    parseFloat(comprobante.subtotalIva105) > 0
                      ? `<tr><td>IVA 10.5%:</td><td style="text-align: right;">$ ${comprobante.subtotalIva105}</td></tr>`
                      : ''
                  }
                `
                    : ''
                }
                <tr class="total-destacado">
                  <td>Importe Total:</td>
                  <td style="text-align: right;">$ ${comprobante.total}</td>
                </tr>
              </table>
            </div>
          </div>
        </div>

        <script>
          window.addEventListener('load', function() {
            setTimeout(function() { window.print(); }, 250);
          });
        </script>
      </body>
      </html>
    `;
  }

  ventana.document.open();
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  ventana.document.write(htmlFinal);
  ventana.document.close();
}
