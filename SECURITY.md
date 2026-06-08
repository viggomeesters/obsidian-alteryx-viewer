# Security Policy

## Supported versions

Only the latest release is supported.

## Reporting a vulnerability

Open a private security advisory on GitHub when available, or contact the repository owner directly.

Do not include sensitive vault content in public issues. If a reproduction requires workflow content, reduce it to a minimal synthetic example first.

## Security model

Alteryx Viewer is read-only. It reads `.yxmd` and `.yxzp` files through the vault API and renders local inspection views. It does not send vault content to external services, does not use runtime network APIs, does not read or mutate the system clipboard, and does not save workflow XML or packages.

The plugin parses workflow XML locally with the runtime `DOMParser`. It lists package entries from ZIP headers and does not extract or execute package contents.
