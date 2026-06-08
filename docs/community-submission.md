# Community submission checklist

- [x] Root `README.md` exists.
- [x] Root `LICENSE` exists.
- [x] Root `manifest.json` exists.
- [x] `manifest.json.id` is `alteryx-viewer`.
- [x] `manifest.json.name` is `Alteryx Viewer`.
- [x] `versions.json` maps `0.1.0` to the minimum app version.
- [x] Release assets are buildable as `main.js`, `manifest.json`, and `styles.css`.
- [x] GitHub release tag must exactly match `manifest.json.version`.
- [x] Release assets must be uploaded individually, not zipped.
- [x] `alteryx-viewer` and `Alteryx Viewer` were not present in `obsidianmd/obsidian-releases` community plugin list when checked.
- [x] Scope is documented as inspect-only.
- [x] Fixtures are synthetic.

Manual submission still requires repository owner sign-in and policy confirmation.

Suggested `community-plugins.json` entry:

```json
{
  "id": "alteryx-viewer",
  "name": "Alteryx Viewer",
  "author": "Viggo Meesters",
  "description": "Open .yxmd workflows and .yxzp packages as read-only summaries with search, source view, and warnings.",
  "repo": "viggomeesters/obsidian-alteryx-viewer"
}
```
