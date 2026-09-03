const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const accessToken = process.env.MP_ACCESS_TOKEN || '';
const isConfigured = Boolean(accessToken && accessToken !== 'TU_MERCADO_PAGO_ACCESS_TOKEN');

let client = null;
if (isConfigured) {
  client = new MercadoPagoConfig({ accessToken });
}

async function crearPreferencia({ recetaId, pacienteNombre, monto, baseUrl }) {
  if (!isConfigured) {
    console.log('[MercadoPago] Modo simulado (Token no configurado en .env). Generando link de prueba directo.');
    return {
      id: `mock-pref-${recetaId}`,
      init_point: `${baseUrl}/receta/${recetaId}?simular_mp=true`
    };
  }

  try {
    const preference = new Preference(client);
    const body = {
      items: [
        {
          id: recetaId,
          title: `Receta Médica - ${pacienteNombre}`,
          quantity: 1,
          unit_price: Number(monto),
          currency_id: process.env.MP_CURRENCY_ID || 'ARS'
        }
      ],
      back_urls: {
        success: `${baseUrl}/receta/${recetaId}?status=approved`,
        failure: `${baseUrl}/receta/${recetaId}?status=failure`,
        pending: `${baseUrl}/receta/${recetaId}?status=pending`
      },
      auto_return: 'approved',
      notification_url: `${baseUrl}/api/webhooks/mercadopago`,
      external_reference: recetaId
    };

    const response = await preference.create({ body });
    return {
      id: response.id,
      init_point: response.init_point
    };
  } catch (error) {
    console.error('[MercadoPago] Error creando preferencia:', error);
    throw error;
  }
}

async function consultarPago(paymentId) {
  if (!isConfigured) {
    return { status: 'approved' };
  }
  try {
    const payment = new Payment(client);
    const result = await payment.get({ id: paymentId });
    return result;
  } catch (error) {
    console.error('[MercadoPago] Error consultando pago:', error);
    throw error;
  }
}

module.exports = {
  isConfigured,
  crearPreferencia,
  consultarPago
};
