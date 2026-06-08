export const RENDER_SOURCE_LINE_LIMIT = 20000;

export interface WarningItem {
  label: string;
  message: string;
}

export interface WorkflowMetadata {
  version: string;
  name: string;
  workflowId: string;
  runSettings: KeyValueItem[];
}

export interface KeyValueItem {
  key: string;
  value: string;
}

export interface WorkflowTool {
  id: string;
  type: string;
  plugin: string;
  engine: string;
  label: string;
  annotation: string;
  containerId: string;
  position: string;
  configSummary: KeyValueItem[];
  paths: KeyValueItem[];
  formulas: KeyValueItem[];
  searchText: string;
}

export interface WorkflowConnection {
  originToolId: string;
  originPort: string;
  destinationToolId: string;
  destinationPort: string;
  name: string;
  searchText: string;
}

export interface ParsedWorkflow {
  metadata: WorkflowMetadata;
  tools: WorkflowTool[];
  connections: WorkflowConnection[];
  source: string;
}

export interface PackageEntry {
  path: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  isWorkflow: boolean;
  searchText: string;
}

export interface ParsedPackage {
  entries: PackageEntry[];
  workflowEntries: PackageEntry[];
}

export type ParsedAlteryxFile =
  | {
      kind: "workflow";
      workflow: ParsedWorkflow | null;
      package: null;
      warnings: WarningItem[];
      isMalformed: boolean;
      sourceLineCount: number;
      renderedSourceLineCount: number;
    }
  | {
      kind: "package";
      workflow: null;
      package: ParsedPackage | null;
      warnings: WarningItem[];
      isMalformed: boolean;
      sourceLineCount: 0;
      renderedSourceLineCount: 0;
    };

export interface XmlParserLike {
  parseFromString(data: string, mimeType: DOMParserSupportedType): Document;
}

const KNOWN_TOOL_TYPES = new Set([
  "AppendFields",
  "AutoField",
  "BlobInput",
  "BlobOutput",
  "ControlContainer",
  "CountRecords",
  "CrossTab",
  "DbFileInput",
  "DbFileOutput",
  "DynamicRename",
  "Filter",
  "FindReplace",
  "Formula",
  "GenerateRows",
  "Join",
  "MultiFieldFormula",
  "MultiRowFormula",
  "RecordID",
  "Sample",
  "Select",
  "Sort",
  "Summarize",
  "TextInput",
  "TextToColumns",
  "ToolContainer",
  "Transpose",
  "Union",
  "Unique",
]);

const RUN_SETTING_NAMES = new Set([
  "Memory",
  "GlobalRecordLimit",
  "TempFiles",
  "Annotation",
  "ConvErrorLimit",
  "ConvErrorLimit_Stop",
  "CancelOnError",
  "DisableBrowse",
  "DisableAllOutput",
  "EnablePerformanceProfiling",
  "RunWithE2",
  "DefaultTZ",
  "PredictiveToolsCodePage",
  "ShowAllMacroMessages",
  "ShowConnectionStatusIsOn",
  "ShowConnectionStatusOnlyWhenRunning",
  "ZoomLevel",
  "LayoutType",
  "IsTemplate",
]);

export function parseAlteryxFile(
  data: ArrayBuffer,
  fileName: string,
  parser: XmlParserLike = new DOMParser(),
): ParsedAlteryxFile {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "yxzp") return parseYxzp(data);
  return parseYxmd(decodeText(data), parser);
}

export function parseYxmd(data: string, parser: XmlParserLike = new DOMParser()): ParsedAlteryxFile {
  const warnings: WarningItem[] = [];
  const sourceLineCount = data ? data.split("\n").length : 0;
  const renderedSourceLineCount = Math.min(sourceLineCount, RENDER_SOURCE_LINE_LIMIT);

  if (!data.trim()) {
    return {
      kind: "workflow",
      workflow: null,
      package: null,
      warnings: [{ label: "Empty file", message: "Workflow file has no XML content." }],
      isMalformed: false,
      sourceLineCount,
      renderedSourceLineCount,
    };
  }

  let document: Document;
  try {
    document = parser.parseFromString(data, "application/xml");
  } catch (error) {
    return workflowParseError(data, `Unable to parse XML: ${getErrorMessage(error)}`);
  }

  const parserError = findParserError(document);
  if (parserError) return workflowParseError(data, parserError);

  const root = document.documentElement;
  if (!root || root.nodeName !== "AlteryxDocument") {
    warnings.push({
      label: "Unexpected root",
      message: `Expected AlteryxDocument root but found ${root?.nodeName || "none"}.`,
    });
  }

  const tools = parseTools(document, warnings);
  const connections = parseConnections(document, warnings);
  warnForBrokenConnections(connections, tools, warnings);

  if (sourceLineCount > RENDER_SOURCE_LINE_LIMIT) {
    warnings.push({
      label: "Source cap",
      message: `${sourceLineCount - RENDER_SOURCE_LINE_LIMIT} source lines are not rendered to keep the view responsive.`,
    });
  }

  return {
    kind: "workflow",
    workflow: {
      metadata: parseMetadata(document),
      tools,
      connections,
      source: data,
    },
    package: null,
    warnings,
    isMalformed: false,
    sourceLineCount,
    renderedSourceLineCount,
  };
}

export function parseYxzp(data: ArrayBuffer): ParsedAlteryxFile {
  const warnings: WarningItem[] = [];
  const entries = readZipEntries(new Uint8Array(data), warnings);
  const workflowEntries = entries.filter((entry) => entry.isWorkflow);

  if (entries.length === 0) {
    warnings.push({
      label: "Package contents",
      message: "No ZIP entries could be listed from this package.",
    });
  }

  if (workflowEntries.length === 0) {
    warnings.push({
      label: "Package contents",
      message: "Package listing contains no .yxmd workflow files.",
    });
  }

  return {
    kind: "package",
    workflow: null,
    package: { entries, workflowEntries },
    warnings,
    isMalformed: warnings.some((warning) => warning.label === "Package parse error"),
    sourceLineCount: 0,
    renderedSourceLineCount: 0,
  };
}

function parseMetadata(document: Document): WorkflowMetadata {
  const root = document.documentElement;
  const properties = firstChildElement(root, "Properties");
  const meta = properties ? firstChildElement(properties, "MetaInfo") : null;

  return {
    version: root?.getAttribute("yxmdVer") || "",
    name: textOf(meta, "Name"),
    workflowId: attrValue(firstChildElement(meta, "WorkflowId"), "value") || textOf(meta, "WorkflowId"),
    runSettings: parseRunSettings(properties),
  };
}

function parseRunSettings(properties: Element | null): KeyValueItem[] {
  if (!properties) return [];
  return childElements(properties)
    .filter((element) => RUN_SETTING_NAMES.has(element.nodeName))
    .map((element) => ({
      key: element.nodeName,
      value: attrValue(element, "value") || attrValue(element, "default") || compactText(element.textContent ?? ""),
    }))
    .filter((item) => item.value);
}

function parseTools(document: Document, warnings: WarningItem[]): WorkflowTool[] {
  const nodeElements = Array.from(document.getElementsByTagName("Node"));
  const seenIds = new Set<string>();

  return nodeElements.map((node, index) => {
    const id = node.getAttribute("ToolID") || "";
    if (!id) {
      warnings.push({
        label: "Missing ToolID",
        message: `Node ${index + 1} does not have a ToolID attribute.`,
      });
    } else if (seenIds.has(id)) {
      warnings.push({
        label: "Duplicate ToolID",
        message: `ToolID ${id} is used more than once.`,
      });
    }
    if (id) seenIds.add(id);

    const gui = firstChildElement(node, "GuiSettings");
    const engine = firstChildElement(node, "EngineSettings");
    const properties = firstChildElement(node, "Properties");
    const config = properties ? firstChildElement(properties, "Configuration") : null;
    const annotation = properties ? firstChildElement(properties, "Annotation") : null;
    const plugin = attrValue(gui, "Plugin");
    const engineName = [attrValue(engine, "EngineDll"), attrValue(engine, "EngineDllEntryPoint")]
      .filter(Boolean)
      .join(" / ");
    const type = inferToolType(plugin, attrValue(engine, "EngineDllEntryPoint"));
    const annotationText = textOf(annotation, "AnnotationText");
    const defaultAnnotation = textOf(annotation, "DefaultAnnotationText");
    const name = textOf(annotation, "Name");
    const label = annotationText || name || defaultAnnotation || type || (id ? `Tool ${id}` : "Tool");
    const containerId = findContainerId(node);
    const position = formatPosition(firstChildElement(gui, "Position"));
    const paths = extractPaths(config);
    const formulas = extractFormulas(config);
    const configSummary = summarizeConfiguration(config);

    if (type && !KNOWN_TOOL_TYPES.has(type) && !plugin.toLowerCase().includes("macro")) {
      warnings.push({
        label: "Unknown tool",
        message: `Tool ${id || index + 1} uses unrecognized type ${type}.`,
      });
    }

    const searchText = [
      id,
      type,
      plugin,
      engineName,
      label,
      annotationText,
      defaultAnnotation,
      containerId,
      position,
      ...configSummary.map((item) => `${item.key} ${item.value}`),
      ...paths.map((item) => `${item.key} ${item.value}`),
      ...formulas.map((item) => `${item.key} ${item.value}`),
    ]
      .join(" ")
      .toLowerCase();

    return {
      id,
      type,
      plugin,
      engine: engineName,
      label,
      annotation: annotationText || defaultAnnotation,
      containerId,
      position,
      configSummary,
      paths,
      formulas,
      searchText,
    };
  });
}

function parseConnections(document: Document, warnings: WarningItem[]): WorkflowConnection[] {
  return Array.from(document.getElementsByTagName("Connection")).map((connection, index) => {
    const origin = firstChildElement(connection, "Origin");
    const destination = firstChildElement(connection, "Destination");
    const parsed = {
      originToolId: attrValue(origin, "ToolID"),
      originPort: attrValue(origin, "Connection"),
      destinationToolId: attrValue(destination, "ToolID"),
      destinationPort: attrValue(destination, "Connection"),
      name: attrValue(connection, "name"),
      searchText: "",
    };

    if (!parsed.originToolId || !parsed.destinationToolId) {
      warnings.push({
        label: "Broken connection",
        message: `Connection ${index + 1} is missing an origin or destination ToolID.`,
      });
    }

    parsed.searchText = [
      parsed.originToolId,
      parsed.originPort,
      parsed.destinationToolId,
      parsed.destinationPort,
      parsed.name,
    ]
      .join(" ")
      .toLowerCase();
    return parsed;
  });
}

function warnForBrokenConnections(
  connections: WorkflowConnection[],
  tools: WorkflowTool[],
  warnings: WarningItem[],
): void {
  const ids = new Set(tools.map((tool) => tool.id).filter(Boolean));
  connections.forEach((connection, index) => {
    if (connection.originToolId && !ids.has(connection.originToolId)) {
      warnings.push({
        label: "Broken connection",
        message: `Connection ${index + 1} origin ToolID ${connection.originToolId} is not present.`,
      });
    }
    if (connection.destinationToolId && !ids.has(connection.destinationToolId)) {
      warnings.push({
        label: "Broken connection",
        message: `Connection ${index + 1} destination ToolID ${connection.destinationToolId} is not present.`,
      });
    }
  });
}

function summarizeConfiguration(config: Element | null): KeyValueItem[] {
  if (!config) return [];
  const summary: KeyValueItem[] = [];
  const queue = childElements(config);

  while (queue.length > 0 && summary.length < 16) {
    const element = queue.shift();
    if (!element) continue;
    const text = compactText(element.textContent ?? "");
    const attrs = Array.from(element.attributes)
      .slice(0, 4)
      .map((attribute) => `${attribute.name}=${attribute.value}`)
      .join(", ");

    if (text && childElements(element).length === 0) {
      summary.push({ key: element.nodeName, value: text });
    } else if (attrs) {
      summary.push({ key: element.nodeName, value: attrs });
    }
    queue.push(...childElements(element));
  }

  return dedupeItems(summary).slice(0, 12);
}

function extractPaths(config: Element | null): KeyValueItem[] {
  if (!config) return [];
  const paths: KeyValueItem[] = [];

  walkElements(config, (element) => {
    const nodeName = element.nodeName.toLowerCase();
    const text = compactText(element.textContent ?? "");
    if (nodeName.includes("file") && text) {
      paths.push({ key: element.nodeName, value: text });
    }
    Array.from(element.attributes).forEach((attribute) => {
      const attrName = attribute.name.toLowerCase();
      const value = attribute.value;
      if ((attrName.includes("file") || looksLikePath(value)) && value) {
        paths.push({ key: `${element.nodeName}.${attribute.name}`, value });
      }
    });
  });

  return dedupeItems(paths).slice(0, 24);
}

function extractFormulas(config: Element | null): KeyValueItem[] {
  if (!config) return [];
  const formulas: KeyValueItem[] = [];

  walkElements(config, (element) => {
    const nodeName = element.nodeName;
    if (nodeName === "FormulaField") {
      formulas.push({
        key: attrValue(element, "field") || "FormulaField",
        value: attrValue(element, "expression") || compactText(element.textContent ?? ""),
      });
      return;
    }

    if (nodeName === "Expression") {
      formulas.push({ key: "Expression", value: compactText(element.textContent ?? "") });
      return;
    }

    Array.from(element.attributes).forEach((attribute) => {
      if (attribute.name.toLowerCase().includes("expression")) {
        formulas.push({ key: `${element.nodeName}.${attribute.name}`, value: attribute.value });
      }
    });
  });

  return dedupeItems(formulas).slice(0, 24);
}

function readZipEntries(bytes: Uint8Array, warnings: WarningItem[]): PackageEntry[] {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    warnings.push({ label: "Package parse error", message: "File does not start with a ZIP signature." });
    return [];
  }

  const entries: PackageEntry[] = [];
  let offset = 0;
  let guard = 0;

  while (offset + 30 <= bytes.length && guard < 5000) {
    guard += 1;
    const signature = readUInt32(bytes, offset);

    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) {
      const next = findNextLocalHeader(bytes, offset + 1);
      if (next < 0) break;
      offset = next;
      continue;
    }

    const flags = readUInt16(bytes, offset + 6);
    const compressionMethod = readUInt16(bytes, offset + 8);
    const compressedSize = readUInt32(bytes, offset + 18);
    const uncompressedSize = readUInt32(bytes, offset + 22);
    const fileNameLength = readUInt16(bytes, offset + 26);
    const extraLength = readUInt16(bytes, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const path = decodeUtf8(bytes.slice(nameStart, nameStart + fileNameLength));

    if (path) {
      entries.push({
        path,
        compressedSize,
        uncompressedSize,
        compressionMethod,
        isWorkflow: path.toLowerCase().endsWith(".yxmd"),
        searchText: `${path} ${compressionMethod} ${compressedSize} ${uncompressedSize}`.toLowerCase(),
      });
    }

    if ((flags & 0x08) === 0x08) {
      warnings.push({
        label: "Package contents",
        message: `${path || "An entry"} uses a ZIP data descriptor; following entries may be incomplete.`,
      });
      break;
    }

    offset = dataStart + compressedSize;
  }

  return entries;
}

function workflowParseError(data: string, message: string): ParsedAlteryxFile {
  const sourceLineCount = data ? data.split("\n").length : 0;
  return {
    kind: "workflow",
    workflow: null,
    package: null,
    warnings: [{ label: "Parse error", message }],
    isMalformed: true,
    sourceLineCount,
    renderedSourceLineCount: Math.min(sourceLineCount, RENDER_SOURCE_LINE_LIMIT),
  };
}

function inferToolType(plugin: string, engineEntryPoint: string): string {
  const pluginType = plugin.split(".").filter(Boolean).pop() || "";
  if (pluginType) return pluginType;
  return engineEntryPoint.replace(/^Alteryx/, "");
}

function findContainerId(node: Element): string {
  let parent = node.parentNode;
  while (parent) {
    if (parent.nodeType === 1 && parent.nodeName === "Node") {
      return (parent as Element).getAttribute("ToolID") || "";
    }
    parent = parent.parentNode;
  }
  return "";
}

function formatPosition(position: Element | null): string {
  if (!position) return "";
  const x = attrValue(position, "x");
  const y = attrValue(position, "y");
  return x || y ? `${x || "?"}, ${y || "?"}` : "";
}

function firstChildElement(parent: Element | null | undefined, name: string): Element | null {
  if (!parent) return null;
  return childElements(parent).find((element) => element.nodeName === name) ?? null;
}

function childElements(parent: Element): Element[] {
  return Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === 1);
}

function walkElements(root: Element, visit: (element: Element) => void): void {
  visit(root);
  childElements(root).forEach((child) => walkElements(child, visit));
}

function textOf(parent: Element | null | undefined, name: string): string {
  const element = firstChildElement(parent, name);
  return compactText(element?.textContent ?? "");
}

function attrValue(element: Element | null | undefined, name: string): string {
  return element?.getAttribute(name) ?? "";
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikePath(value: string): boolean {
  return /(^|[./\\])[\w .-]+\.(csv|dat|txt|xlsx|xls|yxdb|yxmd|json|xml)(\|\|\|.*)?$/i.test(value);
}

function dedupeItems(items: KeyValueItem[]): KeyValueItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.key}\u0000${item.value}`;
    if (!item.value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function decodeText(data: ArrayBuffer): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(data);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function readUInt16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function findNextLocalHeader(bytes: Uint8Array, start: number): number {
  for (let index = start; index + 3 < bytes.length; index += 1) {
    if (
      bytes[index] === 0x50 &&
      bytes[index + 1] === 0x4b &&
      bytes[index + 2] === 0x03 &&
      bytes[index + 3] === 0x04
    ) {
      return index;
    }
  }
  return -1;
}

function findParserError(document: Document): string | null {
  const parserErrors = Array.from(document.getElementsByTagName("parsererror"));
  if (parserErrors.length === 0) return null;
  return parserErrors
    .map((error) => error.textContent?.replace(/\s+/g, " ").trim())
    .filter((message): message is string => Boolean(message))
    .join(" ");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
