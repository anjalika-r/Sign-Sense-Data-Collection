const videoFolder = "./Sign videos/";

export const labels = ["background", "Auslan", "Bad", "Brother", "Don't Have", "Don't Know", "Don't Want", "Fingerspell", "Forget", "Go", "Good", "Have", "Hearing", "How", "How are you", "Know", "Learn", "Live", "Love", "Meet", "Name", "Nice", "No", "Please", "Remember", "Sign", "Slow", "So- So", "Talk", "Tired", "Want", "Well", "What", "When", "Where", "Who", "Why", "Work", "Yes", "You"];
const clipLabels = new Set(labels.filter((label) => label !== "background"));

export function clipFor(label) {
  return clipLabels.has(label) ? `${videoFolder}${encodeURIComponent(label)}.mp4` : null;
}

export function renderReference(container, label) {
  const clip = clipFor(label);
  container.replaceChildren();
  if (!clip) { const message = document.createElement("p"); message.className = "placeholder"; message.textContent = "No reference clip for background motion."; container.append(message); return; }
  const video = document.createElement("video");
  video.src = clip; video.loop = true; video.autoplay = true; video.muted = true; video.playsInline = true;
  video.setAttribute("aria-label", `${label} reference sign`); container.append(video);
}
