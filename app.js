const socket = io();

// CONFIG
const CONE_HEIGHT = 1.67;
const CYL_HEIGHT = 4.25;
const MAX_HEIGHT = CONE_HEIGHT + CYL_HEIGHT;

const V_TOTAL = 46.168;

const ratio = (1/3) * (CONE_HEIGHT / CYL_HEIGHT);
const V_CYL = V_TOTAL / (1 + ratio);
const V_CONE = V_TOTAL - V_CYL;

// PRODUCTOS
const PRODUCTS = {
  "DL-5": { density: 1300, color: "#2563eb" },
  "VE-03": { density: 1370, color: "#16a34a" },
  "ASE": { density: 800, color: "#ea580c" }
};

let mode = "demo";
let turnData = {};

// HISTÓRICO
let history = { "DL-5": [], "VE-03": [], "ASE": [] };
let lastTotals = { "DL-5": 0, "VE-03": 0, "ASE": 0 };
let charts = {};

// ESTADO
const tanks = {};
for (let i = 1; i <= 8; i++) {
  tanks["tanque" + i] = {
    levelMeters: 0,
    volume: 0,
    product: "DL-5"
  };
}

// ===== GAUGE =====
function createGauge(percent) {
  const radius = 40;
  const circumference = Math.PI * radius;
  const progress = (percent / 100) * circumference;

  return `
    <svg width="120" height="80">
      <path d="M10 60 A50 50 0 0 1 110 60"
        stroke="#e5e7eb" stroke-width="10" fill="none"/>

      <path d="M10 60 A50 50 0 0 1 110 60"
        stroke="#22c55e" stroke-width="10" fill="none"
        stroke-dasharray="${circumference}"
        stroke-dashoffset="${circumference - progress}"
        style="transition: stroke-dashoffset 0.6s ease;">
      </path>

      <text x="10" y="75" font-size="10">0%</text>
      <text x="55" y="20" font-size="10">50%</text>
      <text x="95" y="75" font-size="10">100%</text>
    </svg>

    <div class="gauge-value">${percent.toFixed(1)}%</div>
  `;
}

// ===== CÁLCULOS =====

function calculateVolume(level) {
  if (level <= CONE_HEIGHT) {
    return V_CONE * Math.pow(level / CONE_HEIGHT, 3);
  } else {
    return V_CONE + V_CYL * ((level - CONE_HEIGHT) / CYL_HEIGHT);
  }
}

function calculateMassTon(volume, product) {
  return (volume * PRODUCTS[product].density) / 1000;
}

// ===== GRÁFICOS =====

function initCharts() {
  Object.keys(PRODUCTS).forEach(p => {

    const ctx = document.getElementById(
      p === "DL-5" ? "chartDL5" :
      p === "VE-03" ? "chartVE03" : "chartASE"
    ).getContext("2d");

    charts[p] = new Chart(ctx, {
      type: "line",
      data: {
        labels: [],
        datasets: [{
          label: p,
          data: [],
          borderColor: PRODUCTS[p].color,
          backgroundColor: PRODUCTS[p].color + "22",
          fill: true,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2
        }]
      },
      options: {
        animation: false,
        plugins: {
          legend: { display: false },
          zoom: {
            pan: { enabled: true, mode: "x" },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: "x"
            }
          }
        },
        scales: {
          x: { title: { display: true, text: "Hora" } },
          y: { title: { display: true, text: "Ton" } }
        }
      }
    });
  });
}

// ===== HISTÓRICO INDUSTRIAL =====

function updateHistory(totals) {

  const now = new Date();
  const minutes = now.getMinutes();
  const roundedMinutes = minutes < 30 ? "00" : "30";
  const label = now.getHours().toString().padStart(2, "0") + ":" + roundedMinutes;

  Object.keys(totals).forEach(p => {

    const currentValue = totals[p];
    const lastEntry = history[p].slice(-1)[0];

    if (!lastEntry) {
      history[p].push({ time: label, value: currentValue });
      lastTotals[p] = currentValue;
      return;
    }

    if (lastEntry.time !== label) {
      history[p].push({
        time: label,
        value: lastTotals[p]
      });
    } else {
      lastEntry.value = currentValue;
    }

    lastTotals[p] = currentValue;
  });
}

function updateCharts() {
  Object.keys(history).forEach(p => {
    charts[p].data.labels = history[p].map(h => h.time);
    charts[p].data.datasets[0].data = history[p].map(h => h.value);
    charts[p].update();
  });
}

// ===== RESUMEN =====

function renderSummary() {

  let totals = { "DL-5": 0, "VE-03": 0, "ASE": 0 };

  Object.values(tanks).forEach(t => {
    totals[t.product] += calculateMassTon(t.volume, t.product);
  });

  const start = turnData.start || {};
  const end = turnData.end || {};

  function draw(id, name, color) {
    document.getElementById(id).innerHTML = `
      <div style="background:${color}; padding:5px;">
        ${name}<br>
        ${totals[name].toFixed(1)} ton<br>
        08: ${start[name]?.toFixed(1) || "-"} |
        18: ${end[name]?.toFixed(1) || "-"}
      </div>
    `;
  }

  draw("summary-DL5","DL-5","#2563eb");
  draw("summary-VE03","VE-03","#16a34a");
  draw("summary-ASE","ASE","#ea580c");
}

// ===== RENDER =====

function render() {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";

  let totals = { "DL-5": 0, "VE-03": 0, "ASE": 0 };

  Object.keys(tanks).forEach(id => {

    const t = tanks[id];
    const product = PRODUCTS[t.product];
    const percent = (t.levelMeters / MAX_HEIGHT) * 100;

    totals[t.product] += calculateMassTon(t.volume, t.product);

    const div = document.createElement("div");
    div.className = "tank";

    div.innerHTML = `
      <h3>Silo ${id.replace("tanque","")}</h3>

      <div class="tank-wrapper">

        <div class="scale">
          <div>5.9</div><div>5</div><div>4</div><div>3</div>
          <div>2</div><div>1</div><div>0</div>
        </div>

        <div class="tank-container">
          <div class="tank-rect">
            <div class="liquid-rect" style="height:${percent}%; background:${product.color}"></div>
          </div>
          <div class="tank-cone">
            <div class="liquid-cone" style="border-top:${percent*0.6}px solid ${product.color}"></div>
          </div>
        </div>

        <div class="gauge-container">
          ${createGauge(percent)}
        </div>

      </div>

      <div>
        ${t.levelMeters.toFixed(2)} m<br>
        ${t.volume.toFixed(2)} m³<br>
        ${calculateMassTon(t.volume, t.product).toFixed(2)} ton<br>
        ${product.density} kg/m³
      </div>

      <select data-id="${id}">
        ${Object.keys(PRODUCTS).map(p =>
          `<option value="${p}" ${p===t.product?"selected":""}>${p}</option>`
        ).join("")}
      </select>
    `;

    grid.appendChild(div);
  });

  document.querySelectorAll("select").forEach(sel => {
    sel.addEventListener("change", e => {
      tanks[e.target.dataset.id].product = e.target.value;
      render();
    });
  });

  socket.emit("totals", totals);

  updateHistory(totals);
  updateCharts();
  renderSummary();
}

// MQTT
socket.on("nivel", data => {
  if (mode !== "real") return;

  const lvl = MAX_HEIGHT - parseFloat(data.nivel);
  tanks[data.tanque].levelMeters = lvl;
  tanks[data.tanque].volume = calculateVolume(lvl);

  render();
});

// TURNOS
socket.on("turnData", data => {
  turnData = data;
  render();
});

socket.emit("getTurnData");

// DEMO
setInterval(() => {
  if (mode !== "demo") return;

  Object.keys(tanks).forEach(id => {
    let lvl = Math.random() * MAX_HEIGHT;
    tanks[id].levelMeters = lvl;
    tanks[id].volume = calculateVolume(lvl);
  });

  render();
}, 2000);

// MODO
document.querySelectorAll('input[name="mode"]').forEach(r => {
  r.addEventListener("change", e => mode = e.target.value);
});

// INIT
initCharts();
render();
