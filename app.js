const socket = io();

// CONFIG
const CONE_HEIGHT = 1.67;
const CYL_HEIGHT = 4.25;
const MAX_HEIGHT = CONE_HEIGHT + CYL_HEIGHT;
const V_TOTAL = 46.168; // m³

const PRODUCT_ORDER = ["DL-5", "VE-03", "ASE"];

// GEOMETRÍA VOLUMEN
const ratio = (1 / 3) * (CONE_HEIGHT / CYL_HEIGHT);
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

let history = {
  "DL-5": [],
  "VE-03": [],
  "ASE": []
};

let charts = {};

const tanks = {};
for (let i = 1; i <= 8; i++) {
  const id = "tanque" + i;
  tanks[id] = {
    levelMeters: 0,
    volume: 0,
    percent: 0,
    product: i === 6 ? "ASE" : "DL-5"
  };
}

function getActiveProducts() {
  const active = new Set();
  Object.values(tanks).forEach(t => {
    if (t.product) active.add(t.product);
  });
  return PRODUCT_ORDER.filter(product => active.has(product));
}

function renderTopPanel() {
  const topPanel = document.getElementById("topPanel");
  const activeProducts = getActiveProducts();

  topPanel.style.gridTemplateColumns = `repeat(${activeProducts.length || 1}, 1fr)`;

  topPanel.innerHTML = activeProducts.map(product => {
    const safeId = product.replace(/[^a-zA-Z0-9]/g, "");
    return `
      <div class="panel-card">
        <div id="summary-${safeId}" class="summary-card"></div>
        <canvas id="chart-${safeId}"></canvas>
      </div>
    `;
  }).join("");
}

function createGauge(percent, color) {
  const radius = 55;
  const circumference = Math.PI * radius;
  const progress = (percent / 100) * circumference;

  return `
    <svg width="150" height="100">
      <path d="M20 75 A55 55 0 0 1 130 75"
        stroke="#e5e7eb"
        stroke-width="12"
        fill="none"/>

      <path d="M20 75 A55 55 0 0 1 130 75"
        stroke="${color}"
        stroke-width="12"
        fill="none"
        stroke-dasharray="${circumference}"
        stroke-dashoffset="${circumference - progress}"
        style="transition: stroke-dashoffset 0.6s ease;">
      </path>

      <text x="18" y="92" font-size="12">0%</text>
      <text x="67" y="20" font-size="12">50%</text>
      <text x="112" y="92" font-size="12">100%</text>
    </svg>

    <div class="gauge-value" style="color:${color}">${percent.toFixed(1)}%</div>
  `;
}

function calculateMassTon(volume, product) {
  return (volume * PRODUCTS[product].density) / 1000;
}

const trendMarkerPlugin = {
  id: "trendMarkerPlugin",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const dataset = chart.data.datasets[0];
    const meta = chart.getDatasetMeta(0);

    if (!meta || !meta.data || meta.data.length < 2) return;

    ctx.save();
    ctx.font = "bold 12px Consolas";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let i = 1; i < dataset.data.length; i++) {
      const prev = dataset.data[i - 1];
      const curr = dataset.data[i];
      const point = meta.data[i];

      if (prev == null || curr == null || !point) continue;

      let symbol = "";
      let color = "";

      if (curr > prev) {
        symbol = "▲";
        color = "#16a34a";
      } else if (curr < prev) {
        symbol = "▼";
        color = "#dc2626";
      } else {
        continue;
      }

      const x = point.x;
      const y = point.y - 14;
      const markerRadius = 9;

      ctx.beginPath();
      ctx.arc(x, y, markerRadius, 0, Math.PI * 2);
      ctx.fillStyle = "#f8fafc";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = color;
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.fillText(symbol, x, y + 0.5);
    }

    ctx.restore();
  }
};

function getYAxisConfig(product) {
  if (product === "DL-5") return { min: 0, max: 420, stepSize: 50 };
  if (product === "VE-03") return { min: 0, max: 60, stepSize: 10 };
  return { min: 0, max: 40, stepSize: 5 };
}

function initCharts() {
  Object.values(charts).forEach(chart => chart.destroy());
  charts = {};

  const activeProducts = getActiveProducts();

  activeProducts.forEach((product) => {
    const safeId = product.replace(/[^a-zA-Z0-9]/g, "");
    const canvas = document.getElementById(`chart-${safeId}`);
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const yAxis = getYAxisConfig(product);

    charts[product] = new Chart(ctx, {
      type: "line",
      plugins: [trendMarkerPlugin],
      data: {
        labels: [],
        datasets: [{
          label: product,
          data: [],
          fill: true,
          backgroundColor: PRODUCTS[product].color + "22",
          tension: 0.15,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 3,
          borderColor: "#111827"
        }]
      },
      options: {
        responsive: true,
        animation: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          zoom: {
            pan: { enabled: true, mode: "x" },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: "x"
            }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return `${context.parsed.y.toFixed(2)} ton`;
              }
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: "Hora" },
            grid: {
              display: true,
              color: "#dbe2ea",
              lineWidth: 1
            }
          },
          y: {
            min: yAxis.min,
            max: yAxis.max,
            title: { display: true, text: "Ton" },
            ticks: { stepSize: yAxis.stepSize },
            grid: {
              display: true,
              color: "#e5e7eb",
              lineWidth: 1
            }
          }
        }
      }
    });
  });
}

function updateCharts() {
  Object.keys(charts).forEach((product) => {
    charts[product].data.labels = history[product].map(h => h.time);
    charts[product].data.datasets[0].data = history[product].map(h => h.value);
    charts[product].update();
  });
}

function renderSummary() {
  let totals = { "DL-5": 0, "VE-03": 0, "ASE": 0 };

  Object.values(tanks).forEach((t) => {
    totals[t.product] += calculateMassTon(t.volume, t.product);
  });

  const start = turnData.start || {};
  const end = turnData.end || {};

  Object.keys(charts).forEach((product) => {
    const safeId = product.replace(/[^a-zA-Z0-9]/g, "");
    const el = document.getElementById(`summary-${safeId}`);
    if (!el) return;

    el.innerHTML = `
      <div style="background:${PRODUCTS[product].color}; padding:8px; border-radius:8px;">
        ${product}<br>
        <strong>Totalizador:</strong> ${totals[product].toFixed(1)} ton<br>
        07: ${start[product]?.toFixed(1) || "-"} |
        19: ${end[product]?.toFixed(1) || "-"}
      </div>
    `;
  });
}

function saveSiloProductConfig(id, product) {
  socket.emit("setSiloProduct", { tanque: id, product });
}

function render() {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";

  Object.keys(tanks).forEach((id) => {
    const t = tanks[id];
    const product = PRODUCTS[t.product];
    const percent = Math.max(0, Math.min(100, t.percent || 0));

    let coneFill = 0;
    let rectFill = 0;

    if (t.levelMeters <= CONE_HEIGHT) {
      coneFill = (t.levelMeters / CONE_HEIGHT) * 60;
      rectFill = 0;
    } else {
      coneFill = 60;
      rectFill = ((t.levelMeters - CONE_HEIGHT) / CYL_HEIGHT) * 100;
    }

    const div = document.createElement("div");

    let className = "tank";
    if (percent >= 90) className += " alert-high";
    else if (percent >= 85) className += " warning";

    div.className = className;

    div.innerHTML = `
      <h3>Silo ${id.replace("tanque", "")}</h3>

      <div class="tank-main">
        <div class="tank-left-data">
          <div>${t.levelMeters.toFixed(2)} m</div>
          <div>${t.volume.toFixed(2)} m³</div>
          <div class="tank-mass">${calculateMassTon(t.volume, t.product).toFixed(2)} ton</div>
          <div>${product.density} kg/m³</div>
        </div>

        <div class="tank-wrapper">
          <div class="scale">
            <div>5.92</div>
            <div>5</div>
            <div>4</div>
            <div>3</div>
            <div>2</div>
            <div>1</div>
            <div>0</div>
          </div>

          <div class="tank-container">
            <div class="tank-rect">
              <div class="liquid-rect"
                style="height:${rectFill}%; background:${product.color}">
              </div>
            </div>

            <div class="tank-cone">
              <div class="liquid-cone"
                style="border-top:${coneFill}px solid ${product.color}">
              </div>
            </div>
          </div>

          <div class="gauge-container">
            ${createGauge(percent, product.color)}
          </div>
        </div>
      </div>

      <select class="product-select" data-id="${id}">
        ${Object.keys(PRODUCTS).map((p) =>
          `<option value="${p}" ${p === t.product ? "selected" : ""}>${p}</option>`
        ).join("")}
      </select>
    `;

    grid.appendChild(div);
  });

  document.querySelectorAll(".product-select").forEach((select) => {
    select.addEventListener("change", (e) => {
      const id = e.target.dataset.id;
      tanks[id].product = e.target.value;
      saveSiloProductConfig(id, e.target.value);
      render();
    });
  });

  const activeProductsNow = getActiveProducts().join("|");
  if (render.lastActiveProducts !== activeProductsNow) {
    render.lastActiveProducts = activeProductsNow;
    renderTopPanel();
    initCharts();
  }

  updateCharts();
  renderSummary();
}

socket.on("nivel", (data) => {
  if (mode !== "real") return;
  if (!tanks[data.tanque]) return;

  const distance = parseFloat(data.nivel);
  if (Number.isNaN(distance)) return;

  const level = Math.max(0, Math.min(MAX_HEIGHT, MAX_HEIGHT - distance));
  const volume = calculateVolumeFromLevel(level);
  const percent = (level / MAX_HEIGHT) * 100;

  tanks[data.tanque] = {
    ...tanks[data.tanque],
    levelMeters: level,
    volume,
    percent
  };

  render();
});

// reutilizada localmente por MQTT
function calculateVolumeFromLevel(level) {
  const safeLevel = Math.max(0, Math.min(MAX_HEIGHT, level));

  if (safeLevel <= CONE_HEIGHT) {
    return V_CONE * Math.pow(safeLevel / CONE_HEIGHT, 3);
  }

  return V_CONE + V_CYL * ((safeLevel - CONE_HEIGHT) / CYL_HEIGHT);
}

socket.on("siloState", (backendState) => {
  Object.keys(backendState || {}).forEach((tanque) => {
    if (!tanks[tanque]) return;
    tanks[tanque] = {
      ...tanks[tanque],
      ...backendState[tanque]
    };
  });
  render();
});

socket.on("turnData", (data) => {
  turnData = data || {};
  render();
});

socket.on("siloConfig", (config) => {
  Object.keys(config || {}).forEach((tanque) => {
    if (tanks[tanque] && PRODUCTS[config[tanque]]) {
      tanks[tanque].product = config[tanque];
    }
  });
  render();
});

socket.on("historyData", (backendHistory) => {
  history = {
    "DL-5": backendHistory?.["DL-5"] || [],
    "VE-03": backendHistory?.["VE-03"] || [],
    "ASE": backendHistory?.["ASE"] || []
  };
  render();
});

function requestInitialData() {
  socket.emit("getTurnData");
  socket.emit("getSiloConfig");
  socket.emit("getHistoryData");
  socket.emit("getSiloState");
}

requestInitialData();

setInterval(() => {
  if (mode !== "demo") return;

  Object.keys(tanks).forEach((id) => {
    const current = tanks[id].levelMeters || 3;
    const next = Math.max(0, Math.min(MAX_HEIGHT, current + (Math.random() - 0.5) * 0.3));
    const volume = calculateVolumeFromLevel(next);
    const percent = (next / MAX_HEIGHT) * 100;

    tanks[id] = {
      ...tanks[id],
      levelMeters: next,
      volume,
      percent
    };
  });

  render();
}, 2000);

document.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.addEventListener("change", (e) => {
    mode = e.target.value;
    if (mode === "real") requestInitialData();
  });
});

renderTopPanel();
initCharts();
render();
