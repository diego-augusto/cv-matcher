// The same page is both the action popup (icon click) and the options page (tab).
const $ = (id) => document.getElementById(id);
const FIELDS = ["apiKey", "cv", "model"];
const n = (x) => x.toLocaleString(locale());
const usd = (value) => Number(value).toLocaleString(locale(), { style: "currency", currency: "USD" });
const VERSION = chrome.runtime.getManifest().version;

let tab; // active tab, popup only
let inPopup = false;
let existing = false; // a résumé is already saved for this tab's job
let setupOpen = false;
let aboutOpen = false;

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
  const showSetup = !aboutOpen && (!inPopup || setupOpen || !configured);
  const showMain = inPopup && !aboutOpen;
  const readable = /^(https?|file):/.test(tab?.url || "");
  const option = $("model").selectedOptions[0];

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
  $("ready").hidden = !showMain || showSetup;
  $("existing").hidden = !showMain || showSetup || !existing;
  $("summary").hidden = !showMain || showSetup;
  $("summaryText").textContent = t("p.summary", { n: n(cv.length), model: option.dataset.name });
  $("toggleSetup").hidden = !showMain || !configured;
  $("toggleSetup").setAttribute("aria-expanded", String(showSetup));

  $("generate").hidden = !showMain;
  $("generate").disabled = !configured || !readable;
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
  const stored = await chrome.storage.local.get([...FIELDS, "result"]);
  $("apiKey").value = stored.apiKey || "";
  $("cv").value = stored.cv || "";
  $("model").value = stored.model || "claude-opus-5-5";
  $("lang").value = currentLang();
  $("theme").value = currentTheme();

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
for (const id of ["lang", "theme"]) {
  $(id).onchange = () => {
    localStorage[id] = $(id).value;
    applyPrefs();
    render();
  };
}

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
