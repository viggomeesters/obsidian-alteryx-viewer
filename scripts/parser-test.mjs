import assert from "node:assert/strict";
import fs from "node:fs";
import esbuild from "esbuild";
import { DOMParser } from "@xmldom/xmldom";

await esbuild.build({
  bundle: true,
  entryPoints: ["src/parser.ts"],
  format: "esm",
  outfile: ".tmp-parser-test.mjs",
  platform: "node",
  target: "node20",
});

const { parseAlteryxFile, parseYxmd, parseYxzp } = await import(new URL("../.tmp-parser-test.mjs", import.meta.url));
const parser = new DOMParser({
  errorHandler: {
    warning() {},
    error(message) {
      throw new Error(message);
    },
    fatalError(message) {
      throw new Error(message);
    },
  },
});

function fixtureBuffer(name) {
  const buffer = fs.readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function fixtureText(name) {
  return fs.readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url), "utf8");
}

const mini = parseYxmd(fixtureText("mini-workflow.yxmd"), parser);
assert.equal(mini.kind, "workflow");
assert.equal(mini.isMalformed, false);
assert.ok(mini.workflow);
assert.equal(mini.workflow.metadata.version, "2025.1");
assert.equal(mini.workflow.metadata.workflowId, "11111111-1111-1111-1111-111111111111");
assert.equal(mini.workflow.tools.length, 4);
assert.equal(mini.workflow.connections.length, 3);
assert.ok(mini.workflow.tools.some((tool) => tool.type === "DbFileInput" && tool.paths[0].value.includes("input.xlsx")));
assert.ok(mini.workflow.tools.some((tool) => tool.type === "Formula" && tool.formulas[0].value.includes("Trim")));

const containers = parseYxmd(fixtureText("containers.yxmd"), parser);
assert.equal(containers.kind, "workflow");
assert.ok(containers.workflow);
assert.ok(containers.workflow.tools.some((tool) => tool.type === "ControlContainer"));
assert.ok(containers.workflow.tools.some((tool) => tool.containerId === "10"));

const broken = parseYxmd(fixtureText("broken-unknown.yxmd"), parser);
assert.ok(broken.warnings.some((warning) => warning.label === "Unknown tool"));
assert.ok(broken.warnings.some((warning) => warning.label === "Broken connection"));
assert.ok(broken.warnings.some((warning) => warning.label === "Missing ToolID"));

const empty = parseYxmd("", parser);
assert.equal(empty.workflow, null);
assert.ok(empty.warnings.some((warning) => warning.label === "Empty file"));

const malformed = parseYxmd("<AlteryxDocument><Nodes></AlteryxDocument>", {
  parseFromString() {
    throw new Error("Opening and ending tag mismatch");
  },
});
assert.equal(malformed.isMalformed, true);
assert.ok(malformed.warnings.some((warning) => warning.label === "Parse error"));

const packaged = parseAlteryxFile(fixtureBuffer("package-listing.yxzp"), "package-listing.yxzp", parser);
assert.equal(packaged.kind, "package");
assert.ok(packaged.package);
assert.ok(packaged.package.workflowEntries.some((entry) => entry.path === "workflows/mini-workflow.yxmd"));

const invalidPackage = parseYxzp(new Uint8Array([1, 2, 3]).buffer);
assert.equal(invalidPackage.kind, "package");
assert.ok(invalidPackage.isMalformed);

fs.rmSync(new URL("../.tmp-parser-test.mjs", import.meta.url));
console.log("Alteryx parser fixture tests passed.");
