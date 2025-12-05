#!/usr/bin/env node
const { spawn } = require( 'child_process' );
const path = require( 'path' );
const fs = require( 'fs' );

const ROOT = path.resolve( __dirname, '..' );
const CHIPPER = path.join( ROOT, 'repos', 'chipper' );
const PERENNIAL_ALIAS = path.join( ROOT, 'repos', 'perennial-alias' );

function ensureExists( dir, hint ) {
  if ( !fs.existsSync( dir ) ) {
    console.error( `${dir} is missing. ${hint}` );
    process.exit( 1 );
  }
}

ensureExists( CHIPPER, 'Run npm run add-sim -- <sim> to fetch chipper/perennial-alias.' );
ensureExists( PERENNIAL_ALIAS, 'Run npm run add-sim -- <sim> to fetch chipper/perennial-alias.' );

console.log( 'Starting watch-strings...' );
const watch = spawn( './bin/watch-strings.zsh', {
  cwd: PERENNIAL_ALIAS,
  stdio: 'inherit',
  shell: true
} );

console.log( 'Starting chipper dev-server on port 8123...' );
const devServer = spawn(
  'npm',
  [ 'exec', 'grunt', 'dev-server', '--', '--port=8123' ],
  {
    cwd: CHIPPER,
    stdio: 'inherit',
    shell: false
  }
);

function shutdown( code = 0 ) {
  devServer.kill( 'SIGTERM' );
  watch.kill( 'SIGTERM' );
  process.exit( code );
}

devServer.on( 'exit', ( code ) => {
  if ( code !== 0 ) {
    console.error( `chipper dev-server exited with code ${code}` );
    shutdown( code || 1 );
  }
} );

watch.on( 'exit', ( code, signal ) => {
  if ( signal === 'SIGTERM' ) {
    shutdown( code || 0 );
    return;
  }
  if ( code !== 0 ) {
    console.error( `watch-strings exited with code ${code}` );
    shutdown( code || 1 );
  }
} );

process.on( 'SIGINT', () => shutdown( 0 ) );
process.on( 'SIGTERM', () => shutdown( 0 ) );
