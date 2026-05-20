/* ──────────────────────────────────────────────────────────
   Ground Control Station — Vanilla JS
   No React, no build tools. Just HTML + CSS + JS.
   ────────────────────────────────────────────────────────── */

/* ============ STATE ============ */
const State = {
  user: null,              // {username, role, token} or null
  conn: "connected",       // connected | reconnecting | lost
  robot: {
    x: 0, y: 0, battery: 87.5, status: "IDLE",
    heading: "N", trail: [[0, 0]],
    prox: { N: 5, S: 5, E: 5, W: 5 }
  },
  obstacles: [],
  obstacleSet: new Set(),
  pendingMove: null,
  log: [],
  toasts: [],
  tweaks: {
    obstacleSeed: 7,
    accentHue: 215,
    gridTheme: {
      gridBg: "#0d1428",
      gridLine: "#1f2b4d",
      obstacle: "#2a1a30",
      robot: "#4dabf7"
    }
  }
};

/* ============ API CONFIG ============ */
const API_BASE = "";  // Empty = same origin (Nginx proxies /api/ to backend)
let _pollTimer = null;

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (State.user && State.user.token) {
    headers["Authorization"] = "Bearer " + State.user.token;
  }
  const res = await fetch(API_BASE + path, { ...opts, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw { status: res.status, detail: err.detail || res.statusText };
  }
  return res.json();
}

function startPolling() {
  stopPolling();
  async function poll() {
    if (!State.user) return;
    try {
      const data = await api("/api/status");
      if (data && !data.error) {
        const pos = data.position || {};
        State.robot.x = pos.x ?? State.robot.x;
        State.robot.y = pos.y ?? State.robot.y;
        State.robot.battery = data.battery ?? State.robot.battery;
        State.robot.status = data.status ?? State.robot.status;
        if (State.conn !== "connected") setConn("connected");
        updateBatteryDerivedState();
        computeProximity();
        renderProximity();
        renderStatusPanel();
        renderBanners();
        drawGrid();
      } else if (data && data.error) {
        setConn("reconnecting");
      }
    } catch (e) {
      if (e.status === 401) { handleLogout(); return; }
      setConn("lost");
    }
  }
  poll();
  _pollTimer = setInterval(poll, 3000);
}

function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

/* ============ HELPERS ============ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function fmtTime(d = new Date()) {
  return d.toLocaleTimeString("en-GB", { hour12: false });
}
function fmtClock(d = new Date()) {
  return d.toLocaleTimeString("en-GB", { hour12: false }) + " UTC";
}

function makeObstacles(seed = 1) {
  const rnd = (n) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % n;
  };
  const set = new Set();
  while (set.size < 40) {
    const x = rnd(21);
    const y = rnd(21);
    if (x === 0 && y === 0) continue;
    set.add(`${x},${y}`);
  }
  return [...set].map((s) => s.split(",").map(Number));
}

function regenObstacles() {
  State.obstacles = makeObstacles(State.tweaks.obstacleSeed);
  State.obstacleSet = new Set(State.obstacles.map(([a, b]) => `${a},${b}`));
}

function computeProximity() {
  const { x, y } = State.robot;
  const obs = State.obstacleSet;
  const prox = { N: 5, S: 5, E: 5, W: 5 };
  for (let d = 1; d <= 5; d++) {
    if (prox.N === 5 && (y + d > 20 || obs.has(`${x},${y + d}`))) prox.N = d - 1;
    if (prox.S === 5 && (y - d < 0 || obs.has(`${x},${y - d}`))) prox.S = d - 1;
    if (prox.E === 5 && (x + d > 20 || obs.has(`${x + d},${y}`))) prox.E = d - 1;
    if (prox.W === 5 && (x - d < 0 || obs.has(`${x - d},${y}`))) prox.W = d - 1;
  }
  State.robot.prox = prox;
}

function audit(cmd, params, result) {
  State.log.unshift({
    time: fmtTime(),
    user: State.user ? State.user.username : "system",
    cmd, params, result
  });
  State.log = State.log.slice(0, 200);
  renderAuditLog();
}

function pushToast(level, title, body) {
  const id = Math.random().toString(36).slice(2);
  State.toasts.push({ id, level, title, body });
  renderToasts();
  setTimeout(() => {
    State.toasts = State.toasts.filter((t) => t.id !== id);
    renderToasts();
  }, 4500);
}

/* ============ LOGIN ============ */
function renderLogin() {
  const root = $("#root");
  root.innerHTML = `
    <div class="login-shell" data-screen-label="01 Login">
      <aside class="login-side">
        <div class="login-brand">
          <div class="gcs-brand-mark" aria-hidden="true">G</div>
          <div>
            <div class="gcs-title">Ground Control Station</div>
            <div class="gcs-subtitle">v1.0 · TURTLEBOT FLEET</div>
          </div>
        </div>

        <div class="login-tagline">
          <h1>Command and observe<br/>your robot fleet.</h1>
          <p>Real-time telemetry, mission audit, and emergency-stop authority
          for ground operations. Authenticate with your role to continue.</p>
        </div>

        <div>
          <div class="login-meta">
            <div class="item">Channel<b>secure / tls 1.3</b></div>
            <div class="item">Region<b>fra-01</b></div>
            <div class="item">Latency<b>34 ms</b></div>
          </div>

          <div class="telemetry-ticker" aria-hidden="true">
            <div class="line">[ 04:21:08 ] handshake.ok <span class="ok">200</span> · robot.fleet=1 · obstacles=40</div>
            <div class="line">[ 04:21:11 ] telemetry.subscribe topic=/status interval=3s <span class="ok">ok</span></div>
            <div class="line">[ 04:21:14 ] auth.required role=<span class="warn">?</span> awaiting credentials…</div>
          </div>
        </div>
      </aside>

      <main class="login-form-wrap">
        <form class="login-form" id="loginForm" novalidate>
          <h2 id="loginTitle">Sign in to console</h2>
          <p class="sub" id="loginSub">Use your operator credentials. Password must be at least 8 characters.</p>

          <div class="login-err" id="loginErr" role="alert" style="display:none;"></div>

          <div class="form-group">
            <label for="username">Operator ID</label>
            <input id="username" type="text" autocomplete="username" placeholder="e.g. cmdr.lee" aria-label="Operator ID" />
          </div>

          <div class="form-group">
            <label for="password">Passphrase</label>
            <input id="password" type="password" autocomplete="current-password" placeholder="••••••••" aria-label="Passphrase" />
          </div>

          <div class="form-group">
            <label>Operator role</label>
            <div class="role-toggle" role="radiogroup" aria-label="Select role">
              <button type="button" class="active" data-role="Commander" role="radio" aria-checked="true" aria-label="Commander role">
                <span class="name">Commander</span>
                <span class="desc">Move + emergency stop</span>
              </button>
              <button type="button" data-role="Viewer" role="radio" aria-checked="false" aria-label="Viewer role">
                <span class="name">Viewer</span>
                <span class="desc">Read-only telemetry</span>
              </button>
            </div>
          </div>

          <button type="submit" class="btn-gcs btn-block btn-lg" id="submitBtn">Authenticate →</button>

          <div class="login-foot">
            <span>
              <span id="switchLabel">New operator? </span>
              <a href="#" id="switchMode">Register here</a>
            </span>
            <span>Build · 2026.05</span>
          </div>
        </form>
      </main>
    </div>
  `;

  let mode = "login";
  let role = "Commander";

  // Role toggle
  $$(".role-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => {
      role = btn.dataset.role;
      $$(".role-toggle button").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-checked", b === btn ? "true" : "false");
      });
    });
  });

  // Switch login/register
  $("#switchMode").addEventListener("click", (e) => {
    e.preventDefault();
    mode = mode === "login" ? "register" : "login";
    $("#loginTitle").textContent = mode === "login" ? "Sign in to console" : "Create operator account";
    $("#loginSub").textContent = mode === "login"
      ? "Use your operator credentials. Password must be at least 8 characters."
      : "Register a new operator. Password must be at least 8 characters.";
    $("#submitBtn").textContent = mode === "login" ? "Authenticate →" : "Create account →";
    $("#switchLabel").textContent = mode === "login" ? "New operator? " : "Already registered? ";
    $("#switchMode").textContent = mode === "login" ? "Register here" : "Back to sign in";
    $("#loginErr").style.display = "none";
  });

  // Submit — real API auth
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const u = $("#username").value.trim();
    const p = $("#password").value.trim();
    const errEl = $("#loginErr");
    const btn = $("#submitBtn");
    if (!u || !p) {
      errEl.textContent = "Username and password are required.";
      errEl.style.display = "block";
      return;
    }
    if (mode === "register" && p.length < 8) {
      errEl.textContent = "Password must be at least 8 characters.";
      errEl.style.display = "block";
      return;
    }
    btn.disabled = true;
    btn.textContent = mode === "login" ? "Authenticating…" : "Creating account…";
    errEl.style.display = "none";

    try {
      if (mode === "register") {
        await api("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ username: u, password: p }),
        });
        pushToast("ok", "Account Created", "Now log in with your credentials.");
        // Auto-switch to login mode after successful registration
        mode = "login";
        $("#loginTitle").textContent = "Sign in to console";
        $("#submitBtn").textContent = "Authenticate →";
        $("#switchLabel").textContent = "New operator? ";
        $("#switchMode").textContent = "Register here";
        btn.disabled = false;
        return;
      }
      // Login
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: u, password: p }),
      });
      localStorage.setItem("gcs_token", data.access_token);
      localStorage.setItem("gcs_user", data.username);
      localStorage.setItem("gcs_role", data.role);
      State.user = { username: data.username, role: data.role, token: data.access_token };
      renderDashboard();
      startPolling();
    } catch (err) {
      errEl.textContent = err.detail || "Authentication failed.";
      errEl.style.display = "block";
    } finally {
      btn.disabled = false;
      btn.textContent = mode === "login" ? "Authenticate →" : "Create account →";
    }
  });
}

/* ============ DASHBOARD ============ */
function renderDashboard() {
  regenObstacles();
  computeProximity();
  State.log = [
    { time: fmtTime(), user: "system", cmd: "BOOT", params: "—", result: "OK" },
    { time: fmtTime(), user: State.user.username, cmd: "AUTH", params: `role=${State.user.role}`, result: "OK" }
  ];

  const isCommander = State.user.role === "Commander";
  const root = $("#root");
  root.innerHTML = `
    <div class="app-shell" data-screen-label="02 Dashboard">
      <header class="gcs-header">
        <div class="gcs-brand">
          <div class="gcs-brand-mark" aria-hidden="true">G</div>
          <div>
            <div class="gcs-title">Ground Control Station</div>
            <div class="gcs-subtitle">Robot #01 · TURTLEBOT-A</div>
          </div>
        </div>
        <div class="header-spacer"></div>
        <div class="header-clock mono" id="clock" aria-label="System clock"></div>
        <div class="conn-pill" id="connPill" role="status" aria-live="polite">
          <span class="conn-dot" id="connDot"></span>
          <span id="connLabel">Connected</span>
        </div>
        <div class="role-badge ${State.user.role.toLowerCase()}" aria-label="Role ${State.user.role}">
          <span aria-hidden="true">●</span> ${State.user.role}
        </div>
        <button class="btn-gcs btn-ghost" id="logoutBtn" aria-label="Logout">Logout</button>
      </header>

      <div class="banner-stack" id="bannerStack"></div>

      <div class="dash">
        <!-- LEFT COLUMN -->
        <div class="dash-left">
          <!-- Robot status panel -->
          <section class="panel" aria-labelledby="status-title">
            <h3 class="panel-title" id="status-title"><span class="dot"></span> Robot Status</h3>

            <div class="status-row">
              <span class="status-label">Battery</span>
              <span class="status-value big" id="batteryVal">—</span>
            </div>
            <div class="battery-wrap" id="batteryWrap" role="progressbar" aria-valuemin="0" aria-valuemax="100">
              <div class="battery-bar">
                <div class="battery-fill" id="batteryFill"></div>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px;">
              <div>
                <div class="status-label">Position</div>
                <div class="status-value mono" id="posVal">x: 00 · y: 00</div>
              </div>
              <div>
                <div class="status-label">Heading</div>
                <div class="status-value mono" id="headingVal">N</div>
              </div>
            </div>

            <div style="margin-top:14px;">
              <div class="status-label" style="margin-bottom:6px;">State</div>
              <span class="status-badge idle" id="stateBadge">
                <span class="dot" aria-hidden="true"></span> <span id="stateText">IDLE</span>
              </span>
            </div>
          </section>

          <!-- Move controls / Viewer info -->
          ${isCommander ? `
          <section class="panel" aria-labelledby="ctrl-title">
            <h3 class="panel-title" id="ctrl-title"><span class="dot"></span> Move Controls</h3>

            <div class="coord-grid">
              <div class="coord-input">
                <label for="targetX">Target X</label>
                <input id="targetX" type="number" min="0" max="20" step="1" value="0" aria-label="Target X coordinate, 0 to 20" />
              </div>
              <div class="coord-input">
                <label for="targetY">Target Y</label>
                <input id="targetY" type="number" min="0" max="20" step="1" value="0" aria-label="Target Y coordinate, 0 to 20" />
              </div>
            </div>

            <div style="display:grid;gap:8px;">
              <button class="btn-gcs btn-lg btn-block" id="dispatchBtn" aria-label="Dispatch move command">▶ Dispatch Move</button>
              <button class="btn-gcs btn-emergency btn-block" id="estopBtn" aria-label="Emergency stop">⬛ Emergency Stop</button>
            </div>

            <div class="proximity">
              <div class="status-label" style="text-align:center;">Proximity Sensors (0–5)</div>
              <div class="proximity-grid" id="proxGrid"></div>
            </div>
          </section>
          ` : `
          <section class="panel" aria-labelledby="ro-title">
            <h3 class="panel-title" id="ro-title"><span class="dot"></span> Viewer Mode</h3>
            <p style="font-size:13px;color:var(--text-dim);line-height:1.5;margin:0;">
              You have <b style="color:var(--text)">read-only</b> access. Move dispatch
              and emergency-stop controls are restricted to operators with the
              <span style="color:var(--warning)"> Commander </span> role.
            </p>
            <div class="proximity">
              <div class="status-label" style="text-align:center;">Proximity Sensors</div>
              <div class="proximity-grid" id="proxGrid"></div>
            </div>
          </section>
          `}
        </div>

        <!-- CENTER GRID MAP -->
        <div class="dash-center">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <h3 class="panel-title" style="margin:0;"><span class="dot"></span> 2D Grid Map · 21×21</h3>
            <div class="mono" style="font-size:11px;color:var(--text-dim);letter-spacing:0.1em;" id="gridMeta">
              OBSTACLES: 40 · SCALE: 1m / CELL
            </div>
          </div>
          <div class="canvas-wrap" id="canvasWrap">
            <canvas id="gridCanvas" aria-label="2D grid map" role="img"></canvas>
            <div class="stuck-overlay" id="stuckOverlay" aria-hidden="true" style="display:none;">
              <div class="label">⚠ ROBOT STUCK · OBSTACLE</div>
            </div>
          </div>
          <div class="grid-legend" aria-hidden="true">
            <span class="legend-swatch"><i style="background:#4dabf7"></i> Robot</span>
            <span class="legend-swatch"><i style="background:#00b894"></i> Charging Station</span>
            <span class="legend-swatch"><i style="background:#2a1a30;border:1px solid rgba(233,69,96,0.4)"></i> Obstacle</span>
            <span class="legend-swatch"><i style="background:rgba(77,171,247,0.35)"></i> Path</span>
          </div>
        </div>

        <!-- BOTTOM AUDIT LOG -->
        <div class="dash-bottom log-wrap">
          <div class="log-head">
            <h3 class="panel-title" style="margin:0;"><span class="dot"></span> Mission Audit Log · <span id="logCount">0</span> entries</h3>
            <button class="btn-gcs btn-ghost" id="exportBtn" aria-label="Export audit log to CSV">⤓ Export CSV</button>
          </div>
          <div class="log-scroll">
            <table class="log-table" aria-label="Mission audit log">
              <thead>
                <tr>
                  <th style="width:110px;">Time</th>
                  <th style="width:140px;">User</th>
                  <th style="width:120px;">Command</th>
                  <th>Parameters</th>
                  <th style="width:90px;">Result</th>
                </tr>
              </thead>
              <tbody id="logBody"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <div class="toast-stack" id="toastStack" aria-live="polite"></div>
    <div id="dlgRoot"></div>
  `;

  // Wire up
  $("#logoutBtn").addEventListener("click", handleLogout);
  if (isCommander) {
    $("#dispatchBtn").addEventListener("click", requestMove);
    $("#estopBtn").addEventListener("click", emergencyStop);
  }
  $("#exportBtn").addEventListener("click", exportCSV);

  // Initial paint
  renderProximity();
  renderStatusPanel();
  renderAuditLog();
  renderBanners();
  drawGrid();
  tickClock();
}

/* ============ STATUS PANEL ============ */
function renderStatusPanel() {
  const r = State.robot;
  const bat = Math.max(0, Math.min(100, r.battery));
  const batClass = bat < 20 ? "low" : bat < 50 ? "mid" : "";
  const batColor = bat < 20 ? "var(--danger)" : bat < 50 ? "var(--warning)" : "var(--success)";

  const bv = $("#batteryVal");
  if (bv) {
    bv.textContent = `${bat.toFixed(1)}%`;
    bv.style.color = batColor;
  }
  const bw = $("#batteryWrap");
  if (bw) bw.setAttribute("aria-valuenow", Math.round(bat));
  const bf = $("#batteryFill");
  if (bf) {
    bf.className = `battery-fill ${batClass}`;
    bf.style.width = `${bat}%`;
  }

  const pv = $("#posVal");
  if (pv) pv.textContent = `x: ${String(r.x).padStart(2, "0")} · y: ${String(r.y).padStart(2, "0")}`;
  const hv = $("#headingVal");
  if (hv) hv.textContent = r.heading;

  const sb = $("#stateBadge");
  if (sb) {
    sb.className = `status-badge ${r.status.toLowerCase()}`;
    $("#stateText").textContent = r.status.replace("_", " ");
  }

  // Disable dispatch button based on state
  const dispatchBtn = $("#dispatchBtn");
  if (dispatchBtn) {
    const disabled = bat <= 0 || r.status === "MOVING" || r.status === "STUCK" || State.conn !== "connected";
    dispatchBtn.disabled = disabled;
  }
  const estopBtn = $("#estopBtn");
  if (estopBtn) {
    estopBtn.disabled = State.conn !== "connected";
  }
}

/* ============ PROXIMITY ============ */
function renderProximity() {
  const grid = $("#proxGrid");
  if (!grid) return;
  const p = State.robot.prox;
  const cell = (dir, val) => `
    <div class="prox-cell ${val <= 1 ? "close" : ""}">
      <div class="dir">${dir}</div><div class="val">${val}</div>
    </div>
  `;
  grid.innerHTML = `
    <div></div>${cell("N", p.N)}<div></div>
    ${cell("W", p.W)}<div class="prox-cell center">BOT</div>${cell("E", p.E)}
    <div></div>${cell("S", p.S)}<div></div>
  `;
}

/* ============ AUDIT LOG ============ */
function renderAuditLog() {
  const body = $("#logBody");
  if (!body) return;
  $("#logCount").textContent = State.log.length;
  if (State.log.length === 0) {
    body.innerHTML = `<tr><td colspan="5" style="color:var(--text-dim);text-align:center;">No entries yet.</td></tr>`;
    return;
  }
  body.innerHTML = State.log.map((row) => `
    <tr>
      <td>${row.time}</td>
      <td>${row.user}</td>
      <td><b>${row.cmd}</b></td>
      <td>${row.params}</td>
      <td class="${row.result === "OK" ? "result-ok" : "result-fail"}">${row.result}</td>
    </tr>
  `).join("");
}

/* ============ BANNERS ============ */
function renderBanners() {
  const stack = $("#bannerStack");
  if (!stack) return;
  const r = State.robot;
  const bat = Math.max(0, Math.min(100, r.battery));
  const isDead = bat <= 0;
  const isLow = bat < 20 && !isDead;
  const banners = [];

  if (State.conn === "lost") {
    banners.push({ cls: "danger", icon: "◉", title: "Signal Lost", msg: "Last known telemetry shown. Manual commands disabled." });
  }
  if (State.conn === "reconnecting") {
    banners.push({ cls: "warn", icon: "◌", title: "Reconnecting", msg: "Attempting to re-establish telemetry link…", pulse: true });
  }
  if (r.status === "STUCK") {
    banners.push({ cls: "danger", icon: "⚠", title: "Robot Stuck", msg: "Obstacle blocking path. Issue Emergency Stop or change target." });
  }
  if (isDead) {
    banners.push({ cls: "danger", icon: "✕", title: "Battery Empty", msg: "Return to charging station required. Move dispatch disabled." });
  }
  if (isLow) {
    banners.push({ cls: "warn", icon: "▲", title: "Low Battery", msg: `${bat.toFixed(1)}% remaining. Plan a return to (0,0) soon.` });
  }

  stack.innerHTML = banners.map((b) => `
    <div class="signal-banner ${b.cls}" role="alert">
      <span class="icon ${b.pulse ? "pulse" : ""}">${b.icon}</span>
      <span><b>${b.title}</b> · ${b.msg}</span>
    </div>
  `).join("");
}

/* ============ TOASTS ============ */
function renderToasts() {
  const stack = $("#toastStack");
  if (!stack) return;
  stack.innerHTML = State.toasts.map((t) => `
    <div class="toast-item ${t.level}" role="status">
      <div>
        <div class="title">${t.title}</div>
        <div class="body">${t.body}</div>
      </div>
    </div>
  `).join("");
}

/* ============ CLOCK ============ */
function tickClock() {
  const el = $("#clock");
  if (!el) return;
  el.textContent = fmtClock();
}
setInterval(tickClock, 1000);

/* ============ CONNECTION ============ */
function setConn(state) {
  State.conn = state;
  const dot = $("#connDot");
  const label = $("#connLabel");
  if (dot) {
    dot.className = `conn-dot ${state}`;
  }
  if (label) {
    label.textContent =
      state === "connected" ? "Connected" :
      state === "reconnecting" ? "Reconnecting…" :
      "Signal Lost";
  }
  renderBanners();
  renderStatusPanel();
}

/* ============ TELEMETRY POLLING (mock /api/status every 3s) ============ */
setInterval(() => {
  if (!State.user) return;
  // Simulate occasional link issues
  const r = Math.random();
  if (State.conn === "connected" && r < 0.03) {
    setConn("reconnecting");
    pushToast("warn", "Link Degraded", "Attempting to reconnect…");
    setTimeout(() => {
      if (Math.random() < 0.7) {
        setConn("connected");
        pushToast("success", "Link Restored", "Telemetry resumed.");
      } else {
        setConn("lost");
        pushToast("danger", "Signal Lost", "No telemetry from robot.");
      }
    }, 2400);
    return;
  }
  if (State.conn !== "connected") return;
  // Auto-charge at (0,0) when idle
  if (State.robot.status === "IDLE" && State.robot.x === 0 && State.robot.y === 0 && State.robot.battery < 100) {
    State.robot.battery = Math.min(100, State.robot.battery + 1.5);
    updateBatteryDerivedState();
    renderStatusPanel();
    renderBanners();
  }
}, 3000);

function updateBatteryDerivedState() {
  const R = State.robot;
  if (R.status === "STUCK") return;
  if (R.battery <= 0) { R.status = "LOW_BATTERY"; return; }
  if (R.battery < 20 && R.status === "IDLE") { R.status = "LOW_BATTERY"; return; }
  if (R.battery >= 20 && R.status === "LOW_BATTERY") { R.status = "IDLE"; return; }
}

/* ============ MOVEMENT ============ */
function requestMove() {
  if (!State.user || State.user.role !== "Commander") return;
  const x = parseInt($("#targetX").value, 10);
  const y = parseInt($("#targetY").value, 10);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 20 || y < 0 || y > 20) {
    pushToast("warn", "Invalid Target", "X and Y must be integers in [0, 20].");
    return;
  }
  if (State.robot.battery <= 0) {
    pushToast("danger", "Battery Empty", "Cannot dispatch — return to charging station required.");
    return;
  }
  State.pendingMove = { x, y };
  showConfirmDialog();
}

function showConfirmDialog() {
  const r = State.robot;
  const m = State.pendingMove;
  $("#dlgRoot").innerHTML = `
    <div class="dlg-backdrop" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <div class="dlg">
        <h3 id="dlg-title">▲ Confirm Dispatch</h3>
        <p>Robot will move from <b>(${r.x},${r.y})</b> toward the target. Battery will drain 0.5% per step.</p>
        <div class="coord-readout mono">
          (${r.x},${r.y}) <span style="color:var(--text-dim)">→</span> (${m.x},${m.y})
        </div>
        <div class="actions">
          <button class="btn-gcs btn-ghost" id="cancelMove">Cancel</button>
          <button class="btn-gcs" id="confirmMove">Confirm Dispatch</button>
        </div>
      </div>
    </div>
  `;
  $("#cancelMove").addEventListener("click", closeDialog);
  $("#confirmMove").addEventListener("click", confirmMove);
}

function closeDialog() {
  $("#dlgRoot").innerHTML = "";
  State.pendingMove = null;
}

function confirmMove() {
  const target = State.pendingMove;
  closeDialog();
  if (!target) return;
  State.robot.status = "MOVING";
  renderStatusPanel();
  renderBanners();

  // Call real backend API
  api(`/api/move?x=${target.x}&y=${target.y}`, { method: "POST" })
    .then((data) => {
      if (data && data.error) {
        pushToast("danger", "Move Failed", data.error);
        audit("MOVE", `to (${target.x},${target.y})`, "FAIL");
        State.robot.status = "IDLE";
        renderStatusPanel();
      }
      // Polling will pick up the new position from the robot API
    })
    .catch((err) => {
      if (err.status === 403) {
        pushToast("danger", "Forbidden", "Commander role required.");
      } else {
        pushToast("danger", "Move Failed", err.detail || "Network error");
      }
      audit("MOVE", `to (${target.x},${target.y})`, "FAIL");
      State.robot.status = "IDLE";
      renderStatusPanel();
    });

  // Also run the client-side animation for visual feedback
  stepTo(target.x, target.y);
}

function stepTo(tx, ty) {
  const obs = State.obstacleSet;
  let cur = { x: State.robot.x, y: State.robot.y };
  const path = [];
  while (cur.x !== tx || cur.y !== ty) {
    const next = { ...cur };
    if (cur.x !== tx) next.x += Math.sign(tx - cur.x);
    else next.y += Math.sign(ty - cur.y);
    if (obs.has(`${next.x},${next.y}`)) {
      path.push({ x: cur.x, y: cur.y, stuck: true });
      break;
    }
    cur = next;
    path.push({ ...cur });
  }

  let i = 0;
  const interval = setInterval(() => {
    if (i >= path.length) {
      clearInterval(interval);
      const last = path[path.length - 1];
      if (last && last.stuck) {
        State.robot.status = "STUCK";
        pushToast("danger", "Robot Stuck", `Obstacle detected blocking path to (${tx},${ty}).`);
        audit("MOVE", `to (${tx},${ty})`, "STUCK");
      } else {
        State.robot.status = State.robot.battery < 20 ? "LOW_BATTERY" : "IDLE";
        State.robot.x = tx;
        State.robot.y = ty;
        audit("MOVE", `to (${tx},${ty})`, "OK");
      }
      computeProximity();
      renderProximity();
      renderStatusPanel();
      renderBanners();
      drawGrid();
      return;
    }
    const p = path[i++];
    const prev = State.robot.trail[State.robot.trail.length - 1] || [State.robot.x, State.robot.y];
    const dx = p.x - prev[0], dy = p.y - prev[1];
    State.robot.heading = dy > 0 ? "N" : dy < 0 ? "S" : dx > 0 ? "E" : "W";
    State.robot.x = p.x;
    State.robot.y = p.y;
    State.robot.battery = Math.max(0, State.robot.battery - 0.5);
    State.robot.trail = [...State.robot.trail.slice(-20), [p.x, p.y]];
    updateBatteryDerivedState();
    computeProximity();
    renderProximity();
    renderStatusPanel();
    renderBanners();
    drawGrid();
  }, 350);
}

function emergencyStop() {
  State.robot.status = "IDLE";
  pushToast("danger", "Emergency Stop", "All commands halted. Robot held in place.");
  audit("E-STOP", "—", "OK");
  renderStatusPanel();
  renderBanners();
  drawGrid();
}

/* ============ CSV EXPORT ============ */
function exportCSV() {
  const rows = [["Time", "User", "Command", "Parameters", "Result"],
    ...State.log.map((r) => [r.time, r.user, r.cmd, r.params, r.result])];
  const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-log-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  audit("EXPORT_CSV", `${State.log.length} rows`, "OK");
}

/* ============ GRID CANVAS ============ */
function drawGrid() {
  const canvas = $("#gridCanvas");
  const wrap = $("#canvasWrap");
  if (!canvas || !wrap) return;

  const size = Math.min(wrap.clientWidth, wrap.clientHeight);
  const dpr = window.devicePixelRatio || 1;
  const px = Math.floor(size);
  canvas.width = px * dpr;
  canvas.height = px * dpr;
  canvas.style.width = px + "px";
  canvas.style.height = px + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;

  const theme = State.tweaks.gridTheme;
  const pad = 26;
  const usable = px - pad * 2;
  const N = 21;
  const cell = usable / N;

  // background
  ctx.fillStyle = theme.gridBg;
  ctx.fillRect(0, 0, px, px);

  // axis labels
  ctx.fillStyle = "#8a96a3";
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < N; i++) {
    if (i % 2 === 0) {
      ctx.fillText(i, pad + cell * i + cell / 2, pad / 2);
      ctx.fillText(i, pad / 2, pad + cell * (N - 1 - i) + cell / 2);
    }
  }

  // arrows
  ctx.fillStyle = "#dfe6e9";
  ctx.font = "bold 10px 'JetBrains Mono', monospace";
  ctx.fillText("X →", px - pad / 2 + 4, pad / 2);
  ctx.save();
  ctx.translate(pad / 2, pad - 6);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Y →", -pad / 2, 0);
  ctx.restore();

  // grid lines
  ctx.strokeStyle = theme.gridLine;
  ctx.lineWidth = 1;
  for (let i = 0; i <= N; i++) {
    const x = pad + i * cell;
    const y = pad + i * cell;
    ctx.beginPath(); ctx.moveTo(x, pad); ctx.lineTo(x, pad + usable); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(pad + usable, y); ctx.stroke();
  }

  const toPx = (gx, gy) => ({
    x: pad + gx * cell,
    y: pad + (N - 1 - gy) * cell
  });

  // charging station at (0,0)
  {
    const { x, y } = toPx(0, 0);
    ctx.fillStyle = "rgba(0,184,148,0.15)";
    ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
    ctx.strokeStyle = "#00b894";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
    ctx.fillStyle = "#00b894";
    ctx.font = `bold ${Math.floor(cell * 0.55)}px 'JetBrains Mono'`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("⚡", x + cell / 2, y + cell / 2 + 1);
  }

  // obstacles
  ctx.fillStyle = theme.obstacle;
  State.obstacles.forEach(([ox, oy]) => {
    if (ox === 0 && oy === 0) return;
    const { x, y } = toPx(ox, oy);
    ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, y + 1, cell - 2, cell - 2);
    ctx.clip();
    ctx.strokeStyle = "rgba(233,69,96,0.18)";
    for (let h = -cell; h < cell * 2; h += 4) {
      ctx.beginPath();
      ctx.moveTo(x + h, y);
      ctx.lineTo(x + h + cell, y + cell);
      ctx.stroke();
    }
    ctx.restore();
  });

  // trail
  const trail = State.robot.trail;
  if (trail.length > 1) {
    ctx.strokeStyle = "rgba(77,171,247,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    trail.forEach((p, i) => {
      const c = toPx(p[0], p[1]);
      const cx = c.x + cell / 2;
      const cy = c.y + cell / 2;
      if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    });
    ctx.stroke();
  }

  // robot
  {
    const r = State.robot;
    const { x, y } = toPx(r.x, r.y);
    const cx = x + cell / 2;
    const cy = y + cell / 2;
    const rad = cell * 0.36;

    ctx.beginPath();
    ctx.arc(cx, cy, rad + 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(77,171,247,0.15)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = r.status === "STUCK" ? "#e94560" : theme.robot;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const dir = r.heading || "N";
    ctx.fillStyle = "#0d1428";
    ctx.beginPath();
    const ang = ({ N: -Math.PI / 2, E: 0, S: Math.PI / 2, W: Math.PI })[dir] || -Math.PI / 2;
    const tip = rad * 0.7;
    ctx.moveTo(cx + Math.cos(ang) * tip, cy + Math.sin(ang) * tip);
    ctx.lineTo(cx + Math.cos(ang + 2.4) * rad * 0.4, cy + Math.sin(ang + 2.4) * rad * 0.4);
    ctx.lineTo(cx + Math.cos(ang - 2.4) * rad * 0.4, cy + Math.sin(ang - 2.4) * rad * 0.4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#dfe6e9";
    ctx.font = "bold 10px 'JetBrains Mono'";
    ctx.fillText(`(${r.x},${r.y})`, cx, cy + rad + 12);
  }

  // signal-lost dim
  if (State.conn === "lost") {
    ctx.fillStyle = "rgba(8,12,28,0.55)";
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = "#e94560";
    ctx.font = "bold 14px 'JetBrains Mono'";
    ctx.textAlign = "center";
    ctx.fillText("◉ SIGNAL LOST · LAST KNOWN POSITION", px / 2, px / 2);
  }

  // Stuck overlay (DOM)
  const overlay = $("#stuckOverlay");
  if (overlay) overlay.style.display = State.robot.status === "STUCK" ? "grid" : "none";

  // Grid meta count
  const meta = $("#gridMeta");
  if (meta) meta.textContent = `OBSTACLES: ${State.obstacles.length} · SCALE: 1m / CELL`;
}

window.addEventListener("resize", () => {
  if (State.user) drawGrid();
});

/* ============ LOGOUT ============ */
function handleLogout() {
  stopPolling();
  localStorage.removeItem("gcs_token");
  localStorage.removeItem("gcs_user");
  localStorage.removeItem("gcs_role");
  State.user = null;
  State.robot = { x: 0, y: 0, battery: 87.5, status: "IDLE", heading: "N", trail: [[0, 0]], prox: { N: 5, S: 5, E: 5, W: 5 } };
  State.conn = "connected";
  renderLogin();
}

/* ============ TWEAKS (simple vanilla panel) ============ */
function initTweaksPanel() {
  // Floating button + panel — visible by default for demo
  const fab = document.createElement("button");
  fab.className = "tweaks-fab";
  fab.textContent = "⚙ Tweaks";
  fab.setAttribute("aria-label", "Open tweaks panel");
  document.body.appendChild(fab);

  const panel = document.createElement("aside");
  panel.className = "tweaks-panel";
  panel.setAttribute("aria-label", "Tweaks panel");
  panel.style.display = "none";
  panel.innerHTML = `
    <header>
      <span>Tweaks</span>
      <button class="tweaks-close" aria-label="Close tweaks panel">✕</button>
    </header>
    <div class="tweaks-body">
      <div class="tweak-section">
        <div class="tweak-section-title">Demo</div>
        <button class="tweak-btn" data-action="login-cmdr">Login as Commander</button>
        <button class="tweak-btn" data-action="login-viewer">Login as Viewer</button>
        <button class="tweak-btn secondary" data-action="logout">Back to Login</button>
      </div>
      <div class="tweak-section">
        <div class="tweak-section-title">Theme</div>
        <label class="tweak-row">
          <span>Accent hue</span>
          <input type="range" min="0" max="360" step="1" value="${State.tweaks.accentHue}" data-tweak="accentHue" />
          <output>${State.tweaks.accentHue}°</output>
        </label>
        <div class="tweak-row-col">
          <span>Robot color</span>
          <div class="swatch-row" data-tweak="robotColor">
            ${["#4dabf7", "#00b894", "#fdcb6e", "#e94560", "#a29bfe"].map((c) =>
              `<button class="swatch ${c === State.tweaks.gridTheme.robot ? "active" : ""}" style="background:${c}" data-color="${c}" aria-label="Robot color ${c}"></button>`
            ).join("")}
          </div>
        </div>
        <div class="tweak-row-col">
          <span>Grid background</span>
          <div class="swatch-row" data-tweak="gridBg">
            ${["#0d1428", "#0a0f1f", "#1a1a2e", "#0f0f1a", "#181a36"].map((c) =>
              `<button class="swatch ${c === State.tweaks.gridTheme.gridBg ? "active" : ""}" style="background:${c}" data-color="${c}" aria-label="Grid background ${c}"></button>`
            ).join("")}
          </div>
        </div>
      </div>
      <div class="tweak-section">
        <div class="tweak-section-title">Scenario</div>
        <label class="tweak-row">
          <span>Obstacle seed</span>
          <input type="number" min="1" max="99" value="${State.tweaks.obstacleSeed}" data-tweak="obstacleSeed" />
        </label>
        <button class="tweak-btn" data-action="sim-lost">Simulate Signal Lost</button>
        <button class="tweak-btn" data-action="sim-drain">Drain Battery to 5%</button>
        <button class="tweak-btn" data-action="sim-stuck">Trigger Robot Stuck</button>
        <button class="tweak-btn secondary" data-action="sim-reset">Reset Robot to (0,0)</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  const open = () => { panel.style.display = "flex"; fab.style.display = "none"; };
  const close = () => { panel.style.display = "none"; fab.style.display = "inline-flex"; };
  fab.addEventListener("click", open);
  panel.querySelector(".tweaks-close").addEventListener("click", close);

  // Slider
  panel.querySelector('[data-tweak="accentHue"]').addEventListener("input", (e) => {
    const v = +e.target.value;
    State.tweaks.accentHue = v;
    e.target.nextElementSibling.textContent = v + "°";
    document.documentElement.style.setProperty("--accent-2", `oklch(0.55 0.13 ${v})`);
  });

  // Swatches
  panel.querySelectorAll(".swatch-row").forEach((row) => {
    const key = row.dataset.tweak;
    row.querySelectorAll(".swatch").forEach((btn) => {
      btn.addEventListener("click", () => {
        const c = btn.dataset.color;
        row.querySelectorAll(".swatch").forEach((b) => b.classList.toggle("active", b === btn));
        if (key === "robotColor") State.tweaks.gridTheme.robot = c;
        if (key === "gridBg") State.tweaks.gridTheme.gridBg = c;
        if (State.user) drawGrid();
      });
    });
  });

  // Seed
  panel.querySelector('[data-tweak="obstacleSeed"]').addEventListener("change", (e) => {
    State.tweaks.obstacleSeed = +e.target.value || 1;
    regenObstacles();
    computeProximity();
    renderProximity();
    if (State.user) drawGrid();
  });

  // Action buttons
  panel.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "login-cmdr") {
        api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "admin123!" }) })
          .then((data) => {
            localStorage.setItem("gcs_token", data.access_token);
            localStorage.setItem("gcs_user", data.username);
            localStorage.setItem("gcs_role", data.role);
            State.user = { username: data.username, role: data.role, token: data.access_token };
            renderDashboard(); startPolling();
          })
          .catch(() => pushToast("danger", "Login Failed", "Could not login as Commander. Ensure backend is running."));
      } else if (action === "login-viewer") {
        api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "viewer", password: "viewer123!" }) })
          .then((data) => {
            localStorage.setItem("gcs_token", data.access_token);
            localStorage.setItem("gcs_user", data.username);
            localStorage.setItem("gcs_role", data.role);
            State.user = { username: data.username, role: data.role, token: data.access_token };
            renderDashboard(); startPolling();
          })
          .catch(() => pushToast("danger", "Login Failed", "Viewer account may not exist. Register first."));
      } else if (action === "logout") {
        handleLogout();
      } else if (action === "sim-lost") {
        if (State.user) { setConn("lost"); pushToast("danger", "Signal Lost", "Simulated."); }
      } else if (action === "sim-drain") {
        if (State.user) {
          State.robot.battery = 5;
          updateBatteryDerivedState();
          renderStatusPanel();
          renderBanners();
        }
      } else if (action === "sim-stuck") {
        if (State.user) {
          State.robot.status = "STUCK";
          renderStatusPanel();
          renderBanners();
          drawGrid();
        }
      } else if (action === "sim-reset") {
        if (State.user) {
          api("/api/reset", { method: "POST" })
            .then(() => {
              State.robot = { x: 0, y: 0, battery: 100, status: "IDLE", heading: "N", trail: [[0, 0]], prox: { N: 5, S: 5, E: 5, W: 5 } };
              setConn("connected");
              computeProximity();
              renderProximity();
              renderStatusPanel();
              renderBanners();
              drawGrid();
              pushToast("ok", "Reset", "Robot simulation has been reset.");
            })
            .catch((err) => pushToast("danger", "Reset Failed", err.detail || "Could not reset."));
        }
      }
    });
  });
}

/* ============ BOOT ============ */
function boot() {
  const tok = localStorage.getItem("gcs_token");
  const user = localStorage.getItem("gcs_user");
  const role = localStorage.getItem("gcs_role");
  if (tok && user && role) {
    State.user = { username: user, role, token: tok };
    // Validate token against backend
    api("/api/auth/me")
      .then(() => { renderDashboard(); startPolling(); })
      .catch(() => { handleLogout(); });
  } else {
    renderLogin();
  }
  initTweaksPanel();
}

document.addEventListener("DOMContentLoaded", boot);