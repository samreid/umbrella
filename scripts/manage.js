#!/usr/bin/env node
const fs = require( 'fs' );
const path = require( 'path' );
const { spawnSync } = require( 'child_process' );

const ROOT = path.resolve( __dirname, '..' );
const REPOS_DIR = path.join( ROOT, 'repos' );
const SIMS_MANIFEST = path.join( ROOT, 'sims.json' );
const DEFAULT_OWNER = 'phetsims';
const CHIPPER = 'chipper';
const PERENNIAL_ALIAS = 'perennial-alias';
const PERENNIAL_REPO = 'perennial';
const TOOLING_BRANCH = 'packagelock-umbrella-1';

const commands = {
  'add-sim': addSim,
  status: statusAll,
  pull: pullAll,
  push: pushAll,
  'ensure-entr': ensureEntr
};

main();

function main() {
  const [ , , cmd, ...args ] = process.argv;
  const action = commands[ cmd ];
  if ( !action ) {
    log(
      [
        'Usage:',
        '  npm run add-sim -- <sim>',
        '  npm run status',
        '  npm run pull',
        '  npm run push',
        '  node scripts/manage.js ensure-entr'
      ].join( '\n' )
    );
    process.exit( 1 );
  }

  fs.mkdirSync( REPOS_DIR, { recursive: true } );
  action( ...args );
}

function addSim( simName ) {
  if ( !simName ) {
    exitWithError( 'add-sim requires a sim name, e.g. npm run add-sim -- circuit-construction-kit-dc' );
  }

  const manifest = loadManifest();
  const config = resolveSimConfig( manifest, simName );
  const liveRepo = config.liveRepo;

  // Step 1: Fetch base tooling (chipper, perennial-alias) using the special branch with package-lock.json
  log( `Fetching base tooling (${CHIPPER}, ${PERENNIAL_ALIAS})...` );
  ensureZipRepo( CHIPPER, DEFAULT_OWNER, CHIPPER, TOOLING_BRANCH );
  npmInstallIfNeeded( CHIPPER );
  ensureZipRepo( PERENNIAL_REPO, DEFAULT_OWNER, PERENNIAL_ALIAS, TOOLING_BRANCH );
  npmInstallIfNeeded( PERENNIAL_ALIAS );

  // Step 2: Read common.phetLibs from chipper/build.json
  const commonPhetLibs = readCommonPhetLibs();

  // Step 3: Fetch the sim itself (need it to read its package.json for phetLibs)
  // If liveRepo is different from simName, fetch sim as zip first
  if ( liveRepo !== simName ) {
    ensureZipRepo( simName );
  }
  else {
    ensureLiveRepo( simName );
  }

  // Step 4: Read sim's phet.phetLibs from its package.json
  const simPhetLibs = readSimPhetLibs( simName );

  // Step 5: Combine all dependencies (common + sim-specific), excluding already-handled repos
  const excludeFromZip = new Set( [ CHIPPER, PERENNIAL_ALIAS, PERENNIAL_REPO, simName, liveRepo ] );
  const allDeps = new Set( [ ...commonPhetLibs, ...simPhetLibs ] );

  // Step 6: Ensure liveRepo is cloned (if different from sim)
  if ( liveRepo !== simName ) {
    ensureLiveRepo( liveRepo );
    // Also need to fetch liveRepo's phetLibs if it has any
    const liveRepoPhetLibs = readSimPhetLibs( liveRepo );
    liveRepoPhetLibs.forEach( dep => allDeps.add( dep ) );
  }

  // Step 7: Download all remaining deps as zips
  const zipRepos = [];
  allDeps.forEach( ( repo ) => {
    if ( !excludeFromZip.has( repo ) ) {
      ensureZipRepo( repo );
      zipRepos.push( repo );
    }
  } );

  log( `Done. Live repo: ${liveRepo}. Zip repos: ${zipRepos.join( ', ' ) || 'none'}.` );
}

function readCommonPhetLibs() {
  const buildJsonPath = path.join( REPOS_DIR, CHIPPER, 'build.json' );
  if ( !fs.existsSync( buildJsonPath ) ) {
    log( 'Warning: chipper/build.json not found, using empty common phetLibs.' );
    return [];
  }

  try {
    const content = fs.readFileSync( buildJsonPath, 'utf8' );
    const buildJson = JSON.parse( content );
    return Array.isArray( buildJson?.common?.phetLibs ) ? buildJson.common.phetLibs : [];
  }
  catch ( err ) {
    log( `Warning: could not read chipper/build.json (${err.message}).` );
    return [];
  }
}

function readSimPhetLibs( repoName ) {
  const packageJsonPath = path.join( REPOS_DIR, repoName, 'package.json' );
  if ( !fs.existsSync( packageJsonPath ) ) {
    log( `Warning: ${repoName}/package.json not found, using empty phetLibs.` );
    return [];
  }

  try {
    const content = fs.readFileSync( packageJsonPath, 'utf8' );
    const packageJson = JSON.parse( content );
    return Array.isArray( packageJson?.phet?.phetLibs ) ? packageJson.phet.phetLibs : [];
  }
  catch ( err ) {
    log( `Warning: could not read ${repoName}/package.json (${err.message}).` );
    return [];
  }
}

function statusAll() {
  const gitRepos = findGitRepos();
  if ( !gitRepos.length ) {
    log( 'No live git repos found in repos/ (zip-only environment).' );
    return;
  }

  gitRepos.forEach( ( repoPath ) => {
    const name = path.basename( repoPath );
    log( `\n[${name}]` );
    run( 'git', [ 'status', '--short' ], { cwd: repoPath } );
  } );
}

function pullAll() {
  const gitRepos = findGitRepos();
  if ( !gitRepos.length ) {
    log( 'No live git repos to pull.' );
    return;
  }

  gitRepos.forEach( ( repoPath ) => {
    const name = path.basename( repoPath );
    log( `Pulling ${name}...` );
    run( 'git', [ 'pull', '--ff-only' ], { cwd: repoPath }, `git pull failed in ${name}` );
  } );
}

function pushAll() {
  const gitRepos = findGitRepos();
  if ( !gitRepos.length ) {
    log( 'No live git repos to push.' );
    return;
  }

  gitRepos.forEach( ( repoPath ) => {
    const name = path.basename( repoPath );
    log( `Pushing ${name}...` );
    run( 'git', [ 'push' ], { cwd: repoPath }, `git push failed in ${name}` );
  } );
}

function ensureEntr() {
  const hasEntr = spawnSync( 'sh', [ '-c', 'command -v entr' ], { stdio: 'ignore' } ).status === 0;
  if ( hasEntr ) {
    log( 'entr already available.' );
    return;
  }

  const hasApt = spawnSync( 'sh', [ '-c', 'command -v apt-get' ], { stdio: 'ignore' } ).status === 0;
  if ( !hasApt ) {
    log( 'entr not found and apt-get not available; please install entr manually.' );
    return;
  }

  log( 'Installing entr via apt-get (requires sudo)...' );
  const update = spawnSync( 'sudo', [ 'apt-get', 'update' ], { stdio: 'inherit' } );
  if ( update.status !== 0 ) {
    log( 'apt-get update failed; please install entr manually.' );
    return;
  }
  const install = spawnSync( 'sudo', [ 'apt-get', 'install', '-y', 'entr' ], { stdio: 'inherit' } );
  if ( install.status !== 0 ) {
    log( 'apt-get install entr failed; please install manually.' );
    return;
  }
  log( 'entr installed.' );
}

function ensureZipRepo( repoName, owner = DEFAULT_OWNER, destName = repoName, branch = null ) {
  const dest = path.join( REPOS_DIR, destName );
  if ( fs.existsSync( dest ) ) {
    log( `${destName} already present (zip).` );
    return;
  }

  // If a specific branch is provided, try only that branch; otherwise try main then master.
  const branches = branch ? [ branch ] : [ 'main', 'master' ];
  const candidates = branches.flatMap( b => [
    `https://github.com/${owner}/${repoName}/archive/refs/heads/${b}.zip`,
    `https://api.github.com/repos/${owner}/${repoName}/zipball/${b}`
  ] );

  // Use project-local temp dir to avoid EXDEV errors when /tmp is on a different filesystem (e.g., Codespaces)
  const tmpRoot = fs.mkdtempSync( path.join( ROOT, '.tmp-umbrella-' ) );
  const zipPath = path.join( tmpRoot, `${repoName}.zip` );
  const extractDir = path.join( tmpRoot, 'extract' );
  fs.mkdirSync( extractDir, { recursive: true } );

  try {
    let downloaded = false;
    for ( const url of candidates ) {
      log( `Downloading ${url}...` );
      const result = spawnSync(
        'curl',
        [ '-fL', '-sS', '-A', 'umbrella-script', '-o', zipPath, url ],
        { stdio: 'inherit' }
      );
      if ( result.status === 0 ) {
        downloaded = true;
        break;
      }
      log( `Download failed, trying next option...` );
    }

    if ( !downloaded ) {
      exitWithError( `All download attempts failed for ${repoName}` );
    }

    run( 'unzip', [ '-q', zipPath, '-d', extractDir ], {}, `unzip failed for ${repoName}` );

    const entries = fs.readdirSync( extractDir, { withFileTypes: true } ).filter( ( entry ) => entry.isDirectory() );
    if ( !entries.length ) {
      exitWithError( `Unexpected zip contents for ${repoName}` );
    }

    const unpacked = path.join( extractDir, entries[ 0 ].name );
    fs.mkdirSync( path.dirname( dest ), { recursive: true } );
    fs.rmSync( dest, { recursive: true, force: true } );
    fs.renameSync( unpacked, dest );
    log( `${destName} downloaded.` );
  }
  finally {
    fs.rmSync( tmpRoot, { recursive: true, force: true } );
  }
}

function ensureLiveRepo( repoName, owner = DEFAULT_OWNER ) {
  const dest = path.join( REPOS_DIR, repoName );
  if ( fs.existsSync( path.join( dest, '.git' ) ) ) {
    log( `${repoName} already present (git).` );
    return;
  }

  fs.rmSync( dest, { recursive: true, force: true } );
  const url = `https://github.com/${owner}/${repoName}.git`;
  log( `Cloning ${url}...` );
  run( 'git', [ 'clone', '--depth=1', '--single-branch', url, dest ], {}, `git clone failed for ${repoName}` );
}

function npmInstallIfNeeded( name ) {
  const dir = path.join( REPOS_DIR, name );
  if ( !fs.existsSync( dir ) ) {
    return;
  }
  if ( !fs.existsSync( path.join( dir, 'package.json' ) ) ) {
    log( `Skipping npm install in ${name} (no package.json).` );
    return;
  }
  if ( fs.existsSync( path.join( dir, 'node_modules' ) ) ) {
    log( `npm install already completed in ${name}.` );
    return;
  }

  // Use npm ci for faster, reproducible installs when package-lock.json exists
  const hasLockfile = fs.existsSync( path.join( dir, 'package-lock.json' ) );
  const npmCommand = hasLockfile ? 'ci' : 'install';
  log( `Running npm ${npmCommand} in ${name}...` );
  run( 'npm', [ npmCommand ], { cwd: dir }, `npm ${npmCommand} failed in ${name}` );
}

function findGitRepos() {
  if ( !fs.existsSync( REPOS_DIR ) ) {
    return [];
  }

  return fs.readdirSync( REPOS_DIR )
    .map( ( entry ) => path.join( REPOS_DIR, entry ) )
    .filter( ( fullPath ) => fs.existsSync( path.join( fullPath, '.git' ) ) );
}

function loadManifest() {
  if ( !fs.existsSync( SIMS_MANIFEST ) ) {
    return new Map();
  }

  try {
    const raw = fs.readFileSync( SIMS_MANIFEST, 'utf8' );
    const parsed = JSON.parse( raw );
    const sims = Array.isArray( parsed?.sims ) ? parsed.sims : [];
    const map = new Map();
    sims.forEach( ( entry ) => {
      if ( entry?.sim ) {
        map.set( entry.sim, {
          sim: entry.sim,
          liveRepo: entry.liveRepo || entry.sim,
          deps: Array.isArray( entry.deps ) ? entry.deps : []
        } );
      }
    } );
    return map;
  }
  catch( err ) {
    log( `Warning: could not read sims.json (${err.message}). Using defaults.` );
    return new Map();
  }
}

function resolveSimConfig( manifest, simName ) {
  if ( manifest.has( simName ) ) {
    return manifest.get( simName );
  }
  log( `Sim ${simName} not in sims.json; defaulting to liveRepo=${simName} with no deps.` );
  return { sim: simName, liveRepo: simName, deps: [] };
}

function run( cmd, args, options = {}, errorMessage ) {
  const result = spawnSync( cmd, args, { stdio: 'inherit', ...options } );
  if ( result.status !== 0 ) {
    exitWithError( errorMessage || `${cmd} ${args.join( ' ' )} failed` );
  }
  return result;
}

function log( message ) {
  process.stdout.write( `${message}\n` );
}

function exitWithError( message ) {
  process.stderr.write( `${message}\n` );
  process.exit( 1 );
}
