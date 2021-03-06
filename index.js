//!/usr/bin/env node
//
// (c) 2020 YeaSoft Intl - Leo Moll
//
// This is the main program of the rflink2mqtt gateway

// activate strict mode
'use strict';

// Load application info and parse commandline options
const path		= require( 'path' );
const opt		= require( path.join( __dirname, 'app-parser' ) );
const log		= require( path.join( __dirname, 'app-logger' ) );

// Load the gateway
const gateway	= require( path.join( __dirname, 'gateway' ) );

// helper functions
function Shutdown( signal ) {
	log.info( "Received " + signal + ". Initiating shutdown..." );
	gateway.Stop( () => {
		log.info( opt.GetAppInfo().name + " shut down." );
		process.exit( 0 );
	} );
}

// function Reload( signal ) {
// 	log.info( "Received " + signal + ". Reloading configuration..." );
// 	gateway.ReloadConfig();
// }

// show startup message
opt.ShowTitle( log.info );

// register signal handlers
process.on( 'SIGINT', function() {
	// remove the ugly ^C from the console ;-)
	process.stdout.write( '\r' );
	Shutdown( 'SIGINT' );
} );

process.on( 'SIGQUIT', function() {
	Shutdown( 'SIGQUIT' );
} );

process.on( 'SIGTERM', function() {
	Shutdown( 'SIGTERM' );
} );

// process.on( 'SIGHUP', function() {
// 	Reload( 'SIGHUP' );
// } );

// start the gateway
gateway.Start();
