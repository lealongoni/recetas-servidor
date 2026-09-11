const http = require('http');
const fs = require('fs');
const path = require('path');

// We will start index.js server and make real HTTP requests
process.env.PORT = '3001';
const server = require('./src/index');

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTests() {
  await wait(1000);
  console.log('\n=========================================');
  console.log(' INICIANDO PRUEBAS END-TO-END (E2E)');
  console.log('=========================================');

  const pdfPath = path.join(__dirname, 'receta_ejemplo.pdf');
  const pdfBuffer = fs.readFileSync(pdfPath);

  // 1. TEST UPLOAD (Multipart)
  console.log('\n[TEST 1] Carga de receta vía POST /api/recetas/upload...');
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  let body = '';
  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="paciente"\r\n\r\nCarlos Gomez\r\n`;
  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="telefono"\r\n\r\n5491155556666\r\n`;
  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="monto"\r\n\r\n12000\r\n`;
  body += `--${boundary}\r\n`;
  body += `Content-Disposition: form-data; name="pdf"; filename="receta_ejemplo.pdf"\r\n`;
  body += `Content-Type: application/pdf\r\n\r\n`;

  const headBuffer = Buffer.from(body, 'utf-8');
  const tailBuffer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
  const fullBody = Buffer.concat([headBuffer, pdfBuffer, tailBuffer]);

  const uploadRes = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/recetas/upload',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': fullBody.length
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(fullBody);
    req.end();
  });

  console.log('Respuesta Upload:', uploadRes.statusCode, uploadRes.body);
  if (uploadRes.statusCode !== 201 || !uploadRes.body.recetaId) {
    throw new Error('Fallo en test de carga');
  }
  const recetaId = uploadRes.body.recetaId;
  console.log('✓ Receta creada con éxito ID:', recetaId);
  console.log('✓ WhatsApp Link generado:', uploadRes.body.whatsappUrl);

  // 2. TEST CONSULTAR ESTADO (Pendiente de pago)
  console.log('\n[TEST 2] Consultar estado antes del pago...');
  const statusRes = await new Promise((resolve, reject) => {
    http.get(`http://localhost:3001/api/recetas/${recetaId}`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(data) }));
    }).on('error', reject);
  });
  console.log('Estado inicial:', statusRes.body.status);
  if (statusRes.body.status !== 'pending') {
    throw new Error('El estado debería ser pending');
  }
  console.log('✓ Estado inicial verificado: pending');

  // 3. TEST DESCARGA BLOQUEADA ANTES DE PAGAR
  console.log('\n[TEST 3] Intentar descargar receta sin haber pagado...');
  const downloadPrePay = await new Promise((resolve, reject) => {
    http.get(`http://localhost:3001/api/recetas/${recetaId}/download`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    }).on('error', reject);
  });
  console.log('Status code descarga no autorizada:', downloadPrePay.statusCode);
  if (downloadPrePay.statusCode !== 403) {
    throw new Error('Se esperaba 403 Forbidden antes del pago');
  }
  console.log('✓ Descarga correctamente denegada antes del pago.');

  // 4. TEST VERIFICAR PAGO APROBADO (5 minutos de expiración)
  console.log('\n[TEST 4] Verificar pago aprobado...');
  const payRes = await new Promise((resolve, reject) => {
    const postData = JSON.stringify({ paymentId: 'test-payment-123' });
    const req = http.request({
      hostname: 'localhost',
      port: 3001,
      path: `/api/recetas/${recetaId}/verificar-pago`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
  console.log('Respuesta pago:', payRes.body);
  if (!payRes.body.success || payRes.body.receta.status !== 'approved') {
    throw new Error('Fallo al registrar pago');
  }
  console.log('✓ Pago aprobado registrado. Expira:', payRes.body.receta.downloadExpiresAt);

  // 5. TEST DESCARGA HABILITADA
  console.log('\n[TEST 5] Descargar receta en PDF tras el pago...');
  const downloadPostPay = await new Promise((resolve, reject) => {
    http.get(`http://localhost:3001/api/recetas/${recetaId}/download`, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        data: Buffer.concat(chunks)
      }));
    }).on('error', reject);
  });
  console.log('Status code descarga pagada:', downloadPostPay.statusCode);
  console.log('Content-Type:', downloadPostPay.headers['content-type']);
  console.log('Tamaño descargado:', downloadPostPay.data.length, 'bytes');
  if (downloadPostPay.statusCode !== 200 || !downloadPostPay.headers['content-type'].includes('application/pdf')) {
    throw new Error('La descarga del PDF falló');
  }
  console.log('✓ Descarga del PDF verificada con éxito.');

  // 6. TEST EXPIRACIÓN (5 minutos)
  console.log('\n[TEST 6] Verificar expiración del enlace tras los 5 minutos...');
  const db = require('./src/db');
  // Forzar fecha expirada en el pasado
  db.update(recetaId, {
    downloadExpiresAt: new Date(Date.now() - 1000).toISOString()
  });

  const downloadExpired = await new Promise((resolve, reject) => {
    http.get(`http://localhost:3001/api/recetas/${recetaId}/download`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    }).on('error', reject);
  });
  console.log('Status code descarga expirada:', downloadExpired.statusCode, downloadExpired.body);
  if (downloadExpired.statusCode !== 410) {
    throw new Error('Se esperaba 410 Gone para descarga expirada');
  }
  console.log('✓ Expiración de 5 minutos verificada correctamente (HTTP 410).');

  console.log('\n======================================================');
  console.log(' ¡TODAS LAS PRUEBAS END-TO-END PASARON EXITOSAMENTE! ');
  console.log('======================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('ERROR EN E2E:', err);
  process.exit(1);
});
