const socket = io();

// ===== CONFIG =====
const CONE_HEIGHT = 1.67;
const CYL_HEIGHT = 4.25;
const MAX_HEIGHT = CONE_HEIGHT + CYL_HEIGHT;

// ✅ Volumen corregido (m³)
const V_TOTAL = 46.168;

const ratio = (1/3) * (CONE_HEIGHT / CYL_HEIGHT);
const V_CYL = V_TOTAL / (1 + ratio);
const V_CONE = V_TOTAL - V_CYL;

// ===== PRODUCTOS =====
const PRODUCTS = {
  "DL-5": { density: 1300, color: "#2563eb" },
  "VE-03": { density: 1370, color: "#16a34a" },
  "ASE": { density: 800, color: "#ea580c" }
};

let mode = "demo";
let turnData = {};

// ===== ESTADO =====
const tanks = {};
for (let i = 1; i <= 8; i++) {
  tanks["tanque" + i] = {
    levelMeters: 0,
    volume: 0,
    percent: 0,
    product: "DL-5"
  };
}

// ===== FUNCIONES =====

function formatName(id) {
  return "Silo " + id.replace("tanque", "");
}

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

function createGauge(percent, color) {
  const r = 40;
  const c = Math.PI * r;
  const p = (percent / 100) * c;

  return `
    <svg width="100" height="60">
      <path d="M10 50 A40 40 0 0 1 90 50"
        stroke="#ccc" stroke-width="8" fill="none"/>
      <path d="M10 50 A40 40 0 0 1 90 50"
        stroke="${color}" stroke-width="8" fill="none"
        stroke-dasharray="${c}"
        stroke-dashoffset="${c - p}">
      </path>
    </svg>
    <div class="gauge-value">${percent.toFixed(1)}%</div>
  `;
}

// ===== RESUMEN =====

function renderSummary() {
  let totals = { "DL-5": 0, "VE-03": 0, "ASE": 0 };

  Object.values(tanks).forEach(t => {
    totals[t.product] += calculateMassTon(t.volume, t.product);
  });

  const start = turnData.start || {};
  const end = turnData.end || {};

  document.getElementById("summary").innerHTML = `
    <div class="summary-card" style="background:#2563eb">
      DL-5<br>
      ${totals["DL-5"].toFixed(1)} t<br>
      08: ${start["DL-5"]?.toFixed(1) || "-"}<br>
      18: ${end["DL-5"]?.toFixed(1) || "-"}
    </div>

    <div class="summary-card" style="background:#16a34a">
      VE-03<br>
      ${totals["VE-03"].toFixed(1)} t<br>
      08: ${start["VE-03"]?.toFixed(1) || "-"}<br>
      18: ${end["VE-03"]?.toFixed(1) || "-"}
    </div>

    <div class="summary-card" style="background:#ea580c">
      ASE<br>
      ${totals["ASE"].toFixed(1)} t<br>
      08: ${start["ASE"]?.toFixed(1) || "-"}<br>
      18: ${end["ASE"]?.toFixed(1) || "-"}
    </div>
  `;
}

// ===== RENDER =====

function render() {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";

  let totals = { "DL-5": 0, "VE-03": 0, "ASE": 0 };

  Object.keys(tanks).forEach(id => {

    const t = tanks[id];
    const product = PRODUCTS[t.product];

    totals[t.product] += calculateMassTon(t.volume, t.product);

    let coneFill = 0;
    let rectFill = 0;

    if (t.levelMeters <= CONE_HEIGHT) {
      coneFill = (t.levelMeters / CONE_HEIGHT) * 60;
    } else {
      coneFill = 60;
      rectFill = ((t.levelMeters - CONE_HEIGHT) / CYL_HEIGHT) * 100;
    }

    const div = document.createElement("div");
    div.className = "tank";

    div.innerHTML = `
      <h3>${formatName(id)}</h3>

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
          ${createGauge(t.percent, product.color)}
        </div>

      </div>

      <div class="level-text">
        ${t.levelMeters.toFixed(2)} m<br>
        ${t.volume.toFixed(2)} m³<br>
        ${calculateMassTon(t.volume, t.product).toFixed(2)} ton<br>
        Densidad: ${product.density} kg/m³
      </div>

      <select class="product-select" data-id="${id}">
        ${Object.keys(PRODUCTS).map(p =>
          `<option value="${p}" ${p === t.product ? "selected" : ""}>${p}</option>`
        ).join("")}
      </select>
    `;

    grid.appendChild(div);
  });

  // selector producto
  document.querySelectorAll(".product-select").forEach(sel => {
    sel.addEventListener("change", e => {
      tanks[e.target.dataset.id].product = e.target.value;
      render();
    });
  });

  // enviar totales al backend
  socket.emit("totals", totals);

  // 🔥 render resumen (CLAVE)
  renderSummary();
}

// ===== MQTT (MODO REAL) =====

socket.on("nivel", data => {

  if (mode !== "real") return;

  if (!tanks[data.tanque]) return;

  const distance = parseFloat(data.nivel);

  const level = MAX_HEIGHT - distance;
  const percent = (level / MAX_HEIGHT) * 100;
  const volume = calculateVolume(level);

  tanks[data.tanque] = {
    ...tanks[data.tanque],
    levelMeters: level,
    percent,
    volume
  };

  render();
});

// ===== TURNOS =====

socket.on("turnData", data => {
  turnData = data;
  render();
});

socket.emit("getTurnData");

// ===== SIMULACIÓN =====

let levels = Array(8).fill(3);

setInterval(() => {

  if (mode !== "demo") return;

  levels = levels.map(l =>
    Math.max(0, Math.min(MAX_HEIGHT, l + (Math.random() - 0.5) * 0.3))
  );

  levels.forEach((lvl, i) => {
    const id = "tanque" + (i + 1);

    tanks[id] = {
      ...tanks[id],
      levelMeters: lvl,
      percent: (lvl / MAX_HEIGHT) * 100,
      volume: calculateVolume(lvl)
    };
  });

  render();

}, 1500);

// ===== SELECTOR MODO =====

document.querySelectorAll('input[name="mode"]').forEach(radio => {
  radio.addEventListener("change", e => {
    mode = e.target.value;
    console.log("Modo:", mode);
  });
});

// ===== INIT =====
render();
