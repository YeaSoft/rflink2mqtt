// (c) 2020 YeaSoft Intl - Leo Moll
//
// This file handles the commandline parsing
// of the application.

// activate strict mode
'use strict';

// load module dependencies
const path = require( 'path' );

// load application information
var appinfo	= require( path.join( __dirname, 'package.json' ) );

// Parse commandline parameters
var opt		= require( 'node-getopt' ).create( [
	[ 'b', 'bind=ARG'			, 'Change the bind address' ],
	[ 'p', 'port=ARG'			, 'Change the listen port' ],
	[ 'l', 'logpath=ARG'		, 'Alternative logging path (default: ' + require( 'path' ).join( __dirname, 'log' ) + ')' ],
	[ 'f', 'logfile=ARG'		, 'Log to file with specified logging level' ],
	[ 'c', 'console=ARG'		, 'Log to console with specified logging level' ],
	[ 'h', 'help'				, 'Display this help' ],
	[ 'v', 'version'			, 'Show ' + appinfo.name + 'version' ]
] )				// create Getopt instance
.bindHelp()		// bind option 'help' to default action
.parseSystem();	// parse command line

opt.GetTitle = function() {
	return [
		appinfo.name + " - " + appinfo.description + " v" + appinfo.version,
		"(c) 2020 YeaSoft Intl. - " + appinfo.author
	];
}

opt.GetAppInfo = function() {
	return appinfo;
}

opt.ShowTitle = function( outfunc ) {
	outfunc( appinfo.name + " - " + appinfo.description + " v" + appinfo.version );
	outfunc( "(c) 2020 YeaSoft Intl. - " + appinfo.author );
	return opt;
}

opt.Start = function() {
	// show version if requested
	if ( opt.options.version ) {
		opt.ShowTitle( console.error );
		process.exit( 1 );
	}
	return opt;
}

// module exports
module.exports = exports = opt;