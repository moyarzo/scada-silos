const socket = io();

// CONFIG
const CONE_HEIGHT = 1.67;
const CYL_HEIGHT = 4.25;
const MAX_HEIGHT = CONE_HEIGHT + CYL_HEIGHT;

// ✅ volumen corregido (m³)
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

// ESTADO
const tanks = {};
for (let i = 1; i <= 8; i++) {
  tanks["tanque" + i] = {
    levelMeters: 0,
    volume: 0,
    percent: 0,
    product: "DL-5"
  };
}

// FUNCIONES
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
    <path d="M10 50 A40 40 0 0 1 90 50" stroke="#ccc" stroke-width="8" fill="none"/>
    <path d="M10 50 A40 40 0 0 1 90 50"
      stroke="${color}" stroke-width="8" fill="none"
      stroke-dasharray="${c}" stroke-dashoffset="${c - p}"/>
  </svg>
  <div>${percent.toFixed(1)}%</div>
  `;
}

// RENDER
function render() {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";

  let totals = { "DL-5": 0, "VE-03": 0, "ASE": 0 };

  Object.keys(tanks).forEach(id => {

    const t = tanks[id];
    const product = PRODUCTS[t.product];

    totals[t.product] += calculateMassTon(t.volume, t.product);

    const percent = (t.levelMeters / MAX_HEIGHT) * 100;

    const div = document.createElement("div");
    div.className = "tank";

    div.innerHTML = `
      <h3>${formatName(id)}</h3>

      <div class="tank-wrapper">

        <div class="scale">
          <div>5.9</div><div>5</div><div>4</div><div>3</div>
          <div>2</div><div>1</div><div>0</div>
        </div>

        <div class="tank-container">
          <div class="tank-rect">
            <div class="liquid-rect"
              style="height:${(percent-30)}%; background:${product.color}">
            </div>
          </div>

          <div class="tank-cone">
            <div class="liquid-cone"
              style="border-top:${percent*0.6}px solid ${product.color}">
            </div>
          </div>
        </div>

        <div class="gauge-container">
          ${createGauge(percent, product.color)}
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
          `<option ${p===t.product?"selected":""}>${p}</option>`
        ).join("")}
      </select>
    `;

    grid.appendChild(div);
  });

  socket.emit("totals", totals);
}

// MQTT DATA
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
