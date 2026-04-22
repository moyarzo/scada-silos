const socket = io();

// CONFIG
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

let mode = "demo";
let turnData = {};
let lastMqttUpdate = null;
let charts = {};

let historyReal = {
  "DL-5": [],
  "VE-03": [],
  "ASE": []
};

let historyDemo = {
  "DL-5": [],
  "VE-03": [],
  "ASE": []
};

const realTanks = {};
const demoTanks = {};

for (let i = 1; i <= 8; i++) {
  const id = "tanque" + i;
  const defaultProduct = i === 6 ? "ASE" : "DL-5";

  realTanks[id] = {
    levelMeters: 0,
    volume: 0,
    percent: 0,
    product: defaultProduct
  };

  demoTanks[id] = {
    levelMeters: 0,
    volume: 0,
    percent: 0,
    product: defaultProduct
  };
}

function calculateVolume(level) {
  const safeLevel = Math.max(0, Math.min(MAX_HEIGHT, level));

  if (safeLevel <= CONE_HEIGHT) {
    return V_CONE * Math.pow(safeLevel / CONE_HEIGHT, 3);
  }

  return V_CONE + V_CYL * ((safeLevel - CONE_HEIGHT) / CYL_HEIGHT);
}

function calculateMassTon(volume, product) {
  return (volume * PRODUCTS[product].density) / 1000;
}

function getRounded5MinLabel() {
  const now = new Date();
  const minutes = now.getMinutes();
  const rounded = Math.floor(minutes / 5) * 5;
  return `${String(now.getHours()).padStart(2, "0")}:${String(rounded).padStart(2, "0")}`;
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
  historyArray.forEach(function (item) {
    map[item.time] = item.value;
  });

  return FIXED_DAY_LABELS.map(function (label) {
    return Object.prototype.hasOwnProperty.call(map, label) ? map[label] : null;
  });
}

function getActiveProducts() {
  const active = new Set();
  Object.keys(realTanks).forEach(function (key) {
    active.add(realTanks[key].product);
  });

  return PRODUCT_ORDER.filter(function (product) {
    return active.has(product);
  });
}

function getViewTanks() {
  return mode === "real" ? realTanks : demoTanks;
}

function getViewHistory() {
  return mode === "real" ? historyReal : historyDemo;
}

function setProductAllModes(tanque, product) {
  if (!realTanks[tanque] || !demoTanks[tanque] || !PRODUCTS[product]) return;
  realTanks[tanque].product = product;
  demoTanks[tanque].product = product;
}

function updateMqttStatus() {
  const el = document.getElementById("mqttStatus");
  if (!el) return;

  if (!lastMqttUpdate) {
    el.textContent = "Última actualización MQTT: --";
    return;
  }

  el.textContent = `Última actualización MQTT: ${lastMqttUpdate}`;
}

function createGauge(percent, color) {
  const radius = 55;
  const circumference = Math.PI * radius;
  const progress = (percent / 100) * circumference;

  return `
    <svg width="150" height="100" viewBox="0 0 150 100" preserveAspectRatio="xMidYMid meet">
      <path d="M20 75 A55 55 0 0 1 130 75"
        stroke="#e5e7eb"
        stroke-width="12"
        fill="none"></path>

      <path d="M20 75 A55 55 0 0 1 130 75"
        stroke="${color}"
        stroke-width="12"
        fill="none"
        stroke-dasharray="${circumference}"
        stroke-dashoffset="${circumference - progress}"
        style="transition: stroke-dashoffset 0.6s ease;"></path>

      <text x="18" y="92" font-size="12">0%</text>
      <text x="75" y="62" font-size="12" text-anchor="middle">50%</text>
      <text x="112" y="92" font-size="12">100%</text>
    </svg>
    <div class="gauge-value" style="color:${color}">${percent.toFixed(1)}%</div>
  `;
}

function renderTopPanel() {
  const topPanel = document.getElementById("topPanel");
  const activeProducts = getActiveProducts();

  topPanel.style.gridTemplateColumns = `repeat(${activeProducts.length || 1}, minmax(0, 1fr))`;

  topPanel.innerHTML = activeProducts.map(function (product) {
    const safeId = product.replace(/[^a-zA-Z0-9]/g, "");
    return `
      <div class="panel-card">
        <div id="summary-${safeId}" class="summary-card"></div>
        <div class="chart-wrapper">
          <canvas id="chart-${safeId}"></canvas>
        </div>
      </div>
    `;
  }).join("");
}

const trendMarkerPlugin = {
  id: "trendMarkerPlugin",
  afterDatasetsDraw: function (chart) {
    const ctx = chart.ctx;
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
  Object.keys(charts).forEach(function (key) {
    charts[key].destroy();
  });
  charts = {};

  const activeProducts = getActiveProducts();

  activeProducts.forEach(function (product) {
    const safeId = product.replace(/[^a-zA-Z0-9]/g, "");
    const canvas = document.getElementById(`chart-${safeId}`);
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const yAxis = getYAxisConfig(product);

    charts[product] = new Chart(ctx, {
      type: "line",
      plugins: [trendMarkerPlugin],
      data: {
        labels: FIXED_DAY_LABELS,
        datasets: [{
          label: product,
          data: [],
          fill: true,
          backgroundColor: PRODUCTS[product].color + "22",
          tension: 0.15,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 3,
          borderColor: "#111827",
          spanGaps: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
          },
          tooltip: {
            callbacks: {
              label: function (context) {
                if (context.parsed.y == null) return "Sin dato";
                return `${context.parsed.y.toFixed(2)} ton`;
              }
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: "Hora" },
            min: 0,
            max: FIXED_DAY_LABELS.length - 1,
            ticks: {
              autoSkip: true,
              maxTicksLimit: window.innerWidth < 768 ? 7 : 13
            },
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
  const sourceHistory = getViewHistory();

  Object.keys(charts).forEach(function (product) {
    charts[product].data.labels = FIXED_DAY_LABELS;
    charts[product].data.datasets[0].data = buildFixedSeries(sourceHistory[product] || []);
    charts[product].update();
  });
}

function renderSummary() {
  const viewTanks = getViewTanks();
  const totals = { "DL-5": 0, "VE-03": 0, "ASE": 0 };

  Object.keys(viewTanks).forEach(function (key) {
    const t = viewTanks[key];
    totals[t.product] += calculateMassTon(t.volume, t.product);
  });

  const start = turnData.start || {};
  const end = turnData.end || {};

  Object.keys(charts).forEach(function (product) {
    const safeId = product.replace(/[^a-zA-Z0-9]/g, "");
    const el = document.getElementById(`summary-${safeId}`);
    if (!el) return;

    if (mode === "real") {
      el.innerHTML = `
        <div style="background:${PRODUCTS[product].color}; padding:8px; border-radius:8px;">
          ${product}<br>
          <strong>Totalizador:</strong> ${totals[product].toFixed(1)} ton<br>
          <strong>Registro turno:</strong> 07: ${start[product] != null ? Number(start[product]).toFixed(1) : "-"} | 19: ${end[product] != null ? Number(end[product]).toFixed(1) : "-"}
        </div>
      `;
    } else {
      el.innerHTML = `
        <div style="background:${PRODUCTS[product].color}; padding:8px; border-radius:8px;">
          ${product}<br>
          <strong>Totalizador:</strong> ${totals[product].toFixed(1)} ton<br>
          <strong>Modo:</strong> Demo
        </div>
      `;
    }
  });
}

function saveSiloProductConfig(id, product) {
  socket.emit("setSiloProduct", { tanque: id, product: product });
}

function updateDemoHistory() {
  const label = getRounded5MinLabel();
  const totals = { "DL-5": 0, "VE-03": 0, "ASE": 0 };

  Object.keys(demoTanks).forEach(function (key) {
    const t = demoTanks[key];
    totals[t.product] += calculateMassTon(t.volume, t.product);
  });

  Object.keys(totals).forEach(function (product) {
    const arr = historyDemo[product];
    const lastEntry = arr[arr.length - 1];

    if (!lastEntry) {
      arr.push({ time: label, value: totals[product] });
    } else if (lastEntry.time !== label) {
      arr.push({ time: label, value: totals[product] });
    } else {
      lastEntry.value = totals[product];
    }
  });
}

function exportData() {
  window.location.href = "/export-data";
}

function exportTrend() {
  window.location.href = "/export-trend";
}

function render() {
  const viewTanks = getViewTanks();
  const grid = document.getElementById("grid");
  grid.innerHTML = "";

  Object.keys(viewTanks).forEach(function (id) {
    const t = viewTanks[id];
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
              <div class="liquid-rect" style="height:${rectFill}%; background:${product.color}"></div>
            </div>

            <div class="tank-cone">
              <div class="liquid-cone" style="border-top:${coneFill}px solid ${product.color}"></div>
            </div>
          </div>

          <div class="gauge-container">
            ${createGauge(percent, product.color)}
          </div>
        </div>
      </div>

      <select class="product-select" data-id="${id}" ${mode === "real" ? "disabled" : ""}>
        ${Object.keys(PRODUCTS).map(function (p) {
          return `<option value="${p}" ${p === t.product ? "selected" : ""}>${p}</option>`;
        }).join("")}
      </select>
    `;

    grid.appendChild(div);
  });

  document.querySelectorAll(".product-select").forEach(function (select) {
    select.addEventListener("change", function (e) {
      const id = e.target.dataset.id;
      const product = e.target.value;
      setProductAllModes(id, product);
      saveSiloProductConfig(id, product);
      render();
    });
  });

  const chartKey = `${mode}|${getActiveProducts().join("|")}`;
  if (render.lastChartKey !== chartKey) {
    render.lastChartKey = chartKey;
    renderTopPanel();
    initCharts();
  }

  updateCharts();
  renderSummary();
  updateMqttStatus();
}

// REAL MQTT EN PARALELO
socket.on("nivel", function (data) {
  if (!realTanks[data.tanque]) return;

  const distance = parseFloat(data.nivel);
  if (Number.isNaN(distance)) return;

  const level = Math.max(0, Math.min(MAX_HEIGHT, MAX_HEIGHT - distance));
  const volume = calculateVolume(level);
  const percent = (level / MAX_HEIGHT) * 100;

  realTanks[data.tanque] = {
    levelMeters: level,
    volume: volume,
    percent: percent,
    product: realTanks[data.tanque].product
  };


  // usar hora del backend (VM)
  if (data.serverTime) {
    lastMqttUpdate = data.serverTime;
  };

});

  if (mode === "real") render();
});

socket.on("siloState", function (backendState) {
  Object.keys(backendState || {}).forEach(function (tanque) {
    if (!realTanks[tanque]) return;
    realTanks[tanque] = {
      levelMeters: backendState[tanque].levelMeters || 0,
      volume: backendState[tanque].volume || 0,
      percent: backendState[tanque].percent || 0,
      product: realTanks[tanque].product
    };
  });

  if (mode === "real") render();
});

socket.on("turnData", function (data) {
  turnData = data || {};
  if (mode === "real") render();
});

socket.on("siloConfig", function (config) {
  Object.keys(config || {}).forEach(function (tanque) {
    if (PRODUCTS[config[tanque]]) {
      setProductAllModes(tanque, config[tanque]);
    }
  });
  render();
});

socket.on("historyData", function (backendHistory) {
  historyReal = {
    "DL-5": backendHistory && backendHistory["DL-5"] ? backendHistory["DL-5"] : [],
    "VE-03": backendHistory && backendHistory["VE-03"] ? backendHistory["VE-03"] : [],
    "ASE": backendHistory && backendHistory["ASE"] ? backendHistory["ASE"] : []
  };

  if (mode === "real") render();
});

function requestRealData() {
  socket.emit("getTurnData");
  socket.emit("getSiloConfig");
  socket.emit("getHistoryData");
  socket.emit("getSiloState");
}

// DEMO EN PARALELO
setInterval(function () {
  Object.keys(demoTanks).forEach(function (id) {
    const current = demoTanks[id].levelMeters || 3;
    const next = Math.max(0, Math.min(MAX_HEIGHT, current + (Math.random() - 0.5) * 0.3));
    const volume = calculateVolume(next);
    const percent = (next / MAX_HEIGHT) * 100;

    demoTanks[id] = {
      levelMeters: next,
      volume: volume,
      percent: percent,
      product: demoTanks[id].product
    };
  });

  updateDemoHistory();

  if (mode === "demo") render();
}, 2000);

document.querySelectorAll('input[name="mode"]').forEach(function (radio) {
  radio.addEventListener("change", function (e) {
    mode = e.target.value;
    if (mode === "real") requestRealData();
    render();
  });
});

document.getElementById("exportBtn").addEventListener("click", exportData);
document.getElementById("exportTrendBtn").addEventListener("click", exportTrend);

window.addEventListener("resize", function () {
  initCharts();
  updateCharts();
});

requestRealData();
renderTopPanel();
initCharts();
render();
updateMqttStatus();
