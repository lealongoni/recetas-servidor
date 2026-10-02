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

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DEFAULT_BANK_CONFIG = {
  alias: 'lnd.longoni.uala',
  cvu: 'lnd.longoni.uala',
  titular: 'Leandro Longoni',
  banco: 'Ualá'
};

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_BANK_CONFIG, null, 2));
      return DEFAULT_BANK_CONFIG;
    }
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    return { ...DEFAULT_BANK_CONFIG, ...JSON.parse(data || '{}') };
  } catch (err) {
    console.error('Error leyendo config:', err);
    return DEFAULT_BANK_CONFIG;
  }
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  } catch (err) {
    console.error('Error guardando config:', err);
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
  },

  getPendingTransfers() {
    const db = loadDB();
    return Object.values(db)
      .filter(r => r.status === 'transfer_pending')
      .sort((a, b) => new Date(b.transferReportedAt || 0) - new Date(a.transferReportedAt || 0));
  },

  getBankConfig() {
    return loadConfig();
  },

  updateBankConfig(updates) {
    const current = loadConfig();
    const updated = { ...current, ...updates };
    saveConfig(updated);
    return updated;
  }
};
