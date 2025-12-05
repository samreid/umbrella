#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REPOS_DIR = path.join(ROOT, 'repos');
const INSTALLED_FILE = path.join(ROOT, 'installed-sims.json');
const CHIPPER = 'chipper';
const PERENNIAL_ALIAS = 'perennial-alias';
const PERENNIAL_REPO = 'perennial';

const commands = {
  'add-sim': addSim,
  'remove-sim': removeSim,
  'list-sims': listSims,
  'install-all': installAll,
  'pull-all': pullAll,
  'push-all': pushAll,
  'status-all': statusAll,
  'clean-all': cleanAll,
  start
};

main();

function main() {
  const [, , cmd, ...args] = process.argv;
  const action = commands[cmd];

  if (!action) {
    log(
      [
        'Usage:',
        '  npm run add-sim -- <sim>',
        '  npm run remove-sim -- <sim>',
        '  npm run list-sims',
        '  npm run install-all',
        '  npm run pull-all',
        '  npm run push-all',
        '  npm run status-all',
        '  npm run clean-all',
        '  npm start -- [sim]'
      ].join('\n')
    );
    process.exit(1);
  }

  ensureInstalledFile();
  fs.mkdirSync(REPOS_DIR, { recursive: true });
  action(...args);
}

function addSim(simName) {
  if (!simName) {
    exitWithError('add-sim requires a sim name, e.g. npm run add-sim -- circuit-construction-kit-dc');
  }

  log(`Adding sim ${simName}...`);
  ensureBaseRepos();
  ensureCommonLibs();
  ensureSimAndLibs(simName);

  const installed = readInstalled();
  if (!installed.includes(simName)) {
    installed.push(simName);
    writeInstalled(installed);
  }

  log(`Sim ${simName} added. Installed sims: ${readInstalled().join(', ') || 'none'}`);
}

function removeSim(simName) {
  if (!simName) {
    exitWithError('remove-sim requires a sim name, e.g. npm run remove-sim -- circuit-construction-kit-dc');
  }

  log(`Removing sim ${simName} and pruning unused repos...`);
  const installed = readInstalled();
  const next = installed.filter((name) => name !== simName);
  writeInstalled(next);

  const requiredRepos = computeRequiredRepos(next);
  pruneRepos(requiredRepos);

  log(`Remaining sims: ${next.join(', ') || 'none'}`);
}

function listSims() {
  const installed = readInstalled();
  if (!installed.length) {
    log('No sims installed. Try: npm run add-sim -- <sim>');
    return;
  }
  log(`Installed sims:\n- ${installed.join('\n- ')}`);
}

function installAll() {
  log('Ensuring base repos, common libs, and installs for all tracked sims...');
  ensureBaseRepos();
  ensureCommonLibs();

  const installed = readInstalled();
  installed.forEach(ensureSimAndLibs);

  log('install-all completed.');
}

function pullAll() {
  log('Pulling latest changes for all tracked repos...');
  installAll();
  forEachTrackedRepo((repoPath, name) => {
    run('git', ['pull', '--ff-only'], { cwd: repoPath }, `git pull failed in ${name}`);
  });
}

function pushAll() {
  log('Pushing all tracked repos...');
  installAll();
  forEachTrackedRepo((repoPath, name) => {
    run('git', ['push'], { cwd: repoPath }, `git push failed in ${name}`);
  });
}

function statusAll() {
  log('Status for all tracked repos:');
  installAll();
  forEachTrackedRepo((repoPath, name) => {
    log(`\n[${name}]`);
    run('git', ['status', '--short'], { cwd: repoPath });
  });
}

function cleanAll() {
  log('Discarding working copy changes for all tracked repos...');
  installAll();
  forEachTrackedRepo((repoPath, name) => {
    run('git', ['reset', '--hard'], { cwd: repoPath }, `git reset failed in ${name}`);
    run('git', ['clean', '-fd'], { cwd: repoPath }, `git clean failed in ${name}`);
  });
}

function start(simName) {
  const installed = readInstalled();
  const chosen = simName || installed[0];
  if (!chosen) {
    exitWithError('No sims installed. Add one with: npm run add-sim -- <sim>');
  }

  log(`Starting dev server for ${chosen}...`);
  installAll();
  const simPath = path.join(REPOS_DIR, chosen);
  if (!fs.existsSync(simPath)) {
    exitWithError(`Sim ${chosen} is not cloned. Run: npm run add-sim -- ${chosen}`);
  }

  run('npm', ['start'], { cwd: simPath }, `npm start failed for ${chosen}`);
}

function ensureBaseRepos() {
  ensureRepoWithInstall(CHIPPER);
  ensureRepoWithInstall(PERENNIAL_REPO, PERENNIAL_ALIAS);
}

function ensureCommonLibs() {
  const common = readChipperCommonLibs();
  common.forEach((name) => ensureRepoWithInstall(name));
}

function ensureSimAndLibs(simName) {
  ensureRepoWithInstall(simName);
  const libs = readSimLibs(simName);
  libs.forEach((name) => ensureRepoWithInstall(name));
}

function ensureRepoWithInstall(repoName, destName = repoName) {
  const dest = path.join(REPOS_DIR, destName);
  if (!fs.existsSync(dest)) {
    const url = `https://github.com/phetsims/${repoName}.git`;
    log(`Cloning ${repoName} into ${destName}...`);
    run('git', ['clone', url, dest], {}, `git clone failed for ${repoName}`);
  }

  npmInstall(dest, destName);
}

function npmInstall(dir, name) {
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    log(`Skipping npm install in ${name || dir} (no package.json)`);
    return;
  }
  log(`Running npm install in ${name || dir}...`);
  run('npm', ['install'], { cwd: dir }, `npm install failed in ${name || dir}`);
}

function readChipperCommonLibs() {
  const buildPath = path.join(REPOS_DIR, CHIPPER, 'build.json');
  if (!fs.existsSync(buildPath)) {
    return [];
  }
  try {
    const build = JSON.parse(fs.readFileSync(buildPath, 'utf8'));
    return Array.isArray(build?.common?.phetLibs) ? build.common.phetLibs : [];
  } catch (err) {
    log(`Could not parse chipper/build.json: ${err.message}`);
    return [];
  }
}

function readSimLibs(simName) {
  const pkgPath = path.join(REPOS_DIR, simName, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return [];
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return Array.isArray(pkg?.phet?.phetLibs) ? pkg.phet.phetLibs : [];
  } catch (err) {
    log(`Could not parse phetLibs for ${simName}: ${err.message}`);
    return [];
  }
}

function computeRequiredRepos(installedSims) {
  const required = new Set([CHIPPER, PERENNIAL_ALIAS]);
  readChipperCommonLibs().forEach((name) => required.add(name));

  installedSims.forEach((sim) => {
    required.add(sim);
    readSimLibs(sim).forEach((name) => required.add(name));
  });

  return required;
}

function pruneRepos(requiredSet) {
  if (!fs.existsSync(REPOS_DIR)) {
    return;
  }

  const entries = fs.readdirSync(REPOS_DIR, { withFileTypes: true });
  entries.forEach((entry) => {
    if (!entry.isDirectory()) {
      return;
    }
    const name = entry.name;
    if (!requiredSet.has(name)) {
      const target = path.join(REPOS_DIR, name);
      log(`Pruning ${name}...`);
      fs.rmSync(target, { recursive: true, force: true });
    }
  });
}

function forEachTrackedRepo(fn) {
  const required = computeRequiredRepos(readInstalled());
  required.forEach((name) => {
    const dir = path.join(REPOS_DIR, name);
    if (fs.existsSync(dir)) {
      fn(dir, name);
    }
  });
}

function ensureInstalledFile() {
  if (!fs.existsSync(INSTALLED_FILE)) {
    fs.writeFileSync(INSTALLED_FILE, '[]');
  }
}

function readInstalled() {
  try {
    const data = fs.readFileSync(INSTALLED_FILE, 'utf8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function writeInstalled(list) {
  const unique = Array.from(new Set(list)).sort();
  fs.writeFileSync(INSTALLED_FILE, JSON.stringify(unique, null, 2));
}

function run(cmd, args, options = {}, errorMessage) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    exitWithError(errorMessage || `${cmd} ${args.join(' ')} failed`);
  }
  return result;
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function exitWithError(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
