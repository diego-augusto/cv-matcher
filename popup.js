// Mesma página serve de popup (clique no ícone) e de página de opções (aba).
const $ = (id) => document.getElementById(id);
const FIELDS = ["apiKey", "cv", "model"];
const n = (x) => x.toLocaleString("pt-BR");

let tab; // aba ativa, só no popup
let inPopup = false;
let existing = false; // já há currículo salvo para a vaga desta aba
let setupOpen = false;

// Só bloqueia o que é certamente errado; outros formatos sk-ant-* ficam por conta da API.
function keyProblem(key) {
  if (key.startsWith("sk-ant-oat"))
    return "Este é um token do Claude Code (sk-ant-oat) e não funciona aqui. Use uma chave do Console, que começa com sk-ant-api.";
  if (key && !key.startsWith("sk-ant-")) return "Isto não parece uma chave da Anthropic. Ela começa com sk-ant-api.";
  return "";
}

function render() {
  const key = $("apiKey").value.trim();
  const cv = $("cv").value.trim();
  const problem = keyProblem(key);
  const configured = Boolean(key && !problem && cv);
  const showSetup = !inPopup || setupOpen || !configured;
  const readable = /^(https?|file):/.test(tab?.url || "");
  const option = $("model").selectedOptions[0];

  $("keyMsg").textContent = problem;
  $("keyMsg").hidden = !problem;
  $("apiKey").setAttribute("aria-invalid", String(Boolean(problem)));
  $("modelHelp").textContent = `${option.dataset.price} por milhão de tokens.`;
  $("cvCount").textContent = `${n(cv.length)} caracteres`;

  $("setup").hidden = !showSetup;
  $("ready").hidden = !inPopup || showSetup;
  $("existing").hidden = !existing || showSetup;
  $("summary").hidden = !inPopup || showSetup;
  $("summaryText").textContent = `Currículo: ${n(cv.length)} caracteres · ${option.text.split(" · ")[0]}`;
  $("toggleSetup").hidden = !inPopup || !configured;
  $("toggleSetup").setAttribute("aria-expanded", String(showSetup));

  $("generate").hidden = !inPopup;
  $("generate").disabled = !configured || !readable;
  $("hint").textContent = !inPopup
    ? ""
    : problem
      ? "Corrija a chave para liberar a geração."
      : !configured
        ? "Preencha a chave e o currículo para liberar a geração."
        : !readable
          ? "Esta página não pode ser lida pela extensão."
          : "";
}

(async () => {
  const stored = await chrome.storage.local.get([...FIELDS, "result"]);
  $("apiKey").value = stored.apiKey || "";
  $("cv").value = stored.cv || "";
  $("model").value = stored.model || "claude-opus-5-5";

  inPopup = !(await chrome.tabs.getCurrent());
  document.documentElement.classList.toggle("tab", !inPopup);
  if (inPopup) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    $("tabTitle").textContent = tab?.title || "(página sem título)";
    $("tabHost").textContent = URL.canParse(tab?.url) ? new URL(tab.url).hostname : "";
    existing = Boolean(tab?.url) && stored.result?.job?.url === tab.url;
  }
  render();
})();

// Salva a cada tecla: o popup fecha ao perder o foco, sem chance de clicar em "Salvar".
for (const id of FIELDS) {
  $(id).addEventListener("input", async () => {
    render();
    await chrome.storage.local.set({ [id]: $(id).value.trim() });
    $("saved").hidden = false;
  });
}

for (const id of ["toggleSetup", "change"]) {
  $(id).onclick = () => {
    setupOpen = !setupOpen;
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
    // páginas chrome://, Web Store etc. não permitem leitura
  }
  if (!text.trim()) return ($("hint").textContent = "Não consegui ler o texto desta página.");
  await chrome.storage.local.set({ job: { text, url: tab.url || "", title: tab.title || "" } });
  chrome.tabs.create({ url: "result.html#new" }); // #new: única forma de disparar uma geração ao abrir
};
