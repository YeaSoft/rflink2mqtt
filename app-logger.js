// (c) 2020 YeaSoft Intl - Leo Moll
//
// This file handles the configuration and
// initialization of the application logger.

// activate strict mode
'use strict';

// required modules
const path		= require( 'path' );
const winston	= require( 'winston' );
				  require( 'winston-daily-rotate-file' );
				  require( 'winston-syslog' );
const config	= require( 'config' );
const opt		= require( './app-parser' );

// the singleton logger provided by the module
var logger = null;

// special logging formatter modules
const { LEVEL, MESSAGE, SPLAT }	= require( 'triple-beam' );
const jsonStringify				= require( 'fast-safe-stringify' );
const ownFormatter				= function( info ) {
	const stringifiedRest = jsonStringify( Object.assign( {}, info, {
		timestamp: undefined,
		level: undefined,
		owner: undefined,
		message: undefined,
		splat: undefined
	} ) );
	const padding = info.padding && info.padding[info.level] || '';
	const timestamp = info.timestamp ? `${info.timestamp} - ` : '';
	const owner = info.owner ? `${info.owner} - ` : 'root - ';
	const rest = stringifiedRest !== '{}' ? ` ${stringifiedRest}` : '';

	return `${timestamp}${owner}${info.level}:${padding} ${info.message}${rest}`;
}

// implementation
function createRootLogger() {
	// if we already created the logger, return it
	if ( logger ) {
		return logger;
	}

	// load configuration
	var cfg = loadConfiguration();

	// instantiate a new logger
	logger = winston.createLogger( {
		format: winston.format.combine(
			winston.format.splat(),
			winston.format.errors( { stack: true } ),
		)
	} );

	// test configuration and exit if invalid
	testConfiguration( cfg, true );

	// apply configuration
	applyConfiguration( cfg );

	// attach childcreator
	attachChildCreator( logger );

	// return the configured logger
	return logger;
};

// Reload configuration function
/*
function Reload() {
	if ( ! logger ) {
		return;
	}

	// load configuration
	var cfg = loadConfiguration();

	// go on only if the new configuration is OK
	if ( testConfguration( cfg ) ) {
		// remove all configurations
		logger.clear();

		// apply configuration
		applyConfiguration( cfg );
	}
}
*/

// utility functions
function loadConfiguration() {
	// default configuration for logger
	var cfg = {
		console: {
			name:				'console',
			level:				'none',
			colorize:			true,
			handleExceptions:	true,
			humanReadableUnhandledException: true
		},
		logfile: {
			name:				'file',
			level:				'none',
			filename:			path.join( __dirname, 'log', opt.GetAppInfo().name + '.log' ),
			datePattern:		'YYYY-MM-DD',
			tailable:			true,
			handleExceptions:	true
		},
		syslog: {
			name:				'syslog',
			level:				'none',
			handleExceptions:	true
		}
	};

	// Merge user configurations with defaults
	var old = process.env.ALLOW_CONFIG_MUTATIONS;
	process.env.ALLOW_CONFIG_MUTATIONS = true;
	if ( config.has ( 'logging.console' ) ) {
		config.util.extendDeep( cfg.console, config.get( 'logging.console' ) );
	}
	if ( config.has ( 'logging.logfile' ) ) {
		config.util.extendDeep( cfg.logfile, config.get( 'logging.logfile' ) );
	}
	if ( config.has ( 'logging.syslog' ) ) {
		config.util.extendDeep( cfg.syslog, config.get( 'logging.syslog' ) );
	}
	process.env.ALLOW_CONFIG_MUTATIONS = old;

	// just in case override with comandline parameters
	if ( opt.options ) {
		cfg.console.level		= opt.options.console ? opt.options.console : cfg.console.level;
		cfg.logfile.level		= opt.options.logfile ? opt.options.logfile : cfg.logfile.level;
		cfg.logfile.filename	= opt.options.logpath ? path.join( opt.options.logpath, opt.GetAppInfo().name + ".log" ) : cfg.logfile.filename;
	}
	return cfg;
}

function testConfiguration( cfg, initial ) {
	var a = testLogLevel( cfg.console.level, "console", initial );
	var b = testLogLevel( cfg.logfile.level, "file", initial );
	var c = testLogLevel( cfg.syslog.level, "syslog", initial );
	return a && b && c;
}

function applyConfiguration( cfg ) {
	// test validity of specified loglevels and assign the transports
	if ( checkLogging( cfg.console.level, "console" ) ) {
		cfg.console.format = winston.format.combine(
			winston.format.colorize(),
			winston.format.printf( ownFormatter )
		);
		logger.add( new winston.transports.Console( cfg.console ) );
	}
	if ( checkLogging( cfg.logfile.level, "file" ) ) {
		cfg.logfile.format = winston.format.combine(
			winston.format.timestamp( {
				format: 'YYYY-MM-DD HH:mm:ss'
			} ),
			winston.format.printf( ownFormatter )
		);
		logger.add( new winston.transports.DailyRotateFile( cfg.logfile ) );
	}
	if ( checkLogging( cfg.syslog.level, "syslog" ) ) {
		cfg.syslog.format = winston.format.combine(
			winston.format.printf( ownFormatter )
		);
		logger.add( new winston.transports.Syslog( cfg.syslog ) );
	}
}

function attachChildCreator( targetLogger ) {
	targetLogger.CreateLogger = function ( owner ) {
		var childLogger = targetLogger.child( { owner: owner } );
		attachChildCreator( childLogger );
		return childLogger;
	}
}

function testLogLevel( loglevel, target, initial ) {
	if ( loglevel ) {
		// test validity of specified loglevels
		if ( [ 'none', 'error', 'warn', 'info', 'verbose', 'debug', 'silly' ].indexOf( loglevel ) < 0 ) {
			showError( loglevel, target, logger.error );
			if ( initial ) {
				// output error also on console
				showError( loglevel, target, console.error );
				process.exit( 1 );
			}
			return false;
		}
		return true;
	}
	return false;
}

function checkLogging( loglevel ) {
	if ( loglevel ) {
		// test validity of specified loglevels
		if ( [ 'none', 'error', 'warn', 'info', 'verbose', 'debug', 'silly' ].indexOf( loglevel ) < 0 ) {
			return false;
		}
	}
	return loglevel != 'none';
}

function showError( loglevel, target, outfunc ) {
	outfunc( "ERROR: Wrong " + target + " log level '" + loglevel + "' specified. Specify one of:" );
	outfunc( "       error, warn, info, verbose, debug, silly" );
}

// Module exports
module.exports = createRootLogger();
