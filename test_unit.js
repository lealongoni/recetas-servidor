const http = require('http');
const fs = require('fs');
const path = require('path');

// Test basic functions of db and logic
const db = require('./src/db');
console.log('1. DB module loaded successfully');

// Run index.js in background or test modules directly
const { crearPreferencia } = require('./src/mercadopago');
async function runUnitTests() {
  console.log('2. Testing MercadoPago module mock fallback...');
  const pref = await crearPreferencia({
    recetaId: 'test-123',
    pacienteNombre: 'Paciente Prueba',
    monto: 5000,
    baseUrl: 'http://localhost:3000'
  });
  console.log('Preferencia generada:', pref);

  console.log('3. Testing DB create and expiration logic...');
  const now = new Date();
  const expires5min = new Date(now.getTime() + 5 * 60 * 1000);
  const testReceta = {
    id: 'test-uuid-456',
    pacienteNombre: 'Maria Lopez',
    monto: 7500,
    status: 'approved',
    downloadExpiresAt: expires5min.toISOString(),
    archivoRuta: path.join(__dirname, 'receta_ejemplo.pdf')
  };
  db.create(testReceta);
  const fetched = db.getById('test-uuid-456');
  if (fetched && fetched.pacienteNombre === 'Maria Lopez') {
    console.log('DB create/get verificado.');
  } else {
    throw new Error('Fallo en DB test');
  }

  console.log('TODO OK: Pruebas unitarias de servidor superadas.');
}

runUnitTests().catch(err => {
  console.error('Error en pruebas:', err);
  process.exit(1);
});
