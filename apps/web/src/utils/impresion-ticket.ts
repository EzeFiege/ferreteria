/**
 * Utilidad para impresión de tickets térmicos de comanderas (58mm y 80mm).
 */

export interface ItemTicketTermico {
  cantidad: string;
  descripcion: string;
  precioUnitario: string;
  subtotal: string;
}

export interface DatosTicketTermico {
  nombreComercio: string;
  cuitComercio?: string | undefined;
  direccionComercio?: string | undefined;
  telefonoComercio?: string | undefined;
  numeroTicket: string | number;
  fechaHora: string;
  cajeroNombre?: string | undefined;
  clienteNombre?: string | undefined;
  clienteDocumento?: string | undefined;
  items: ItemTicketTermico[];
  subtotal: string;
  descuento?: string | undefined;
  total: string;
  medioCobro: string;
  anchoPapelMm?: 58 | 80 | undefined;
}

export function imprimirTicketTermico(datos: DatosTicketTermico): void {
  const anchoMm = datos.anchoPapelMm ?? 80;
  const ventanaImpresion = window.open('', '_blank', 'width=450,height=600');
  if (!ventanaImpresion) {
    alert('Por favor habilitá las ventanas emergentes (popups) para imprimir tickets.');
    return;
  }

  const filasItemsHtml = datos.items
    .map(
      (it) => `
      <tr>
        <td style="text-align: left; padding: 2px 0;">${it.cantidad} x ${it.descripcion}</td>
        <td style="text-align: right; padding: 2px 0; white-space: nowrap;">$ ${it.subtotal}</td>
      </tr>
      ${
        parseFloat(it.cantidad) > 1
          ? `<tr>
              <td colspan="2" style="font-size: 10px; color: #555; padding-bottom: 2px;">
                (${it.cantidad} x $ ${it.precioUnitario})
              </td>
            </tr>`
          : ''
      }
    `,
    )
    .join('');

  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <title>Ticket #${datos.numeroTicket}</title>
      <style>
        @page {
          size: ${anchoMm}mm auto;
          margin: 0;
        }
        body {
          font-family: 'Courier New', Courier, monospace;
          font-size: 12px;
          line-height: 1.25;
          margin: 0;
          padding: 8px 10px;
          width: ${anchoMm === 58 ? '48mm' : '72mm'};
          color: #000;
          background: #fff;
        }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .font-bold { font-weight: bold; }
        .divider {
          border-top: 1px dashed #000;
          margin: 6px 0;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        .total-box {
          font-size: 15px;
          font-weight: bold;
          margin: 6px 0;
        }
        @media print {
          body { width: 100%; }
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="text-center font-bold" style="font-size: 14px;">
        ${datos.nombreComercio}
      </div>
      ${
        datos.cuitComercio
          ? `<div class="text-center" style="font-size: 11px;">CUIT: ${datos.cuitComercio}</div>`
          : ''
      }
      ${
        datos.direccionComercio
          ? `<div class="text-center" style="font-size: 11px;">${datos.direccionComercio}</div>`
          : ''
      }
      ${
        datos.telefonoComercio
          ? `<div class="text-center" style="font-size: 11px;">Tel: ${datos.telefonoComercio}</div>`
          : ''
      }

      <div class="divider"></div>

      <div style="font-size: 11px;">
        <div><strong>Ticket Nº:</strong> #${datos.numeroTicket}</div>
        <div><strong>Fecha:</strong> ${datos.fechaHora}</div>
        ${
          datos.cajeroNombre
            ? `<div><strong>Atendió:</strong> ${datos.cajeroNombre}</div>`
            : ''
        }
        ${
          datos.clienteNombre
            ? `<div><strong>Cliente:</strong> ${datos.clienteNombre} ${
                datos.clienteDocumento ? `(${datos.clienteDocumento})` : ''
              }</div>`
            : ''
        }
      </div>

      <div class="divider"></div>

      <table>
        <thead>
          <tr style="border-bottom: 1px dashed #000; font-size: 11px;">
            <th style="text-align: left; padding-bottom: 4px;">Detalle</th>
            <th style="text-align: right; padding-bottom: 4px;">Importe</th>
          </tr>
        </thead>
        <tbody>
          ${filasItemsHtml}
        </tbody>
      </table>

      <div class="divider"></div>

      <table>
        ${
          datos.descuento && parseFloat(datos.descuento) > 0
            ? `<tr>
                <td style="text-align: left;">Subtotal:</td>
                <td style="text-align: right;">$ ${datos.subtotal}</td>
              </tr>
              <tr>
                <td style="text-align: left;">Descuento:</td>
                <td style="text-align: right;">-$ ${datos.descuento}</td>
              </tr>`
            : ''
        }
        <tr class="total-box">
          <td style="text-align: left;">TOTAL:</td>
          <td style="text-align: right;">$ ${datos.total}</td>
        </tr>
        <tr>
          <td style="text-align: left; font-size: 11px;">Medio de Cobro:</td>
          <td style="text-align: right; font-size: 11px; font-weight: bold;">${datos.medioCobro}</td>
        </tr>
      </table>

      <div class="divider"></div>

      <div class="text-center" style="font-size: 11px; margin-top: 8px;">
        <div>¡Muchas gracias por su compra!</div>
        <div style="font-size: 10px; color: #555; margin-top: 4px;">
          Comprobante no fiscal - Ticket de control
        </div>
      </div>

      <script>
        window.onload = function() {
          window.print();
          setTimeout(function() {
            window.close();
          }, 500);
        };
      </script>
    </body>
    </html>
  `;

  ventanaImpresion.document.documentElement.innerHTML = html;
  setTimeout(() => {
    ventanaImpresion.print();
    setTimeout(() => {
      ventanaImpresion.close();
    }, 500);
  }, 250);
}
