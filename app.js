const socket = io();

/* =========================
   CONFIG
========================= */
const CONE_HEIGHT = 1.67;
const CYL_HEIGHT = 4.25;
const MAX_HEIGHT = CONE_HEIGHT + CYL_HEIGHT;
const V_TOTAL = 46.168;

const PRODUCT_ORDER = ["DL-5", "VE-03", "ASE"];

const ratio = (1 / 3) * (CONE_HEIGHT / CYL_HEIGHT);
const V_CYL = V_TOTAL / (1 + ratio);
const V_CONE = V_TOTAL - V_CYL;

const PRODUCTS = {
  "DL-5": { density: 1300, color: "#2563eb" },
  "VE-03": { density: 1370, color: "#16a34a" },
  "ASE": { density: 800, color: "#ea580c" }
};

/* =========================
   ESTADO GLOBAL
========================= */
let mode = "real";
let turnData = {};
let charts = {};
let siloMiniCharts = {};

let selectedHistoryDate = "";
let availableHistoryDates = [];

let historyReal = { "DL-5": [], "VE-03": [], "ASE": [] };
let siloTrendReal = {};

let lastMqttUpdate = "--:--:--";
let mqttSignalOk = false;
let lastMqttHeartbeat = 0;

const realTanks = {};
for (let i = 1; i <= 8; i++) {
  const id = "tanque" + i;
  realTanks[id] = {
    levelMeters: 0,
    volume: 0,
    percent: 0,
    product: i === 6 ? "ASE" : "DL-5"
  };
}

/* =========================
   UTILIDADES
========================= */
function calculateMassTon(volume, product) {
  return (volume * PRODUCTS[product].density) / 1000;
}

function getFixedDayLabels() {
  const labels = [];
  for (let h = 7; h <= 19; h++) {
    for (let m = 0; m < 60; m += 5) {
      if (h === 19 && m > 0) break;
      labels.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return labels;
}

const FIXED_DAY_LABELS = getFixedDayLabels();

function buildFixedSeries(historyArray) {
  const map = {};
  historyArray.forEach(i => map[i.time] = i.value);

  return FIXED_DAY_LABELS.map(l =>
    map.hasOwnProperty(l) ? map[l] : null
  );
}

/* =========================
   MQTT STATUS
========================= */
function updateMqttStatus() {
  const el = document.getElementById("mqttStatus");
  if (!el) return;

  el.textContent = mqttSignalOk
    ? `🟢 MQTT Activo (${lastMqttUpdate})`
    : `🔴 Sin señal (${lastMqttUpdate})`;
}

/* =========================
   SELECTOR DE FECHA
========================= */
function renderDateSelector() {
  const select = document.getElementById("chartDateSelect");
  if (!select) return;

  select.innerHTML = availableHistoryDates.map(d => {
    const label = d === availableHistoryDates.at(-1)
      ? `${d} (Hoy)`
      : d;

    return `<option value="${d}" ${d === selectedHistoryDate ? "selected" : ""}>${label}</option>`;
  }).join("");

  select.onchange = function () {
    selectedHistoryDate = this.value;

    socket.emit("getHistoryData", { date: selectedHistoryDate });
    socket.emit("getSiloTrendData", { date: selectedHistoryDate });
  };
}

/* =========================
   MINI GRÁFICOS
========================= */
function destroyMiniCharts() {
  Object.values(siloMiniCharts).forEach(c => c.destroy());
  siloMiniCharts = {};
}

function updateMiniSiloCharts() {
  destroyMiniCharts();

  Object.keys(realTanks).forEach(id => {
    const canvas = document.getElementById("mini-" + id);
    if (!canvas) return;

    const data = buildFixedSeries(siloTrendReal[id] || []);

    siloMiniCharts[id] = new Chart(canvas, {
      type: "line",
      data: {
        labels: FIXED_DAY_LABELS,
        datasets: [{
          data,
          borderColor: "#111827",
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          tension: 0.25
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false, min: 0, max: 60 }
        }
      }
    });
  });
}

/* =========================
   RENDER
========================= */
function render() {
  const grid = document.getElementById("grid");
  destroyMiniCharts();
  grid.innerHTML = "";

  Object.keys(realTanks).forEach(id => {
    const t = realTanks[id];
    const product = PRODUCTS[t.product];

    const div = document.createElement("div");
    div.className = "tank";

    div.innerHTML = `
      <h3>Silo ${id.replace("tanque", "")}</h3>

      <div class="tank-main">

        <div class="tank-left-panel">
          <div class="tank-left-data">
            <div>${t.levelMeters.toFixed(2)} m</div>
            <div>${t.volume.toFixed(2)} m³</div>
            <div class="tank-mass">${calculateMassTon(t.volume, t.product).toFixed(2)} ton</div>
            <div>${product.density} kg/m³</div>
          </div>
        </div>

        <div class="tank-wrapper">
          <div class="mini-chart-container">
            <canvas id="mini-${id}"></canvas>
          </div>
        </div>
      </div>
    `;

    grid.appendChild(div);
  });

  updateMiniSiloCharts();
}

/* =========================
   SOCKETS
========================= */

socket.on("historyDates", dates => {
  availableHistoryDates = dates;

  if (!selectedHistoryDate && dates.length) {
    selectedHistoryDate = dates.at(-1);
  }

  renderDateSelector();

  socket.emit("getHistoryData", { date: selectedHistoryDate });
  socket.emit("getSiloTrendData", { date: selectedHistoryDate });
});

socket.on("historyData", payload => {
  if (payload.date !== selectedHistoryDate) return;

  historyReal = payload.history;
});

socket.on("siloTrendData", payload => {
  if (payload.date !== selectedHistoryDate) return;

  siloTrendReal = payload.history;
  render();
});

socket.on("siloState", state => {
  Object.assign(realTanks, state);
  render();
});

socket.on("nivel", data => {
  lastMqttUpdate = data.serverTime;
  mqttSignalOk = true;
  lastMqttHeartbeat = Date.now();
  updateMqttStatus();
});

/* =========================
   INIT
========================= */

function requestData() {
  socket.emit("getHistoryDates");
  socket.emit("getSiloState");
}

setInterval(() => {
  if (Date.now() - lastMqttHeartbeat > 300000) {
    mqttSignalOk = false;
    updateMqttStatus();
  }
}, 1000);

requestData();
render();
updateMqttStatus();
