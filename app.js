const POSES = [
  { id: "front", label: "Front" },
  { id: "side", label: "Side" },
  { id: "back", label: "Back" },
  { id: "flex", label: "Flex" }
];

const MEASURES = [
  { id: "chest", label: "Chest" },
  { id: "shoulders", label: "Shoulders" },
  { id: "waist", label: "Waist" },
  { id: "hips", label: "Hips" },
  { id: "arms", label: "Arms" },
  { id: "legs", label: "Legs" },
  { id: "calves", label: "Calves" }
];

let settings = null;
let photos = [];
let urlCache = new Map();
let currentView = "home";
let stream = null;
let facing = "user";
let pose = "front";
let ghostOn = true;
let pendingBlob = null;
let editingId = null;
let compare = { a: null, b: null, slot: "a", mode: "side" };
let galleryFilter = "all";
let unlocked = true;
let pinBuffer = "";

const $ = (id) => document.getElementById(id);

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2400);
}

function objectUrl(photo) {
  if (!photo || !photo.blob) return "";
  if (urlCache.has(photo.id)) return urlCache.get(photo.id);
  const u = URL.createObjectURL(photo.blob);
  urlCache.set(photo.id, u);
  return u;
}

function unitW() { return settings.units === "imperial" ? "lb" : "kg"; }
function unitL() { return settings.units === "imperial" ? "in" : "cm"; }

function fmtNum(n, digits = 1) {
  if (n === null || n === undefined || n === "") return "—";
  const x = Number(n);
  if (Number.isNaN(x)) return "—";
  return Number.isInteger(x) ? String(x) : x.toFixed(digits);
}

function bmi(weight, heightCm) {
  if (!weight || !heightCm) return null;
  let kg = Number(weight);
  let cm = Number(heightCm);
  if (settings.units === "imperial") {
    kg = kg * 0.453592;
    cm = cm * 2.54;
  }
  const m = cm / 100;
  if (m <= 0) return null;
  return kg / (m * m);
}

async function refresh() {
  photos = await Photos.all();
}

function showView(name) {
  currentView = name;
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  const el = $("view-" + name);
  if (el) el.classList.add("active");
  document.querySelectorAll("#tabNav button").forEach((b) => {
    b.classList.toggle("active", b.dataset.go === name);
  });
  const hideNav = name === "capture" || name === "save" || name === "onboard" || name === "detail";
  $("tabNav").style.display = hideNav ? "none" : "grid";
  if (name !== "capture") stopCam();
  if (name === "home") renderHome();
  if (name === "gallery") renderGallery();
  if (name === "compare") renderCompare();
  if (name === "trends") renderTrends();
  if (name === "settings") renderSettings();
  if (name === "capture") startCam();
}

async function startCam() {
  stopCam();
  $("reviewImg").classList.add("hidden");
  $("camVideo").classList.remove("hidden");
  $("camUi").style.display = "flex";
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1440 }, height: { ideal: 1920 } },
      audio: false
    });
    $("camVideo").srcObject = stream;
    const mirror = facing === "user" ? "scaleX(-1)" : "none";
    $("camVideo").style.transform = mirror;
    $("ghostImg").style.transform = mirror;
    await $("camVideo").play();
  } catch (err) {
    toast("Camera blocked. Allow camera access, or import from the gallery.");
    console.warn(err);
  }
  renderPosePills();
  loadGhost();
}

function stopCam() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  $("camVideo").srcObject = null;
}

function renderPosePills() {
  $("posePills").innerHTML = POSES.map(
    (p) => `<button class="pill ${p.id === pose ? "on" : ""}" data-pose="${p.id}">${p.label}</button>`
  ).join("");
  $("ghostBtn").classList.toggle("on", ghostOn);
}

async function loadGhost() {
  const last = photos.find((p) => p.pose === pose);
  const img = $("ghostImg");
  if (ghostOn && last) {
    img.src = objectUrl(last);
    img.classList.add("on");
  } else {
    img.classList.remove("on");
  }
}

async function captureFrame() {
  const video = $("camVideo");
  const canvas = $("snapCanvas");
  const w = video.videoWidth || 1080;
  const h = video.videoHeight || 1440;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, w, h);
  pendingBlob = await compressCanvas(canvas);
  const url = URL.createObjectURL(pendingBlob);
  $("reviewImg").src = url;
  $("reviewImg").classList.remove("hidden");
  $("camVideo").classList.add("hidden");
  stopCam();
  editingId = null;
  openSaveForm();
}

function compressCanvas(canvas, max = 1600, quality = 0.84) {
  const scale = Math.min(1, max / Math.max(canvas.width, canvas.height));
  const w = Math.round(canvas.width * scale);
  const h = Math.round(canvas.height * scale);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d").drawImage(canvas, 0, 0, w, h);
  return new Promise((resolve) => out.toBlob((b) => resolve(b), "image/jpeg", quality));
}

function compressFile(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(await compressCanvas(canvas));
    };
    img.onerror = () => resolve(file);
    img.src = url;
  });
}

function lastStats() {
  const withW = photos.find((p) => p.weight);
  const lastM = {};
  for (const m of MEASURES) {
    const hit = photos.find((p) => p.measures && p.measures[m.id]);
    if (hit) lastM[m.id] = hit.measures[m.id];
  }
  return { weight: withW ? withW.weight : "", measures: lastM, date: todayISO() };
}

function openSaveForm() {
  const existing = editingId ? photos.find((p) => p.id === editingId) : null;
  const seed = existing || lastStats();
  $("savePreview").src = existing ? objectUrl(existing) : URL.createObjectURL(pendingBlob);
  const poseVal = existing ? existing.pose : pose;
  $("saveForm").innerHTML = `
    <div class="field"><label>Date</label><input type="date" id="fDate" value="${existing ? existing.date : todayISO()}" /></div>
    <div class="field"><label>Pose</label>
      <select id="fPose">${POSES.map((p) => `<option value="${p.id}" ${p.id === poseVal ? "selected" : ""}>${p.label}</option>`).join("")}</select>
    </div>
    <div class="field"><label>Weight (${unitW()})</label><input id="fWeight" inputmode="decimal" value="${seed.weight || ""}" placeholder="79" /></div>
    <div class="measures">
      ${MEASURES.map((m) => `
        <div class="field">
          <label>${m.label} (${unitL()})</label>
          <input data-m="${m.id}" inputmode="decimal" value="${(seed.measures && seed.measures[m.id]) || ""}" />
        </div>`).join("")}
    </div>
    <div class="field"><label>Notes</label><textarea id="fNotes" placeholder="Lighting, pump, time of day…">${existing ? existing.notes || "" : ""}</textarea></div>
    <button class="btn" id="fSave">${existing ? "Update" : "Save frame"}</button>
  `;
  $("fSave").onclick = commitSave;
  showView("save");
}

async function commitSave() {
  const measures = {};
  $("saveForm").querySelectorAll("[data-m]").forEach((inp) => {
    if (inp.value.trim()) measures[inp.dataset.m] = Number(inp.value);
  });
  const rec = {
    id: editingId || uid(),
    date: $("fDate").value || todayISO(),
    pose: $("fPose").value,
    weight: $("fWeight").value ? Number($("fWeight").value) : null,
    measures,
    notes: $("fNotes").value.trim(),
    createdAt: editingId ? (photos.find((p) => p.id === editingId)?.createdAt || Date.now()) : Date.now(),
    blob: editingId ? photos.find((p) => p.id === editingId).blob : pendingBlob
  };
  if (!rec.blob) {
    toast("No photo attached.");
    return;
  }
  await Photos.save(rec);
  await Settings.set({ lastPose: rec.pose });
  await refresh();
  pendingBlob = null;
  editingId = null;
  toast("Saved.");
  showView("home");
}

function renderHome() {
  const latestW = photos.find((p) => p.weight);
  const firstW = [...photos].reverse().find((p) => p.weight);
  let delta = "—";
  if (latestW && firstW && latestW.id !== firstW.id) {
    const d = latestW.weight - firstW.weight;
    delta = (d > 0 ? "+" : "") + fmtNum(d) + " " + unitW();
  }
  const days = photos.length ? Math.abs(daysBetween(photos[photos.length - 1].date, photos[0].date)) : 0;
  $("homeStats").innerHTML = `
    <div class="stat"><div class="k">Frames</div><div class="v">${photos.length}</div><div class="s">${days ? days + " days logged" : "Start today"}</div></div>
    <div class="stat"><div class="k">Weight</div><div class="v">${latestW ? fmtNum(latestW.weight) : "—"}</div><div class="s">${latestW ? unitW() : "add on save"}</div></div>
    <div class="stat"><div class="k">Change</div><div class="v">${delta}</div><div class="s">vs first weigh-in</div></div>
  `;
  const latest = photos.slice(0, 6);
  if (!latest.length) {
    $("homeGrid").innerHTML = `<div class="empty" style="grid-column:1/-1">
      <h3>No frames yet</h3>
      <p>Hit the shutter in the middle of the tab bar. Use Front, Side and Back in the same light if you can.</p>
    </div>`;
    return;
  }
  $("homeGrid").innerHTML = latest.map(photoCard).join("");
  bindPhotoCards($("homeGrid"));
}

function photoCard(p) {
  const w = p.weight ? ` · ${fmtNum(p.weight)} ${unitW()}` : "";
  return `<button class="card-photo" data-id="${p.id}">
    <div class="thumb">
      <img src="${objectUrl(p)}" alt="${p.pose}" />
      <span class="badge">${p.pose}</span>
    </div>
    <div class="meta"><div class="d">${formatDate(p.date)}</div><div class="p">${p.pose}${w}</div></div>
  </button>`;
}

function bindPhotoCards(root) {
  root.querySelectorAll("[data-id]").forEach((el) => {
    el.onclick = () => openDetail(el.dataset.id);
  });
}

function renderGallery() {
  $("poseFilters").innerHTML = ["all", ...POSES.map((p) => p.id)]
    .map((id) => `<button class="pill ${galleryFilter === id ? "on" : ""}" data-f="${id}">${id === "all" ? "All" : id}</button>`)
    .join("");
  $("poseFilters").onclick = (e) => {
    const b = e.target.closest("[data-f]");
    if (!b) return;
    galleryFilter = b.dataset.f;
    renderGallery();
  };
  const list = galleryFilter === "all" ? photos : photos.filter((p) => p.pose === galleryFilter);
  $("galleryGrid").innerHTML = list.length
    ? list.map(photoCard).join("")
    : `<div class="empty" style="grid-column:1/-1"><h3>Nothing here</h3><p>Capture or import a ${galleryFilter} photo.</p></div>`;
  bindPhotoCards($("galleryGrid"));
}

function openDetail(id) {
  const p = photos.find((x) => x.id === id);
  if (!p) return;
  $("detailTitle").textContent = formatDate(p.date);
  $("detailImg").src = objectUrl(p);
  const b = bmi(p.weight, settings.heightCm);
  const cells = [
    ["Pose", p.pose],
    ["Weight", p.weight ? `${fmtNum(p.weight)} ${unitW()}` : "—"],
    ["BMI", b ? b.toFixed(1) : "—"],
    ...MEASURES.filter((m) => p.measures && p.measures[m.id]).map((m) => [m.label, `${fmtNum(p.measures[m.id])} ${unitL()}`])
  ];
  $("detailMeta").innerHTML = `
    <div class="kv">${cells.map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}</div>
    ${p.notes ? `<p style="color:var(--muted);line-height:1.5">${escapeHtml(p.notes)}</p>` : ""}
  `;
  $("deletePhoto").onclick = async () => {
    if (!confirm("Delete this frame? It cannot be undone.")) return;
    await Photos.remove(p.id);
    if (urlCache.has(p.id)) {
      URL.revokeObjectURL(urlCache.get(p.id));
      urlCache.delete(p.id);
    }
    await refresh();
    showView("gallery");
  };
  $("editPhoto").onclick = () => {
    editingId = p.id;
    pendingBlob = p.blob;
    openSaveForm();
  };
  $("sharePhoto").onclick = () => sharePhoto(p);
  showView("detail");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function sharePhoto(p) {
  const file = new File([p.blob], `framelog-${p.date}-${p.pose}.jpg`, { type: "image/jpeg" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `FrameLog ${p.date}` });
      return;
    } catch {}
  }
  const a = document.createElement("a");
  a.href = objectUrl(p);
  a.download = file.name;
  a.click();
}

function renderCompare() {
  const fill = (slotEl, photo, label) => {
    if (!photo) {
      slotEl.innerHTML = `<div class="ph">Tap to pick ${label}</div>`;
      return;
    }
    slotEl.innerHTML = `<img src="${objectUrl(photo)}" alt=""><div class="meta" style="padding:8px 10px"><div class="d">${formatDate(photo.date)}</div><div class="p">${photo.pose}${photo.weight ? " · " + fmtNum(photo.weight) + " " + unitW() : ""}</div></div>`;
  };
  fill($("slotA"), compare.a, "earlier");
  fill($("slotB"), compare.b, "later");
  const box = $("sliderBox");
  if (compare.mode === "slider" && compare.a && compare.b) {
    box.classList.remove("hidden");
    $("slideBefore").src = objectUrl(compare.b);
    $("slideAfter").src = objectUrl(compare.a);
    applySlider(Number($("sliderRange").value));
  } else {
    box.classList.add("hidden");
  }
  $("toggleCompareMode").textContent = compare.mode === "slider" ? "Side by side" : "Slider";
  let msg = "Pick two frames of the same pose if you can.";
  if (compare.a && compare.b) {
    const days = Math.abs(daysBetween(compare.a.date, compare.b.date));
    const parts = [`${days} day${days === 1 ? "" : "s"} apart`];
    if (compare.a.weight && compare.b.weight) {
      const d = compare.b.weight - compare.a.weight;
      parts.push(`${d > 0 ? "+" : ""}${fmtNum(d)} ${unitW()}`);
    }
    msg = parts.join(" · ");
  }
  $("compareDelta").textContent = msg;
}

function applySlider(pct) {
  $("slideAfter").style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
  $("sliderBar").style.left = pct + "%";
}

function openPicker(slot) {
  compare.slot = slot;
  const modal = $("pickerModal");
  const draw = (filter) => {
    const list = filter === "all" ? photos : photos.filter((p) => p.pose === filter);
    $("pickerList").innerHTML = list
      .map((p) => `<button data-id="${p.id}"><img src="${objectUrl(p)}" alt=""></button>`)
      .join("") || `<p style="color:var(--muted)">No photos yet.</p>`;
    $("pickerList").onclick = (e) => {
      const b = e.target.closest("[data-id]");
      if (!b) return;
      const p = photos.find((x) => x.id === b.dataset.id);
      compare[compare.slot] = p;
      modal.classList.remove("show");
      renderCompare();
    };
  };
  $("pickerFilters").innerHTML = ["all", ...POSES.map((p) => p.id)]
    .map((id) => `<button class="pill ${id === "all" ? "on" : ""}" data-f="${id}">${id}</button>`)
    .join("");
  $("pickerFilters").onclick = (e) => {
    const b = e.target.closest("[data-f]");
    if (!b) return;
    $("pickerFilters").querySelectorAll(".pill").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    draw(b.dataset.f);
  };
  draw("all");
  modal.classList.add("show");
}

function renderTrends() {
  const weights = photos.filter((p) => p.weight).slice().reverse();
  const uniqueDates = [];
  const seen = new Set();
  for (const p of weights) {
    if (seen.has(p.date)) continue;
    seen.add(p.date);
    uniqueDates.push(p);
  }
  let html = "";
  html += `<div class="chart-card"><h3>Weight (${unitW()})</h3>`;
  if (uniqueDates.length < 2) {
    html += `<p style="color:var(--muted);font-size:13px;margin:0">Log weight on at least two check-ins to see a line.</p></div>`;
  } else {
    html += `<canvas id="wChart"></canvas></div>`;
  }
  for (const m of MEASURES) {
    const series = [];
    const dSeen = new Set();
    for (const p of [...photos].reverse()) {
      if (p.measures && p.measures[m.id] && !dSeen.has(p.date)) {
        dSeen.add(p.date);
        series.push({ date: p.date, v: p.measures[m.id] });
      }
    }
    if (series.length < 2) continue;
    html += `<div class="chart-card"><h3>${m.label} (${unitL()})</h3><canvas id="c_${m.id}"></canvas></div>`;
  }
  if (!html.includes("canvas") && uniqueDates.length < 2) {
    html += `<div class="empty"><h3>No trend yet</h3><p>Add weight or a tape measure when you save a frame.</p></div>`;
  }
  $("trendsPad").innerHTML = html;
  if (uniqueDates.length >= 2) drawLine($("wChart"), uniqueDates.map((p) => ({ x: p.date, y: p.weight })));
  for (const m of MEASURES) {
    const c = $("c_" + m.id);
    if (!c) continue;
    const series = [];
    const dSeen = new Set();
    for (const p of [...photos].reverse()) {
      if (p.measures && p.measures[m.id] && !dSeen.has(p.date)) {
        dSeen.add(p.date);
        series.push({ x: p.date, y: p.measures[m.id] });
      }
    }
    drawLine(c, series);
  }
}

function drawLine(canvas, points) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 320;
  const h = 160;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const ys = points.map((p) => p.y);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const pad = (max - min) * 0.18 || 1;
  const y0 = min - pad;
  const y1 = max + pad;
  const L = 8, R = 8, T = 12, B = 24;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#2a2d33";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(L, T);
  ctx.lineTo(L, h - B);
  ctx.lineTo(w - R, h - B);
  ctx.stroke();
  const xAt = (i) => L + (i / (points.length - 1)) * (w - L - R);
  const yAt = (v) => T + (1 - (v - y0) / (y1 - y0)) * (h - T - B);
  ctx.strokeStyle = "#c4a574";
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xAt(i), y = yAt(p.y);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = "#c4a574";
  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(xAt(i), yAt(p.y), 3, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = "#9a948a";
  ctx.font = "11px -apple-system, sans-serif";
  ctx.fillText(fmtNum(points[0].y), L, h - 8);
  ctx.textAlign = "right";
  ctx.fillText(fmtNum(points[points.length - 1].y), w - R, h - 8);
}

function renderSettings() {
  $("settingsPad").innerHTML = `
    <div class="list">
      <div class="row"><div class="l">Units</div>
        <select id="sUnits" style="background:transparent;border:0;text-align:right">
          <option value="metric" ${settings.units === "metric" ? "selected" : ""}>kg / cm</option>
          <option value="imperial" ${settings.units === "imperial" ? "selected" : ""}>lb / in</option>
        </select>
      </div>
      <div class="row"><div class="l">Height (${unitL()})</div>
        <input id="sHeight" inputmode="decimal" value="${settings.heightCm || ""}" style="width:90px;background:transparent;border:0;text-align:right" />
      </div>
    </div>
    <h2 class="section-h" style="margin-top:22px"><span>Privacy</span></h2>
    <div class="list">
      <div class="row"><div class="l">PIN lock</div>
        <button class="linkish" id="sPin">${settings.pin ? "Change / remove" : "Set 4-digit PIN"}</button>
      </div>
    </div>
    <p style="color:var(--faint);font-size:12px;margin:8px 0 18px">PIN is stored only on this device. It is a speed bump, not encryption.</p>
    <h2 class="section-h"><span>Data</span></h2>
    <div class="btn-row" style="margin-bottom:10px">
      <button class="btn ghost" id="sExport">Export backup</button>
      <button class="btn ghost" id="sImportJson">Import backup</button>
    </div>
    <input type="file" id="jsonIn" accept="application/json" class="hidden" />
    <button class="btn danger" id="sWipe">Delete all frames</button>
    <p style="color:var(--faint);font-size:12px;margin-top:18px;line-height:1.45">
      Add to Home Screen in Safari for the full-screen app. Photos live in this browser profile.
      Clearing Safari data for this site will delete them — export first.
    </p>
  `;
  $("sUnits").onchange = async (e) => {
    settings = await Settings.set({ units: e.target.value });
    renderSettings();
  };
  $("sHeight").onchange = async (e) => {
    settings = await Settings.set({ heightCm: Number(e.target.value) || null });
  };
  $("sPin").onclick = setupPin;
  $("sExport").onclick = exportBackup;
  $("sImportJson").onclick = () => $("jsonIn").click();
  $("jsonIn").onchange = importBackup;
  $("sWipe").onclick = async () => {
    if (!confirm("Delete every photo and measurement on this device?")) return;
    for (const p of photos) await Photos.remove(p.id);
    urlCache.forEach((u) => URL.revokeObjectURL(u));
    urlCache.clear();
    await refresh();
    toast("Cleared.");
    showView("home");
  };
}

function setupPin() {
  const next = prompt(settings.pin ? "New 4-digit PIN (blank to remove)" : "Choose a 4-digit PIN");
  if (next === null) return;
  if (next === "") {
    Settings.set({ pin: "" }).then((s) => { settings = s; toast("PIN removed"); renderSettings(); });
    return;
  }
  if (!/^\d{4}$/.test(next)) {
    toast("Use exactly 4 digits.");
    return;
  }
  Settings.set({ pin: next }).then((s) => { settings = s; toast("PIN saved"); renderSettings(); });
}

async function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

function dataUrlToBlob(url) {
  const [meta, b64] = url.split(",");
  const mime = (meta.match(/data:(.*?);/) || [])[1] || "image/jpeg";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function exportBackup() {
  toast("Preparing backup…");
  const payload = {
    app: "framelog",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: { units: settings.units, heightCm: settings.heightCm },
    photos: []
  };
  for (const p of photos) {
    payload.photos.push({
      id: p.id,
      date: p.date,
      pose: p.pose,
      weight: p.weight,
      measures: p.measures,
      notes: p.notes,
      createdAt: p.createdAt,
      image: await blobToDataUrl(p.blob)
    });
  }
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `framelog-backup-${todayISO()}.json`;
  a.click();
}

async function importBackup(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.photos) throw new Error("Not a FrameLog backup");
    for (const p of data.photos) {
      await Photos.save({
        id: p.id || uid(),
        date: p.date,
        pose: p.pose || "front",
        weight: p.weight ?? null,
        measures: p.measures || {},
        notes: p.notes || "",
        createdAt: p.createdAt || Date.now(),
        blob: dataUrlToBlob(p.image)
      });
    }
    if (data.settings) await Settings.set(data.settings);
    settings = await Settings.get();
    await refresh();
    toast(`Imported ${data.photos.length} frames.`);
    showView("home");
  } catch (err) {
    toast("Could not read that file.");
    console.warn(err);
  }
}

function renderLock() {
  const dots = $("pinDots").querySelectorAll("span");
  dots.forEach((d, i) => d.classList.toggle("on", i < pinBuffer.length));
}

function handlePin(d) {
  if (d === "⌫") {
    pinBuffer = pinBuffer.slice(0, -1);
    renderLock();
    return;
  }
  if (pinBuffer.length >= 4) return;
  pinBuffer += d;
  renderLock();
  if (pinBuffer.length === 4) {
    if (pinBuffer === settings.pin) {
      unlocked = true;
      $("lockScreen").classList.remove("show");
      pinBuffer = "";
    } else {
      toast("Wrong PIN");
      pinBuffer = "";
      renderLock();
    }
  }
}

async function boot() {
  settings = await Settings.get();
  await refresh();
  pose = settings.lastPose || "front";

  if (settings.pin) {
    unlocked = false;
    $("lockScreen").classList.add("show");
    $("pinPad").innerHTML = ["1","2","3","4","5","6","7","8","9","","0","⌫"]
      .map((d) => `<button data-d="${d}" ${d === "" ? "disabled style='opacity:0'" : ""}>${d}</button>`)
      .join("");
    $("pinPad").onclick = (e) => {
      const b = e.target.closest("[data-d]");
      if (b && b.dataset.d) handlePin(b.dataset.d);
    };
  }

  document.querySelectorAll("[data-go]").forEach((el) => {
    el.addEventListener("click", () => showView(el.dataset.go));
  });

  $("closeCam").onclick = () => showView("home");
  $("flipCam").onclick = () => {
    facing = facing === "user" ? "environment" : "user";
    startCam();
  };
  $("ghostBtn").onclick = () => {
    ghostOn = !ghostOn;
    loadGhost();
    renderPosePills();
  };
  $("posePills").onclick = (e) => {
    const b = e.target.closest("[data-pose]");
    if (!b) return;
    pose = b.dataset.pose;
    renderPosePills();
    loadGhost();
  };
  $("shutter").onclick = () => captureFrame();
  $("timerBtn").onclick = () => {
    let n = 3;
    $("timerBtn").textContent = n;
    const t = setInterval(() => {
      n -= 1;
      $("timerBtn").textContent = n || "0";
      if (n <= 0) {
        clearInterval(t);
        $("timerBtn").textContent = "3s";
        captureFrame();
      }
    }, 1000);
  };
  $("backFromSave").onclick = () => {
    pendingBlob = null;
    editingId = null;
    showView("home");
  };

  $("slotA").onclick = () => openPicker("a");
  $("slotB").onclick = () => openPicker("b");
  $("pickerClose").onclick = () => $("pickerModal").classList.remove("show");
  $("toggleCompareMode").onclick = () => {
    compare.mode = compare.mode === "slider" ? "side" : "slider";
    renderCompare();
  };
  $("sliderRange").oninput = (e) => applySlider(Number(e.target.value));

  $("importBtn").onclick = () => $("importInput").click();
  $("importInput").onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    pendingBlob = await compressFile(files[0]);
    editingId = null;
    openSaveForm();
    if (files.length > 1) toast("Imported the first photo. Repeat to add the rest.");
  };

  $("obGo").onclick = async () => {
    settings = await Settings.set({
      onboarded: true,
      units: $("obUnits").value,
      heightCm: $("obHeight").value ? Number($("obHeight").value) : settings.heightCm
    });
    showView("home");
  };

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  if (!settings.onboarded) showView("onboard");
  else showView("home");
}

boot().catch((err) => {
  console.error(err);
  toast("Could not open the local library.");
});
