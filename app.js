/* ==========================================================
   APP.JS - SCADA SILOS
   Sistema Monitoreo Planta Los Bronces – Silos de Matriz
   ========================================================== */

const socket = io();

const PRODUCTS = {
  "DL-5": {
    density: 1300,
    color: "#2f80ed",
    soft: "rgba(47,128,237,0.18)",
    yMax: 420
  },
  "VE-03": {
    density: 1370,
    color: "#9b51e0",
    soft: "rgba(155,81,224,0.18)",
    yMax: 60
  },
  "ASE": {
    density: 800,
    color: "#27ae60",
    soft: "rgba(39,174,96,0.18)",
    yMax: 40
  }
};

const SILO_COUNT = 8;

const CONE_HEIGHT = 1.67;
const CYLINDER_HEIGHT = 4.25;
const MAX_HEIGHT = CONE_HEIGHT + CYLINDER_HEIGHT;

const TOTAL_VOLUME = 46.168;

const SHIFT_START = "07:00";
const SHIFT_END = "19:00";

let currentMode = "demo";
let selectedDate = getTodayDate();
let latestSilos = {};
let productAssignments = {};
let charts = {};
let historicalByDate = {};
let demoTimer = null;

/* ==========================================================
   INICIO
   ========================================================== */

document.addEventListener("DOMContentLoaded", () => {
  initDefaultAssignments();
  bindUI();
  initCharts();
  requestInitialData();

  if (currentMode === "demo") {
    startDemoMode();
  }
});

/* ==========================================================
   UI
   ========================================================== */

function bindUI() {
  const modeSelector = document.getElementById("modeSelector");
  const dateSelector = document.getElementById("dateSelector");
  const downloadDataBtn = document.getElementById("downloadData");
  const downloadTrendBtn = document.getElementById("downloadTrend");

  if (modeSelector) {
    modeSelector.value = currentMode;

    modeSelector.addEventListener("change", () => {
      currentMode = modeSelector.value;

      if (currentMode === "demo") {
        startDemoMode();
      } else {
        stopDemoMode();
        socket.emit("request-current-state");
      }
    });
  }

  if (dateSelector) {
    dateSelector.value = selectedDate;

    dateSelector.addEventListener("change", async () => {
      selectedDate = dateSelector.value;
      await loadTrendByDate(selectedDate);
    });
  }

  if (downloadDataBtn) {
    downloadDataBtn.addEventListener("click", () => {
      window.location.href = `/download-data?date=${selectedDate}`;
    });
  }

  if (downloadTrendBtn) {
    downloadTrendBtn.addEventListener("click", () => {
      window.location.href = `/download-trend?date=${selectedDate}`;
    });
  }

  for (let i = 1; i <= SILO_COUNT; i++) {
    const select = document.getElementById(`product-silo-${i}`);

    if (select) {
      select.value = productAssignments[i];

      select.addEventListener("change", () => {
        productAssignments[i] = select.value;
        updateSiloProductVisual(i);
        updateAllSummariesFromCurrentState();
        updateVisibleCharts();

        socket.emit("save-product-assignments", productAssignments);
      });
    }
  }
}

/* ==========================================================
   DATOS INICIALES
   ========================================================== */

function requestInitialData() {
  socket.emit("request-current-state");
  socket.emit("request-product-assignments");
  loadTrendByDate(selectedDate);
}

function initDefaultAssignments() {
  for (let i = 1; i <= SILO_COUNT; i++) {
    productAssignments[i] = i === 6 ? "ASE" : "DL-5";
  }
}

/* ==========================================================
   SOCKET.IO
   ========================================================== */

socket.on("connect", () => {
  socket.emit("request-current-state");
  socket.emit("request-product-assignments");
});

socket.on("product-assignments", data => {
  if (!data) return;

  productAssignments = {
    ...productAssignments,
    ...data
  };

  for (let i = 1; i <= SILO_COUNT; i++) {
    const select = document.getElementById(`product-silo-${i}`);

    if (select) {
      select.value = productAssignments[i];
    }

    updateSiloProductVisual(i);
  }

  updateAllSummariesFromCurrentState();
  updateVisibleCharts();
});

socket.on("current-state", data => {
  if (!data) return;

  latestSilos = data.silos || data || {};

  updateSilos(latestSilos);
  updateAllSummariesFromCurrentState();

  if (data.lastMqttUpdate) {
    updateMqttTime(data.lastMqttUpdate);
  }
});

socket.on("mqtt-update", data => {
  if (currentMode !== "real") return;
  if (!data) return;

  latestSilos = {
    ...latestSilos,
    ...data
  };

  updateSilos(latestSilos);
  updateAllSummariesFromCurrentState();
  updateMqttTime(new Date());
});

socket.on("trend-update", data => {
  if (!data) return;

  const date = data.date || getTodayDate();

  if (!historicalByDate[date]) {
    historicalByDate[date] = [];
  }

  historicalByDate[date].push(data);

  if (date === selectedDate) {
    renderChartsFromHistory(historicalByDate[date]);
    updateSummariesFromHistory(historicalByDate[date]);
  }
});

/* ==========================================================
   SILOS
   ========================================================== */

function updateSilos(silos) {
  for (let i = 1; i <= SILO_COUNT; i++) {
    const value = silos[i] || silos[`silo${i}`] || {};
    const distance = Number(value.distance ?? value.distancia ?? 0);
    const level = calculateLevelFromDistance(distance);
    const percentage = clamp((level / MAX_HEIGHT) * 100, 0, 100);
    const product = productAssignments[i] || "DL-5";
    const tons = calculateTons(level, product);

    updateSiloUI(i, {
      level,
      percentage,
      tons,
      product
    });
  }
}

function updateSiloUI(index, data) {
  const fill = document.getElementById(`silo-fill-${index}`);
  const percentLabel = document.getElementById(`silo-percent-${index}`);
  const tonsLabel = document.getElementById(`silo-tons-${index}`);
  const densityLabel = document.getElementById(`silo-density-${index}`);
  const productLabel = document.getElementById(`silo-product-${index}`);
  const card = document.getElementById(`silo-card-${index}`);

  const productInfo = PRODUCTS[data.product] || PRODUCTS["DL-5"];

  if (fill) {
    fill.style.height = `${data.percentage}%`;
    fill.style.background = productInfo.color;
  }

  if (percentLabel) {
    percentLabel.textContent = `${data.percentage.toFixed(0)}%`;
    percentLabel.style.color = productInfo.color;
  }

  if (tonsLabel) {
    tonsLabel.textContent = `${data.tons.toFixed(1)} ton`;
  }

  if (densityLabel) {
    densityLabel.textContent = `${productInfo.density} kg/m³`;
  }

  if (productLabel) {
    productLabel.textContent = data.product;
  }

  if (card) {
    card.classList.remove("alarm-yellow", "alarm-red");

    if (data.percentage >= 90) {
      card.classList.add("alarm-red");
    } else if (data.percentage >= 85) {
      card.classList.add("alarm-yellow");
    }
  }
}

function updateSiloProductVisual(index) {
  const product = productAssignments[index] || "DL-5";
  const productInfo = PRODUCTS[product];

  const fill = document.getElementById(`silo-fill-${index}`);
  const percentLabel = document.getElementById(`silo-percent-${index}`);
  const densityLabel = document.getElementById(`silo-density-${index}`);
  const productLabel = document.getElementById(`silo-product-${index}`);

  if (fill) fill.style.background = productInfo.color;
  if (percentLabel) percentLabel.style.color = productInfo.color;
  if (densityLabel) densityLabel.textContent = `${productInfo.density} kg/m³`;
  if (productLabel) productLabel.textContent = product;
}

/* ==========================================================
   CÁLCULOS
   ========================================================== */

function calculateLevelFromDistance(distance) {
  if (!distance || Number.isNaN(distance)) return 0;

  const level = MAX_HEIGHT - distance;

  return clamp(level, 0, MAX_HEIGHT);
}

function calculateVolume(level) {
  level = clamp(level, 0, MAX_HEIGHT);

  if (level <= 0) return 0;

  const coneVolume = TOTAL_VOLUME * (CONE_HEIGHT / MAX_HEIGHT);
  const cylinderVolume = TOTAL_VOLUME - coneVolume;

  if (level <= CONE_HEIGHT) {
    const ratio = level / CONE_HEIGHT;
    return coneVolume * Math.pow(ratio, 3);
  }

  const cylinderLevel = level - CONE_HEIGHT;
  const cylinderRatio = cylinderLevel / CYLINDER_HEIGHT;

  return coneVolume + cylinderVolume * cylinderRatio;
}

function calculateTons(level, product) {
  const volume = calculateVolume(level);
  const density = PRODUCTS[product]?.density || PRODUCTS["DL-5"].density;

  return (volume * density) / 1000;
}

function calculateCurrentProductTotals() {
  const totals = {
    "DL-5": 0,
    "VE-03": 0,
    "ASE": 0
  };

  for (let i = 1; i <= SILO_COUNT; i++) {
    const silo = latestSilos[i] || latestSilos[`silo${i}`] || {};
    const product = productAssignments[i] || "DL-5";
    const distance = Number(silo.distance ?? silo.distancia ?? 0);
    const level = calculateLevelFromDistance(distance);
    const tons = calculateTons(level, product);

    totals[product] += tons;
  }

  return totals;
}

/* ==========================================================
   RESÚMENES
   ========================================================== */

function updateAllSummariesFromCurrentState() {
  const totals = calculateCurrentProductTotals();

  updateSummaryUI(totals);
  updateVisibleCharts();
}

function updateSummariesFromHistory(history) {
  const totals = {
    "DL-5": 0,
    "VE-03": 0,
    "ASE": 0
  };

  if (!history || !history.length) {
    updateSummaryUI(totals);
    return;
  }

  const lastPoint = history[history.length - 1];

  if (lastPoint.products) {
    Object.keys(totals).forEach(product => {
      totals[product] = Number(lastPoint.products[product] || 0);
    });
  } else if (lastPoint.silos) {
    for (let i = 1; i <= SILO_COUNT; i++) {
      const siloData = lastPoint.silos[i] || lastPoint.silos[`silo${i}`];

      if (!siloData) continue;

      const product = siloData.product || productAssignments[i] || "DL-5";
      const tons = Number(siloData.tons ?? siloData.toneladas ?? 0);

      if (totals[product] !== undefined) {
        totals[product] += tons;
      }
    }
  }

  updateSummaryUI(totals);
}

function updateSummaryUI(totals) {
  Object.keys(PRODUCTS).forEach(product => {
    const safeId = normalizeProductId(product);

    const totalEl = document.getElementById(`summary-${safeId}`);
    const cardEl = document.getElementById(`summary-card-${safeId}`);

    if (totalEl) {
      totalEl.textContent = `Totalizador: ${Number(totals[product] || 0).toFixed(1)} ton`;
    }

    if (cardEl) {
      const hasProduct = hasAnySiloWithProduct(product);
      cardEl.style.display = hasProduct ? "" : "none";
    }
  });
}

/* ==========================================================
   GRÁFICOS
   ========================================================== */

function initCharts() {
  Object.keys(PRODUCTS).forEach(product => {
    const canvas = document.getElementById(`chart-${normalizeProductId(product)}`);

    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    charts[product] = new Chart(ctx, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: product,
            data: [],
            borderColor: "#000000",
            backgroundColor: PRODUCTS[product].soft,
            fill: true,
            tension: 0.35,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: "#000000",
            pointBorderColor: "#000000"
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 500
        },
        plugins: {
          legend: {
            display: true
          },
          tooltip: {
            callbacks: {
              label: context => `${product}: ${context.raw.toFixed(1)} ton`
            }
          }
        },
        scales: {
          x: {
            min: SHIFT_START,
            max: SHIFT_END,
            grid: {
              display: true
            },
            ticks: {
              autoSkip: true,
              maxTicksLimit: 12
            }
          },
          y: {
            min: 0,
            max: PRODUCTS[product].yMax,
            ticks: {
              callback: value => `${value} t`
            },
            grid: {
              display: true
            }
          }
        }
      }
    });
  });

  updateVisibleCharts();
}

async function loadTrendByDate(date) {
  try {
    const response = await fetch(`/api/trend?date=${date}`);

    if (!response.ok) {
      throw new Error("No se pudo cargar la tendencia");
    }

    const data = await response.json();

    const history = Array.isArray(data)
      ? data
      : data.history || data.trend || [];

    historicalByDate[date] = history;

    renderChartsFromHistory(history);
    updateSummariesFromHistory(history);
  } catch (error) {
    console.error(error);

    historicalByDate[date] = [];

    renderChartsFromHistory([]);
    updateSummariesFromHistory([]);
  }
}

function renderChartsFromHistory(history) {
  const series = {
    "DL-5": [],
    "VE-03": [],
    "ASE": []
  };

  const labels = [];

  if (history && history.length) {
    history.forEach(point => {
      const time = point.time || point.hora || extractTime(point.timestamp);

      if (!time) return;

      labels.push(time);

      Object.keys(PRODUCTS).forEach(product => {
        let value = 0;

        if (point.products) {
          value = Number(point.products[product] || 0);
        } else if (point.totals) {
          value = Number(point.totals[product] || 0);
        } else if (point.silos) {
          value = calculateProductTotalFromPoint(point, product);
        }

        series[product].push(value);
      });
    });
  }

  Object.keys(PRODUCTS).forEach(product => {
    const chart = charts[product];

    if (!chart) return;

    chart.data.labels = labels;
    chart.data.datasets[0].data = series[product];
    chart.data.datasets[0].pointBackgroundColor = buildPointColors(series[product]);
    chart.data.datasets[0].pointStyle = buildPointStyles(series[product]);

    chart.update();
  });

  updateVisibleCharts();
}

function calculateProductTotalFromPoint(point, product) {
  let total = 0;

  for (let i = 1; i <= SILO_COUNT; i++) {
    const silo = point.silos[i] || point.silos[`silo${i}`];

    if (!silo) continue;

    const siloProduct = silo.product || productAssignments[i] || "DL-5";

    if (siloProduct !== product) continue;

    const tons = Number(silo.tons ?? silo.toneladas ?? 0);

    total += tons;
  }

  return total;
}

function buildPointColors(values) {
  return values.map((value, index) => {
    if (index === 0) return "#000000";

    const previous = values[index - 1];

    if (value > previous) return "#27ae60";
    if (value < previous) return "#e74c3c";

    return "#000000";
  });
}

function buildPointStyles(values) {
  return values.map((value, index) => {
    if (index === 0) return "circle";

    const previous = values[index - 1];

    if (value > previous) return "triangle";
    if (value < previous) return "rectRot";

    return "circle";
  });
}

function updateVisibleCharts() {
  Object.keys(PRODUCTS).forEach(product => {
    const safeId = normalizeProductId(product);
    const wrapper = document.getElementById(`chart-wrapper-${safeId}`);

    if (!wrapper) return;

    const hasProduct = hasAnySiloWithProduct(product);

    wrapper.style.display = hasProduct ? "" : "none";
  });
}

/* ==========================================================
   VARIACIONES DIARIAS
   ========================================================== */

function calculateDailyVariations(history) {
  const variations = {
    "DL-5": {
      positive: 0,
      negative: 0
    },
    "VE-03": {
      positive: 0,
      negative: 0
    },
    "ASE": {
      positive: 0,
      negative: 0
    }
  };

  if (!history || history.length < 2) {
    return variations;
  }

  const productSeries = {
    "DL-5": [],
    "VE-03": [],
    "ASE": []
  };

  history.forEach(point => {
    Object.keys(PRODUCTS).forEach(product => {
      let value = 0;

      if (point.products) {
        value = Number(point.products[product] || 0);
      } else if (point.totals) {
        value = Number(point.totals[product] || 0);
      } else if (point.silos) {
        value = calculateProductTotalFromPoint(point, product);
      }

      productSeries[product].push(value);
    });
  });

  Object.keys(PRODUCTS).forEach(product => {
    const values = productSeries[product];

    for (let i = 1; i < values.length; i++) {
      const diff = values[i] - values[i - 1];

      if (diff > 0) {
        variations[product].positive += diff;
      } else if (diff < 0) {
        variations[product].negative += Math.abs(diff);
      }
    }
  });

  return variations;
}

/* ==========================================================
   MODO DEMO
   ========================================================== */

function startDemoMode() {
  stopDemoMode();

  generateDemoData();

  demoTimer = setInterval(() => {
    generateDemoData();
  }, 4000);
}

function stopDemoMode() {
  if (demoTimer) {
    clearInterval(demoTimer);
    demoTimer = null;
  }
}

function generateDemoData() {
  const demoSilos = {};

  for (let i = 1; i <= SILO_COUNT; i++) {
    const current = latestSilos[i] || {};
    const currentDistance = Number(current.distance ?? randomBetween(0.8, 4.8));

    const variation = randomBetween(-0.15, 0.15);
    const distance = clamp(currentDistance + variation, 0.2, MAX_HEIGHT);

    demoSilos[i] = {
      distance
    };
  }

  latestSilos = demoSilos;

  updateSilos(latestSilos);
  updateAllSummariesFromCurrentState();
  updateMqttTime(new Date());

  const productTotals = calculateCurrentProductTotals();

  const point = {
    date: selectedDate,
    time: getCurrentTime(),
    products: productTotals
  };

  if (!historicalByDate[selectedDate]) {
    historicalByDate[selectedDate] = [];
  }

  historicalByDate[selectedDate].push(point);

  renderChartsFromHistory(historicalByDate[selectedDate]);
  updateSummariesFromHistory(historicalByDate[selectedDate]);
}

/* ==========================================================
   UTILIDADES
   ========================================================== */

function hasAnySiloWithProduct(product) {
  for (let i = 1; i <= SILO_COUNT; i++) {
    if ((productAssignments[i] || "DL-5") === product) {
      return true;
    }
  }

  return false;
}

function updateMqttTime(value) {
  const el = document.getElementById("mqttTime");

  if (!el) return;

  const date = value instanceof Date ? value : new Date(value);

  el.textContent = `Última actualización MQTT: ${date.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })}`;
}

function normalizeProductId(product) {
  return product
    .toLowerCase()
    .replaceAll("-", "")
    .replaceAll(" ", "");
}

function getTodayDate() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getCurrentTime() {
  const now = new Date();

  return now.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function extractTime(timestamp) {
  if (!timestamp) return "";

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString("es-CL", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
