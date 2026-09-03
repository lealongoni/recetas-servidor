const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'recetas.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify({}, null, 2));
      return {};
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data || '{}');
  } catch (err) {
    console.error('Error leyendo base de datos:', err);
    return {};
  }
}

function saveDB(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    console.error('Error guardando base de datos:', err);
  }
}

module.exports = {
  create(receta) {
    const db = loadDB();
    db[receta.id] = receta;
    saveDB(db);
    return receta;
  },

  getById(id) {
    const db = loadDB();
    return db[id] || null;
  },

  getByPreferenceId(preferenceId) {
    const db = loadDB();
    return Object.values(db).find(r => r.mpPreferenceId === preferenceId) || null;
  },

  update(id, updates) {
    const db = loadDB();
    if (!db[id]) return null;
    db[id] = { ...db[id], ...updates, updatedAt: new Date().toISOString() };
    saveDB(db);
    return db[id];
  },

  list() {
    const db = loadDB();
    return Object.values(db);
  }
};
