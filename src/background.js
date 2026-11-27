// Background service worker: reads a résumé PDF with the API, so the popup can close while it runs.
// The progress lives in chrome.storage.local.pdfImport, which the popup and the options tab both render:
//   { step: "reading" | "done" | "error", file: {name, size, pages}, started, phase, chars, cost?, previous?, error? }
import { ApiError, buildPdfRequest, foldEvent, parseResponse, splitEvents, streamResult } from "./core.js";

let controller = null;
const save = (pdfImport) => chrome.storage.local.set({ pdfImport });

// A fresh worker means an import still marked "reading" died with the previous one.
chrome.storage.local.get("pdfImport").then(({ pdfImport }) => {
  if (pdfImport?.step === "reading" && !controller) save({ ...pdfImport, step: "error", error: { kind: "interrupted" } });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "pdf:start") readPdf(message);
  if (message.type === "pdf:cancel") controller?.abort();
});

async function readPdf({ pdf, file, model, prices }) {
  controller?.abort();
  controller = new AbortController();
  const { signal } = controller;
  const base = { step: "reading", file, started: Date.now(), phase: 0, chars: 0 };
  await save(base);
  // Extension API calls reset the worker's idle timer while the model thinks and nothing arrives.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20e3);
  try {
    const { apiKey, cv: previous = "" } = await chrome.storage.local.get(["apiKey", "cv"]);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      ...buildPdfRequest({ apiKey, model, pdf }),
    });
    if (!res.ok) parseResponse(res, await res.json().catch(() => ({}))); // throws the ApiError
    await save({ ...base, phase: 1 });

    let msg = {};
    let buffer = "";
    let saved = 0;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      const { events, rest } = splitEvents(buffer + chunk.value);
      buffer = rest;
      msg = events.reduce(foldEvent, msg);
      if (msg.text && Date.now() - saved > 500) {
        saved = Date.now();
        await save({ ...base, phase: 2, chars: msg.text.length });
      }
    }

    const { cv, usage } = parseResponse(res, streamResult(msg));
    const text = cv.text?.trim();
    if (!text) return await save({ ...base, step: "error", error: { kind: "empty" } });
    const cost = (usage.input * prices.input + usage.output * prices.output) / 1e6;
    await chrome.storage.local.set({ cv: text, pdfImport: { ...base, step: "done", chars: text.length, cost, previous } });
  } catch (e) {
    if (controller?.signal !== signal) return; // replaced by a newer import, which owns pdfImport now
    if (e.name === "AbortError") return await chrome.storage.local.remove("pdfImport");
    const kind = e instanceof ApiError ? "api" : e.name;
    await save({ ...base, step: "error", error: { kind, status: e.status, message: e.message } });
  } finally {
    clearInterval(keepAlive);
    if (controller?.signal === signal) controller = null;
  }
}
