const TOKEN_KEY = "wc_token";
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = t => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  const t = getToken(); if (t) headers.Authorization = "Bearer " + t;
  let r;
  try { r = await fetch(API_URL + path, { method: opts.method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch { throw new Error("Cannot reach the server. It may be waking up; wait a minute and try again."); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.error || "Request failed"); e.status = r.status; throw e; }
  return d;
}

async function getMe() {
  if (!getToken()) return null;
  try { return (await api("/api/me")).user; }
  catch (e) { if (e.status === 401) setToken(null); return null; }
}

function logout() { setToken(null); location.replace("login.html"); }

// Protects a page. Hides it until access is confirmed.
async function requireAuth(adminOnly, onAccountPage) {
  document.documentElement.style.visibility = "hidden";
  const me = await getMe();
  if (!me) { location.replace("login.html"); return null; }
  if (me.mustChangePassword && !onAccountPage) { location.replace("account.html?force=1"); return null; }
  if (adminOnly && me.role !== "admin") { location.replace("index.html"); return null; }
  const bar = document.getElementById("userbar");
  if (bar) {
    bar.textContent = "";
    const who = document.createElement("span"); who.textContent = me.username + (me.role === "admin" ? " (admin)" : ""); bar.append(who);
    const link = (href, text) => { const a = document.createElement("a"); a.href = href; a.textContent = text; bar.append(a); };
    if (me.role === "admin") link("admin.html", "Manage users");
    link("account.html", "Change password");
    const b = document.createElement("button"); b.className = "ghost"; b.textContent = "Log out"; b.onclick = logout; bar.append(b);
  }
  document.documentElement.style.visibility = "visible";
  return me;
}
