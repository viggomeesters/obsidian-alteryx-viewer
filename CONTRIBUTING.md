# Contributing

Thanks for helping improve Alteryx Viewer.

## Development

```bash
npm install
npm run build
npx tsc --noEmit
npm test
```

For manual testing, copy or symlink the repository into `.obsidian/plugins/alteryx-viewer/` in a test vault, reload the app, and open synthetic `.yxmd` or `.yxzp` files.

## Scope guard

- Keep the plugin inspect-only.
- Do not add workflow execution, generation, conversion, validation save-back, shell commands, network calls, clipboard calls, or dynamic code execution.
- Do not commit real client workflows or private fixtures.
- Preserve parser fixture coverage for metadata, tools, connections, paths, formulas, containers, unknown tools, broken connections, malformed XML, and package listing.
