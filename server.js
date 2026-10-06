const express = require("express");
const path = require("path");
const { createClient } = require("@libsql/client");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";

const JWT_SECRET = process.env.JWT_SECRET || (IS_PROD ? null : "CHANGE_ME_MAMOABIO_SECRET");
if (!JWT_SECRET) throw new Error("La variable d'environnement JWT_SECRET est obligatoire en production.");

// ---------- Base de données Turso (ou fichier local en développement) ----------
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:data/mamoabio.db",
  authToken: process.env.TURSO_AUTH_TOKEN
});

const all = async (sql, args = []) => (await db.execute({ sql, args })).rows.map(r => ({ ...r }));
const one = async (sql, args = []) => (await all(sql, args))[0] || null;
const run = (sql, args = []) => db.execute({ sql, args });

const IMG_PREFIX = "/api/images/";

async function init() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','super_admin')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT DEFAULT '',
      origin TEXT DEFAULT 'Madagascar',
      price TEXT DEFAULT 'Prix sur demande',
      image TEXT DEFAULT '',
      stock REAL DEFAULT 0,
      unit TEXT DEFAULT 'kg',
      available INTEGER DEFAULT 1,
      featured INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      product TEXT DEFAULT '',
      message TEXT NOT NULL,
      status TEXT DEFAULT 'new',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mime TEXT NOT NULL,
      data BLOB NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  if ((await one("SELECT COUNT(*) AS n FROM users")).n === 0) {
    await db.batch([
      { sql: "INSERT INTO users (username,email,password,role) VALUES (?,?,?,?)",
        args: ["admin", "admin@mamoabio.com", bcrypt.hashSync("Admin@123", 10), "admin"] },
      { sql: "INSERT INTO users (username,email,password,role) VALUES (?,?,?,?)",
        args: ["superadmin", "superadmin@mamoabio.com", bcrypt.hashSync("SuperAdmin@123", 10), "super_admin"] }
    ], "write");
  }

  if ((await one("SELECT COUNT(*) AS n FROM products")).n === 0) {
    const sql = `INSERT INTO products (name,category,description,origin,price,image,stock,unit,available,featured)
                 VALUES (?,?,?,?,?,?,?,?,?,?)`;
    await db.batch([
      { sql, args: ["Cacao de Madagascar","cacao","Fèves de cacao sélectionnées pour leur caractère aromatique et leur richesse naturelle.","Madagascar","Prix sur demande","https://images.unsplash.com/photo-1575377222312-dd1a9f29f5a0?auto=format&fit=crop&w=900&q=85",50,"kg",1,1] },
      { sql, args: ["Vanille Bourbon","vanille","Vanille Bourbon de Madagascar, appréciée pour son parfum intense et ses notes gourmandes.","Madagascar","Prix sur demande","https://images.unsplash.com/photo-1615485290382-441e4d049cb5?auto=format&fit=crop&w=900&q=85",20,"kg",1,1] },
      { sql, args: ["Poivre de Madagascar","epices","Un poivre de caractère, soigneusement sélectionné pour ses arômes et sa puissance.","Madagascar","Prix sur demande","https://images.unsplash.com/photo-1599909533730-f9d5b6d0b6c9?auto=format&fit=crop&w=900&q=85",35,"kg",1,1] }
    ], "write");
  }
}

// Initialisation unique (réutilisée entre les requêtes en serverless)
let ready = null;
app.use(async (req, res, next) => {
  try {
    ready = ready || init().catch(err => { ready = null; throw err; });
    await ready;
    next();
  } catch (err) {
    next(err);
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ---------- Upload d'images (stockées dans Turso, limite Vercel ~4,5 Mo) ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, /^image\/(png|jpe?g|webp|gif|avif)$/.test(file.mimetype))
});

async function saveImage(file) {
  const r = await run("INSERT INTO images (mime,data) VALUES (?,?)", [file.mimetype, file.buffer]);
  return `${IMG_PREFIX}${Number(r.lastInsertRowid)}`;
}

async function deleteImage(url) {
  if (url && url.startsWith(IMG_PREFIX)) {
    await run("DELETE FROM images WHERE id=?", [Number(url.slice(IMG_PREFIX.length))]);
  }
}

app.get("/api/images/:id", async (req, res) => {
  const r = await db.execute({ sql: "SELECT mime,data FROM images WHERE id=?", args: [Number(req.params.id)] });
  if (!r.rows.length) return res.status(404).end();
  res.set("Content-Type", r.rows[0].mime);
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.send(Buffer.from(r.rows[0].data));
});

// ---------- Auth ----------
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentification requise." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Session invalide ou expirée." });
  }
}

function superAdmin(req, res, next) {
  if (req.user.role !== "super_admin") return res.status(403).json({ error: "Accès Super Admin requis." });
  next();
}

const isTrue = v => (v === "1" || v === "true" || v === 1 || v === true) ? 1 : 0;

// ---------- Routes publiques ----------
app.get("/api/products", async (req, res) => {
  res.json(await all("SELECT * FROM products ORDER BY featured DESC, id DESC"));
});

app.post("/api/inquiries", async (req, res) => {
  const { name, email, product, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: "Champs obligatoires manquants." });
  await run("INSERT INTO inquiries (name,email,product,message) VALUES (?,?,?,?)", [name, email, product || "", message]);
  res.status(201).json({ message: "Demande enregistrée." });
});

app.post("/api/auth/login", async (req, res) => {
  const { identifier, password } = req.body;
  const user = await one("SELECT * FROM users WHERE username = ? OR email = ?", [identifier ?? "", identifier ?? ""]);
  if (!user || !bcrypt.compareSync(password || "", user.password)) {
    return res.status(401).json({ error: "Identifiants incorrects." });
  }
  const token = jwt.sign({ id: user.id, username: user.username, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "3h" });
  res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
});

app.get("/api/auth/me", auth, (req, res) => res.json({ user: req.user }));

// ---------- Administration ----------
app.get("/api/admin/stats", auth, async (req, res) => {
  const products = (await one("SELECT COUNT(*) n FROM products")).n;
  const available = (await one("SELECT COUNT(*) n FROM products WHERE available=1")).n;
  const stockOut = (await one("SELECT COUNT(*) n FROM products WHERE available=0 OR stock<=0")).n;
  const inquiries = (await one("SELECT COUNT(*) n FROM inquiries WHERE status IN ('new','not_confirmed')")).n;
  res.json({ products, available, stockOut, inquiries });
});

app.get("/api/admin/products", auth, async (req, res) => {
  res.json(await all("SELECT * FROM products ORDER BY id DESC"));
});

app.post("/api/admin/products", auth, upload.single("image"), async (req, res) => {
  const { name, category, description, origin, price, stock, unit, available, featured } = req.body;
  if (!name || !category) return res.status(400).json({ error: "Nom et catégorie obligatoires." });
  const image = req.file ? await saveImage(req.file) : (req.body.image || "");
  const r = await run(
    `INSERT INTO products (name,category,description,origin,price,image,stock,unit,available,featured)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [name, category, description || "", origin || "Madagascar", price || "Prix sur demande", image,
     Number(stock || 0), unit || "kg", isTrue(available), isTrue(featured)]
  );
  res.status(201).json(await one("SELECT * FROM products WHERE id=?", [Number(r.lastInsertRowid)]));
});

app.put("/api/admin/products/:id", auth, upload.single("image"), async (req, res) => {
  const id = Number(req.params.id);
  const old = await one("SELECT * FROM products WHERE id=?", [id]);
  if (!old) return res.status(404).json({ error: "Produit introuvable." });
  const b = req.body;
  const image = req.file ? await saveImage(req.file) : (b.image ?? old.image);
  await run(
    `UPDATE products SET name=?,category=?,description=?,origin=?,price=?,image=?,stock=?,unit=?,available=?,featured=?
     WHERE id=?`,
    [b.name ?? old.name, b.category ?? old.category, b.description ?? old.description,
     b.origin ?? old.origin, b.price ?? old.price, image, Number(b.stock ?? old.stock),
     b.unit ?? old.unit, isTrue(b.available), isTrue(b.featured), id]
  );
  if (image !== old.image) await deleteImage(old.image);
  res.json(await one("SELECT * FROM products WHERE id=?", [id]));
});

app.delete("/api/admin/products/:id", auth, async (req, res) => {
  const id = Number(req.params.id);
  const product = await one("SELECT image FROM products WHERE id=?", [id]);
  await run("DELETE FROM products WHERE id=?", [id]);
  if (product) await deleteImage(product.image);
  res.json({ message: "Produit supprimé." });
});

app.get("/api/admin/inquiries", auth, async (req, res) => {
  res.json(await all("SELECT * FROM inquiries ORDER BY id DESC"));
});

app.patch("/api/admin/inquiries/:id", auth, async (req, res) => {
  await run("UPDATE inquiries SET status='not_confirmed' WHERE status IN ('new','read')");
  res.json({ message: "Statut mis à jour." });
});

app.get("/api/admin/users", auth, superAdmin, async (req, res) => {
  res.json(await all("SELECT id,username,email,role,created_at FROM users ORDER BY id DESC"));
});

app.post("/api/admin/users", auth, superAdmin, async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password || !["admin", "super_admin"].includes(role)) {
    return res.status(400).json({ error: "Informations invalides." });
  }
  try {
    const r = await run("INSERT INTO users (username,email,password,role) VALUES (?,?,?,?)",
      [username, email, bcrypt.hashSync(password, 10), role]);
    res.status(201).json(await one("SELECT id,username,email,role,created_at FROM users WHERE id=?", [Number(r.lastInsertRowid)]));
  } catch {
    res.status(409).json({ error: "Nom d'utilisateur ou email déjà utilisé." });
  }
});

app.delete("/api/admin/users/:id", auth, superAdmin, async (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: "Vous ne pouvez pas supprimer votre propre compte." });
  await run("DELETE FROM users WHERE id=?", [Number(req.params.id)]);
  res.json({ message: "Utilisateur supprimé." });
});

app.get("/{*splat}", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) return res.status(400).json({ error: "Image trop volumineuse (4 Mo max)." });
  res.status(500).json({ error: "Erreur serveur." });
});

// Local : node server.js  |  Vercel : exporté via api/index.js
if (require.main === module) {
  app.listen(PORT, () => console.log(`Mamoabio lancé sur http://localhost:${PORT}`));
}
module.exports = app;
