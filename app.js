const DEFAULT_RATES = {
  bottle500: 7.90, sleeve500: 0.50, seal500: 0.30,
  bottle20: 135.00, label20: 6.00, seal20new: 1.70, seal20ref: 1.70,
  labour: 335.00, allowance: 5
};
const RATE_LABELS = {
  bottle500: "500 mL empty bottle", sleeve500: "500 mL sleeve", seal500: "500 mL security seal",
  bottle20: "20 L new empty bottle", label20: "20 L label", seal20new: "20 L new security seal",
  seal20ref: "20 L refill security seal", labour: "Labour per unit/day", allowance: "Consumables/misc (%)"
};

const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

let rates = { ...DEFAULT_RATES, ...load("wc_rates", {}) };
let saved = load("wc_saved", []);
let current = null;

const DEFAULT_PRICES = { pack500: 0, new20: 0, ref20: 0, vat: 16, inclusive: 0 };
let prices = { ...DEFAULT_PRICES, ...load("wc_prices", {}) };
const ROLES = [
  { key: "sh", role: "SH", text: "Budget cost calculated and production inputs verified." },
  { key: "dcd", role: "DCD", text: "Checked and verified." },
  { key: "cd", role: "CD", text: "Noted / approved." }
];
const sign = load("wc_sign", {});

function calcSales(q500, q20n, q20r, totalCost) {
  const v = prices.vat / 100, incl = +prices.inclusive === 1;
  const mk = (name, entered, vatable) => {
    let net = entered, vat = 0;
    if (vatable) { net = incl ? entered / (1 + v) : entered; vat = incl ? entered - net : entered * v; }
    return { name, net: round2(net), vat: round2(vat), gross: round2(net + vat) };
  };
  const lines = [
    mk("500 mL (" + (q500 / 24).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " packs)", (q500 / 24) * prices.pack500, true),
    mk("20 L new bottles", q20n * prices.new20, true),
    mk("20 L refills (no VAT)", q20r * prices.ref20, false)
  ];
  const net = round2(lines.reduce((s, l) => s + l.net, 0));
  const vat = round2(lines.reduce((s, l) => s + l.vat, 0));
  const profit = round2(net - totalCost);
  return { lines, net, vat, gross: round2(net + vat), profit, margin: net ? profit / net * 100 : 0 };
}

function renderSales() {
  const s = current.sales;
  $("sales").querySelector("tbody").innerHTML = s.lines.map(l =>
    `<tr><td>${l.name}</td><td class="n">${fmt(l.net)}</td><td class="n">${fmt(l.vat)}</td><td class="n">${fmt(l.gross)}</td></tr>`).join("") +
    `<tr class="sum"><td>Total sales</td><td class="n">${fmt(s.net)}</td><td class="n">${fmt(s.vat)}</td><td class="n">${fmt(s.gross)}</td></tr>` +
    `<tr><td colspan="3">Total budget cost</td><td class="n">${fmt(current.total)}</td></tr>` +
    `<tr class="total"><td colspan="3">Profit (${s.margin.toFixed(1)}% of net sales)</td><td class="n">${fmt(s.profit)}</td></tr>`;
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
  ROLES.forEach(r => { out[r.key] = { role: r.role, name: (sign[r.key] || {}).name || "", text: (sign[r.key] || {}).text ?? r.text }; });
  return out;
}

function calculate() {
  const q500 = +$("q500").value || 0, q20n = +$("q20new").value || 0;
  const q20r = +$("q20ref").value || 0, lab = +$("labour").value || 0;
  const r = rates;
  const lines = [
    ["500 mL empty bottles", q500, r.bottle500],
    ["500 mL sleeves", q500, r.sleeve500],
    ["500 mL security seals", q500, r.seal500],
    ["20 L new empty bottles", q20n, r.bottle20],
    ["20 L new labels", q20n, r.label20],
    ["20 L new security seals", q20n, r.seal20new],
    ["20 L refill security seals", q20r, r.seal20ref],
    ["Labour (units)", lab, r.labour]
  ].map(([name, qty, rate]) => ({ name, qty, rate, cost: round2(qty * rate) }));
  const direct = round2(lines.reduce((s, l) => s + l.cost, 0));
  const allowance = round2(direct * r.allowance / 100);
  return { lines, direct, allowance, total: round2(direct + allowance), q500, q20n, q20r, lab };
}

function renderResult() {
  current = calculate();
  const rows = current.lines.map(l =>
    `<tr><td>${l.name}</td><td class="n">${l.qty.toLocaleString()}</td><td class="n">${fmt(l.rate)}</td><td class="n">${fmt(l.cost)}</td></tr>`).join("");
  $("result").querySelector("tbody").innerHTML = rows +
    `<tr class="sum"><td colspan="3">Direct-cost subtotal</td><td class="n">${fmt(current.direct)}</td></tr>` +
    `<tr><td colspan="3">Consumables/misc (${rates.allowance}%)</td><td class="n">${fmt(current.allowance)}</td></tr>` +
    `<tr class="total"><td colspan="3">Total budget cost</td><td class="n">${fmt(current.total)}</td></tr>`;
  current.sales = calcSales(current.q500, current.q20n, current.q20r, current.total);
  renderSales();
  $("packs").textContent = current.q500 ? `500 mL equivalent: ${(current.q500 / 24).toLocaleString(undefined, { maximumFractionDigits: 2 })} packs of 24.` : "";
}

function renderSaved() {
  $("empty").style.display = saved.length ? "none" : "block";
  $("saved").querySelector("tbody").innerHTML = saved.map((b, i) => {
    const mix = [b.q500 && `${b.q500} × 500 mL`, b.q20n && `${b.q20n} × 20 L new`, b.q20r && `${b.q20r} × 20 L refill`].filter(Boolean).join("; ") || "-";
    return `<tr><td>${esc(b.name)}</td><td>${b.date || ""}</td><td>${mix}</td><td class="n">${b.lab}</td>
      <td class="n">${fmt(b.direct)}</td><td class="n">${fmt(b.allowance)}</td><td class="n">${fmt(b.total)}</td><td class="n">${b.sales ? fmt(b.sales.net) : "-"}</td><td class="n"><strong>${b.sales ? fmt(b.sales.profit) : "-"}</strong></td>
      <td><button class="link" data-del="${i}">Delete</button></td></tr>`;
  }).join("");
}
const esc = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function renderRates() {
  $("rates").innerHTML = Object.keys(DEFAULT_RATES).map(k =>
    `<label>${RATE_LABELS[k]} <input type="number" min="0" step="0.01" data-rate="${k}" value="${rates[k]}"></label>`).join("");
}

document.addEventListener("input", e => {
  if (e.target.dataset.rate) {
    rates[e.target.dataset.rate] = +e.target.value || 0;
    store("wc_rates", rates);
  }
  if (e.target.dataset.price) {
    prices[e.target.dataset.price] = +e.target.value || 0;
    store("wc_prices", prices);
  }
  if (e.target.dataset.sign) {
    const [k, f] = e.target.dataset.sign.split(".");
    sign[k] = { ...(sign[k] || {}), [f]: e.target.value };
    store("wc_sign", sign);
  }
  renderResult();
});
document.addEventListener("click", e => {
  const d = e.target.dataset.del;
  if (d !== undefined && confirm("Delete this saved batch?")) {
    saved.splice(+d, 1); store("wc_saved", saved); renderSaved();
  }
});
$("save").onclick = () => {
  saved.push({ name: $("batchName").value || "Untitled batch", date: $("batchDate").value, ...current, rates: { ...rates }, prices: { ...prices }, sign: readSign() });
  store("wc_saved", saved); renderSaved();
};
$("print").onclick = () => window.print();
$("resetRates").onclick = () => { rates = { ...DEFAULT_RATES }; store("wc_rates", rates); renderRates(); renderResult(); };
$("csv").onclick = () => {
  const head = "Batch,Date,500mL,20L new,20L refill,Labour units,Direct,Allowance,Total cost,Net sales,VAT,Profit,SH,DCD,CD\n";
  const body = saved.map(b => [`"${(b.name || "").replace(/"/g, '""')}"`, b.date, b.q500, b.q20n, b.q20r, b.lab, b.direct, b.allowance, b.total, b.sales ? b.sales.net : "", b.sales ? b.sales.vat : "", b.sales ? b.sales.profit : "", ...["sh","dcd","cd"].map(k => `"${((b.sign && b.sign[k] && b.sign[k].name) || "").replace(/"/g, '""')}"`)].join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([head + body], { type: "text/csv" }));
  a.download = "water-costing-batches.csv"; a.click();
};

$("batchDate").valueAsDate = new Date();
document.querySelectorAll("[data-price]").forEach(el => { el.value = prices[el.dataset.price]; });
renderRates(); renderSign(); renderResult(); renderSaved();
