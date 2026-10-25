import {
  FileView,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import {
  KeyValueItem,
  PackageEntry,
  ParsedAlteryxFile,
  WarningItem,
  WorkflowConnection,
  WorkflowTool,
  parseAlteryxFile,
} from "./parser";

const VIEW_TYPE_ALTERYX_VIEWER = "alteryx-viewer";
const ALTERYX_EXTENSIONS = ["yxmd", "yxzp"];

type ViewMode = "summary" | "tools" | "connections" | "source" | "package";

export default class AlteryxViewerPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(
      VIEW_TYPE_ALTERYX_VIEWER,
      (leaf) => new AlteryxViewerView(leaf),
    );
    this.registerExtensions(ALTERYX_EXTENSIONS, VIEW_TYPE_ALTERYX_VIEWER);

    this.addCommand({
      id: "open-current-alteryx-in-viewer",
      name: "Open current Alteryx file in viewer",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!isAlteryxFile(file)) return false;

        if (!checking) {
          void this.openAlteryxFile(file);
        }
        return true;
      },
    });
  }

  async openAlteryxFile(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({
      type: VIEW_TYPE_ALTERYX_VIEWER,
      state: { file: file.path },
      active: true,
    });
  }
}

class AlteryxViewerView extends FileView {
  private parsed: ParsedAlteryxFile | null = null;
  private mode: ViewMode = "summary";
  private filterValue = "";
  private errorMessage = "";

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_ALTERYX_VIEWER;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Alteryx viewer";
  }

  getIcon(): string {
    return "workflow";
  }

  async onLoadFile(file: TFile): Promise<void> {
    await this.loadAlteryxFile(file);
  }

  async onUnloadFile(): Promise<void> {
    this.parsed = null;
    this.errorMessage = "";
    this.contentEl.empty();
  }

  private async loadAlteryxFile(file: TFile): Promise<void> {
    try {
      const data = await this.app.vault.readBinary(file);
      this.parsed = parseAlteryxFile(data, file.name);
      this.mode = this.parsed.kind === "package" ? "package" : this.mode === "package" ? "summary" : this.mode;
      this.errorMessage = "";
    } catch (error) {
      this.parsed = null;
      this.errorMessage = `Unable to read Alteryx file: ${getErrorMessage(error)}`;
    }
    this.render();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("alteryx-viewer");

    const header = container.createDiv({ cls: "alteryx-viewer__header" });
    this.renderTitle(header);
    this.renderToolbar(header);

    if (!this.file) {
      renderMessage(container, "No Alteryx file is attached to this viewer.");
      return;
    }

    if (!isAlteryxFile(this.file)) {
      renderMessage(container, "This viewer only supports .yxmd and .yxzp files.");
      return;
    }

    if (this.errorMessage) {
      renderMessage(container, this.errorMessage);
      return;
    }

    if (!this.parsed) {
      renderMessage(container, "Alteryx file is not loaded.");
      return;
    }

    renderWarnings(container, this.parsed.warnings);

    if (this.parsed.kind === "package") {
      renderPackage(container, this.parsed.package, this.filterValue);
      return;
    }

    if (this.parsed.isMalformed || !this.parsed.workflow) {
      renderSource(container, this.parsed.workflow?.source ?? "", this.parsed.renderedSourceLineCount);
      return;
    }

    this.renderModeTabs(container);
    if (this.mode === "tools") {
      renderTools(container, this.parsed.workflow.tools, this.filterValue);
    } else if (this.mode === "connections") {
      renderConnections(container, this.parsed.workflow.connections, this.filterValue);
    } else if (this.mode === "source") {
      renderSource(container, this.parsed.workflow.source, this.parsed.renderedSourceLineCount);
    } else {
      renderWorkflowSummary(container, this.parsed);
    }
  }

  private renderTitle(parent: HTMLElement): void {
    const title = parent.createDiv({ cls: "alteryx-viewer__title" });
    title.createDiv({
      cls: "alteryx-viewer__filename",
      text: this.file?.name ?? "Alteryx file",
    });
    title.createDiv({
      cls: "alteryx-viewer__path",
      text: this.file?.path ?? "",
    });
  }

  private renderToolbar(parent: HTMLElement): void {
    const toolbar = parent.createDiv({ cls: "alteryx-viewer__toolbar" });

    const searchWrap = toolbar.createDiv({ cls: "alteryx-viewer__search" });
    setIcon(searchWrap.createSpan({ cls: "alteryx-viewer__search-icon" }), "search");
    const searchInput = searchWrap.createEl("input", {
      attr: {
        "aria-label": "Filter Alteryx details",
        placeholder: "Filter",
        spellcheck: "false",
        type: "search",
        value: this.filterValue,
      },
    });
    searchInput.addEventListener("input", () => {
      this.filterValue = searchInput.value;
      this.render();
    });

    const refreshButton = createIconButton(toolbar, "refresh-cw", "Refresh file");
    refreshButton.addEventListener("click", () => {
      void this.reloadFile();
    });
  }

  private renderModeTabs(parent: HTMLElement): void {
    const tabs = parent.createDiv({
      cls: "alteryx-viewer__tabs",
      attr: { "aria-label": "Workflow view mode" },
    });

    [
      ["summary", "Summary"],
      ["tools", "Tools"],
      ["connections", "Connections"],
      ["source", "Source"],
    ].forEach(([mode, label]) => {
      const button = tabs.createEl("button", {
        cls: "alteryx-viewer__tab",
        text: label,
        attr: { type: "button" },
      });
      button.toggleClass("is-active", this.mode === mode);
      button.addEventListener("click", () => {
        this.mode = mode as ViewMode;
        this.render();
      });
    });
  }

  private async reloadFile(): Promise<void> {
    if (!this.file) {
      new Notice("No Alteryx file to refresh");
      return;
    }
    await this.loadAlteryxFile(this.file);
  }
}

function renderWorkflowSummary(parent: HTMLElement, parsed: ParsedAlteryxFile): void {
  if (parsed.kind !== "workflow" || !parsed.workflow) return;
  const workflow = parsed.workflow;
  const summary = parent.createDiv({ cls: "alteryx-viewer__summary" });
  summary.createSpan({ cls: "alteryx-viewer__pill", text: `${workflow.tools.length} tools` });
  summary.createSpan({ cls: "alteryx-viewer__pill", text: `${workflow.connections.length} connections` });
  summary.createSpan({ cls: "alteryx-viewer__pill", text: `${parsed.sourceLineCount} source lines` });
  if (workflow.metadata.version) {
    summary.createSpan({ cls: "alteryx-viewer__pill", text: `yxmd ${workflow.metadata.version}` });
  }

  const grid = parent.createDiv({ cls: "alteryx-viewer__grid" });
  const metadata = grid.createDiv({ cls: "alteryx-viewer__panel" });
  metadata.createDiv({ cls: "alteryx-viewer__panel-title", text: "Workflow metadata" });
  renderKeyValues(metadata, [
    { key: "Name", value: workflow.metadata.name },
    { key: "Workflow ID", value: workflow.metadata.workflowId },
    { key: "Version", value: workflow.metadata.version },
    ...workflow.metadata.runSettings,
  ]);

  const paths = workflow.tools.flatMap((tool) =>
    tool.paths.map((path) => ({
      key: tool.id ? `${tool.id} ${path.key}` : path.key,
      value: path.value,
    })),
  );
  const pathPanel = grid.createDiv({ cls: "alteryx-viewer__panel" });
  pathPanel.createDiv({ cls: "alteryx-viewer__panel-title", text: "Input/output paths" });
  renderKeyValues(pathPanel, paths.slice(0, 24), "No file paths found in tool configs.");

  const formulas = workflow.tools.flatMap((tool) =>
    tool.formulas.map((formula) => ({
      key: tool.id ? `${tool.id} ${formula.key}` : formula.key,
      value: formula.value,
    })),
  );
  const formulaPanel = grid.createDiv({ cls: "alteryx-viewer__panel alteryx-viewer__panel--wide" });
  formulaPanel.createDiv({ cls: "alteryx-viewer__panel-title", text: "Formula expressions" });
  renderKeyValues(formulaPanel, formulas.slice(0, 32), "No formula expressions found.");
}

function renderTools(parent: HTMLElement, tools: WorkflowTool[], query: string): void {
  const normalizedQuery = query.trim().toLowerCase();
  const visible = normalizedQuery ? tools.filter((tool) => tool.searchText.includes(normalizedQuery)) : tools;
  const list = parent.createDiv({ cls: "alteryx-viewer__list" });

  if (visible.length === 0) {
    renderMessage(list, "No tools match the current filter.");
    return;
  }

  visible.forEach((tool) => {
    const item = list.createDiv({ cls: "alteryx-viewer__tool" });
    const top = item.createDiv({ cls: "alteryx-viewer__tool-top" });
    top.createSpan({ cls: "alteryx-viewer__tool-id", text: tool.id || "missing id" });
    top.createSpan({ cls: "alteryx-viewer__tool-label", text: tool.label });
    top.createSpan({ cls: "alteryx-viewer__tool-type", text: tool.type || "unknown" });

    renderKeyValues(item, [
      { key: "Plugin", value: tool.plugin },
      { key: "Engine", value: tool.engine },
      { key: "Position", value: tool.position },
      { key: "Container", value: tool.containerId },
      ...tool.configSummary,
      ...tool.paths.map((path) => ({ key: `Path ${path.key}`, value: path.value })),
      ...tool.formulas.map((formula) => ({ key: `Formula ${formula.key}`, value: formula.value })),
    ]);
  });
}

function renderConnections(parent: HTMLElement, connections: WorkflowConnection[], query: string): void {
  const normalizedQuery = query.trim().toLowerCase();
  const visible = normalizedQuery
    ? connections.filter((connection) => connection.searchText.includes(normalizedQuery))
    : connections;
  const list = parent.createDiv({ cls: "alteryx-viewer__list" });

  if (visible.length === 0) {
    renderMessage(list, "No connections match the current filter.");
    return;
  }

  visible.forEach((connection) => {
    const item = list.createDiv({ cls: "alteryx-viewer__connection" });
    item.createSpan({
      cls: "alteryx-viewer__connection-flow",
      text: `${connection.originToolId || "?"}.${connection.originPort || "?"} -> ${
        connection.destinationToolId || "?"
      }.${connection.destinationPort || "?"}`,
    });
    if (connection.name) {
      item.createSpan({ cls: "alteryx-viewer__connection-name", text: connection.name });
    }
  });
}

function renderPackage(parent: HTMLElement, pkg: ParsedAlteryxFile["package"], query: string): void {
  if (!pkg) {
    renderMessage(parent, "Package listing is not available.");
    return;
  }

  const summary = parent.createDiv({ cls: "alteryx-viewer__summary" });
  summary.createSpan({ cls: "alteryx-viewer__pill", text: `${pkg.entries.length} entries` });
  summary.createSpan({ cls: "alteryx-viewer__pill", text: `${pkg.workflowEntries.length} workflows` });

  const normalizedQuery = query.trim().toLowerCase();
  const visible = normalizedQuery
    ? pkg.entries.filter((entry) => entry.searchText.includes(normalizedQuery))
    : pkg.entries;
  const list = parent.createDiv({ cls: "alteryx-viewer__list" });

  if (visible.length === 0) {
    renderMessage(list, "No package entries match the current filter.");
    return;
  }

  visible.forEach((entry) => renderPackageEntry(list, entry));
}

function renderPackageEntry(parent: HTMLElement, entry: PackageEntry): void {
  const item = parent.createDiv({
    cls: `alteryx-viewer__package-entry ${entry.isWorkflow ? "alteryx-viewer__package-entry--workflow" : ""}`,
  });
  item.createSpan({ cls: "alteryx-viewer__package-path", text: entry.path });
  item.createSpan({
    cls: "alteryx-viewer__package-meta",
    text: `${formatBytes(entry.uncompressedSize)} uncompressed, method ${entry.compressionMethod}`,
  });
}

function renderWarnings(parent: HTMLElement, warnings: WarningItem[]): void {
  if (warnings.length === 0) return;
  const box = parent.createDiv({ cls: "alteryx-viewer__warnings" });
  box.createDiv({ cls: "alteryx-viewer__warnings-title", text: "Warnings" });
  warnings.slice(0, 12).forEach((warning) => {
    box.createDiv({
      cls: "alteryx-viewer__warning",
      text: `${warning.label}: ${warning.message}`,
    });
  });
  if (warnings.length > 12) {
    box.createDiv({
      cls: "alteryx-viewer__warning-more",
      text: `${warnings.length - 12} additional warnings hidden`,
    });
  }
}

function renderKeyValues(parent: HTMLElement, items: KeyValueItem[], emptyText = "No values found."): void {
  const values = items.filter((item) => item.value);
  if (values.length === 0) {
    parent.createDiv({ cls: "alteryx-viewer__empty", text: emptyText });
    return;
  }

  const table = parent.createDiv({ cls: "alteryx-viewer__kv" });
  values.forEach((item) => {
    table.createDiv({ cls: "alteryx-viewer__kv-key", text: item.key });
    table.createDiv({ cls: "alteryx-viewer__kv-value", text: item.value });
  });
}

function renderSource(parent: HTMLElement, data: string, renderedLineCount: number): void {
  const source = parent.createDiv({ cls: "alteryx-viewer__source" });
  const pre = source.createEl("pre");
  data
    .split("\n")
    .slice(0, renderedLineCount)
    .forEach((line, index) => {
      const lineEl = pre.createDiv({ cls: "alteryx-viewer__source-line" });
      lineEl.createSpan({ cls: "alteryx-viewer__line-number", text: String(index + 1) });
      const code = lineEl.createSpan({ cls: "alteryx-viewer__source-code" });
      highlightXmlLine(code, line);
    });
}

function highlightXmlLine(parent: HTMLElement, line: string): void {
  const tokenPattern = /(<!--.*?-->|<!\[CDATA\[.*?\]\]>|<\/?[A-Za-z_][\w:.-]*|[A-Za-z_:][\w:.-]*(?==)|"[^"]*"|'[^']*'|[<>/=])/g;
  let cursor = 0;

  for (const match of line.matchAll(tokenPattern)) {
    if (match.index > cursor) {
      parent.createSpan({ text: line.slice(cursor, match.index) });
    }

    const token = match[0];
    parent.createSpan({ cls: tokenClass(token), text: token });
    cursor = match.index + token.length;
  }

  if (cursor < line.length) {
    parent.createSpan({ text: line.slice(cursor) });
  }
}

function tokenClass(token: string): string {
  if (token.startsWith("<!--")) return "alteryx-viewer__tok-comment";
  if (token.startsWith("<![CDATA[")) return "alteryx-viewer__tok-cdata";
  if (token.startsWith("<")) return "alteryx-viewer__tok-tag";
  if (token.startsWith("\"") || token.startsWith("'")) return "alteryx-viewer__tok-string";
  if (["<", ">", "/", "="].includes(token)) return "alteryx-viewer__tok-punctuation";
  return "alteryx-viewer__tok-attr";
}

function createIconButton(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
  const button = parent.createEl("button", {
    cls: "clickable-icon alteryx-viewer__button",
    attr: { "aria-label": label, title: label, type: "button" },
  });
  setIcon(button, icon);
  return button;
}

function renderMessage(parent: HTMLElement, message: string): void {
  parent.createDiv({ cls: "alteryx-viewer__message", text: message });
}

function isAlteryxFile(file: TFile | null): file is TFile {
  return Boolean(file && ALTERYX_EXTENSIONS.includes(file.extension.toLowerCase()));
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
