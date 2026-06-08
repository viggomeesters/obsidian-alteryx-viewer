import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const main = fs.readFileSync("src/main.ts", "utf8");
const parser = fs.readFileSync("src/parser.ts", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
const bundle = fs.existsSync("main.js") ? fs.readFileSync("main.js", "utf8") : "";

const assertions = [
  [manifest.id === "alteryx-viewer", "manifest id is alteryx-viewer"],
  [manifest.name === "Alteryx Viewer", "manifest display name is Alteryx Viewer"],
  [manifest.version === "0.1.0", "manifest version is 0.1.0"],
  [versions[manifest.version] === manifest.minAppVersion, "versions.json maps manifest version to min app version"],
  [!/obsidian/i.test(manifest.description), "manifest description avoids product name"],
  [/^[a-z-]+$/.test(manifest.id) && !manifest.id.includes("obsidian") && !manifest.id.endsWith("plugin"), "manifest id follows directory rules"],
  [main.includes("registerExtensions(ALTERYX_EXTENSIONS"), "extensions are registered"],
  [main.includes("[\"yxmd\", \"yxzp\"]"), "yxmd and yxzp extensions are in scope"],
  [main.includes("extends FileView"), "binary FileView is used"],
  [main.includes("this.app.vault.readBinary(file)"), "vault binary reader is used"],
  [main.includes("renderTools(container, this.parsed.workflow.tools, this.filterValue)"), "tool list view exists"],
  [main.includes("renderConnections(container, this.parsed.workflow.connections, this.filterValue)"), "connection view exists"],
  [main.includes("renderSource(container, this.parsed.workflow.source"), "source view code path exists"],
  [main.includes("renderPackage(container, this.parsed.package, this.filterValue)"), "package listing view exists"],
  [parser.includes("RENDER_SOURCE_LINE_LIMIT = 20000"), "source render cap exists"],
  [parser.includes("parseFromString(data, \"application/xml\")"), "DOMParser XML parsing is used"],
  [parser.includes("readZipEntries"), "yxzp package listing parser exists"],
  [!main.includes("navigator.clipboard") && !parser.includes("navigator.clipboard") && !bundle.includes("navigator.clipboard"), "no clipboard access"],
  [!main.includes("fetch(") && !parser.includes("fetch(") && !bundle.includes("fetch("), "no fetch usage"],
  [!main.includes("XMLHttpRequest") && !parser.includes("XMLHttpRequest") && !bundle.includes("XMLHttpRequest"), "no XMLHttpRequest usage"],
  [!main.includes("WebSocket") && !parser.includes("WebSocket") && !bundle.includes("WebSocket"), "no WebSocket usage"],
  [!main.includes("child_process") && !parser.includes("child_process") && !bundle.includes("child_process"), "no process execution module"],
  [!main.includes("spawn(") && !parser.includes("spawn(") && !bundle.includes("spawn("), "no spawn calls"],
  [!main.includes("exec(") && !parser.includes("exec(") && !bundle.includes("exec("), "no exec calls"],
  [!main.includes("eval(") && !parser.includes("eval(") && !bundle.includes("eval("), "no eval calls"],
  [!main.includes("new Function") && !parser.includes("new Function") && !bundle.includes("new Function"), "no dynamic functions"],
  [!main.includes("writeBinary") && !main.includes("writeFile") && !parser.includes("writeFile"), "no file writeback"],
  [!styles.includes("!important"), "styles do not use important overrides"],
  [fs.existsSync("README.md") && fs.existsSync("LICENSE") && fs.existsSync("manifest.json"), "root submission files exist"],
  [fs.existsSync("main.js") && fs.existsSync("styles.css"), "release assets exist"],
];

const failures = assertions.filter(([passes]) => !passes).map(([, label]) => label);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL: ${failure}`);
  }
  process.exit(1);
}

console.log("Alteryx Viewer smoke checks passed.");
