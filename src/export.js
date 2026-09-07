import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

export async function exportSession(personName, recordings) {
  const zip = new JSZip(); const root = zip.folder(personName);
  const rawHands = root.folder("raw").folder("hands"); const rawFace = root.folder("raw").folder("face"); const rawPose = root.folder("raw").folder("pose");
  const trimmedHands = root.folder("trimmed").folder("hands"); const trimmedFace = root.folder("trimmed").folder("face"); const trimmedPose = root.folder("trimmed").folder("pose"); const trimmedVideo = root.folder("trimmed").folder("video");
  recordings.forEach(({ hands, face, pose, trimmed, video }) => { const file = `${hands.label}_${hands.recordingId}.json`; rawHands.file(file, JSON.stringify(hands, null, 2)); rawFace.file(file, JSON.stringify(face, null, 2)); rawPose.file(file, JSON.stringify(pose, null, 2)); trimmedPose.file(file, JSON.stringify(trimmed.pose, null, 2)); trimmedHands.file(file, JSON.stringify(trimmed.hands, null, 2)); trimmedFace.file(file, JSON.stringify(trimmed.face, null, 2)); trimmedVideo.file(`${hands.label}_${hands.recordingId}.webm`, video); });
  const blob = await zip.generateAsync({ type: "blob" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${personName}_sign-sense.zip`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 500);
}
