require("dotenv").config();
const express = require("express"), mongoose = require("mongoose"), bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken"), cors = require("cors"), helmet = require("helmet");
const rateLimit = require("express-rate-limit"), crypto = require("crypto");

const { MONGODB_URI, JWT_SECRET, FRONTEND_URL = "", ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_PASSWORD, PORT = 3000 } = process.env;
if (!MONGODB_URI || !JWT_SECRET) { console.error("MONGODB_URI and JWT_SECRET are required."); process.exit(1); }

const User = mongoose.model("User", new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  username: { type: String, required: true, trim: true },
  usernameLower: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["user", "admin"], default: "user" },
  approved: { type: Boolean, default: false },
  mustChangePassword: { type: Boolean, default: false },
  tokenVersion: { type: Number, default: 0 }
}, { timestamps: true }));

const Batch = mongoose.model("Batch", new mongoose.Schema({
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  createdByName: { type: String, required: true },
  name: { type: String, default: "Untitled batch" },
  date: { type: String, default: "" },
  data: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true }));
const Setting = mongoose.model("Setting", new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed }
}));

const RATE_KEYS = ["bottle500", "sleeve500", "seal500", "bottle20", "label20", "seal20new", "seal20ref",
  "bottle10", "label10", "seal10new", "seal10ref", "bottle5", "label5", "seal5new", "seal5ref", "labour", "allowance"];
const PRICE_KEYS = ["pack500", "new20", "ref20", "new10", "ref10", "new5", "ref5", "vat", "inclusive"];
const QTY_KEYS = ["q500", "q20n", "q20r", "q10n", "q10r", "q5n", "q5r", "lab", "direct", "allowance", "total"];
const num = (v, nonNeg) => { v = Number(v); if (!Number.isFinite(v)) return 0; v = Math.min(Math.max(v, -1e9), 1e9); return nonNeg ? Math.max(v, 0) : v; };
const pickNums = (o, keys, nonNeg) => Object.fromEntries(keys.map(k => [k, num(o && o[k], nonNeg)]));
const text = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
function cleanSettings(b) {
  const rates = pickNums(b.rates, RATE_KEYS, true), prices = pickNums(b.prices, PRICE_KEYS, true);
  rates.allowance = Math.min(rates.allowance, 100); prices.vat = Math.min(prices.vat, 100); prices.inclusive = prices.inclusive ? 1 : 0;
  return { rates, prices };
}
function cleanBatch(d) {
  const sign = {};
  ["sh", "dcd", "cd"].forEach(k => { const s = (d.sign && d.sign[k]) || {}; sign[k] = { role: text(s.role, 10), name: text(s.name, 100), text: text(s.text, 300) }; });
  return { ...pickNums(d, QTY_KEYS), sales: pickNums(d.sales, ["net", "vat", "gross", "profit", "margin"]),
    rates: pickNums(d.rates, RATE_KEYS, true), prices: pickNums(d.prices, PRICE_KEYS, true), sign };
}
const pubBatch = b => ({ id: b._id, name: b.name, date: b.date, createdBy: b.createdBy, createdByName: b.createdByName, createdAt: b.createdAt, data: b.data });

const str = v => (typeof v === "string" ? v.trim() : "");
const validEmail = e => e.length <= 254 && /^[^\s@<>"'`\\]+@[^\s@<>"'`\\]+\.[^\s@<>"'`\\]+$/.test(e);
const validUser = u => /^[A-Za-z0-9_.-]{3,30}$/.test(u);
const validPass = p => typeof p === "string" && p.length >= 8 && p.length <= 100;
const pub = u => ({ id: u._id, email: u.email, username: u.username, role: u.role, approved: u.approved,
  mustChangePassword: u.mustChangePassword, createdAt: u.createdAt });
const signToken = u => jwt.sign({ id: u._id, tv: u.tokenVersion }, JWT_SECRET, { expiresIn: "8h" });
const hash = p => bcrypt.hash(p, 12);
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
const origins = FRONTEND_URL.split(",").map(s => s.trim().replace(/\/$/, "")).filter(Boolean);
app.use(cors({ origin: (o, cb) => cb(null, !o || origins.includes(o)) }));
app.use(express.json({ limit: "100kb" }));
app.param("id", (req, res, next, id) => mongoose.isValidObjectId(id) ? next() : res.status(404).json({ error: "Not found." }));
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, message: { error: "Too many attempts. Try again in 15 minutes." } });

async function auth(req, res, next) {
  try {
    const p = jwt.verify((req.headers.authorization || "").replace(/^Bearer /, ""), JWT_SECRET);
    const u = await User.findById(p.id);
    if (!u || !u.approved || u.tokenVersion !== p.tv) return res.status(401).json({ error: "Session expired. Please sign in again." });
    req.user = u; next();
  } catch { res.status(401).json({ error: "Please sign in." }); }
}
const adminOnly = (req, res, next) => req.user.role === "admin" ? next() : res.status(403).json({ error: "Admins only." });

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/api/register", limiter, wrap(async (req, res) => {
  const email = str(req.body.email).toLowerCase(), username = str(req.body.username), password = req.body.password;
  if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (!validUser(username)) return res.status(400).json({ error: "Username must be 3-30 characters: letters, numbers, . _ -" });
  if (!validPass(password)) return res.status(400).json({ error: "Password must be at least 8 characters." });
  try {
    await User.create({ email, username, usernameLower: username.toLowerCase(), passwordHash: await hash(password) });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: "That email or username is already registered." });
    throw e;
  }
  res.status(201).json({ message: "Account created. An administrator must approve it before you can sign in." });
}));

app.post("/api/login", limiter, wrap(async (req, res) => {
  const id = str(req.body.identifier), password = typeof req.body.password === "string" ? req.body.password : "";
  const u = id && await User.findOne(id.includes("@") ? { email: id.toLowerCase() } : { usernameLower: id.toLowerCase() });
  if (!u || !(await bcrypt.compare(password, u.passwordHash))) return res.status(401).json({ error: "Incorrect email/username or password." });
  if (!u.approved) return res.status(403).json({ error: "Your account is waiting for administrator approval." });
  res.json({ token: signToken(u), user: pub(u) });
}));

app.get("/api/me", auth, (req, res) => res.json({ user: pub(req.user) }));

app.post("/api/change-password", auth, wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (typeof currentPassword !== "string" || !(await bcrypt.compare(currentPassword, req.user.passwordHash)))
    return res.status(400).json({ error: "Current password is incorrect." });
  if (!validPass(newPassword)) return res.status(400).json({ error: "New password must be at least 8 characters." });
  req.user.passwordHash = await hash(newPassword);
  req.user.mustChangePassword = false; req.user.tokenVersion += 1;
  await req.user.save();
  res.json({ token: signToken(req.user), user: pub(req.user) });
}));

// ---- Shared rates and selling prices (everyone reads, only admins change) ----
app.get("/api/settings", auth, wrap(async (req, res) => {
  const s = await Setting.findOne({ key: "company" });
  res.json({ settings: s ? s.value : null });
}));
app.put("/api/settings", auth, adminOnly, wrap(async (req, res) => {
  const value = cleanSettings(req.body || {});
  await Setting.findOneAndUpdate({ key: "company" }, { $set: { value } }, { upsert: true, new: true });
  res.json({ settings: value });
}));

// ---- Shared batch records ----
app.get("/api/batches", auth, wrap(async (req, res) => {
  const list = await Batch.find().sort({ createdAt: -1 }).limit(500);
  res.json({ batches: list.map(pubBatch) });
}));
app.post("/api/batches", auth, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.data || typeof b.data !== "object" || Array.isArray(b.data)) return res.status(400).json({ error: "Batch data is missing." });
  const date = text(b.date, 10);
  const doc = await Batch.create({ createdBy: req.user._id, createdByName: req.user.username,
    name: text(b.name, 100) || "Untitled batch", date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "", data: cleanBatch(b.data) });
  res.status(201).json({ batch: pubBatch(doc) });
}));
app.delete("/api/batches/:id", auth, wrap(async (req, res) => {
  const b = await Batch.findById(req.params.id);
  if (!b) return res.status(404).json({ error: "Not found." });
  if (req.user.role !== "admin" && !b.createdBy.equals(req.user._id)) return res.status(403).json({ error: "You can only delete your own batches." });
  await Batch.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
}));

// ---- Admin dashboard ----
app.get("/api/admin/users", auth, adminOnly, wrap(async (req, res) => {
  const users = await User.find().sort({ approved: 1, createdAt: -1 });
  res.json({ users: users.map(pub) });
}));

app.patch("/api/admin/users/:id", auth, adminOnly, wrap(async (req, res) => {
  const u = await User.findById(req.params.id);
  if (!u) return res.status(404).json({ error: "User not found." });
  const self = u._id.equals(req.user._id), { approved, role } = req.body;
  if (self && (approved === false || role === "user")) return res.status(400).json({ error: "You cannot revoke or demote your own account." });
  if (typeof approved === "boolean") u.approved = approved;
  if (role === "user" || role === "admin") u.role = role;
  await u.save();
  res.json({ user: pub(u) });
}));

// Reset (no body: generates a temporary password) or set a specific password. User must change it at next sign-in.
app.post("/api/admin/users/:id/password", auth, adminOnly, wrap(async (req, res) => {
  const u = await User.findById(req.params.id);
  if (!u) return res.status(404).json({ error: "User not found." });
  const given = req.body.newPassword, generated = given === undefined;
  const pw = generated ? crypto.randomBytes(9).toString("base64url") : given;
  if (!validPass(pw)) return res.status(400).json({ error: "Password must be at least 8 characters." });
  u.passwordHash = await hash(pw); u.mustChangePassword = true; u.tokenVersion += 1;
  await u.save();
  res.json({ message: "Password updated. The user must change it at next sign-in.", tempPassword: generated ? pw : undefined });
}));

app.delete("/api/admin/users/:id", auth, adminOnly, wrap(async (req, res) => {
  if (req.user._id.equals(req.params.id)) return res.status(400).json({ error: "You cannot delete your own account." });
  await User.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
}));

app.use((req, res) => res.status(404).json({ error: "Not found." }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: "Server error." }); });

(async () => {
  await mongoose.connect(MONGODB_URI);
  if (!(await User.exists({ role: "admin" })) && ADMIN_EMAIL && ADMIN_USERNAME && validPass(ADMIN_PASSWORD)) {
    await User.create({ email: ADMIN_EMAIL.toLowerCase(), username: ADMIN_USERNAME, usernameLower: ADMIN_USERNAME.toLowerCase(),
      passwordHash: await hash(ADMIN_PASSWORD), role: "admin", approved: true });
    console.log("First admin created.");
  }
  app.listen(PORT, () => console.log("API listening on " + PORT));
})().catch(e => { console.error(e); process.exit(1); });
