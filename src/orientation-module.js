import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

const $ = (id) => document.getElementById(id);
const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter((letter) => !["H", "J"].includes(letter));
const safeName = (value) => value.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "") || "signer";
const tiltSlug = (value) => value.replaceAll(" ", "_").replace(/[()]/g, "").toLowerCase();
const combinations = ["forward", "neutral", "back"].flatMap((lid) => ["toward", "neutral", "away"].flatMap((hand) => Array.from({ length: hand === "neutral" ? 2 : 1 }, (_, index) => ({ lid, hand, clipNumber: index + 1 }))));

let stream, camera, latestResult, adminManifest = {}, adminLetter = "A", adminImage = null;
let signerName = "", manifest, tasks = [], taskIndex = 0, signerResults = [], fullResults = [], pendingCapture = null;

function switchView(id) { ["orientation-entry", "admin-auth", "signer-auth", "admin-workspace", "signer-workspace"].forEach((view) => { $(view).hidden = view !== id; }); }
function download(blob, name) { const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(blob); anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(anchor.href), 1000); }
function stopCamera() { if (camera) camera.stop(); if (stream) stream.getTracks().forEach((track) => track.stop()); camera = stream = null; }
function captureBase(task) { return `${task.letter}/orient${task.orientation.index}/tilt_${tiltSlug(task.combo.lid)}_${tiltSlug(task.combo.hand)}_${task.combo.clipNumber}`; }
function apiFile(relative) { return `/api/sessions/${encodeURIComponent(signerName)}/file/${relative.split("/").map(encodeURIComponent).join("/")}`; }
async function putFile(relative, content, type) { const response = await fetch(apiFile(relative), { method: "PUT", headers: { "Content-Type": type }, body: content }); if (!response.ok) throw new Error("Save failed"); }
async function saveSessionState(nextTaskIndex = taskIndex) {
  const saved = tasks.map((task, index) => task.saved ? { taskIndex: index, ...task.saved } : null).filter(Boolean);
  const response = await fetch(`/api/sessions/${encodeURIComponent(signerName)}/state`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskIndex: nextTaskIndex, saved }) });
  if (!response.ok) throw new Error("Progress save failed");
}
async function persistCapture(task, capture, nextTaskIndex) {
  const base = captureBase(task);
  const details = { letter: task.letter, orientationIndex: task.orientation.index, lidTilt: task.combo.lid, handTilt: task.combo.hand, clipNumber: task.combo.clipNumber, targetFps: 30 };
  const trimmed = { ...details, captureWindow: "3-second signing window after countdown", actualFrameCount: capture.frames.length, frames: capture.frames };
  const untrimmed = { ...details, captureWindow: "record press through countdown and 3-second signing window", actualFrameCount: capture.fullFrames.length, frames: capture.fullFrames };
  await Promise.all([putFile(`${base}/landmarks_trimmed.json`, JSON.stringify(trimmed), "application/json"), putFile(`${base}/landmarks_untrimmed.json`, JSON.stringify(untrimmed), "application/json")]);
  task.saved = { base, frameCount: capture.frames.length }; await saveSessionState(nextTaskIndex);
}

async function startCamera(videoId, canvasId) {
  stopCamera(); const video = $(videoId), canvas = $(canvasId), context = canvas.getContext("2d");
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } }, audio: false });
  video.srcObject = stream; await video.play();
  const { Holistic, Camera, drawConnectors, drawLandmarks, FACEMESH_TESSELATION, HAND_CONNECTIONS, POSE_CONNECTIONS } = window;
  const holistic = new Holistic({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}` });
  holistic.setOptions({ modelComplexity: 0, smoothLandmarks: true, refineFaceLandmarks: false, minDetectionConfidence: .5, minTrackingConfidence: .5 });
  holistic.onResults((results) => { latestResult = results; canvas.width = video.videoWidth; canvas.height = video.videoHeight; context.clearRect(0, 0, canvas.width, canvas.height); context.save(); context.translate(canvas.width, 0); context.scale(-1, 1); if (results.faceLandmarks) drawConnectors(context, results.faceLandmarks, FACEMESH_TESSELATION, { color: "#94b6ff55", lineWidth: .45 }); [results.leftHandLandmarks, results.rightHandLandmarks].forEach((hand) => { if (hand) { drawConnectors(context, hand, HAND_CONNECTIONS, { color: "#75e6ae", lineWidth: 2 }); drawLandmarks(context, hand, { color: "#ffcf72", radius: 2 }); } }); if (results.poseLandmarks) drawConnectors(context, results.poseLandmarks, POSE_CONNECTIONS, { color: "#f18bc3", lineWidth: 2 }); context.restore(); });
  camera = new Camera(video, { onFrame: async () => holistic.send({ image: video }), width: 1280, height: 720 }); camera.start();
}
function point({ x, y, z, visibility }) { return { x, y, z, ...(visibility === undefined ? {} : { visibility }) }; }
function landmarkFrame(timestamp) { const result = latestResult || {}; return { timestamp, face: result.faceLandmarks?.map(point) ?? null, pose: result.poseLandmarks?.map(point) ?? null, hands: { left: result.leftHandLandmarks?.map(point) ?? null, right: result.rightHandLandmarks?.map(point) ?? null } }; }
function resetAdminImage() { adminImage = null; $("admin-image-preview").hidden = true; $("admin-save-reference").disabled = true; $("admin-description").value = ""; }
function updateAdmin() { $("admin-letter-title").textContent = adminLetter; $("admin-letter-select").value = adminLetter; $("admin-orientation-count").textContent = `${(adminManifest[adminLetter] || []).length} saved orientations for ${adminLetter}`; resetAdminImage(); }
function showAdminImage(blob) { adminImage = blob; const image = $("admin-image-preview"); image.src = URL.createObjectURL(blob); image.hidden = false; $("admin-save-reference").disabled = false; }
async function normaliseReferenceImage(blob) {
  const image = await createImageBitmap(blob); const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 720;
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", .92));
}

function buildTasks() {
  return letters.flatMap((letter) => (manifest[letter] || []).flatMap((orientation) => combinations.map((combo) => ({ letter, orientation, combo }))));
}
function showReferenceImage(letter, index) {
  const image = $("signer-reference-image"); const paths = [`./reference/reference_${letter}_${letter}_${index}.jpg`, `./reference/${letter}_${index}.jpg`, `./reference/reference_${letter}_${index}.jpg`]; let attempt = 0;
  image.onerror = () => { attempt += 1; if (attempt < paths.length) image.src = paths[attempt]; };
  image.src = paths[attempt];
}
function populateResumePicker() {
  const select = $("resume-task-select"); select.replaceChildren();
  tasks.forEach((task, index) => { if (task.saved) return; select.add(new Option(task.letter + " · orientation " + task.orientation.index + " · laptop " + task.combo.lid + " · hand " + task.combo.hand + (task.combo.clipNumber === 2 ? " · take 2" : ""), index)); });
  select.value = String(taskIndex); $("resume-picker").hidden = !select.options.length;
}
function renderTask() {
  const task = tasks[taskIndex]; if (!task) { $("signer-task-title").textContent = "All captures complete"; $("signer-progress").textContent = "Export your session ZIP."; $("signer-record").hidden = true; return; }
  const currentLetterTotal = tasks.filter((item) => item.letter === task.letter).length; const currentLetterDone = tasks.filter((item) => item.letter === task.letter && item.saved).length;
  const activeLetters = [...new Set(tasks.map((item) => item.letter))]; const lettersDone = activeLetters.filter((letter) => tasks.filter((item) => item.letter === letter).every((item) => item.saved)).length;
  $("signer-task-title").textContent = `Letter ${task.letter} · orientation ${task.orientation.index}`; $("signer-progress").textContent = `${task.letter} — ${currentLetterTotal - currentLetterDone} of ${currentLetterTotal} clips left · letters done ${lettersDone} of ${activeLetters.length} · overall ${taskIndex + 1} of ${tasks.length}`;
  showReferenceImage(task.letter, task.orientation.index); $("signer-description").textContent = task.orientation.description || "No description provided.";
  $("signer-tilt-instruction").textContent = `Set laptop lid: ${task.combo.lid}. Set hand: ${task.combo.hand}.${task.combo.clipNumber === 2 ? " This is the second neutral-hand take." : ""}`;
}
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function countdown() { const overlay = $("countdown-overlay"); overlay.hidden = false; for (const number of [3, 2, 1]) { overlay.textContent = number; await wait(1000); } overlay.hidden = true; }
function recorderFor(activeStream) { const type = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm"; const chunks = []; const recorder = new MediaRecorder(activeStream, { mimeType: type }); const done = new Promise((resolve) => { recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data); recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType })); }); recorder.start(); return { recorder, done }; }
async function captureSignerClip() {
  $("signer-record").disabled = true; $("signer-overlay").hidden = true; fullResults = []; const full = recorderFor(stream); const fullStarted = performance.now(); const fullSampler = setInterval(() => fullResults.push(landmarkFrame(performance.now() - fullStarted)), 1000 / 30); await countdown(); signerResults = []; const started = performance.now();
  const sampler = setInterval(() => signerResults.push(landmarkFrame(performance.now() - started)), 1000 / 30);
  await wait(3000); clearInterval(sampler); clearInterval(fullSampler); full.recorder.stop();
  const reviewBlob = await full.done; $("signer-overlay").hidden = false; pendingCapture = { reviewBlob, frames: signerResults, fullFrames: fullResults };
  const review = $("signer-review-video"); review.src = URL.createObjectURL(reviewBlob); review.hidden = false; review.play().catch(() => {});
  $("signer-record").hidden = true; $("signer-record").disabled = false; $("signer-keep").hidden = false; $("signer-redo").hidden = false;
}
async function exportSigner() {
  const zip = new JSZip(), root = zip.folder(signerName), meta = [];
  for (const [index, task] of tasks.entries()) { if (!task.saved) continue; const folder = root.folder(task.saved.base); const base = task.saved.base; const [trimmed, untrimmed] = await Promise.all([fetch(apiFile(base + "/landmarks_trimmed.json")).then((response) => response.text()), fetch(apiFile(base + "/landmarks_untrimmed.json")).then((response) => response.text())]); folder.file("landmarks_trimmed.json", trimmed); folder.file("landmarks_untrimmed.json", untrimmed); meta.push({ index, letter: task.letter, orientationIndex: task.orientation.index, ...task.combo, frameCount: task.saved.frameCount }); }
  root.file("session_meta.json", JSON.stringify({ signerName, lettersCovered: [...new Set(tasks.filter((task) => task.saved).map((task) => task.letter))], totalRequired: tasks.length, keptClips: meta.length, clips: meta }, null, 2));
  download(await zip.generateAsync({ type: "blob" }), `${signerName}_orientation_session.zip`);
}

export function initOrientationModule() {
  letters.forEach((letter) => $("admin-letter-select").add(new Option(letter, letter)));
  $("orientation-mode-button").onclick = () => { switchView("orientation-entry"); $("orientation-dialog").showModal(); };
  $("close-orientation").onclick = () => $("orientation-dialog").close();
  $("exit-orientation").onclick = () => { stopCamera(); $("orientation-dialog").close(); };
  $("admin-role").onclick = () => switchView("admin-auth"); $("signer-role").onclick = () => switchView("signer-auth");
  $("admin-auth-submit").onclick = async () => { if ($("admin-password").value !== "2345") { $("admin-auth-error").textContent = "Incorrect password."; return; } adminManifest = {}; switchView("admin-workspace"); await startCamera("admin-video", "admin-overlay"); updateAdmin(); };
  $("signer-auth-submit").onclick = async () => { signerName = safeName($("orientation-signer-name").value); $("manifest-status").textContent = "Loading your saved session…"; try { manifest = await (await fetch("./reference/manifest.json")).json(); tasks = buildTasks(); if (!tasks.length) throw new Error("No reference orientations found."); const state = await (await fetch("/api/sessions/" + encodeURIComponent(signerName) + "/state")).json(); (state.saved || []).forEach((saved) => { if (tasks[saved.taskIndex]) tasks[saved.taskIndex].saved = saved; }); const firstUnfinished = tasks.findIndex((task) => !task.saved); taskIndex = firstUnfinished === -1 ? tasks.length : firstUnfinished; const next = tasks[taskIndex]; $("signer-resume-point").textContent = state.saved?.length && next ? "Resumed at " + next.letter + ", orientation " + next.orientation.index + ", laptop " + next.combo.lid + ", hand " + next.combo.hand + "." : "New session — your first kept clip will save immediately."; populateResumePicker(); switchView("signer-workspace"); await startCamera("signer-video", "signer-overlay"); renderTask(); } catch (error) { $("manifest-status").textContent = `Could not load session: ${error.message}`; } };
  $("admin-letter-select").onchange = (event) => { adminLetter = event.target.value; updateAdmin(); };
  $("admin-photo").onclick = () => { const video = $("admin-video"), canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext("2d").drawImage(video, 0, 0); canvas.toBlob(showAdminImage, "image/jpeg", .92); };
  $("admin-paste-input").onchange = (event) => event.target.files[0] && showAdminImage(event.target.files[0]);
  document.addEventListener("paste", (event) => { if ($("admin-workspace").hidden) return; const image = [...event.clipboardData.items].find((item) => item.type.startsWith("image/")); if (image) showAdminImage(image.getAsFile()); });
  $("admin-save-reference").onclick = async () => { const list = adminManifest[adminLetter] ||= []; const index = list.length + 1; const image = await normaliseReferenceImage(adminImage); list.push({ index, description: $("admin-description").value.trim() }); download(image, `reference/${adminLetter}_${index}.jpg`); updateAdmin(); };
  $("admin-download-manifest").onclick = () => download(new Blob([JSON.stringify(adminManifest, null, 2)], { type: "application/json" }), "reference/manifest.json");
  $("signer-record").onclick = captureSignerClip;
  $("resume-task-select").onchange = (event) => { taskIndex = Number(event.target.value); $("signer-resume-point").textContent = "Selected a remaining capture to continue."; renderTask(); };
  $("signer-redo").onclick = () => { pendingCapture = null; $("signer-review-video").hidden = true; $("signer-record").hidden = false; $("signer-record").disabled = false; $("signer-keep").hidden = true; $("signer-redo").hidden = true; };
  $("signer-keep").onclick = async () => { const keep = $("signer-keep"); let saved = false; const nextTaskIndex = taskIndex + 1; keep.disabled = true; keep.textContent = "Saving…"; try { await persistCapture(tasks[taskIndex], pendingCapture, nextTaskIndex); saved = true; pendingCapture = null; taskIndex = nextTaskIndex; URL.revokeObjectURL($("signer-review-video").src); $("signer-review-video").pause(); $("signer-review-video").hidden = true; $("signer-record").hidden = false; $("signer-record").disabled = false; $("signer-redo").hidden = true; populateResumePicker(); if (tasks[taskIndex]?.saved) taskIndex = tasks.findIndex((task) => !task.saved); renderTask(); } catch (error) { $("signer-progress").textContent = "Save failed — do not close this tab. Please try Keep again."; console.error(error); } finally { keep.disabled = false; keep.textContent = "Keep"; keep.hidden = saved; } };
  $("signer-export").onclick = exportSigner;
}
