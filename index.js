//!/usr/bin/env node
//
// (c) 2020 YeaSoft Intl - Leo Moll
//
// This is the main program of the rflink2mqtt gateway

// activate strict mode
'use strict';

// Load application info and parse commandline options
const opt		= require( './app-parser' ).Start();
const log		= require( './app-logger' );

// Load the gateway
const gateway	= require( './gateway' );

// show startup message
opt.ShowTitle( log.info );

// start the gateway
gateway.Start();

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
