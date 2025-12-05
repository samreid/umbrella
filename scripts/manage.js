#!/usr/bin/env node
const fs = require( 'fs' );
const os = require( 'os' );
const path = require( 'path' );
const { spawnSync } = require( 'child_process' );

const ROOT = path.resolve( __dirname, '..' );
const REPOS_DIR = path.join( ROOT, 'repos' );
const SIMS_MANIFEST = path.join( ROOT, 'sims.json' );
const DEFAULT_OWNER = 'phetsims';
const CHIPPER = 'chipper';
const PERENNIAL_ALIAS = 'perennial-alias';
const PERENNIAL_REPO = 'perennial';

const commands = {
  'add-sim': addSim,
  status: statusAll,
  pull: pullAll,
  push: pushAll
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
        '  npm run push'
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

  log( `Fetching base tooling (${CHIPPER}, ${PERENNIAL_ALIAS})...` );
  ensureZipRepo( CHIPPER );
  npmInstallIfNeeded( CHIPPER );
  ensureZipRepo( PERENNIAL_REPO, DEFAULT_OWNER, PERENNIAL_ALIAS );
  npmInstallIfNeeded( PERENNIAL_ALIAS );

  const deps = Array.isArray( config.deps ) ? config.deps : [];
  const allZipRepos = new Set( deps );

  if ( config.liveRepo === simName ) {
    ensureLiveRepo( simName );
  }
  else {
    ensureZipRepo( simName );
    allZipRepos.add( simName );
    ensureLiveRepo( config.liveRepo );
  }

  allZipRepos.forEach( ( repo ) => ensureZipRepo( repo ) );
  log( `Done. Live repo: ${config.liveRepo}. Zip repos: ${Array.from( allZipRepos ).join( ', ' ) || 'none'}.` );
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

function ensureZipRepo( repoName, owner = DEFAULT_OWNER, destName = repoName ) {
  const dest = path.join( REPOS_DIR, destName );
  if ( fs.existsSync( dest ) ) {
    log( `${destName} already present (zip).` );
    return;
  }

  // Prefer archive URLs for reliability with anonymous downloads; fallback to zipball.
  const candidates = [
    `https://github.com/${owner}/${repoName}/archive/refs/heads/main.zip`,
    `https://github.com/${owner}/${repoName}/archive/refs/heads/master.zip`,
    `https://api.github.com/repos/${owner}/${repoName}/zipball/main`,
    `https://api.github.com/repos/${owner}/${repoName}/zipball/master`
  ];

  const tmpRoot = fs.mkdtempSync( path.join( os.tmpdir(), 'umbrella-' ) );
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
  log( `Running npm install in ${name}...` );
  run( 'npm', [ 'install' ], { cwd: dir }, `npm install failed in ${name}` );
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
