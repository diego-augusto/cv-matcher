// Mesma página serve de popup (clique no ícone) e de página de opções (aba).
const $ = (id) => document.getElementById(id);
const FIELDS = ["apiKey", "cv", "model"];

(async () => {
  const stored = await chrome.storage.local.get(FIELDS);
  $("apiKey").value = stored.apiKey || "";
  $("cv").value = stored.cv || "";
  $("model").value = stored.model || "claude-opus-5-5";
  $("setup").open = !stored.apiKey || !stored.cv;

  const inPopup = !(await chrome.tabs.getCurrent());
  document.documentElement.classList.toggle("tab", !inPopup);
  $("generate").hidden = !inPopup; // numa aba, não há vaga "atual" para ler
  if (!inPopup) $("setup").open = true;
})();

// Salva a cada tecla: o popup fecha ao perder o foco, sem chance de clicar em "Salvar".
for (const id of FIELDS) {
  $(id).addEventListener("input", () => chrome.storage.local.set({ [id]: $(id).value.trim() }));
}

$("generate").onclick = async () => {
  if (!$("apiKey").value.trim() || !$("cv").value.trim()) {
    $("setup").open = true;
    return ($("status").textContent = "Preencha a chave da API e o currículo abaixo.");
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let job = "";
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.innerText,
    });
    job = result || "";
  } catch {
    // páginas chrome://, Web Store etc. não permitem leitura
  }
  if (!job.trim()) return ($("status").textContent = "Não consegui ler o texto desta página.");
  await chrome.storage.local.set({ job, jobUrl: tab.url || "" });
  chrome.tabs.create({ url: "result.html" });
};
