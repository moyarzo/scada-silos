const socket = io();

// CONFIG
const CONE_HEIGHT = 1.67;
const CYL_HEIGHT = 4.25;
const MAX_HEIGHT = CONE_HEIGHT + CYL_HEIGHT;

const V_TOTAL = 46168;

const ratio = (1/3) * (CONE_HEIGHT / CYL_HEIGHT);
const V_CYL = V_TOTAL / (1 + ratio);
const V_CONE = V_TOTAL - V_CYL;

let mode = "demo";

// Estado
const tanks = {};
for (let i = 1; i <= 8; i++) {
  tanks["tanque" + i] = {
    percent: 0,
    levelMeters: 0,
    volume: 0
  };
}

// Funciones
function formatName(id) {
  return "Silo " + id.replace("tanque", "");
}

function distanceToLevel(distance) {
  let level = MAX_HEIGHT - distance;
  return Math.max(0, Math.min(MAX_HEIGHT, level));
}

function calculateVolume(levelMeters) {
  if (levelMeters <= CONE_HEIGHT) {
    return V_CONE * Math.pow(levelMeters / CONE_HEIGHT, 3);
  } else {
    const h = levelMeters - CONE_HEIGHT;
    return V_CONE + V_CYL * (h / CYL_HEIGHT);
  }
}

function createGauge(percent) {
  const radius = 40;
  const circumference = Math.PI * radius;
  const progress = (percent / 100) * circumference;

  return `
    <svg width="100" height="60">
      <path d="M10 50 A40 40 0 0 1 90 50"
            stroke="#1f2937"
            stroke-width="8"
            fill="none"/>

      <path d="M10 50 A40 40 0 0 1 90 50"
            stroke="#22c55e"
            stroke-width="8"
            fill="none"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${circumference - progress}">
      </path>
    </svg>

    <div class="gauge-value">${percent.toFixed(1)}%</div>
  `;
}

// Render
function render() {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";

  Object.keys(tanks).forEach(id => {

    const t = tanks[id];

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
                 style="height:${rectFill}%"></div>
          </div>

          <div class="tank-cone">
            <div class="liquid-cone"
                 style="border-top:${coneFill}px solid #3b82f6"></div>
          </div>
        </div>

        <div class="gauge-container">
          ${createGauge(t.percent)}
        </div>

      </div>

      <div class="level-text">
        <div class="value">${t.levelMeters.toFixed(2)} m</div>
        <div class="value">${t.volume.toFixed(0)} m³</div>
      </div>
    `;

    grid.appendChild(div);
  });
}

// MQTT
socket.on("nivel", data => {

  if (mode !== "real") return;

  if (tanks[data.tanque]) {

    const distance = parseFloat(data.nivel);

    const level = distanceToLevel(distance);
    const percent = (level / MAX_HEIGHT) * 100;
    const volume = calculateVolume(level);

    tanks[data.tanque] = {
      levelMeters: level,
      percent,
      volume
    };

    render();
  }
});

// Simulación
let simulatedLevels = Array(8).fill(3);

setInterval(() => {

  if (mode !== "demo") return;

  simulatedLevels = simulatedLevels.map(l => {
    let change = (Math.random() - 0.5) * 0.3;
    let newLevel = l + change;
    return Math.max(0, Math.min(MAX_HEIGHT, newLevel));
  });

  simulatedLevels.forEach((lvl, i) => {

    const percent = (lvl / MAX_HEIGHT) * 100;
    const volume = calculateVolume(lvl);

    tanks["tanque" + (i + 1)] = {
      levelMeters: lvl,
      percent,
      volume
    };

  });

  render();

}, 1500);

// Selector modo
document.querySelectorAll('input[name="mode"]').forEach(radio => {
  radio.addEventListener("change", e => {
    mode = e.target.value;
    console.log("Modo:", mode);
  });
});

render();