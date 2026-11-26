// Clique no ícone: captura o texto visível da aba e abre a página de resultado.
chrome.action.onClicked.addListener(async (tab) => {
  let job = "";
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.innerText,
    });
    job = result || "";
  } catch {
    // páginas chrome://, Web Store etc. não permitem leitura; result.js mostra o erro
  }
  await chrome.storage.local.set({ job, jobUrl: tab.url || "" });
  chrome.tabs.create({ url: "result.html" });
});
