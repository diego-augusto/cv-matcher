const $ = (id) => document.getElementById(id);

chrome.storage.local.get(["apiKey", "cv"]).then(({ apiKey = "", cv = "" }) => {
  $("apiKey").value = apiKey;
  $("cv").value = cv;
});

$("save").onclick = async () => {
  await chrome.storage.local.set({ apiKey: $("apiKey").value.trim(), cv: $("cv").value.trim() });
  $("status").textContent = "Salvo.";
};
