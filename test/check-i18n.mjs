// node test/check-i18n.mjs — fails if a language is missing a key or the code uses a key that does not exist.
import assert from "node:assert";
import fs from "node:fs";
import vm from "node:vm";

const noop = () => {};
const ctx = {
  localStorage: {},
  navigator: { language: "pt-BR" },
  document: { documentElement: { dataset: {} }, querySelectorAll: () => [], addEventListener: noop },
  addEventListener: noop,
};
vm.runInNewContext(fs.readFileSync("src/i18n.js", "utf8") + "\nthis.STRINGS = STRINGS;", ctx);

const keys = (lang) => Object.keys(ctx.STRINGS[lang]).sort();
for (const lang of ["pt", "es"]) assert.deepStrictEqual(keys(lang), keys("en"), `${lang} keys differ from en`);

const source = ["popup.html", "result.html", "popup.js", "result.js", "core.js"].map((f) => fs.readFileSync(`src/${f}`, "utf8")).join("\n");
const used = [...source.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"|\bt\("([^"]+)"/g)].map((m) => m[1] || m[2]);
// explain() in core.js builds its keys as e.<name>.title / e.<name>.text
for (const [, name] of source.matchAll(/\bnotice\("([^"]+)"/g)) used.push(`e.${name}.title`, `e.${name}.text`);
for (const key of used) assert.ok(key in ctx.STRINGS.en, `key used but not translated: ${key}`);
console.log(`ok: ${keys("en").length} keys in 3 languages, ${new Set(used).size} used in the code`);
