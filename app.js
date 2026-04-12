const socket = io();

let mode = "demo";
let historyReal = { "DL-5": [], "VE-03": [], "ASE": [] };

const PRODUCTS = {
  "DL-5": { color: "#2563eb" },
  "VE-03": { color: "#16a34a" },
  "ASE": { color: "#ea580c" }
};

// ---------- BOTONES ----------
document.getElementById("exportBtn").onclick = () => {
  window.location.href = "/export-data";
};

document.getElementById("exportTrendBtn").onclick = () => {
  window.location.href = "/export-trend";
};

// ---------- GRAFICO RANGO FIJO ----------
function getFixedLabels() {
  const labels = [];
  for (let h = 7; h <= 19; h++) {
    for (let m = 0; m < 60; m += 5) {
      if (h === 19 && m > 0) break;
      labels.push(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`);
    }
  }
  return labels;
}

const FIXED_LABELS = getFixedLabels();

function buildSeries(history) {
  const map = {};
  history.forEach(h => map[h.time] = h.value);

  return FIXED_LABELS.map(t => map[t] ?? null);
}

// ---------- GRAFICOS ----------
let charts = {};

function initCharts() {
  ["DL-5","VE-03","ASE"].forEach(p => {
    const ctx = document.createElement("canvas");
    document.getElementById("topPanel").appendChild(ctx);

    charts[p] = new Chart(ctx, {
      type: "line",
      data: {
        labels: FIXED_LABELS,
        datasets: [{
          data: [],
          borderColor: "black",
          backgroundColor: PRODUCTS[p].color + "22",
          fill: true
        }]
      }
    });
  });
}

function updateCharts() {
  Object.keys(charts).forEach(p => {
    charts[p].data.datasets[0].data = buildSeries(historyReal[p]);
    charts[p].update();
  });
}

// ---------- SOCKET ----------
socket.on("historyData", (data) => {
  historyReal = data;
  updateCharts();
});

socket.emit("getHistoryData");

initCharts();
