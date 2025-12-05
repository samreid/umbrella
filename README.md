# umbrella
Umbrella is a lightweight harness repo for PhET development. It checks out selected sims and common-code repositories into one workspace and provides npm scripts to clone, update, and run dev servers locally or in GitHub Codespaces.

## Quickstart
- `npm install` – clones base repos (`chipper`, `perennial-alias`) and installs their dependencies.
- `npm run add-sim -- <sim-name>` – clones the sim plus its `phetLibs` and common libs listed in `chipper/build.json`, running `npm install` in each.
- `npm start -- [sim-name]` – runs `npm start` inside the given sim (defaults to the first installed sim).

## Maintenance scripts
- `npm run list-sims` – show tracked sims.
- `npm run pull-all` / `push-all` – pull or push all tracked repos.
- `npm run status-all` – show working copy status for all tracked repos.
- `npm run clean-all` – discard working copy changes (`git reset --hard` + `git clean -fd`).
- `npm run remove-sim -- <sim-name>` – remove a sim and prune repos no longer required by any remaining sims.
