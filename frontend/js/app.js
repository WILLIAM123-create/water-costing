const SIZES = [
  { k: "20", label: "20 L", nq: "q20n", rq: "q20r" },
  { k: "10", label: "10 L", nq: "q10n", rq: "q10r" },
  { k: "5",  label: "5 L",  nq: "q5n",  rq: "q5r" }
];
// 10 L and 5 L rates start at 0: enter your real prices under Rates.
const DEFAULT_RATES = {
  bottle500: 7.90, sleeve500: 0.50, seal500: 0.30,
  bottle20: 135.00, label20: 6.00, seal20new: 1.70, seal20ref: 1.70,
  bottle10: 0, label10: 0, seal10new: 0, seal10ref: 0,
  bottle5: 0, label5: 0, seal5new: 0, seal5ref: 0,
  labour: 335.00, allowance: 5
};
const RATE_LABELS = { bottle500: "500 mL empty bottle", sleeve500: "500 mL sleeve", seal500: "500 mL security seal", labour: "Labour per unit/day", allowance: "Consumables/misc (%)" };
SIZES.forEach(s => Object.assign(RATE_LABELS, {
  ["bottle" + s.k]: s.label + " new empty bottle", ["label" + s.k]: s.label + " label",
  ["seal" + s.k + "new"]: s.label + " new security seal", ["seal" + s.k + "ref"]: s.label + " refill security seal"
}));
const DEFAULT_PRICES = { pack500: 0, new20: 0, ref20: 0, new10: 0, ref10: 0, new5: 0, ref5: 0, vat: 16, inclusive: 0 };
const ROLES = [
  { key: "sh", role: "SH", text: "Budget cost calculated and production inputs verified." },
  { key: "dcd", role: "DCD", text: "Checked and verified." },
  { key: "cd", role: "CD", text: "Noted / approved." }
];

const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let rates = { ...DEFAULT_RATES };
let prices = { ...DEFAULT_PRICES };
let saved = [];
let isAdmin = false, me = null, settingsTimer = null;
const sign = load("wc_sign", {});
let current = null;

function readQty() {
  const q = { q500: +$("q500").value || 0, lab: +$("labour").value || 0 };
  SIZES.forEach(s => { q[s.nq] = +$(s.nq).value || 0; q[s.rq] = +$(s.rq).value || 0; });
  return q;
}

function calculate() {
  const q = readQty(), r = rates;
  const rows = [["500 mL empty bottles", q.q500, r.bottle500], ["500 mL sleeves", q.q500, r.sleeve500], ["500 mL security seals", q.q500, r.seal500]];
  const missing = [];
  SIZES.forEach(s => {
    const n = q[s.nq], f = q[s.rq];
    rows.push([s.label + " new empty bottles", n, r["bottle" + s.k]], [s.label + " new labels", n, r["label" + s.k]],
              [s.label + " new security seals", n, r["seal" + s.k + "new"]], [s.label + " refill security seals", f, r["seal" + s.k + "ref"]]);
    if ((n > 0 && !r["bottle" + s.k]) || (f > 0 && !r["seal" + s.k + "ref"])) missing.push(s.label);
  });
  rows.push(["Labour (units)", q.lab, r.labour]);
  const lines = rows.map(([name, qty, rate]) => ({ name, qty, rate, cost: round2(qty * rate) }));
  const direct = round2(lines.reduce((s, l) => s + l.cost, 0));
  const allowance = round2(direct * r.allowance / 100);
  const total = round2(direct + allowance);
  return { ...q, lines, direct, allowance, total, missing, sales: calcSales(q, total) };
}

function calcSales(q, totalCost) {
  const v = prices.vat / 100, incl = +prices.inclusive === 1;
  const mk = (name, qty, entered, vatable) => {
    let net = entered, vat = 0;
    if (vatable) { net = incl ? entered / (1 + v) : entered; vat = incl ? entered - net : entered * v; }
    return { name, qty, net: round2(net), vat: round2(vat), gross: round2(net + vat) };
  };
  const packs = q.q500 / 24;
  const lines = [mk("500 mL (" + packs.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " packs)", q.q500, packs * prices.pack500, true)];
  SIZES.forEach(s => lines.push(
    mk(s.label + " new bottles", q[s.nq], q[s.nq] * prices["new" + s.k], true),
    mk(s.label + " refills (no VAT)", q[s.rq], q[s.rq] * prices["ref" + s.k], false)));
  const net = round2(lines.reduce((a, l) => a + l.net, 0)), vat = round2(lines.reduce((a, l) => a + l.vat, 0));
  const profit = round2(net - totalCost);
  return { lines, net, vat, gross: round2(net + vat), profit, margin: net ? profit / net * 100 : 0 };
}

function renderResult() {
  current = calculate();
  $("result").querySelector("tbody").innerHTML =
    current.lines.filter(l => l.qty > 0 || l.name.startsWith("Labour")).map(l =>
      `<tr><td>${l.name}</td><td class="n">${l.qty.toLocaleString()}</td><td class="n">${fmt(l.rate)}</td><td class="n">${fmt(l.cost)}</td></tr>`).join("") +
    `<tr class="sum"><td colspan="3">Direct-cost subtotal</td><td class="n">${fmt(current.direct)}</td></tr>` +
    `<tr><td colspan="3">Consumables/misc (${rates.allowance}%)</td><td class="n">${fmt(current.allowance)}</td></tr>` +
    `<tr class="total"><td colspan="3">Total budget cost</td><td class="n">${fmt(current.total)}</td></tr>`;
  $("packs").textContent = current.q500 ? `500 mL equivalent: ${(current.q500 / 24).toLocaleString(undefined, { maximumFractionDigits: 2 })} packs of 24.` : "";
  $("warn").textContent = current.missing.length ? `Rates for ${current.missing.join(", ")} are still 0. Enter them under Rates.` : "";
  const s = current.sales;
  $("sales").querySelector("tbody").innerHTML =
    s.lines.filter(l => l.qty > 0).map(l => `<tr><td>${l.name}</td><td class="n">${fmt(l.net)}</td><td class="n">${fmt(l.vat)}</td><td class="n">${fmt(l.gross)}</td></tr>`).join("") +
    `<tr class="sum"><td>Total sales</td><td class="n">${fmt(s.net)}</td><td class="n">${fmt(s.vat)}</td><td class="n">${fmt(s.gross)}</td></tr>` +
    `<tr><td colspan="3">Total budget cost</td><td class="n">${fmt(current.total)}</td></tr>` +
    `<tr class="total"><td colspan="3">Profit (${s.margin.toFixed(1)}% of net sales)</td><td class="n">${fmt(s.profit)}</td></tr>`;
}

function mixText(b) {
  return [b.q500 && `${b.q500} × 500 mL`, ...SIZES.flatMap(s => [b[s.nq] && `${b[s.nq]} × ${s.label} new`, b[s.rq] && `${b[s.rq]} × ${s.label} refill`])].filter(Boolean).join("; ") || "-";
}
function renderSaved() {
  $("empty").style.display = saved.length ? "none" : "block";
  $("saved").querySelector("tbody").innerHTML = saved.map(b => {
    const can = isAdmin || (me && b.owner === me.id);
    return `<tr><td>${esc(b.name)}</td><td>${esc(b.date)}</td><td>${esc(b.by)}</td><td>${mixText(b)}</td><td class="n">${b.lab}</td>
     <td class="n">${fmt(b.direct)}</td><td class="n">${fmt(b.allowance)}</td><td class="n">${fmt(b.total)}</td>
     <td class="n">${b.sales ? fmt(b.sales.net) : "-"}</td><td class="n"><strong>${b.sales ? fmt(b.sales.profit) : "-"}</strong></td>
     <td>${can ? `<button class="link" data-del="${esc(b.id)}">Delete</button>` : ""}</td></tr>`;
  }).join("");
}
async function loadBatches() {
  try {
    const { batches } = await api("/api/batches");
    saved = batches.map(b => ({ id: b.id, name: b.name, date: b.date, by: b.createdByName, owner: b.createdBy, ...b.data }));
  } catch (e) { $("empty").textContent = e.message; }
  renderSaved();
}
function applyPrices() {
  document.querySelectorAll("[data-price]").forEach(el => { el.value = prices[el.dataset.price]; el.disabled = !isAdmin; });
}
function queueSettings() {
  if (!isAdmin) return;
  clearTimeout(settingsTimer); $("settingsMsg").textContent = "Saving...";
  settingsTimer = setTimeout(async () => {
    try { await api("/api/settings", { method: "PUT", body: { rates, prices } }); $("settingsMsg").textContent = "Saved. Everyone now uses these rates and prices."; }
    catch (e) { $("settingsMsg").textContent = "Not saved: " + e.message; }
  }, 600);
}
function checkImport() {
  const old = load("wc_saved", []);
  if (!old.length) return;
  $("importBox").style.display = "block";
  $("importText").textContent = `${old.length} batch(es) are saved only in this browser.`;
}
function renderRates() {
  $("rates").innerHTML = Object.keys(DEFAULT_RATES).map(k =>
    `<label>${RATE_LABELS[k]} <input type="number" min="0" step="0.01" data-rate="${k}" value="${rates[k]}" ${isAdmin ? "" : "disabled"}></label>`).join("");
}
function renderSign() {
  $("sign").innerHTML = ROLES.map(r => {
    const d = sign[r.key] || {};
    return `<div class="signrow"><strong>${r.role}</strong>
      <label>Name <input type="text" data-sign="${r.key}.name" value="${esc(d.name || "")}"></label>
      <label>Remarks <input type="text" data-sign="${r.key}.text" value="${esc(d.text ?? r.text)}"></label></div>`;
  }).join("");
}
function readSign() {
  const out = {};
  ROLES.forEach(r => { const d = sign[r.key] || {}; out[r.key] = { role: r.role, name: d.name || "", text: d.text ?? r.text }; });
  return out;
}

document.addEventListener("input", e => {
  const t = e.target;
  if (t.dataset.rate && isAdmin) { rates[t.dataset.rate] = +t.value || 0; queueSettings(); }
  if (t.dataset.price && isAdmin) { prices[t.dataset.price] = +t.value || 0; queueSettings(); }
  if (t.dataset.sign) { const [k, f] = t.dataset.sign.split("."); sign[k] = { ...(sign[k] || {}), [f]: t.value }; store("wc_sign", sign); }
  renderResult();
});
document.addEventListener("click", async e => {
  const d = e.target.dataset.del;
  if (d && confirm("Delete this saved batch?")) {
    try { await api("/api/batches/" + d, { method: "DELETE" }); } catch (err) { alert(err.message); }
    await loadBatches();
  }
});
$("save").onclick = async () => {
  const c = current, data = { q500: c.q500, lab: c.lab, direct: c.direct, allowance: c.allowance, total: c.total,
    sales: { net: c.sales.net, vat: c.sales.vat, gross: c.sales.gross, profit: c.sales.profit, margin: c.sales.margin },
    rates: { ...rates }, prices: { ...prices }, sign: readSign() };
  SIZES.forEach(s => { data[s.nq] = c[s.nq]; data[s.rq] = c[s.rq]; });
  $("save").disabled = true;
  try { await api("/api/batches", { method: "POST", body: { name: $("batchName").value || "Untitled batch", date: $("batchDate").value, data } }); await loadBatches(); }
  catch (e) { alert(e.message); }
  finally { $("save").disabled = false; }
};
$("importBtn").onclick = async () => {
  try {
    for (const b of load("wc_saved", [])) await api("/api/batches", { method: "POST", body: { name: b.name, date: b.date, data: b } });
    store("wc_saved", []); $("importBox").style.display = "none"; await loadBatches();
  } catch (e) { alert(e.message); }
};
$("print").onclick = () => window.print();
window.addEventListener("beforeprint", () => {
  $("phName").textContent = $("batchName").value || "(unnamed)"; $("phDate").textContent = $("batchDate").value;
  $("phBy").textContent = me ? me.username : ""; $("phWhen").textContent = new Date().toLocaleString("en-KE");
});
$("resetRates").onclick = () => { rates = { ...DEFAULT_RATES }; renderRates(); renderResult(); queueSettings(); };
$("csv").onclick = () => {
  const q = s => `"${String(s || "").replace(/"/g, '""')}"`;
  const head = ["Batch", "Date", "Saved by", "500mL", ...SIZES.flatMap(s => [s.label + " new", s.label + " refill"]), "Labour units", "Direct", "Allowance", "Total cost", "Net sales", "VAT", "Profit", "SH", "DCD", "CD"].join(",");
  const rows = saved.map(b => [q(b.name), b.date, q(b.by), b.q500, ...SIZES.flatMap(s => [b[s.nq] || 0, b[s.rq] || 0]), b.lab, b.direct, b.allowance, b.total,
    b.sales ? b.sales.net : "", b.sales ? b.sales.vat : "", b.sales ? b.sales.profit : "", ...["sh", "dcd", "cd"].map(k => q(b.sign && b.sign[k] && b.sign[k].name))].join(","));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([[head, ...rows].join("\n")], { type: "text/csv" }));
  a.download = "water-costing-batches.csv"; a.click();
};

$("batchDate").valueAsDate = new Date();
applyPrices(); renderRates(); renderSign(); renderResult(); renderSaved();
window.meReady.then(async u => {
  if (!u) return;
  me = u; isAdmin = u.role === "admin";
  $("resetRates").style.display = isAdmin ? "" : "none";
  try {
    const s = (await api("/api/settings")).settings;
    if (s) { rates = { ...DEFAULT_RATES, ...s.rates }; prices = { ...DEFAULT_PRICES, ...s.prices }; }
  } catch (e) { $("settingsMsg").textContent = e.message; }
  applyPrices(); renderRates(); renderResult();
  await loadBatches(); checkImport();
});
