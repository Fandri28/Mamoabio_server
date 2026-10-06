// Copie data/mamoabio.db (+ photos de public/uploads) vers Turso.
// Usage : TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/migrate-to-turso.js
const fs = require("fs");
const path = require("path");
const { createClient } = require("@libsql/client");

const local = createClient({ url: "file:" + path.join(__dirname, "..", "data", "mamoabio.db") });
const remote = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

(async () => {
  // Le serveur crée les tables au premier démarrage ; on les crée ici aussi au cas où.
  await remote.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','super_admin')), created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL, description TEXT DEFAULT '', origin TEXT DEFAULT 'Madagascar', price TEXT DEFAULT 'Prix sur demande', image TEXT DEFAULT '', stock REAL DEFAULT 0, unit TEXT DEFAULT 'kg', available INTEGER DEFAULT 1, featured INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS inquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, product TEXT DEFAULT '', message TEXT NOT NULL, status TEXT DEFAULT 'new', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS images (id INTEGER PRIMARY KEY AUTOINCREMENT, mime TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  `);

  const get = async t => (await local.execute(`SELECT * FROM ${t}`)).rows.map(r => ({ ...r }));

  for (const u of await get("users")) {
    await remote.execute({ sql: "INSERT OR IGNORE INTO users (id,username,email,password,role,created_at) VALUES (?,?,?,?,?,?)",
      args: [u.id, u.username, u.email, u.password, u.role, u.created_at] });
  }

  for (const p of await get("products")) {
    let image = p.image || "";
    if (image.startsWith("/uploads/")) {
      const file = path.join(__dirname, "..", "public", image);
      if (fs.existsSync(file)) {
        const r = await remote.execute({ sql: "INSERT INTO images (mime,data) VALUES (?,?)",
          args: [MIME[path.extname(file).toLowerCase()] || "image/png", fs.readFileSync(file)] });
        image = `/api/images/${Number(r.lastInsertRowid)}`;
      }
    }
    await remote.execute({ sql: `INSERT OR IGNORE INTO products (id,name,category,description,origin,price,image,stock,unit,available,featured,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [p.id, p.name, p.category, p.description, p.origin, p.price, image, p.stock, p.unit, p.available, p.featured, p.created_at] });
  }

  for (const i of await get("inquiries")) {
    await remote.execute({ sql: "INSERT OR IGNORE INTO inquiries (id,name,email,product,message,status,created_at) VALUES (?,?,?,?,?,?,?)",
      args: [i.id, i.name, i.email, i.product, i.message, i.status, i.created_at] });
  }
  console.log("Migration terminée.");
})().catch(e => { console.error(e); process.exit(1); });
