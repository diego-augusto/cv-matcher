// The same page is both the action popup (icon click) and the options page (tab).
import { ApiError, estimatePdfCost, explain, inspectPdf } from "./core.js";

const $ = (id) => document.getElementById(id);
const FIELDS = ["apiKey", "cv", "model", "instructions"];
const n = (x) => x.toLocaleString(locale());
const usd = (value) => Number(value).toLocaleString(locale(), { style: "currency", currency: "USD" });
const VERSION = chrome.runtime.getManifest().version;

let tab; // active tab, popup only
let inPopup = false;
let existing = false; // a résumé is already saved for this tab's job
let setupOpen = false;
let aboutOpen = false;

// "system" (nothing chosen yet) follows the OS until the first click on the toggle.
const isDark = () =>
  currentTheme() === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : currentTheme() === "dark";

// Blocks only what is certainly wrong; other sk-ant-* formats are left for the API to judge.
function keyProblem(key) {
  if (key.startsWith("sk-ant-oat")) return t("p.keyOat");
  if (key && !key.startsWith("sk-ant-")) return t("p.keyBad");
  return "";
}

function render() {
  const key = $("apiKey").value.trim();
  const cv = $("cv").value.trim();
  const problem = keyProblem(key);
  const configured = Boolean(key && !problem && cv);
  const importing = inPopup && view() !== "idle" && Boolean(key && !problem);
  const showSetup = !aboutOpen && (!inPopup || setupOpen || !configured || importing);
  const showMain = inPopup && !aboutOpen;
  const readable = /^(https?|file):/.test(tab?.url || "");
  const option = $("model").selectedOptions[0];

  $("moon").toggleAttribute("hidden", isDark());
  $("sun").toggleAttribute("hidden", !isDark());
  $("theme").setAttribute("aria-label", isDark() ? t("p.toLight") : t("p.toDark"));
  $("keyMsg").textContent = problem;
  $("keyMsg").hidden = !problem;
  $("apiKey").setAttribute("aria-invalid", String(Boolean(problem)));
  $("modelHelp").textContent = t("p.price", { in: usd(option.dataset.in), out: usd(option.dataset.out) });
  $("cvCount").textContent = t("p.chars", { n: n(cv.length) });
  $("tabTitle").textContent = tab?.title || t("p.untitled");
  $("version").textContent = t("a.version", { v: VERSION });
  $("versionTag").textContent = `Beta ${VERSION}`;

  $("about").hidden = !aboutOpen;
  $("footer").hidden = aboutOpen;
  $("setup").hidden = !showSetup;
  $("setup").classList.toggle("focus", importing);
  $("ready").hidden = !showMain || (showSetup && !importing);
  $("existing").hidden = !showMain || showSetup || !existing;
  $("summary").hidden = !showMain || showSetup;
  $("summaryText").textContent = t("p.summary", { n: n(cv.length), model: option.dataset.name });
  $("toggleSetup").hidden = !showMain || !configured;
  $("toggleSetup").setAttribute("aria-expanded", String(showSetup));

  $("generate").hidden = !showMain;
  $("generate").disabled = !configured || !readable || view() === "reading"; // the résumé is about to change
  renderPdf(Boolean(key && !problem), option);
  $("hint").textContent = !showMain
    ? ""
    : problem
      ? t("p.hintKey")
      : !configured
        ? t("p.hintSetup")
        : !readable
          ? t("p.hintUnreadable")
          : "";
}

(async () => {
  const stored = await chrome.storage.local.get([...FIELDS, "result", "pdfImport"]);
  job = stored.pdfImport ?? null;
  // A reading older than the worker's 5-minute limit will never report back.
  if (job?.step === "reading" && Date.now() - job.started > 5 * 60e3) job = { ...job, step: "error", error: { kind: "interrupted" } };
  if (job?.seen) {
    chrome.storage.local.remove("pdfImport");
    job = null;
  }
  markSeen();
  $("apiKey").value = stored.apiKey || "";
  $("cv").value = stored.cv || "";
  $("model").value = stored.model || "claude-opus-5-5";
  $("instructions").value = stored.instructions || "";
  $("lang").value = currentLang();

  inPopup = !(await chrome.tabs.getCurrent());
  document.documentElement.classList.toggle("tab", !inPopup);
  if (inPopup) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    $("tabHost").textContent = URL.canParse(tab?.url) ? new URL(tab.url).hostname : "";
    existing = Boolean(tab?.url) && stored.result?.job?.url === tab.url;
  }
  render();
})();

// Saves on every keystroke: the popup closes when it loses focus, with no chance to click "Save".
for (const id of FIELDS) {
  $(id).addEventListener("input", async () => {
    render();
    await chrome.storage.local.set({ [id]: $(id).value.trim() });
    $("saved").hidden = false;
  });
}

// Language and theme: localStorage, read synchronously by i18n.js on every page.
$("lang").onchange = () => {
  localStorage.lang = $("lang").value;
  applyPrefs();
  render();
};
$("theme").onclick = () => {
  localStorage.theme = isDark() ? "light" : "dark";
  applyPrefs();
  render();
};

for (const id of ["toggleSetup", "change"]) {
  $(id).onclick = () => {
    setupOpen = !setupOpen;
    render();
  };
}
for (const id of ["aboutLink", "aboutBack"]) {
  $(id).onclick = () => {
    aboutOpen = !aboutOpen;
    render();
  };
}

// ---------- PDF import: idle → selected → reading → done | error ----------
// Choosing the file and seeing the price happen on this page. The reading runs in background.js and reports
// through chrome.storage.local.pdfImport, so the popup can close meanwhile and the popup and the tab stay in step.

const local = { step: "idle", file: null, bytes: null, pages: null, notice: null }; // before the reading starts
let job = null; // chrome.storage.local.pdfImport, written by background.js

const view = () => (local.step !== "idle" ? local.step : job?.step || "idle");
const fileSize = (bytes) =>
  bytes < 1e6
    ? Math.ceil(bytes / 1e3).toLocaleString(locale(), { style: "unit", unit: "kilobyte" })
    : (bytes / 1e6).toLocaleString(locale(), { style: "unit", unit: "megabyte", maximumFractionDigits: 1 });
// Sub-cent amounts would round to "US$ 0.00", which reads as free.
const cost = (value, approx = "") => (value < 0.01 ? `< ${usd(0.01)}` : `${approx}${usd(value)}`);
const prices = (option) => ({ input: Number(option.dataset.in), output: Number(option.dataset.out) });

// The worker stores plain data; rebuild the error so explain() can classify it.
function noticeFor(error) {
  if (error.kind === "empty") return { title: t("p.pdfEmpty"), text: t("p.pdfEmptyText") };
  if (error.kind === "interrupted") return { title: t("p.pdfInterrupted"), text: t("p.pdfInterruptedText") };
  const e =
    error.kind === "api"
      ? new ApiError(error.status, error.message)
      : error.kind === "TypeError"
        ? new TypeError(error.message)
        : Object.assign(new Error(error.message), { name: error.kind });
  return explain(e, t);
}

function renderPdf(keyOk, option) {
  const step = view();
  for (const el of document.querySelectorAll("[data-pdf]")) el.hidden = el.dataset.pdf !== step;
  $("expand").hidden = !inPopup || $("setup").hidden;
  $("pdfChoose").disabled = !keyOk;
  $("pdfPaid").textContent = keyOk ? t("p.pdfPaid") : t("p.pdfNeedKey");
  $("pdfBackground").textContent = inPopup ? t("p.pdfBackground") : t("p.pdfBackgroundTab");
  $("cv").hidden = step === "reading";
  $("cv").classList.toggle("imported", step === "done");
  $("cvHelp").textContent = step === "done" ? t("p.pdfReview") : t("p.cvHelp");

  if (step === "selected") {
    const pages = local.pages === 1 ? t("p.pdfPage") : local.pages ? t("p.pdfPages", { n: n(local.pages) }) : "";
    const cheapest = [...$("model").options].sort((a, b) => a.dataset.in - b.dataset.in)[0];
    const estimate = cost(estimatePdfCost(local.pages, prices(option)), "~");
    const cheaper = cost(estimatePdfCost(local.pages, prices(cheapest)), "~");
    const current = $("cv").value.trim().length;
    document.querySelector(".pdf-file").textContent = local.file.name;
    $("pdfMeta").textContent = [pages, fileSize(local.file.size)].filter(Boolean).join(" · ");
    $("pdfEstimate").textContent = estimate;
    $("pdfCostLine").textContent = [
      t("p.pdfCostLine", { model: option.dataset.name }),
      cheapest === option ? "" : t("p.pdfCheaper", { model: cheapest.dataset.name, cost: cheaper }),
    ].join(" ");
    $("pdfReplace").textContent = current ? t("p.pdfReplace", { n: n(current) }) : "";
    $("pdfImport").textContent = t("p.pdfImport", { cost: estimate });
  }

  if (step === "reading") {
    const secs = Math.max(0, Math.floor((Date.now() - job.started) / 1000));
    $("pdfImporting").textContent = t("p.pdfImporting", { name: job.file.name });
    $("pdfClock").textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    // phase 0: sending, 1: the model is reading, 2: the transcription is arriving
    $("pdfBar").style.width = `${job.phase < 2 ? [12, 40][job.phase] : 40 + 55 * (1 - Math.exp(-job.chars / 3000))}%`;
    $("pdfStepSend").textContent = t("p.pdfStepSend", { size: fileSize(job.file.size) });
    $("pdfStepFill").textContent = job.phase === 2 ? t("p.pdfStepFilling", { n: n(job.chars) }) : t("p.pdfStepFill");
    [...$("pdfSteps").children].forEach((li, i) => {
      li.classList.toggle("done", i < job.phase);
      li.classList.toggle("active", i === job.phase);
    });
  }

  if (step === "done") $("pdfDoneMeta").textContent = t("p.pdfDoneMeta", { n: n(job.chars), cost: cost(job.cost) });

  if (step === "error") {
    const notice = local.notice || noticeFor(job.error);
    $("pdfErrTitle").textContent = notice.title;
    $("pdfErrText").textContent = `${notice.text} ${t("p.pdfUnchanged")}`;
    $("pdfErrDetail").textContent = notice.detail || "";
    $("pdfRetry").hidden = !local.bytes;
  }
}

function setLocal(changes) {
  Object.assign(local, changes);
  render();
}

async function pickPdf(file) {
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { pages, problem } = inspectPdf(bytes);
  if (problem === "notPdf") return setLocal({ file, bytes: null, step: "error", notice: { title: t("p.pdfNotPdf"), text: t("p.pdfNotPdfText") } });
  if (problem === "tooBig") return setLocal({ file, bytes: null, step: "error", notice: { title: t("p.pdfTooBig"), text: t("p.pdfTooBigText") } });
  setLocal({ file, bytes, pages, step: "selected", notice: null });
}

function importPdf() {
  const option = $("model").selectedOptions[0];
  const file = { name: local.file.name, size: local.file.size, pages: local.pages };
  // Shown at once; background.js overwrites it with the real progress.
  job = { step: "reading", file, started: Date.now(), phase: 0, chars: 0 };
  setLocal({ step: "idle", notice: null }); // the file stays in `local` for "Try again"
  chrome.runtime
    .sendMessage({ type: "pdf:start", pdf: local.bytes.toBase64(), file, model: option.value, prices: prices(option) })
    .catch(() => {}); // the worker sends no reply
}

// Shown once after it ends: the next time the page opens, a finished import is cleared.
function markSeen() {
  if (job && job.step !== "reading" && !job.seen) chrome.storage.local.set({ pdfImport: { ...job, seen: true } });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.cv && document.activeElement !== $("cv")) $("cv").value = changes.cv.newValue ?? "";
  if (changes.pdfImport) {
    job = changes.pdfImport.newValue ?? null;
    markSeen();
  }
  if (changes.cv || changes.pdfImport) render();
});
setInterval(() => view() === "reading" && render(), 1000); // the clock

$("pdfChoose").onclick = $("pdfAnother").onclick = () => $("pdfFile").click();
$("pdfFile").onchange = () => {
  pickPdf($("pdfFile").files[0]);
  $("pdfFile").value = "";
};
// Dropping a file works in the tab; a popup closes before anything can be dragged onto it.
$("pdfChoose").ondragover = (e) => {
  if ($("pdfChoose").disabled) return;
  e.preventDefault();
  $("pdfChoose").classList.add("over");
};
$("pdfChoose").ondragleave = () => $("pdfChoose").classList.remove("over");
$("pdfChoose").ondrop = (e) => {
  e.preventDefault();
  $("pdfChoose").classList.remove("over");
  pickPdf(e.dataTransfer.files[0]);
};
$("pdfImport").onclick = $("pdfRetry").onclick = importPdf;
$("pdfRemove").onclick = $("pdfCancel").onclick = () => setLocal({ step: "idle", file: null, bytes: null, notice: null });
$("pdfAbort").onclick = () => {
  chrome.runtime.sendMessage({ type: "pdf:cancel" }).catch(() => {});
  chrome.storage.local.remove("pdfImport"); // also clears an import whose worker is gone
};
$("pdfUndo").onclick = () => {
  $("cv").value = job.previous;
  $("cv").dispatchEvent(new Event("input")); // saves like typing
  chrome.storage.local.remove("pdfImport");
};
$("expand").onclick = () => chrome.runtime.openOptionsPage();

$("openExisting").onclick = () => chrome.tabs.create({ url: "result.html" });

$("generate").onclick = async () => {
  let text = "";
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.innerText,
    });
    text = result || "";
  } catch {
    // chrome:// pages, the Web Store etc. cannot be read
  }
  if (!text.trim()) return ($("hint").textContent = t("p.hintNoText"));
  await chrome.storage.local.set({ job: { text, url: tab.url || "", title: tab.title || "" } });
  chrome.tabs.create({ url: "result.html#new" }); // #new: the only way to start a generation on open
};
