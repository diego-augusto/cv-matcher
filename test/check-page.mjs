// node test/check-page.mjs — fails if a language of the project page (docs/) does not cover exactly the keys in its markup.
import assert from "node:assert";
import fs from "node:fs";
import vm from "node:vm";

const ctx = {
  localStorage: { getItem: () => null },
  navigator: { language: "en" },
  location: { search: "" },
  URLSearchParams,
  document: { documentElement: {}, querySelectorAll: () => [] },
};
vm.runInNewContext(fs.readFileSync("docs/page.js", "utf8") + "\nthis.STRINGS = STRINGS;", ctx);

const html = fs.readFileSync("docs/index.html", "utf8");
const used = [...new Set([...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]))].sort();
assert.ok(used.length > 0, "no data-i18n keys found in docs/index.html");
for (const lang of ["pt", "es"]) assert.deepStrictEqual(Object.keys(ctx.STRINGS[lang]).sort(), used, `${lang} keys differ from the markup`);
console.log(`ok: ${used.length} keys on the project page in 3 languages`);
