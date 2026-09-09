import { labels, renderReference } from "./reference-clips.js";
import { LandmarkBuffer } from "./buffer.js";
import { startHolistic } from "./holistic.js";
import { exportSession } from "./export.js";
import { initOrientationModule } from "./orientation-module.js";

const $ = (id) => document.getElementById(id);
const select = $("label-select"), reference = $("reference-content"), refLabel = $("reference-label");
const recordButton = $("record-button"), discardButton = $("discard-button"), exportButton = $("export-button");
const review = $("review-dialog"), reviewVideo = $("review-video"), timeline = $("timeline");
let personName = "", recording = false, buffer = null, recordings = [];
let cameraStream = null, mediaRecorder = null, videoChunks = [], captureStartedAt = 0, pending = null;
let trimStart = 0, trimEnd = 0, dragging = null, dragOffset = 0, previewing = false;

labels.forEach((label) => select.add(new Option(label, label)));
function safeName(value) { return value.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "").replace(/^_+|_+$/g, "") || "recorder"; }
function updateReference() { renderReference(reference, select.value); refLabel.textContent = select.value; }
function updateCounts() {
  const counts = recordings.reduce((result, item) => ({ ...result, [item.hands.label]: (result[item.hands.label] || 0) + 1 }), {});
  $("total-count").textContent = recordings.length; const list = $("sample-list"); list.replaceChildren();
  const entries = Object.entries(counts); if (!entries.length) list.innerHTML = "<li>No samples recorded yet.</li>";
  entries.forEach(([label, count]) => { const li = document.createElement("li"); li.textContent = `${label}: ${count}`; list.append(li); });
  discardButton.disabled = !recordings.length || recording; exportButton.disabled = !recordings.length;
}
function updateTimeline() {
  const duration = reviewVideo.duration || 1, start = trimStart / duration * 100, end = trimEnd / duration * 100;
  $("start-handle").style.left = `${start}%`; $("end-handle").style.left = `${end}%`;
  const selection = $("selection"); selection.style.left = `${start}%`; selection.style.width = `${end - start}%`;
  $("trim-start-value").textContent = `${trimStart.toFixed(3)}s`; $("trim-end-value").textContent = `${trimEnd.toFixed(3)}s`;
  $("trim-readout").textContent = `${(trimEnd - trimStart).toFixed(3)}s selected`;
}
function setHandleFromPointer(event) {
  if (!dragging) return;
  const bounds = timeline.getBoundingClientRect(), fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
  const value = fraction * reviewVideo.duration, gap = .001;
  if (dragging === "start") { trimStart = Math.min(value, trimEnd - gap); reviewVideo.currentTime = trimStart; }
  else if (dragging === "end") { trimEnd = Math.max(value, trimStart + gap); reviewVideo.currentTime = trimEnd; }
  else { const length = trimEnd - trimStart; trimStart = Math.max(0, Math.min(value - dragOffset, reviewVideo.duration - length)); trimEnd = trimStart + length; reviewVideo.currentTime = trimStart; }
  updateTimeline();
}
async function makeFilmstrip() {
  const strip = $("filmstrip"), context = strip.getContext("2d"), thumb = document.createElement("canvas"), tctx = thumb.getContext("2d");
  const count = 12; thumb.width = 160; thumb.height = 88; context.fillStyle = "#09101e"; context.fillRect(0, 0, strip.width, strip.height);
  const seek = (time) => new Promise((resolve) => { reviewVideo.onseeked = resolve; reviewVideo.currentTime = time; });
  for (let index = 0; index < count; index += 1) {
    if (index) await seek(reviewVideo.duration * index / count); tctx.drawImage(reviewVideo, 0, 0, thumb.width, thumb.height);
    context.drawImage(thumb, index * 80, 0, 80, 88);
  }
  reviewVideo.onseeked = null; reviewVideo.currentTime = trimStart;
}
function trimRecording(recordingData, start, end) {
  const relative = recordingData.hands.timestamps.map((time) => (time - captureStartedAt) / 1000);
  const indexes = relative.map((time, index) => time >= start && time <= end ? index : -1).filter((index) => index >= 0);
  const first = indexes[0] ?? 0, last = indexes.at(-1) ?? recordingData.hands.frames.length - 1;
  const slice = (data) => ({ ...data, timestamps: data.timestamps.slice(first, last + 1), frames: data.frames.slice(first, last + 1), trim: { startSeconds: start, endSeconds: end, originalRawFrameCount: data.frames.length } });
  return { hands: slice(recordingData.hands), face: slice(recordingData.face), pose: slice(recordingData.pose) };
}
async function renderTrimmedVideo(sourceUrl, start, end) {
  const source = document.createElement("video"); source.src = sourceUrl; source.muted = true; source.playsInline = true;
  await new Promise((resolve, reject) => { source.onloadedmetadata = resolve; source.onerror = reject; });
  const canvas = document.createElement("canvas"); canvas.width = source.videoWidth; canvas.height = source.videoHeight;
  const context = canvas.getContext("2d"), stream = canvas.captureStream(30), chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm" });
  const finished = new Promise((resolve) => { recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); }; recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType })); });
  const draw = () => { context.drawImage(source, 0, 0, canvas.width, canvas.height); if (source.currentTime >= end || source.ended) recorder.stop(); else source.requestVideoFrameCallback(draw); };
  recorder.start(); source.currentTime = start; await source.play(); source.requestVideoFrameCallback(draw); return finished;
}
function openReview() {
  trimStart = 0; trimEnd = reviewVideo.duration; updateTimeline(); review.showModal(); makeFilmstrip();
}
select.addEventListener("change", updateReference); updateReference();
recordButton.addEventListener("click", () => {
  if (!cameraStream || pending) return; recording = !recording;
  if (recording) {
    buffer = new LandmarkBuffer(); videoChunks = []; captureStartedAt = performance.now();
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
    mediaRecorder = new MediaRecorder(cameraStream, { mimeType }); mediaRecorder.ondataavailable = (event) => { if (event.data.size) videoChunks.push(event.data); };
    mediaRecorder.onstop = () => { const blob = new Blob(videoChunks, { type: mediaRecorder.mimeType }); pending = { ...buffer.toRecording({ recordingId: `${Date.now()}`, label: select.value, personName }), blob }; reviewVideo.src = URL.createObjectURL(blob); reviewVideo.onloadedmetadata = openReview; };
    mediaRecorder.start(); recordButton.textContent = "■ Stop recording"; recordButton.classList.add("recording"); select.disabled = true;
  } else { mediaRecorder.stop(); recordButton.textContent = "● Start recording"; recordButton.classList.remove("recording"); select.disabled = false; }
});
timeline.addEventListener("pointerdown", (event) => { const bounds = timeline.getBoundingClientRect(), value = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * reviewVideo.duration; if (event.target === $("start-handle")) dragging = "start"; else if (event.target === $("end-handle")) dragging = "end"; else if (value >= trimStart && value <= trimEnd) { dragging = "move"; dragOffset = value - trimStart; } else dragging = Math.abs(value - trimStart) < Math.abs(value - trimEnd) ? "start" : "end"; timeline.setPointerCapture(event.pointerId); setHandleFromPointer(event); });
timeline.addEventListener("pointermove", setHandleFromPointer);
timeline.addEventListener("pointerup", () => { dragging = null; });
$("preview-trim").addEventListener("click", () => { previewing = !previewing; $("preview-trim").textContent = previewing ? "■ Stop preview" : "▶ Preview my trim"; if (previewing) { reviewVideo.currentTime = trimStart; reviewVideo.play(); } else reviewVideo.pause(); });
reviewVideo.addEventListener("timeupdate", () => { if (previewing && reviewVideo.currentTime >= trimEnd) reviewVideo.currentTime = trimStart; });
review.addEventListener("cancel", (event) => event.preventDefault());
$("keep-recording").addEventListener("click", async () => {
  const keepButton = $("keep-recording"); keepButton.disabled = true; keepButton.textContent = "Creating trimmed clip…";
  try { const video = await renderTrimmedVideo(reviewVideo.src, trimStart, trimEnd); recordings.push({ hands: pending.hands, face: pending.face, pose: pending.pose, trimmed: trimRecording(pending, trimStart, trimEnd), video }); pending = null; previewing = false; review.close(); updateCounts(); }
  finally { keepButton.disabled = false; keepButton.textContent = "Keep my trim"; }
});
$("reject-recording").addEventListener("click", () => { pending = null; previewing = false; URL.revokeObjectURL(reviewVideo.src); reviewVideo.removeAttribute("src"); review.close(); });
discardButton.addEventListener("click", () => { recordings.pop(); updateCounts(); });
exportButton.addEventListener("click", () => exportSession(personName, recordings));
$("name-form").addEventListener("submit", (event) => { event.preventDefault(); personName = safeName($("recorder-name").value); $("session-person").textContent = `Recorder: ${personName}`; $("destination").textContent = `/${personName}/raw/{hands,face,pose}/ and /${personName}/trimmed/`; $("name-dialog").close(); });
initOrientationModule();
document.body.classList.add("static-only");
$("orientation-mode-button").click();
