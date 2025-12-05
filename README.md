# umbrella
Umbrella is a lightweight harness repo for PhET development. It checks out selected sims and common-code repositories into one workspace and provides npm scripts to clone, update, and run dev servers locally or in GitHub Codespaces.

## Quickstart
- `npm run add-sim -- <sim-name>` – clones the sim plus its `phetLibs` and common libs listed in `chipper/build.json` (no auto-install in sims/libs).
- `npm start` – runs the chipper dev server (`grunt dev-server --port=8123`) and `perennial-alias/bin/watch-strings.zsh` (strings watcher output streams to stdout). Add at least one sim first.

## Example Usage
- `npm run add-sim -- circuit-construction-kit-dc`
- `npm start`
