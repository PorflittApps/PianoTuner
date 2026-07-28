const noteNameEl = document.getElementById("noteName");
const frequencyEl = document.getElementById("frequency");
const centsEl = document.getElementById("cents");
const targetFrequencyEl = document.getElementById("targetFrequency");
const needleEl = document.getElementById("needle");
const statusMessageEl = document.getElementById("statusMessage");
const micStateEl = document.getElementById("micState");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const installButton = document.getElementById("installButton");
const a4ReferenceInput = document.getElementById("a4Reference");

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const PIANO_MIN_HZ = 25;
const PIANO_MAX_HZ = 5000;
const YIN_THRESHOLD = 0.13;
const MIN_RMS = 0.012;
const TUNED_CENTS = 3;

let audioContext = null;
let analyser = null;
let mediaStream = null;
let sourceNode = null;
let animationFrame = null;
let timeDomainBuffer = null;
let yinBuffer = null;
let frequencyHistory = [];
let lastValidDetection = 0;
let installPrompt = null;

function setStatus(message, className) {
  statusMessageEl.textContent = message;
  statusMessageEl.className = `status ${className}`;
}

function resetDisplay() {
  noteNameEl.textContent = "—";
  frequencyEl.textContent = "—";
  centsEl.textContent = "—";
  targetFrequencyEl.textContent = "—";
  needleEl.style.left = "50%";
  needleEl.style.opacity = "0.3";
}

function getReferenceA4() {
  const parsed = Number.parseFloat(a4ReferenceInput.value);
  return Number.isFinite(parsed) ? Math.min(450, Math.max(430, parsed)) : 440;
}

function frequencyToMidi(frequency, a4) {
  return Math.round(69 + 12 * Math.log2(frequency / a4));
}

function midiToFrequency(midi, a4) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

function midiToNoteName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  return `${note}${octave}`;
}

function centsOff(frequency, targetFrequency) {
  return 1200 * Math.log2(frequency / targetFrequency);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function detectPitchYIN(buffer, sampleRate) {
  const bufferSize = buffer.length;
  const halfSize = Math.floor(bufferSize / 2);

  let rms = 0;
  for (let i = 0; i < bufferSize; i += 1) {
    rms += buffer[i] * buffer[i];
  }
  rms = Math.sqrt(rms / bufferSize);

  if (rms < MIN_RMS) {
    return null;
  }

  if (!yinBuffer || yinBuffer.length !== halfSize) {
    yinBuffer = new Float32Array(halfSize);
  } else {
    yinBuffer.fill(0);
  }

  for (let tau = 1; tau < halfSize; tau += 1) {
    let sum = 0;
    for (let i = 0; i < halfSize; i += 1) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    yinBuffer[tau] = sum;
  }

  yinBuffer[0] = 1;
  let runningSum = 0;

  for (let tau = 1; tau < halfSize; tau += 1) {
    runningSum += yinBuffer[tau];
    yinBuffer[tau] = runningSum === 0 ? 1 : (yinBuffer[tau] * tau) / runningSum;
  }

  let tauEstimate = -1;

  for (let tau = 2; tau < halfSize; tau += 1) {
    if (yinBuffer[tau] < YIN_THRESHOLD) {
      while (tau + 1 < halfSize && yinBuffer[tau + 1] < yinBuffer[tau]) {
        tau += 1;
      }
      tauEstimate = tau;
      break;
    }
  }

  if (tauEstimate === -1) {
    return null;
  }

  const x0 = tauEstimate > 1 ? tauEstimate - 1 : tauEstimate;
  const x2 = tauEstimate + 1 < halfSize ? tauEstimate + 1 : tauEstimate;
  const s0 = yinBuffer[x0];
  const s1 = yinBuffer[tauEstimate];
  const s2 = yinBuffer[x2];

  let betterTau = tauEstimate;
  const denominator = 2 * (2 * s1 - s2 - s0);

  if (denominator !== 0) {
    betterTau += (s2 - s0) / denominator;
  }

  const frequency = sampleRate / betterTau;
  const confidence = 1 - yinBuffer[tauEstimate];

  if (
    !Number.isFinite(frequency) ||
    frequency < PIANO_MIN_HZ ||
    frequency > PIANO_MAX_HZ ||
    confidence < 0.72
  ) {
    return null;
  }

  return { frequency, confidence, rms };
}

function updateTuner(detection) {
  const now = performance.now();

  if (!detection) {
    if (now - lastValidDetection > 650) {
      frequencyHistory = [];
      setStatus("Toca una nota y mantenla unos instantes.", "listening");
      needleEl.style.opacity = "0.3";
    }
    return;
  }

  lastValidDetection = now;
  frequencyHistory.push(detection.frequency);

  if (frequencyHistory.length > 9) {
    frequencyHistory.shift();
  }

  const stableFrequency = median(frequencyHistory);
  const frequencySpread = standardDeviation(frequencyHistory);
  const a4 = getReferenceA4();
  const midi = frequencyToMidi(stableFrequency, a4);
  const targetFrequency = midiToFrequency(midi, a4);
  const cents = centsOff(stableFrequency, targetFrequency);
  const noteName = midiToNoteName(midi);

  noteNameEl.textContent = noteName;
  frequencyEl.textContent = stableFrequency.toFixed(1);
  targetFrequencyEl.textContent = targetFrequency.toFixed(1);
  centsEl.textContent = `${cents >= 0 ? "+" : ""}${cents.toFixed(1)}`;

  const clampedCents = Math.max(-50, Math.min(50, cents));
  needleEl.style.left = `${50 + clampedCents}%`;
  needleEl.style.opacity = "1";

  const relativeVariation = stableFrequency > 0 ? frequencySpread / stableFrequency : 1;
  const unstable = frequencyHistory.length < 4 || relativeVariation > 0.006;

  if (unstable) {
    setStatus("Lectura inestable: mantén la nota o reduce el ruido.", "unstable");
    return;
  }

  if (Math.abs(cents) <= TUNED_CENTS) {
    setStatus("Afinada", "tuned");
  } else if (cents < 0) {
    setStatus("Demasiado grave", "low");
  } else {
    setStatus("Demasiado aguda", "high");
  }
}

function analyze() {
  if (!analyser || !audioContext || !timeDomainBuffer) return;

  analyser.getFloatTimeDomainData(timeDomainBuffer);
  const result = detectPitchYIN(timeDomainBuffer, audioContext.sampleRate);
  updateTuner(result);
  animationFrame = requestAnimationFrame(analyze);
}

async function startTuner() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Este navegador no permite acceder al micrófono.", "error");
    return;
  }

  try {
    startButton.disabled = true;
    setStatus("Solicitando acceso al micrófono…", "listening");

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1
      }
    });

    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: "interactive"
    });

    await audioContext.resume();

    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0;
    timeDomainBuffer = new Float32Array(analyser.fftSize);

    sourceNode.connect(analyser);

    frequencyHistory = [];
    lastValidDetection = performance.now();

    stopButton.disabled = false;
    micStateEl.textContent = "Micrófono activo";
    setStatus("Toca una nota y mantenla unos instantes.", "listening");

    analyze();
  } catch (error) {
    console.error(error);
    setStatus(
      error?.name === "NotAllowedError"
        ? "Permiso de micrófono rechazado. Habilítalo en el navegador."
        : "No fue posible iniciar el micrófono.",
      "error"
    );
    startButton.disabled = false;
  }
}

async function stopTuner() {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  if (audioContext) {
    await audioContext.close();
    audioContext = null;
  }

  analyser = null;
  timeDomainBuffer = null;
  yinBuffer = null;
  frequencyHistory = [];

  resetDisplay();
  startButton.disabled = false;
  stopButton.disabled = true;
  micStateEl.textContent = "Micrófono inactivo";
  setStatus("Afinador detenido.", "idle");
}

startButton.addEventListener("click", startTuner);
stopButton.addEventListener("click", stopTuner);

a4ReferenceInput.addEventListener("change", () => {
  const normalized = getReferenceA4();
  a4ReferenceInput.value = normalized.toFixed(1);
  frequencyHistory = [];
});

window.addEventListener("beforeunload", () => {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
  }
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  installButton.classList.remove("hidden");
});

installButton.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installButton.classList.add("hidden");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("No se pudo registrar el service worker:", error);
    });
  });
}
