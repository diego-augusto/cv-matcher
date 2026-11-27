// npm test — unit tests for src/core.js plus static checks on the extension files.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import { ApiError, MAX_PDF_BYTES, MODEL_NAMES, PDF_SCHEMA, SCHEMA, buildPdfRequest, buildRequest, estimatePdfCost, foldEvent, inspectPdf, splitEvents, streamResult, explain, parseResponse, startMode } from "../src/core.js";

const read = (file) => fs.readFileSync(`src/${file}`, "utf8");

// ---------- startMode: a reload must never call the API ----------

test("startMode generates only with #new and a captured job", () => {
  const job = { text: "job" };
  const result = { cv: {} };
  assert.equal(startMode("#new", { job, result }), "generate");
  assert.equal(startMode("#new", { job }), "generate");
  assert.equal(startMode("", { job, result }), "saved"); // reload, or "Open" from the popup
  assert.equal(startMode("#other", { job, result }), "saved");
  assert.equal(startMode("#new", { result }), "saved");
  assert.equal(startMode("", { job }), "empty");
  assert.equal(startMode("#new", {}), "empty");
});

// ---------- buildRequest ----------

const request = (model) => {
  const { headers, body } = buildRequest({ apiKey: "sk-ant-x", cv: "MY CV", model, jobText: "THE JOB" });
  return { headers, body: JSON.parse(body) };
};

test("buildRequest sends what a browser-origin structured call needs", () => {
  const { headers, body } = request("claude-opus-5-5");
  assert.equal(headers["x-api-key"], "sk-ant-x");
  assert.equal(headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.deepEqual(body.thinking, { type: "adaptive" });
  assert.deepEqual(body.output_config.format, { type: "json_schema", schema: SCHEMA });
  assert.equal(body.messages[0].content, "<resume>\nMY CV\n</resume>\n\n<page>\nTHE JOB\n</page>");
  assert.ok(!("temperature" in body), "current models reject temperature");
  assert.ok(!("budget_tokens" in body.thinking), "current models reject budget_tokens");
});

test("buildRequest appends the user's instructions to SYSTEM instead of replacing it", () => {
  const system = (instructions) =>
    JSON.parse(buildRequest({ apiKey: "k", cv: "c", model: "claude-opus-5-5", jobText: "j", instructions }).body).system;
  assert.equal(system(""), system(undefined));
  assert.ok(system("ONE PAGE").startsWith(system("")));
  assert.ok(system("ONE PAGE").includes("<preferences>\nONE PAGE\n</preferences>"));
});

test("buildRequest asks for the server-side fallback on every model except Haiku", () => {
  for (const model of Object.keys(MODEL_NAMES)) {
    const { headers, body } = request(model);
    const expected = !model.includes("haiku");
    assert.equal(body.fallbacks === "default", expected, model);
    assert.equal(headers["anthropic-beta"] === "server-side-fallback-2026-07-01", expected, model);
  }
});

test("buildPdfRequest sends the PDF as a base64 document and asks for structured text", () => {
  const pdf = fs.readFileSync("test/fake-resume.pdf").toString("base64");
  const { headers, body } = buildPdfRequest({ apiKey: "sk-ant-x", model: "claude-haiku-5-5", pdf });
  const parsed = JSON.parse(body);
  assert.equal(headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.ok(!("anthropic-beta" in headers) && !("fallbacks" in parsed), "Haiku has no fallback");
  assert.deepEqual(parsed.output_config.format, { type: "json_schema", schema: PDF_SCHEMA });
  assert.deepEqual(parsed.messages[0].content[0], {
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: pdf },
  });
  assert.ok(pdf.startsWith("JVBERi0"), "the fixture is a PDF"); // "%PDF-"
  assert.equal(parsed.stream, true, "streamed, so the background worker keeps receiving bytes");
});

test("a streamed answer, split at any point, folds into what parseResponse() reads", () => {
  const sse = [
    { type: "message_start", message: { model: "claude-opus-5-5", usage: { input_tokens: 6100 } } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: '{"text":"# Mar' } },
    { type: "ping" },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: 'ina"}' } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2300 } },
    { type: "message_stop" },
  ].map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  for (const cut of [1, 37, 200, sse.length - 3]) {
    let msg = {};
    let buffer = "";
    for (const chunk of [sse.slice(0, cut), sse.slice(cut)]) {
      const { events, rest } = splitEvents(buffer + chunk);
      buffer = rest;
      msg = events.reduce(foldEvent, msg);
    }
    assert.deepEqual(parseResponse({ ok: true }, streamResult(msg)), {
      cv: { text: "# Marina" },
      model: "claude-opus-5-5",
      usage: { input: 6100, output: 2300 },
    });
  }
});

test("a mid-stream error event is an ApiError that explain() understands", () => {
  const e = thrown(() => foldEvent({}, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }));
  assert.ok(e instanceof ApiError);
  assert.equal(kind(e), "5xx");
  assert.equal(thrown(() => parseResponse({ ok: true }, streamResult({ stop_reason: "refusal" }))).message, "refusal");
});

test("inspectPdf counts pages and catches what the API would reject, before anything is paid", () => {
  assert.deepEqual(inspectPdf(new Uint8Array(fs.readFileSync("test/fake-resume.pdf"))), { pages: 2 });
  assert.deepEqual(inspectPdf(new TextEncoder().encode("# not a pdf")), { problem: "notPdf" });
  const big = new Uint8Array(MAX_PDF_BYTES + 1);
  big.set(new TextEncoder().encode("%PDF-1.7"));
  assert.deepEqual(inspectPdf(big), { problem: "tooBig" });
  // compressed page objects: count unknown, not zero
  assert.deepEqual(inspectPdf(new TextEncoder().encode("%PDF-1.7 /Type /Pages /Count 3")), { pages: null });
});

test("estimatePdfCost grows with pages and price, and assumes 2 pages when unknown", () => {
  const opus = { input: 4, output: 20 };
  assert.ok(estimatePdfCost(3, opus) > estimatePdfCost(1, opus));
  assert.ok(estimatePdfCost(2, opus) > estimatePdfCost(2, { input: 0.1, output: 0.5 }));
  assert.equal(estimatePdfCost(null, opus), estimatePdfCost(2, opus));
});

test("SCHEMA is strict: every object closes additionalProperties and requires all properties", () => {
  let objects = 0;
  (function walk(node) {
    if (node.type === "object") {
      objects++;
      assert.equal(node.additionalProperties, false);
      assert.deepEqual(node.required, Object.keys(node.properties));
      Object.values(node.properties).forEach(walk);
    }
    if (node.items) walk(node.items);
  })(SCHEMA);
  assert.equal(objects, 3);
});

// ---------- parseResponse ----------

const ok = { ok: true, status: 200, statusText: "OK" };
const thrown = (fn) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  assert.fail("expected an exception");
};

test("parseResponse returns the résumé JSON, the model that answered and the usage", () => {
  const data = {
    model: "claude-sonnet-5-5",
    stop_reason: "end_turn",
    content: [{ type: "thinking", thinking: "…" }, { type: "text", text: '{"name":"Ana"}' }],
    usage: { input_tokens: 10, output_tokens: 20 },
  };
  assert.deepEqual(parseResponse(ok, data), {
    cv: { name: "Ana" },
    model: "claude-sonnet-5-5",
    usage: { input: 10, output: 20 },
  });
});

test("parseResponse turns API failures into ApiError", () => {
  const http = thrown(() => parseResponse({ ok: false, status: 401, statusText: "Unauthorized" }, { error: { message: "invalid x-api-key" } }));
  assert.deepEqual([http.status, http.message], [401, "invalid x-api-key"]);
  // a body that is not JSON arrives here as {}
  assert.equal(thrown(() => parseResponse({ ok: false, status: 502, statusText: "Bad Gateway" }, {})).message, "Bad Gateway");
  assert.equal(thrown(() => parseResponse(ok, { stop_reason: "refusal" })).message, "refusal");
  assert.equal(thrown(() => parseResponse(ok, { stop_reason: "max_tokens" })).message, "max_tokens");
});

test("parseResponse without a text block is an ApiError, not a TypeError (which would read as a network failure)", () => {
  for (const data of [{}, { content: [] }, { content: [{ type: "thinking", thinking: "…" }] }]) {
    assert.ok(thrown(() => parseResponse(ok, data)) instanceof ApiError);
  }
});

// ---------- explain ----------

const t = (key) => key;
const kind = (e) => explain(e, t).title.split(".")[1];

test("explain maps each failure to its notice", () => {
  assert.equal(kind(new DOMException("aborted", "AbortError")), "cancel");
  assert.equal(kind(new TypeError("Failed to fetch")), "net");
  assert.equal(kind(new ApiError(401, "invalid x-api-key")), "401");
  assert.equal(kind(new ApiError(400, "Your credit balance is too low")), "credit");
  assert.equal(kind(new ApiError(403, "Your credit balance is too low")), "credit"); // credit wins over 403
  assert.equal(kind(new ApiError(403, "forbidden")), "model");
  assert.equal(kind(new ApiError(404, "model: nope")), "model");
  assert.equal(kind(new ApiError(429, "rate limited")), "429");
  assert.equal(kind(new ApiError(500, "boom")), "5xx");
  assert.equal(kind(new ApiError(529, "overloaded")), "5xx");
  assert.equal(kind(new ApiError(0, "refusal")), "refusal");
  assert.equal(kind(new ApiError(0, "max_tokens")), "max");
  assert.equal(kind(new ApiError(400, "bad request")), "unknown");
  assert.equal(kind(new SyntaxError("Unexpected token")), "unknown"); // the model's text was not JSON
});

test("explain offers the right actions and details", () => {
  assert.deepEqual(explain(new ApiError(401, "bad key"), t), {
    title: "e.401.title",
    text: "e.401.text",
    retry: true,
    detail: "API 401 · bad key",
    settings: true,
    note: "e.401.note",
  });
  assert.equal(explain(new ApiError(404, "x"), t).settings, true);
  assert.equal(explain(new ApiError(0, "refusal"), t).detail, undefined);
  assert.equal(explain(new ApiError(0, "The API response has no text block"), t).detail, "The API response has no text block");
});

// ---------- static checks on the extension files ----------

test("the model list in popup.html matches MODEL_NAMES", () => {
  const options = [...read("popup.html").matchAll(/<option value="(claude-[^"]+)" data-name="([^"]+)"/g)];
  assert.deepEqual(Object.fromEntries(options.map((m) => [m[1], m[2]])), MODEL_NAMES);
});

test("#cv stays plaintext-only, which is what makes persisting its innerHTML safe", () => {
  assert.match(read("result.html"), /id="cv" contenteditable="plaintext-only"/);
});

test("pages have no inline scripts or handlers (the MV3 CSP blocks them silently)", () => {
  for (const page of ["popup.html", "result.html"]) {
    for (const [tag] of read(page).matchAll(/<script\b[^>]*>/g)) assert.match(tag, /\bsrc="/, `${page}: ${tag}`);
    assert.doesNotMatch(read(page), /\son[a-z]+="/, page);
  }
});

test("every file the manifest and the pages point at exists", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  const files = [manifest.action.default_popup, manifest.options_page, manifest.background.service_worker, ...Object.values(manifest.icons)];
  for (const page of ["popup.html", "result.html"]) {
    files.push(...[...read(page).matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]));
  }
  for (const file of files) assert.ok(fs.existsSync(`src/${file}`), `missing src/${file}`);
});

test("every script parses", () => {
  for (const file of fs.readdirSync("src").filter((f) => f.endsWith(".js"))) {
    execFileSync(process.execPath, ["--check", `src/${file}`], { stdio: "pipe" });
  }
});
