import { MAX_RESULTS, MODEL_NAMES, buildRequest, explain, findResult, keepResult, parseResponse, savedResults, startMode } from "./core.js";

const $ = (id) => document.getElementById(id);
const n = (x) => x.toLocaleString(locale());
const PAGE_PX = (267 * 96) / 25.4; // usable height of an A4 page (297 mm − 2 × 15 mm)

let job; // { text, url, title }: the job being shown
let result; // { job, cv, html, meta }: the résumé being shown, one entry of the persisted `results`
let controller;
let timer;

function el(parent, tag, text, className) {
  const node = parent.appendChild(document.createElement(tag));
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

// ---------- screens ----------

function setState(state) {
  for (const node of document.querySelectorAll("[data-show]")) node.hidden = node.dataset.show !== state;
}

function setStatus(text, { busy = false, tone = "", extra = "" } = {}) {
  $("spinner").hidden = !busy;
  $("statusText").textContent = text;
  $("statusText").className = tone;
  $("statusExtra").textContent = extra;
}

function showNotice({ title, text, note = "", detail = "", settings = false, retry = false }) {
  $("noticeTitle").textContent = title;
  $("noticeText").textContent = text;
  $("noticeNote").textContent = note;
  $("noticeNote").hidden = !note;
  $("noticeDetail").textContent = detail;
  $("noticeDetail").hidden = !detail;
  $("openSettings").hidden = !settings;
  $("retry").hidden = !retry;
  // when settings is not offered, "Try again" becomes the primary action
  $("retry").classList.toggle("ghost", settings);
  $("noticeActions").hidden = !settings && !retry;
  setState("notice");
}

function showMeta({ model, at, cvChars, usage }) {
  const list = $("metaList");
  list.replaceChildren();
  const row = (label, value, wide) => {
    const div = el(list, "div", "", wide ? "wide" : "");
    el(div, "dt", label);
    return el(div, "dd", value);
  };
  const vaga = row(t("r.job"), job.title || t("p.untitled"), true);
  if (URL.canParse(job.url)) {
    const link = el(vaga, "a", job.url.replace(/^https?:\/\//, ""));
    link.href = job.url;
    link.target = "_blank";
    link.rel = "noopener";
  }
  row(t("p.model"), MODEL_NAMES[model] || model);
  row(
    usage ? t("r.generatedAt") : t("r.startedAt"),
    new Date(at).toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
  );
  if (usage) {
    row(t("r.tokensIn"), n(usage.input));
    row(t("r.tokensOut"), n(usage.output));
  }
  row(t("r.baseCv"), t("p.chars", { n: n(cvChars) }));
  row(t("r.pageText"), t("p.chars", { n: n(job.text.length) }));
  $("jobText").value = job.text;
  $("meta").hidden = false;
}

// Results saved before the requirements existed have none; the panel then stays hidden.
function showMatch(requirements) {
  $("match").hidden = !requirements;
  if (!requirements) return;
  const { covered, missing } = requirements;
  const total = covered.length + missing.length;
  $("matchCount").textContent = t("r.matchCount", { covered: n(covered.length), total: n(total) });
  $("matchBar").firstChild.style.width = `${total ? (100 * covered.length) / total : 0}%`;
  for (const [key, items] of [["covered", covered], ["missing", missing]]) {
    $(`${key}Block`).hidden = !items.length;
    $(`${key}Title`).textContent = t(`r.${key}`, { n: n(items.length) });
    $(key).replaceChildren();
    for (const item of items) el($(key), "li", item);
  }
}

function render(cv) {
  const root = $("cv");
  root.replaceChildren();
  el(root, "h1", cv.name);
  if (cv.headline) el(root, "p", cv.headline, "headline");
  if (cv.contact.length) el(root, "p", cv.contact.join(" · "), "contact");
  if (cv.summary) el(root, "p", cv.summary);
  for (const section of cv.sections) {
    el(root, "h2", section.title);
    for (const entry of section.entries) {
      const div = el(root, "div", "", "entry");
      if (entry.title || entry.period) {
        const head = el(div, "div", "", "entry-head");
        el(head, "strong", entry.title);
        el(head, "span", entry.period, "period");
      }
      if (entry.subtitle) el(div, "div", entry.subtitle, "subtitle");
      if (entry.bullets.length) {
        const ul = el(div, "ul");
        for (const bullet of entry.bullets) el(ul, "li", bullet);
      }
    }
  }
}

function readyStatus() {
  const pages = Math.max(1, Math.ceil(($("cv").scrollHeight - 1) / PAGE_PX));
  setStatus(t("p.saved"), { tone: "ok", extra: `· ${pages === 1 ? t("r.pages1") : t("r.pagesN", { n: pages })}` });
}

// Reads the list again first: another result tab may have changed it.
async function persist() {
  const list = savedResults(await chrome.storage.local.get(["results", "result"]));
  await chrome.storage.local.set({ results: keepResult(list, result) });
  await chrome.storage.local.remove("result"); // the pre-history key
}

function showResult() {
  history.replaceState(null, "", `${location.pathname}?at=${result.meta.at}`); // a reload shows this same résumé
  // html comes from this page's own DOM (plaintext-only edits), never from the model or the job page
  if (result.html) $("cv").innerHTML = result.html;
  else render(result.cv);
  $("cv").lang = result.cv.language || "";
  document.title = `CV - ${result.cv.name}`; // Chrome uses it as the suggested PDF filename
  showMeta(result.meta);
  showMatch(result.cv.requirements);
  setState("ready");
  readyStatus();
}

// ---------- generation ----------

async function generate(settings, signal) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal,
    ...buildRequest({ ...settings, jobText: job.text }),
  });
  return parseResponse(res, await res.json().catch(() => ({})));
}

async function run() {
  const { apiKey, cv, model = "claude-opus-5-5", instructions } = await chrome.storage.local.get(["apiKey", "cv", "model", "instructions"]);
  if (!apiKey || !cv) {
    setStatus(t("e.setup.title"), { tone: "error" });
    return showNotice({ title: t("e.setup.title"), text: t("e.setup.text"), settings: true });
  }

  const started = Date.now();
  controller = new AbortController();
  setState("generating");
  showMatch(null);
  showMeta({ model, at: started, cvChars: cv.length });
  const tick = () => {
    const s = Math.floor((Date.now() - started) / 1000);
    setStatus(t("r.generating"), {
      busy: true,
      extra: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} · ${t("r.eta")}`,
    });
  };
  tick();
  timer = setInterval(tick, 1000);

  try {
    const data = await generate({ apiKey, cv, model, instructions }, controller.signal);
    result = {
      job,
      cv: data.cv,
      html: null,
      // the model differs from the selected one when the fallback takes over
      meta: { model: data.model || model, at: Date.now(), cvChars: cv.length, usage: data.usage },
    };
    await persist();
    showResult();
  } catch (e) {
    const notice = explain(e, t);
    setStatus(notice.title, { tone: "error" });
    showNotice(notice);
  } finally {
    clearInterval(timer);
  }
}

// ---------- events ----------

$("cancel").onclick = () => controller?.abort();
$("retry").onclick = run;
$("print").onclick = () => print();
$("openSettings").onclick = () => chrome.runtime.openOptionsPage();
$("regen").onclick = () => {
  if (confirm(t("r.regenConfirm"))) run();
};

let saveTimer;
$("cv").addEventListener("input", () => {
  setStatus(t("r.saving"));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    result.html = $("cv").innerHTML;
    await persist();
    readyStatus();
  }, 400);
});

(async () => {
  const stored = await chrome.storage.local.get(["job", "results", "result"]);
  const at = new URLSearchParams(location.search).get("at");
  const saved = findResult(savedResults(stored), at);
  // Strip #new right away so that a reload never starts another paid generation.
  const mode = startMode(location.hash, { job: stored.job, result: saved });
  history.replaceState(null, "", location.pathname);
  if (mode === "generate") {
    job = stored.job;
    return run();
  }
  if (mode === "saved") {
    result = saved;
    job = result.job;
    return showResult();
  }
  setStatus("");
  if (at) return showNotice({ title: t("e.gone.title"), text: t("e.gone.text", { max: MAX_RESULTS }) });
  showNotice({ title: t("e.empty.title"), text: t("e.empty.text") });
})();
