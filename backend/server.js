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
app.use(express.json({ limit: "10kb" }));
app.param("id", (req, res, next, id) => mongoose.isValidObjectId(id) ? next() : res.status(404).json({ error: "User not found." }));
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
