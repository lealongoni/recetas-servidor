require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { crearPreferencia, consultarPago, isConfigured } = require('./mercadopago');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de almacenamiento de PDFs
const STORAGE_DIR = path.join(__dirname, '..', 'storage', 'recetas');
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, STORAGE_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos en formato PDF'));
    }
  }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function getBaseUrl(req) {
  if (process.env.RENDER_EXTERNAL_URL) {
    return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '');
  }
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${protocol}://${host}`;
}

// 1. CARGA DE RECETA (Llamado desde la App APK o Web del Médico)
app.post('/api/recetas/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Debes adjuntar un archivo PDF con la receta' });
    }

    const pacienteNombre = (req.body.paciente || 'Paciente').trim();
    const telefono = (req.body.telefono || '').replace(/\D/g, '');
    const email = (req.body.email || '').trim();
    const monto = parseFloat(req.body.monto || 0);

    if (isNaN(monto) || monto <= 0) {
      return res.status(400).json({ error: 'El monto ingresado no es válido' });
    }

    const recetaId = uuidv4();
    const baseUrl = getBaseUrl(req);

    // Crear preferencia en Mercado Pago
    const pref = await crearPreferencia({
      recetaId,
      pacienteNombre,
      monto,
      baseUrl
    });

    const receta = {
      id: recetaId,
      pacienteNombre,
      telefono,
      email,
      monto,
      archivoNombreOriginal: req.file.originalname,
      archivoGuardado: req.file.filename,
      archivoRuta: req.file.path,
      status: 'pending', // pending | approved | expired
      mpPreferenceId: pref.id,
      mpInitPoint: pref.init_point,
      createdAt: new Date().toISOString(),
      paidAt: null,
      downloadExpiresAt: null
    };

    db.create(receta);

    const urlPaciente = `${baseUrl}/receta/${recetaId}`;
    const textoWhatsApp = urlPaciente;
    const whatsappUrl = telefono
      ? `https://wa.me/${telefono}?text=${encodeURIComponent(textoWhatsApp)}`
      : `https://wa.me/?text=${encodeURIComponent(textoWhatsApp)}`;

    return res.status(201).json({
      success: true,
      recetaId,
      urlPaciente,
      whatsappUrl,
      textoWhatsApp,
      monto,
      pacienteNombre,
      telefono,
      email
    });
  } catch (error) {
    console.error('Error al subir receta:', error);
    return res.status(500).json({ error: 'Error interno al procesar la receta: ' + error.message });
  }
});

// 2. OBTENER INFORMACIÓN DE LA RECETA (Para el portal del paciente)
app.get('/api/recetas/:id', (req, res) => {
  const receta = db.getById(req.params.id);
  if (!receta) {
    return res.status(404).json({ error: 'Receta no encontrada' });
  }

  const now = Date.now();
  let isExpired = false;
  let segundosRestantes = 0;

  if (receta.downloadExpiresAt) {
    const expiresMs = new Date(receta.downloadExpiresAt).getTime();
    segundosRestantes = Math.max(0, Math.floor((expiresMs - now) / 1000));
    if (segundosRestantes <= 0) {
      isExpired = true;
    }
  }

  res.json({
    id: receta.id,
    pacienteNombre: receta.pacienteNombre,
    monto: receta.monto,
    status: receta.status,
    mpInitPoint: receta.mpInitPoint,
    mpConfigurado: isConfigured(),
    bankConfig: db.getBankConfig(),
    transferReportedAt: receta.transferReportedAt,
    paidAt: receta.paidAt,
    downloadExpiresAt: receta.downloadExpiresAt,
    segundosRestantes,
    isExpired,
    fechaCreacion: receta.createdAt
  });
});

// 3. DESCARGAR RECETA EN PDF (Solo si fue pagada y dentro de los 5 minutos)
app.get('/api/recetas/:id/download', (req, res) => {
  const receta = db.getById(req.params.id);
  if (!receta) {
    return res.status(404).send('Receta no encontrada');
  }

  if (receta.status !== 'approved') {
    return res.status(403).send('Esta receta aún no ha sido abonada.');
  }

  const now = Date.now();
  if (receta.downloadExpiresAt && now > new Date(receta.downloadExpiresAt).getTime()) {
    return res.status(410).send('El enlace de descarga ha expirado (límite de 5 minutos por seguridad médica). Contacte a su médico para renovarlo.');
  }

  if (!fs.existsSync(receta.archivoRuta)) {
    return res.status(404).send('El archivo PDF no se encuentra disponible.');
  }

  const nombreDescarga = `Receta-${receta.pacienteNombre.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreDescarga}"`);
  const stream = fs.createReadStream(receta.archivoRuta);
  stream.pipe(res);
});

// SISTEMA DE EVENTOS EN TIEMPO REAL (SSE) PARA NOTIFICACIONES
const eventClients = new Set();
function broadcastEvent(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of eventClients) {
    try {
      client.write(data);
    } catch (e) {
      eventClients.delete(client);
    }
  }
}

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  eventClients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (e) {
      clearInterval(keepAlive);
      eventClients.delete(res);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    eventClients.delete(res);
  });
});

// 4. CONFIGURACIÓN BANCARIA (ALIAS, CBU, TITULAR)
app.get('/api/config/banco', (req, res) => {
  res.json(db.getBankConfig());
});

app.post('/api/config/banco', (req, res) => {
  const { alias, cvu, titular, banco } = req.body;
  const updated = db.updateBankConfig({
    ...(alias ? { alias: alias.trim() } : {}),
    ...(cvu ? { cvu: cvu.trim() } : {}),
    ...(titular ? { titular: titular.trim() } : {}),
    ...(banco ? { banco: banco.trim() } : {})
  });
  res.json({ success: true, config: updated });
});

// 5. INFORMAR TRANSFERENCIA (Desde el portal del paciente)
app.post('/api/recetas/:id/report-transfer', (req, res) => {
  const receta = db.getById(req.params.id);
  if (!receta) {
    return res.status(404).json({ error: 'Receta no encontrada' });
  }

  if (receta.status === 'approved') {
    return res.json({ success: true, message: 'La receta ya está aprobada.', status: 'approved' });
  }

  const now = new Date().toISOString();
  const updated = db.update(receta.id, {
    status: 'transfer_pending',
    transferReportedAt: now,
    transferNote: (req.body.note || '').trim()
  });

  broadcastEvent({
    type: 'transfer_reported',
    recetaId: receta.id,
    pacienteNombre: receta.pacienteNombre,
    monto: receta.monto,
    time: now
  });

  console.log(`[Transferencia Informada] Receta ${receta.id} de ${receta.pacienteNombre} por $${receta.monto}`);
  res.json({ success: true, receta: updated });
});

// 6. LISTAR TRANSFERENCIAS PENDIENTES (Para la app y panel médico)
app.get('/api/recetas/pending-transfers', (req, res) => {
  res.json(db.getPendingTransfers());
});

// 7. APROBAR TRANSFERENCIA (La secretaria/médico toca "Aprobar")
app.post('/api/recetas/:id/approve-transfer', (req, res) => {
  const receta = db.getById(req.params.id);
  if (!receta) {
    return res.status(404).json({ error: 'Receta no encontrada' });
  }

  const now = new Date();
  const expires = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutos de vigencia

  const updated = db.update(receta.id, {
    status: 'approved',
    paidAt: now.toISOString(),
    downloadExpiresAt: expires.toISOString(),
    paymentMethod: 'transfer'
  });

  broadcastEvent({
    type: 'transfer_approved',
    recetaId: receta.id,
    pacienteNombre: receta.pacienteNombre,
    monto: receta.monto,
    time: now.toISOString()
  });

  console.log(`[Transferencia Aprobada] Receta ${receta.id} aprobada. Expira: ${expires.toISOString()}`);
  res.json({ success: true, receta: updated });
});

// 8. RECHAZAR TRANSFERENCIA
app.post('/api/recetas/:id/reject-transfer', (req, res) => {
  const receta = db.getById(req.params.id);
  if (!receta) {
    return res.status(404).json({ error: 'Receta no encontrada' });
  }

  const updated = db.update(receta.id, {
    status: 'pending',
    transferRejectedAt: new Date().toISOString()
  });

  res.json({ success: true, receta: updated });
});

// 9. VERIFICAR PAGO CON MERCADO PAGO
app.post('/api/recetas/:id/verificar-pago', async (req, res) => {
  try {
    const receta = db.getById(req.params.id);
    if (!receta) {
      return res.status(404).json({ error: 'Receta no encontrada' });
    }

    if (receta.status === 'approved') {
      return res.json({ success: true, message: 'Pago ya acreditado.', receta });
    }

    const paymentId = req.body.paymentId || req.query.payment_id || req.query['data.id'];
    if (!paymentId) {
      return res.status(400).json({ error: 'Identificador de pago no provisto' });
    }

    // Consultar el estado real en la API de Mercado Pago
    const payment = await consultarPago(paymentId);
    if (payment && payment.status === 'approved') {
      const now = new Date();
      const expires = new Date(now.getTime() + 5 * 60 * 1000);

      const updated = db.update(receta.id, {
        status: 'approved',
        paidAt: now.toISOString(),
        downloadExpiresAt: expires.toISOString(),
        mpPaymentId: String(paymentId),
        paymentMethod: 'mercadopago'
      });

      broadcastEvent({
        type: 'mp_payment_approved',
        recetaId: receta.id,
        pacienteNombre: receta.pacienteNombre,
        monto: receta.monto,
        time: now.toISOString()
      });

      return res.json({
        success: true,
        message: 'Pago verificado con éxito. El link de descarga expira en 5 minutos.',
        receta: updated
      });
    }

    return res.status(400).json({ error: 'El pago no figura como aprobado en Mercado Pago' });
  } catch (error) {
    console.error('[Verificar Pago] Error:', error);
    return res.status(500).json({ error: 'Error al verificar el estado del pago' });
  }
});

// 10. WEBHOOK DE MERCADO PAGO
app.all('/api/webhooks/mercadopago', async (req, res) => {
  try {
    const paymentId = req.query['data.id'] || req.query.id || (req.body && req.body.data && req.body.data.id);
    const type = req.query.type || (req.body && req.body.type);

    console.log('[Webhook Mercado Pago]', { query: req.query, body: req.body });

    if (paymentId && (type === 'payment' || !type)) {
      const payment = await consultarPago(paymentId);
      if (payment && payment.status === 'approved') {
        const recetaId = payment.external_reference;
        if (recetaId) {
          const now = new Date();
          const expires = new Date(now.getTime() + 5 * 60 * 1000); // Expira en 5 minutos
          const updated = db.update(recetaId, {
            status: 'approved',
            paidAt: now.toISOString(),
            downloadExpiresAt: expires.toISOString(),
            mpPaymentId: String(paymentId),
            paymentMethod: 'mercadopago'
          });

          broadcastEvent({
            type: 'mp_payment_approved',
            recetaId,
            pacienteNombre: updated ? updated.pacienteNombre : 'Paciente',
            monto: updated ? updated.monto : 0,
            time: now.toISOString()
          });

          console.log(`[Webhook] Receta ${recetaId} marcada como pagada con éxito.`);
        }
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('[Webhook] Error procesando notificación:', error);
    res.status(200).send('OK');
  }
});

// 6. RUTA PARA SERVIR EL PORTAL WEB DEL PACIENTE
app.get('/receta/:id', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile('receta.html', { root: path.join(__dirname, '..', 'public') });
});

// INICIO DEL SERVIDOR
app.listen(PORT, '0.0.0.0', () => {
  console.log(`===================================================`);
  console.log(` Servidor de Recetas Médicas iniciado en puerto ${PORT}`);
  console.log(` - Portal Paciente: http://localhost:${PORT}/receta/:id`);
  console.log(` - Panel Médico Web: http://localhost:${PORT}/index.html`);
  console.log(`===================================================`);
});
