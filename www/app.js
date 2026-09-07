/* =========================================================
   MI LEÓN — control de mantenimiento (Seat León MK1 1.9 TDI ARL)
   Todo el estado se guarda en localStorage, en este dispositivo.
   ========================================================= */

const STORAGE_KEY = "mileon_v1";

const DEFAULT_MAINTENANCE = [
  { id: "aceite", name: "Aceite y filtro de aceite", intervalKm: 15000, intervalMonths: 12, lastKm: null, lastDate: null, custom: false },
  { id: "distribucion", name: "Correa distribución + tensores + bomba de agua", intervalKm: 120000, intervalMonths: 60, lastKm: null, lastDate: null, custom: false, critical: true },
  { id: "correa_accesorios", name: "Correa de accesorios / alternador", intervalKm: 90000, intervalMonths: 48, lastKm: null, lastDate: null, custom: false },
  { id: "filtro_gasoil", name: "Filtro de combustible (gasoil)", intervalKm: 30000, intervalMonths: 24, lastKm: null, lastDate: null, custom: false },
  { id: "filtro_aire", name: "Filtro de aire", intervalKm: 30000, intervalMonths: 24, lastKm: null, lastDate: null, custom: false },
  { id: "filtro_habitaculo", name: "Filtro de habitáculo (polen)", intervalKm: 20000, intervalMonths: 12, lastKm: null, lastDate: null, custom: false },
  { id: "liquido_frenos", name: "Líquido de frenos", intervalKm: null, intervalMonths: 24, lastKm: null, lastDate: null, custom: false },
  { id: "refrigerante", name: "Líquido refrigerante", intervalKm: null, intervalMonths: 48, lastKm: null, lastDate: null, custom: false },
  { id: "itv", name: "ITV", intervalKm: null, intervalMonths: 12, lastKm: null, lastDate: null, custom: false },
];

function defaultState() {
  return {
    km: 0,
    expenses: [],
    fuel: [],
    maintenance: JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE)),
    issues: [],
    docs: { plate: "", vin: "", itv: "", insurer: "", insuranceDate: "" },
    apiKey: "",
  };
}

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    // merge para asegurar que campos nuevos existen si se actualiza la app
    return Object.assign(base, parsed, {
      maintenance: parsed.maintenance && parsed.maintenance.length ? parsed.maintenance : base.maintenance,
      docs: Object.assign(base.docs, parsed.docs || {}),
    });
  } catch (e) {
    console.error("Error cargando datos", e);
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------------- HELPERS DE FORMATO ---------------- */

function formatKm(km) {
  if (km === null || km === undefined) return "—";
  return Math.round(km).toLocaleString("es-ES") + " km";
}

function formatMoney(v) {
  return Number(v || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function formatDate(d) {
  if (!d) return "—";
  const date = new Date(d + "T00:00:00");
  if (isNaN(date)) return "—";
  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function monthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 2200);
}

/* =========================================================
   NAVEGACIÓN
   ========================================================= */

function switchTab(tab) {
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  document.getElementById("panel-" + tab).classList.add("active");
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  window.scrollTo(0, 0);
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

document.querySelectorAll(".subtab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const group = btn.parentElement.nextElementSibling.parentElement;
    document.querySelectorAll(".subtab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".subpanel").forEach((p) => p.classList.remove("active"));
    document.getElementById(btn.dataset.subtab).classList.add("active");
  });
});

/* =========================================================
   MODAL GENÉRICO
   ========================================================= */

const modalBackdrop = document.getElementById("modalBackdrop");
const modalBody = document.getElementById("modalBody");
const modalTitle = document.getElementById("modalTitle");

function openModal(title, bodyHTML, onMount) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHTML;
  modalBackdrop.hidden = false;
  if (onMount) onMount(modalBody);
}

function closeModal() {
  modalBackdrop.hidden = true;
  modalBody.innerHTML = "";
}

document.getElementById("modalClose").addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeModal();
});

/* =========================================================
   KM ACTUALES
   ========================================================= */

function renderKm() {
  document.getElementById("kmValue").textContent = Math.round(state.km).toLocaleString("es-ES");
}

document.getElementById("openKmEditor").addEventListener("click", () => {
  openModal(
    "Actualizar kilómetros",
    `
    <div class="field-row">
      <label>Kilómetros actuales del coche</label>
      <input type="number" id="f_km" inputmode="numeric" value="${state.km || ""}">
    </div>
    <button class="btn-primary full" id="f_km_save">Guardar</button>
  `,
    (root) => {
      root.querySelector("#f_km_save").addEventListener("click", () => {
        const v = parseFloat(root.querySelector("#f_km").value);
        if (isNaN(v) || v < 0) return toast("Introduce un valor válido");
        state.km = v;
        saveState();
        renderAll();
        closeModal();
        toast("Kilómetros actualizados");
      });
    }
  );
});

/* =========================================================
   MANTENIMIENTO — lógica de estado / vencimientos
   ========================================================= */

function maintenanceStatus(item) {
  // Devuelve { level: 'good'|'warn'|'danger'|'none', label, nextKm, nextDate }
  if (item.lastKm === null && item.lastDate === null) {
    return { level: "warn", label: "Sin registrar", nextKm: null, nextDate: null };
  }

  let nextKm = null;
  let nextDate = null;
  let level = "good";
  let label = "Al día";

  if (item.intervalKm && item.lastKm !== null) {
    nextKm = item.lastKm + item.intervalKm;
    const remainingKm = nextKm - state.km;
    if (remainingKm <= 0) {
      level = "danger";
      label = `Vencido hace ${formatKm(Math.abs(remainingKm))}`;
    } else if (remainingKm <= 1500) {
      level = "warn";
      label = `Quedan ${formatKm(remainingKm)}`;
    } else {
      label = `Próximo a los ${formatKm(nextKm)}`;
    }
  }

  if (item.intervalMonths && item.lastDate) {
    const last = new Date(item.lastDate + "T00:00:00");
    const next = new Date(last);
    next.setMonth(next.getMonth() + item.intervalMonths);
    nextDate = next.toISOString().slice(0, 10);
    const daysLeft = Math.round((next - new Date()) / 86400000);
    let dateLevel = "good";
    let dateLabel = `Próximo el ${formatDate(nextDate)}`;
    if (daysLeft <= 0) {
      dateLevel = "danger";
      dateLabel = `Venció el ${formatDate(nextDate)}`;
    } else if (daysLeft <= 30) {
      dateLevel = "warn";
      dateLabel = `Antes del ${formatDate(nextDate)}`;
    }
    // combina el nivel más urgente entre km y fecha
    const order = { good: 0, warn: 1, danger: 2 };
    if (order[dateLevel] >= order[level]) {
      level = dateLevel;
      label = item.intervalKm && item.lastKm !== null ? `${label} · ${dateLabel}` : dateLabel;
    }
  }

  return { level, label, nextKm, nextDate };
}

function badgeHTML(level, textOverride) {
  const map = { good: "Al día", warn: "Próximo", danger: "Vencido", none: "—" };
  return `<span class="badge ${level}">${textOverride || map[level]}</span>`;
}

/* =========================================================
   RENDER: INICIO
   ========================================================= */

function renderHome() {
  const statGrid = document.getElementById("statGrid");
  const month = new Date().toISOString().slice(0, 7);
  const monthTotal = state.expenses.filter((e) => e.date.startsWith(month)).reduce((s, e) => s + e.amount, 0);
  const totalTotal = state.expenses.reduce((s, e) => s + e.amount, 0) + state.fuel.reduce((s, f) => s + (f.cost || 0), 0);

  const consumptions = computeConsumptions();
  const avgConsumption = consumptions.length
    ? (consumptions.reduce((s, c) => s + c.value, 0) / consumptions.length).toFixed(1)
    : null;

  const openIssues = state.issues.filter((i) => i.status !== "resuelta").length;

  const statuses = state.maintenance.map(maintenanceStatus);
  const urgent = statuses.filter((s) => s.level === "danger").length;
  const soon = statuses.filter((s) => s.level === "warn").length;

  statGrid.innerHTML = `
    <div class="stat-card">
      <div class="label">Gasto este mes</div>
      <div class="value">${formatMoney(monthTotal)}</div>
    </div>
    <div class="stat-card">
      <div class="label">Coste km/L (medio)</div>
      <div class="value ${avgConsumption ? "" : "warn"}">${avgConsumption ? avgConsumption + " L/100km" : "Sin datos"}</div>
    </div>
    <div class="stat-card">
      <div class="label">Mantenimientos urgentes</div>
      <div class="value ${urgent ? "danger" : "good"}">${urgent}</div>
    </div>
    <div class="stat-card">
      <div class="label">Averías abiertas</div>
      <div class="value ${openIssues ? "warn" : "good"}">${openIssues}</div>
    </div>
  `;

  // alerta superior
  const alertBar = document.getElementById("alertBar");
  if (urgent > 0 || soon > 0) {
    alertBar.hidden = false;
    const parts = [];
    if (urgent) parts.push(`${urgent} mantenimiento${urgent > 1 ? "s" : ""} vencido${urgent > 1 ? "s" : ""}`);
    if (soon) parts.push(`${soon} próximo${soon > 1 ? "s" : ""}`);
    alertBar.textContent = "⚠ " + parts.join(" · ");
  } else {
    alertBar.hidden = true;
  }

  // próximos mantenimientos (top 3 por urgencia)
  const sorted = state.maintenance
    .map((m) => ({ m, s: maintenanceStatus(m) }))
    .sort((a, b) => {
      const order = { danger: 0, warn: 1, good: 2 };
      return order[a.s.level] - order[b.s.level];
    })
    .slice(0, 3);

  const homeMaintList = document.getElementById("homeMaintList");
  homeMaintList.innerHTML = sorted.length
    ? sorted
        .map(
          ({ m, s }) => `
      <div class="list-item" data-maint="${m.id}">
        <div class="li-main">
          <div class="li-title">${m.name}</div>
          <div class="li-sub">${s.label}</div>
        </div>
        ${badgeHTML(s.level)}
      </div>`
        )
        .join("")
    : `<div class="empty-state">Todavía no hay mantenimientos registrados.</div>`;

  homeMaintList.querySelectorAll("[data-maint]").forEach((el) => {
    el.addEventListener("click", () => {
      switchTab("mantenimiento");
    });
  });

  // averías abiertas
  const homeIssueList = document.getElementById("homeIssueList");
  const openIssuesList = state.issues.filter((i) => i.status !== "resuelta").slice(0, 3);
  homeIssueList.innerHTML = openIssuesList.length
    ? openIssuesList
        .map(
          (i) => `
      <div class="list-item" data-issue="${i.id}">
        <div class="li-main">
          <div class="li-title">${i.title}</div>
          <div class="li-sub">${i.status === "en_curso" ? "En curso" : "Pendiente"}</div>
        </div>
        ${badgeHTML(i.priority === "alta" ? "danger" : i.priority === "media" ? "warn" : "muted", capitalize(i.priority))}
      </div>`
        )
        .join("")
    : `<div class="empty-state">No tienes averías pendientes 🎉</div>`;

  homeIssueList.querySelectorAll("[data-issue]").forEach((el) => {
    el.addEventListener("click", () => {
      switchTab("averias");
    });
  });
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/* =========================================================
   GASTOS
   ========================================================= */

const EXPENSE_CATEGORIES = ["Mantenimiento", "Reparación", "Avería", "Seguro/ITV", "Otro"];

function renderExpenses() {
  const list = document.getElementById("expenseList");
  const sorted = [...state.expenses].sort((a, b) => (a.date < b.date ? 1 : -1));

  list.innerHTML = sorted.length
    ? sorted
        .map(
          (e) => `
    <div class="list-item" data-expense="${e.id}">
      <div class="li-main">
        <div class="li-title">${e.desc || e.category}</div>
        <div class="li-sub">${e.category} · ${formatDate(e.date)}${e.km ? " · " + formatKm(e.km) : ""}</div>
      </div>
      <div class="li-right"><span class="li-amount">${formatMoney(e.amount)}</span></div>
    </div>`
        )
        .join("")
    : `<div class="empty-state">Aún no has añadido ningún gasto.</div>`;

  list.querySelectorAll("[data-expense]").forEach((el) => {
    el.addEventListener("click", () => openExpenseForm(el.dataset.expense));
  });

  const month = new Date().toISOString().slice(0, 7);
  const monthTotal = state.expenses.filter((e) => e.date.startsWith(month)).reduce((s, e) => s + e.amount, 0);
  const yearTotal = state.expenses.filter((e) => e.date.startsWith(month.slice(0, 4))).reduce((s, e) => s + e.amount, 0);

  document.getElementById("expenseSummary").innerHTML = `
    <div class="stat-card"><div class="label">Este mes</div><div class="value">${formatMoney(monthTotal)}</div></div>
    <div class="stat-card"><div class="label">Este año</div><div class="value">${formatMoney(yearTotal)}</div></div>
  `;
}

function openExpenseForm(id) {
  const existing = id ? state.expenses.find((e) => e.id === id) : null;
  openModal(
    existing ? "Editar gasto" : "Nuevo gasto",
    `
    <div class="field-row">
      <label>Categoría</label>
      <div class="chip-group" id="f_cat">
        ${EXPENSE_CATEGORIES.map(
          (c) => `<button type="button" class="chip-option ${existing && existing.category === c ? "selected" : ""}" data-val="${c}">${c}</button>`
        ).join("")}
      </div>
    </div>
    <div class="field-row"><label>Descripción</label><input type="text" id="f_desc" placeholder="Ej: Cambio de pastillas de freno" value="${existing ? existing.desc : ""}"></div>
    <div class="field-row-inline">
      <div class="field-row"><label>Importe (€)</label><input type="number" step="0.01" inputmode="decimal" id="f_amount" value="${existing ? existing.amount : ""}"></div>
      <div class="field-row"><label>Fecha</label><input type="date" id="f_date" value="${existing ? existing.date : todayISO()}"></div>
    </div>
    <div class="field-row"><label>Kilómetros (opcional)</label><input type="number" inputmode="numeric" id="f_km" value="${existing && existing.km ? existing.km : state.km || ""}"></div>
    <button class="btn-primary full" id="f_save">Guardar</button>
    ${existing ? `<button class="btn-danger full" id="f_delete">Eliminar gasto</button>` : ""}
  `,
    (root) => {
      let selectedCat = existing ? existing.category : EXPENSE_CATEGORIES[0];
      root.querySelectorAll("#f_cat .chip-option").forEach((chip) => {
        chip.addEventListener("click", () => {
          root.querySelectorAll("#f_cat .chip-option").forEach((c) => c.classList.remove("selected"));
          chip.classList.add("selected");
          selectedCat = chip.dataset.val;
        });
      });
      if (!existing) root.querySelector("#f_cat .chip-option").classList.add("selected");

      root.querySelector("#f_save").addEventListener("click", () => {
        const amount = parseFloat(root.querySelector("#f_amount").value);
        const date = root.querySelector("#f_date").value;
        if (isNaN(amount) || amount <= 0) return toast("Introduce un importe válido");
        if (!date) return toast("Selecciona una fecha");
        const km = root.querySelector("#f_km").value ? parseFloat(root.querySelector("#f_km").value) : null;
        const desc = root.querySelector("#f_desc").value.trim();

        if (existing) {
          Object.assign(existing, { category: selectedCat, desc, amount, date, km });
        } else {
          state.expenses.push({ id: uid(), category: selectedCat, desc, amount, date, km });
        }
        saveState();
        renderAll();
        closeModal();
        toast("Gasto guardado");
      });

      if (existing) {
        root.querySelector("#f_delete").addEventListener("click", () => {
          state.expenses = state.expenses.filter((e) => e.id !== existing.id);
          saveState();
          renderAll();
          closeModal();
          toast("Gasto eliminado");
        });
      }
    }
  );
}

document.getElementById("btnAddExpense").addEventListener("click", () => openExpenseForm());

/* =========================================================
   CONSUMO / COMBUSTIBLE
   ========================================================= */

function computeConsumptions() {
  const sorted = [...state.fuel].sort((a, b) => a.km - b.km);
  const out = [];
  for (let i = 1; i < sorted.length; i++) {
    const kmDiff = sorted[i].km - sorted[i - 1].km;
    if (kmDiff <= 0) continue;
    const value = (sorted[i].liters / kmDiff) * 100;
    out.push({ date: sorted[i].date, km: sorted[i].km, value });
  }
  return out;
}

function renderFuel() {
  const list = document.getElementById("fuelList");
  const sorted = [...state.fuel].sort((a, b) => (a.date < b.date ? 1 : -1));

  list.innerHTML = sorted.length
    ? sorted
        .map(
          (f) => `
    <div class="list-item" data-fuel="${f.id}">
      <div class="li-main">
        <div class="li-title">${f.liters.toFixed(1)} L</div>
        <div class="li-sub">${formatDate(f.date)} · ${formatKm(f.km)}</div>
      </div>
      <div class="li-right"><span class="li-amount">${f.cost ? formatMoney(f.cost) : ""}</span></div>
    </div>`
        )
        .join("")
    : `<div class="empty-state">Aún no has registrado repostajes.</div>`;

  list.querySelectorAll("[data-fuel]").forEach((el) => {
    el.addEventListener("click", () => openFuelForm(el.dataset.fuel));
  });

  const consumptions = computeConsumptions();
  const avg = consumptions.length ? consumptions.reduce((s, c) => s + c.value, 0) / consumptions.length : null;
  const totalLiters = state.fuel.reduce((s, f) => s + f.liters, 0);
  const totalCost = state.fuel.reduce((s, f) => s + (f.cost || 0), 0);
  const costPerKm = totalLiters && totalCost ? totalCost / (state.fuel.length > 1 ? Math.max(...state.fuel.map((f) => f.km)) - Math.min(...state.fuel.map((f) => f.km)) : 1) : null;

  document.getElementById("fuelSummary").innerHTML = `
    <div class="stat-card"><div class="label">Consumo medio</div><div class="value">${avg ? avg.toFixed(1) + " L/100" : "—"}</div></div>
    <div class="stat-card"><div class="label">Gasto en diésel</div><div class="value">${formatMoney(totalCost)}</div></div>
  `;

  drawFuelChart(consumptions);
}

function drawFuelChart(consumptions) {
  const canvas = document.getElementById("fuelChart");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight || 140;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (consumptions.length < 2) {
    ctx.fillStyle = "#9AA69D";
    ctx.font = "13px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Registra al menos 2 repostajes para ver la gráfica", w / 2, h / 2);
    return;
  }

  const pad = 24;
  const values = consumptions.map((c) => c.value);
  const min = Math.min(...values) * 0.9;
  const max = Math.max(...values) * 1.1;

  ctx.strokeStyle = "#DCE3DA";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = pad + ((h - pad * 1.5) * i) / 3;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - 10, y);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.strokeStyle = "#4F6F5E";
  ctx.lineWidth = 2.5;
  consumptions.forEach((c, i) => {
    const x = pad + ((w - pad - 20) * i) / (consumptions.length - 1);
    const y = h - pad * 0.6 - ((c.value - min) / (max - min || 1)) * (h - pad * 1.5);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  consumptions.forEach((c, i) => {
    const x = pad + ((w - pad - 20) * i) / (consumptions.length - 1);
    const y = h - pad * 0.6 - ((c.value - min) / (max - min || 1)) * (h - pad * 1.5);
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "#4F6F5E";
    ctx.fill();
  });

  ctx.fillStyle = "#6C766E";
  ctx.font = "11px -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(max.toFixed(1) + " L/100", 2, pad);
  ctx.fillText(min.toFixed(1) + " L/100", 2, h - pad * 0.6);
}

function openFuelForm(id) {
  const existing = id ? state.fuel.find((f) => f.id === id) : null;
  openModal(
    existing ? "Editar repostaje" : "Nuevo repostaje",
    `
    <p class="hint">Introduce los litros repostados y los km del cuadro. Para calcular bien el consumo, reposta siempre a depósito lleno.</p>
    <div class="field-row-inline">
      <div class="field-row"><label>Litros</label><input type="number" step="0.01" inputmode="decimal" id="f_liters" value="${existing ? existing.liters : ""}"></div>
      <div class="field-row"><label>Coste (€)</label><input type="number" step="0.01" inputmode="decimal" id="f_cost" value="${existing && existing.cost ? existing.cost : ""}"></div>
    </div>
    <div class="field-row-inline">
      <div class="field-row"><label>Kilómetros</label><input type="number" inputmode="numeric" id="f_km" value="${existing ? existing.km : state.km || ""}"></div>
      <div class="field-row"><label>Fecha</label><input type="date" id="f_date" value="${existing ? existing.date : todayISO()}"></div>
    </div>
    <button class="btn-primary full" id="f_save">Guardar</button>
    ${existing ? `<button class="btn-danger full" id="f_delete">Eliminar repostaje</button>` : ""}
  `,
    (root) => {
      root.querySelector("#f_save").addEventListener("click", () => {
        const liters = parseFloat(root.querySelector("#f_liters").value);
        const km = parseFloat(root.querySelector("#f_km").value);
        const date = root.querySelector("#f_date").value;
        const cost = root.querySelector("#f_cost").value ? parseFloat(root.querySelector("#f_cost").value) : null;
        if (isNaN(liters) || liters <= 0) return toast("Introduce los litros repostados");
        if (isNaN(km) || km <= 0) return toast("Introduce los km actuales");
        if (!date) return toast("Selecciona una fecha");

        if (existing) {
          Object.assign(existing, { liters, km, date, cost });
        } else {
          state.fuel.push({ id: uid(), liters, km, date, cost });
        }
        if (km > state.km) state.km = km;
        saveState();
        renderAll();
        closeModal();
        toast("Repostaje guardado");
      });

      if (existing) {
        root.querySelector("#f_delete").addEventListener("click", () => {
          state.fuel = state.fuel.filter((f) => f.id !== existing.id);
          saveState();
          renderAll();
          closeModal();
          toast("Repostaje eliminado");
        });
      }
    }
  );
}

document.getElementById("btnAddFuel").addEventListener("click", () => openFuelForm());

/* =========================================================
   MANTENIMIENTO
   ========================================================= */

function renderMaintenance() {
  const list = document.getElementById("maintList");
  const items = [...state.maintenance].sort((a, b) => {
    const order = { danger: 0, warn: 1, good: 2 };
    return order[maintenanceStatus(a).level] - order[maintenanceStatus(b).level];
  });

  list.innerHTML = items
    .map((m) => {
      const s = maintenanceStatus(m);
      return `
      <div class="list-item" data-maint="${m.id}">
        <div class="li-main">
          <div class="li-title">${m.name}${m.critical ? " ⚠️" : ""}</div>
          <div class="li-sub">${s.label}${m.lastKm ? " · Último: " + formatKm(m.lastKm) : ""}</div>
        </div>
        ${badgeHTML(s.level)}
      </div>`;
    })
    .join("");

  list.querySelectorAll("[data-maint]").forEach((el) => {
    el.addEventListener("click", () => openMaintenanceForm(el.dataset.maint));
  });
}

function openMaintenanceForm(id) {
  const item = state.maintenance.find((m) => m.id === id);
  openModal(
    item.name,
    `
    ${item.critical ? `<p class="hint">⚠️ Este es un mantenimiento crítico: si se pasa de fecha en un motor TDI con distribución interna (interferencial), puede provocar una avería grave del motor.</p>` : ""}
    <div class="field-row-inline">
      <div class="field-row"><label>Último cambio (km)</label><input type="number" inputmode="numeric" id="f_lastkm" value="${item.lastKm || ""}"></div>
      <div class="field-row"><label>Fecha del último cambio</label><input type="date" id="f_lastdate" value="${item.lastDate || ""}"></div>
    </div>
    <div class="field-row-inline">
      <div class="field-row"><label>Intervalo (km)</label><input type="number" inputmode="numeric" id="f_intkm" value="${item.intervalKm || ""}"></div>
      <div class="field-row"><label>Intervalo (meses)</label><input type="number" inputmode="numeric" id="f_intmonths" value="${item.intervalMonths || ""}"></div>
    </div>
    <button class="btn-primary full" id="f_save">Guardar como realizado hoy</button>
    <button class="btn-secondary full" id="f_save_only">Guardar datos sin cambiar fecha</button>
    ${item.custom ? `<button class="btn-danger full" id="f_delete">Eliminar mantenimiento</button>` : ""}
  `,
    (root) => {
      const applyIntervals = () => {
        const intKm = root.querySelector("#f_intkm").value ? parseFloat(root.querySelector("#f_intkm").value) : null;
        const intMonths = root.querySelector("#f_intmonths").value ? parseFloat(root.querySelector("#f_intmonths").value) : null;
        item.intervalKm = intKm;
        item.intervalMonths = intMonths;
      };

      root.querySelector("#f_save").addEventListener("click", () => {
        applyIntervals();
        const km = root.querySelector("#f_lastkm").value ? parseFloat(root.querySelector("#f_lastkm").value) : state.km;
        item.lastKm = km;
        item.lastDate = todayISO();
        saveState();
        renderAll();
        closeModal();
        toast("Mantenimiento actualizado");
      });

      root.querySelector("#f_save_only").addEventListener("click", () => {
        applyIntervals();
        item.lastKm = root.querySelector("#f_lastkm").value ? parseFloat(root.querySelector("#f_lastkm").value) : null;
        item.lastDate = root.querySelector("#f_lastdate").value || null;
        saveState();
        renderAll();
        closeModal();
        toast("Datos guardados");
      });

      if (item.custom) {
        root.querySelector("#f_delete").addEventListener("click", () => {
          state.maintenance = state.maintenance.filter((m) => m.id !== item.id);
          saveState();
          renderAll();
          closeModal();
          toast("Mantenimiento eliminado");
        });
      }
    }
  );
}

document.getElementById("btnAddMaint").addEventListener("click", () => {
  openModal(
    "Nuevo mantenimiento personalizado",
    `
    <div class="field-row"><label>Nombre</label><input type="text" id="f_name" placeholder="Ej: Válvula EGR"></div>
    <div class="field-row-inline">
      <div class="field-row"><label>Intervalo (km)</label><input type="number" inputmode="numeric" id="f_intkm" placeholder="opcional"></div>
      <div class="field-row"><label>Intervalo (meses)</label><input type="number" inputmode="numeric" id="f_intmonths" placeholder="opcional"></div>
    </div>
    <button class="btn-primary full" id="f_save">Crear</button>
  `,
    (root) => {
      root.querySelector("#f_save").addEventListener("click", () => {
        const name = root.querySelector("#f_name").value.trim();
        if (!name) return toast("Ponle un nombre al mantenimiento");
        state.maintenance.push({
          id: uid(),
          name,
          intervalKm: root.querySelector("#f_intkm").value ? parseFloat(root.querySelector("#f_intkm").value) : null,
          intervalMonths: root.querySelector("#f_intmonths").value ? parseFloat(root.querySelector("#f_intmonths").value) : null,
          lastKm: null,
          lastDate: null,
          custom: true,
        });
        saveState();
        renderAll();
        closeModal();
        toast("Mantenimiento creado");
      });
    }
  );
});

/* =========================================================
   AVERÍAS
   ========================================================= */

function renderIssues() {
  const list = document.getElementById("issueList");
  const order = { alta: 0, media: 1, baja: 2 };
  const sorted = [...state.issues].sort((a, b) => {
    if (a.status === "resuelta" && b.status !== "resuelta") return 1;
    if (b.status === "resuelta" && a.status !== "resuelta") return -1;
    return order[a.priority] - order[b.priority];
  });

  list.innerHTML = sorted.length
    ? sorted
        .map(
          (i) => `
    <div class="list-item" data-issue="${i.id}">
      <div class="li-main">
        <div class="li-title">${i.title}</div>
        <div class="li-sub">${i.desc ? i.desc.slice(0, 60) : ""}</div>
      </div>
      <div class="li-right">
        ${badgeHTML(i.priority === "alta" ? "danger" : i.priority === "media" ? "warn" : "muted", capitalize(i.priority))}
        <span class="badge muted">${statusLabel(i.status)}</span>
      </div>
    </div>`
        )
        .join("")
    : `<div class="empty-state">No hay averías registradas. ¡Buena señal!</div>`;

  list.querySelectorAll("[data-issue]").forEach((el) => {
    el.addEventListener("click", () => openIssueDetail(el.dataset.issue));
  });
}

function statusLabel(s) {
  return { pendiente: "Pendiente", en_curso: "En curso", resuelta: "Resuelta" }[s] || s;
}

document.getElementById("btnAddIssue").addEventListener("click", () => {
  openModal(
    "Nueva avería / extra",
    `
    <div class="field-row"><label>Título</label><input type="text" id="f_title" placeholder="Ej: Ruido en suspensión delantera"></div>
    <div class="field-row"><label>Descripción</label><textarea id="f_desc" rows="3" placeholder="Describe el síntoma, cuándo ocurre, ruidos, testigos encendidos..."></textarea></div>
    <div class="field-row">
      <label>Prioridad</label>
      <div class="chip-group" id="f_prio">
        <button type="button" class="chip-option selected" data-val="media">Media</button>
        <button type="button" class="chip-option" data-val="alta">Alta</button>
        <button type="button" class="chip-option" data-val="baja">Baja</button>
      </div>
    </div>
    <button class="btn-primary full" id="f_save">Crear avería</button>
  `,
    (root) => {
      let prio = "media";
      root.querySelectorAll("#f_prio .chip-option").forEach((chip) => {
        chip.addEventListener("click", () => {
          root.querySelectorAll("#f_prio .chip-option").forEach((c) => c.classList.remove("selected"));
          chip.classList.add("selected");
          prio = chip.dataset.val;
        });
      });

      root.querySelector("#f_save").addEventListener("click", () => {
        const title = root.querySelector("#f_title").value.trim();
        if (!title) return toast("Ponle un título a la avería");
        const desc = root.querySelector("#f_desc").value.trim();
        state.issues.push({
          id: uid(),
          title,
          desc,
          priority: prio,
          status: "pendiente",
          createdAt: todayISO(),
          chat: [],
        });
        saveState();
        renderAll();
        closeModal();
        toast("Avería creada");
      });
    }
  );
});

function openIssueDetail(id) {
  const issue = state.issues.find((i) => i.id === id);
  openModal(
    "Avería",
    `
    <div class="field-row"><label>Título</label><input type="text" id="f_title" value="${issue.title}"></div>
    <div class="field-row"><label>Descripción</label><textarea id="f_desc" rows="3">${issue.desc || ""}</textarea></div>
    <div class="field-row">
      <label>Estado</label>
      <div class="chip-group" id="f_status">
        <button type="button" class="chip-option ${issue.status === "pendiente" ? "selected" : ""}" data-val="pendiente">Pendiente</button>
        <button type="button" class="chip-option ${issue.status === "en_curso" ? "selected" : ""}" data-val="en_curso">En curso</button>
        <button type="button" class="chip-option ${issue.status === "resuelta" ? "selected" : ""}" data-val="resuelta">Resuelta</button>
      </div>
    </div>
    <div class="field-row">
      <label>Prioridad</label>
      <div class="chip-group" id="f_prio">
        <button type="button" class="chip-option ${issue.priority === "baja" ? "selected" : ""}" data-val="baja">Baja</button>
        <button type="button" class="chip-option ${issue.priority === "media" ? "selected" : ""}" data-val="media">Media</button>
        <button type="button" class="chip-option ${issue.priority === "alta" ? "selected" : ""}" data-val="alta">Alta</button>
      </div>
    </div>
    <button class="btn-primary full" id="f_chat">💬 Abrir chat de diagnóstico</button>
    <button class="btn-secondary full" id="f_save">Guardar cambios</button>
    <button class="btn-danger full" id="f_delete">Eliminar avería</button>
  `,
    (root) => {
      let status = issue.status;
      let prio = issue.priority;
      root.querySelectorAll("#f_status .chip-option").forEach((chip) => {
        chip.addEventListener("click", () => {
          root.querySelectorAll("#f_status .chip-option").forEach((c) => c.classList.remove("selected"));
          chip.classList.add("selected");
          status = chip.dataset.val;
        });
      });
      root.querySelectorAll("#f_prio .chip-option").forEach((chip) => {
        chip.addEventListener("click", () => {
          root.querySelectorAll("#f_prio .chip-option").forEach((c) => c.classList.remove("selected"));
          chip.classList.add("selected");
          prio = chip.dataset.val;
        });
      });

      root.querySelector("#f_chat").addEventListener("click", () => {
        closeModal();
        openChat(issue);
      });

      root.querySelector("#f_save").addEventListener("click", () => {
        issue.title = root.querySelector("#f_title").value.trim() || issue.title;
        issue.desc = root.querySelector("#f_desc").value.trim();
        issue.status = status;
        issue.priority = prio;
        saveState();
        renderAll();
        closeModal();
        toast("Avería actualizada");
      });

      root.querySelector("#f_delete").addEventListener("click", () => {
        state.issues = state.issues.filter((i) => i.id !== issue.id);
        saveState();
        renderAll();
        closeModal();
        toast("Avería eliminada");
      });
    }
  );
}

/* =========================================================
   CHAT DE DIAGNÓSTICO (API de Anthropic con clave propia del usuario)
   ========================================================= */

const chatBackdrop = document.getElementById("chatBackdrop");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
let currentIssue = null;

function openChat(issue) {
  currentIssue = issue;
  document.getElementById("chatTitle").textContent = issue.title;
  renderChatMessages();
  chatBackdrop.hidden = false;

  if (issue.chat.length === 0) {
    if (!state.apiKey) {
      pushSystemMsg(
        "No tienes configurada tu clave de API de Anthropic (puedes añadirla en la pestaña 'Más'). Mientras tanto, puedes usar este chat como cuaderno de notas para ir apuntando pistas sobre la avería."
      );
    } else {
      pushSystemMsg("Cuéntame los síntomas con el máximo detalle posible: cuándo ocurre, ruidos, testigos, olores...");
    }
  }
}

document.getElementById("chatClose").addEventListener("click", () => {
  chatBackdrop.hidden = true;
});

function pushSystemMsg(text) {
  currentIssue.chat.push({ role: "system", text });
  saveState();
  renderChatMessages();
}

function renderChatMessages() {
  chatMessages.innerHTML = currentIssue.chat
    .map((m) => `<div class="msg ${m.role}">${escapeHTML(m.text)}</div>`)
    .join("");
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHTML(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 90) + "px";
});

document.getElementById("chatSend").addEventListener("click", sendChatMessage);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

async function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text || !currentIssue) return;
  chatInput.value = "";
  chatInput.style.height = "auto";

  currentIssue.chat.push({ role: "user", text });
  saveState();
  renderChatMessages();

  if (!state.apiKey) {
    // modo notas: no hay clave, no se llama a la API
    return;
  }

  pushSystemMsg("Pensando...");
  const thinkingIndex = currentIssue.chat.length - 1;

  try {
    const carContext = `Eres un mecánico experto ayudando a diagnosticar averías de un Seat León MK1 (1M) del año 2004, motor 1.9 TDI 150cv, código de motor ARL (bomba-inyector, common rail no, distribución interna interferencial). El usuario está registrando esta avería en su app personal de mantenimiento. Avería: "${currentIssue.title}". Descripción inicial: "${currentIssue.desc || "sin descripción"}". Haz preguntas concretas para acotar el diagnóstico, sugiere comprobaciones que el usuario pueda hacer él mismo, y cuándo sea necesario recomienda acudir a un taller. Responde en español, de forma breve y práctica.`;

    const history = currentIssue.chat
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.text }));

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": state.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 700,
        system: carContext,
        messages: history,
      }),
    });

    // quitar el mensaje "Pensando..."
    currentIssue.chat.splice(thinkingIndex, 1);

    if (!res.ok) {
      const errBody = await res.text();
      console.error(errBody);
      pushSystemMsg("No se pudo contactar con la IA (revisa tu clave de API en 'Más'). Error: " + res.status);
      return;
    }

    const data = await res.json();
    const answer = (data.content || []).map((c) => c.text || "").join("\n").trim() || "(sin respuesta)";
    currentIssue.chat.push({ role: "assistant", text: answer });
    saveState();
    renderChatMessages();
  } catch (e) {
    currentIssue.chat.splice(thinkingIndex, 1);
    pushSystemMsg("Error de conexión al intentar hablar con la IA. Comprueba tu conexión a internet.");
    console.error(e);
  }
}

/* =========================================================
   DOCUMENTACIÓN
   ========================================================= */

function renderDocs() {
  document.getElementById("docPlate").value = state.docs.plate || "";
  document.getElementById("docVin").value = state.docs.vin || "";
  document.getElementById("docItv").value = state.docs.itv || "";
  document.getElementById("docInsurer").value = state.docs.insurer || "";
  document.getElementById("docInsuranceDate").value = state.docs.insuranceDate || "";
  document.getElementById("apiKeyInput").value = state.apiKey || "";
}

document.getElementById("btnSaveDocs").addEventListener("click", () => {
  state.docs = {
    plate: document.getElementById("docPlate").value.trim(),
    vin: document.getElementById("docVin").value.trim(),
    itv: document.getElementById("docItv").value,
    insurer: document.getElementById("docInsurer").value.trim(),
    insuranceDate: document.getElementById("docInsuranceDate").value,
  };
  // sincroniza la fecha de ITV con el mantenimiento "itv" si se ha indicado
  saveState();
  toast("Documentación guardada");
});

document.getElementById("btnSaveKey").addEventListener("click", () => {
  state.apiKey = document.getElementById("apiKeyInput").value.trim();
  saveState();
  toast("Clave guardada en este dispositivo");
});

/* =========================================================
   EXPORTAR / IMPORTAR / RESET
   ========================================================= */

document.getElementById("btnExport").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mi-leon-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("btnImport").addEventListener("click", () => {
  document.getElementById("importFile").click();
});

document.getElementById("importFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      state = Object.assign(defaultState(), parsed);
      saveState();
      renderAll();
      toast("Copia de seguridad importada");
    } catch (err) {
      toast("El archivo no es válido");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

document.getElementById("btnReset").addEventListener("click", () => {
  if (confirm("¿Seguro que quieres borrar todos los datos de la app? Esta acción no se puede deshacer.")) {
    state = defaultState();
    saveState();
    renderAll();
    toast("Datos borrados");
  }
});

/* =========================================================
   RENDER GENERAL
   ========================================================= */

function renderAll() {
  renderKm();
  renderHome();
  renderExpenses();
  renderFuel();
  renderMaintenance();
  renderIssues();
  renderDocs();
}

renderAll();

/* =========================================================
   SERVICE WORKER
   ========================================================= */

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW no registrado", e));
  });
}
