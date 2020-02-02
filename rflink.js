// (c) 2020 YeaSoft Intl - Leo Moll
//
// This file handles the rflink connection

// activate strict mode
'use strict';

// load module dependencies
const path			= require( 'path' );
const config		= require( 'config' );
const serialport	= require( 'serialport' );
const readline		= require( '@serialport/parser-readline' );

// load application modules
const log			= require( path.join( __dirname, 'app-logger' ) );

// helper
function __fncallback( cb ) { return typeof cb === 'function' ? cb : () => {}; }
function __fncall( cb, th, ...args) { if ( typeof cb === 'function' ) cb.apply( th, args ); }

function decompose( elements ) {
	let result = {};
	let unknown = 0;
	elements.forEach( element => {
		if ( element ) {
			let parts = element.split( '=' );
			if ( parts.length > 1 ) {
				let name = parts.shift().toLowerCase();
				result[ name ] = parts.join('=');
			}
			else {
				++unknown;
				result[ 'unknown' + unknown.toString() ] = element;
			}
		}
	} );
	return result;
}

// module interface
var rflink = {
	ready: false,
	port: undefined,
	parser: undefined,
	openretry: undefined,
	keepalive: undefined,
	gateway: undefined,
	status: {
		active: false,
		model: '',
		version: '',
		revision: '',
		build: '',
		lastOpened: undefined,
		lastMessage: undefined,
		lastError: undefined,
		sessionCount: 0,
		messageCount: 0,
		commandCount: 0,
		confirmCount: 0,
		errorCount: 0,
		deadCount: 0,
	},
	config: {},
};

rflink.emit = function( ...args ) {
	if ( this.gateway ) {
		return this.gateway.emit.apply( this.gateway, args );
	}
}

rflink.SetActive = function( active ) {
	active = active ? true : false;
	if ( this.status.active != active ) {
		this.status.active = active;
		this.emit( 'rfonline', this.status );
	}
}

rflink.LoadConfig = function( gateway ) {
	// default configuration
	this.config = {
		connection: {
			port: null,
			baudrate: 57600,
			databits: 8,
			parity: "none",
			stopbits: 1,
		},
		retry: 60,
		keepalive: 10,
		delimiter: '\r\n',
		encoding: 'utf8',
		cansend: true,
	}
	// merge user configurations with defaults
	let old = process.env.ALLOW_CONFIG_MUTATIONS;
	process.env.ALLOW_CONFIG_MUTATIONS = true;
	if ( config.has ( 'rflink' ) ) {
		config.util.extendDeep( this.config, config.get( 'rflink' ) );
	}
	process.env.ALLOW_CONFIG_MUTATIONS = old;
	// plausibility checks
	if ( !this.config.connection.port || this.config.connection.port.length == 0 ) {
		log.error( "No serial port specified.");
		return false;
	}
	// limit timings
	this.config.retry = Math.max( this.config.retry, 5 );
	this.config.keepalive = Math.max( this.config.keepalive, 5 );
	// store gateway reference
	if ( gateway ) this.gateway = gateway;
	return true;
}

rflink.Start = function( gateway ) {
	if ( this.openretry || this.port ) {
		// already opening/open
		return this;
	}

	log.info( "Starting up rflink interface..." );
	if ( ! this.LoadConfig( gateway ) ) {
		return undefined;
	}


	// prepare communication system
	let s_opt = {
		autoOpen: false,
		baudRate: this.config.connection.baudrate,
		dataBits: this.config.connection.databits,
		stopBits: this.config.connection.stopbits,
		parity: this.config.connection.parity,
	};
	let p_opt = {
		delimiter: this.config.delimiter,
		encoding: this.config.encoding,
	};

	// setup communication objects
	try {
		this.port	= new serialport( this.config.connection.port, s_opt );
		this.parser	= this.port.pipe( new readline( p_opt ) );
	}
	catch( error ) {
		log.error( "Wrong rflink options specified: ", error );
		this.Stop();
		return undefined;
	}

	// setup operations
	this.port.rfSend = function( data ) {
		this.write( data + '\r\n', ( error ) => {
			if ( error ) {
				log.error( "Error writing on serial port %s: %s", rflink.config.communication.port, error.message );
				rflink.status.lastError = new Date();
				rflink.status.errorCount++;
				rflink.Restart();
			}
		} );
	}
	this.port.rfReboot = function() {
		this.rfSend( '10;REBOOT;' );
	}
	this.port.rfPing = function() {
		this.rfSend( '10;PING;' );
	}
	this.port.rfVersion = function() {
		this.rfSend( '10;VERSION;' );
	}
	this.port.rfDebug = function( mode, state ) {
		if ( mode === 'U' ) {
			mode = '10;RFUDEBUG=';
		}
		else if ( mode === 'Q' ) {
			mode = '10;QRFDEBUG=';
		}
		else {
			mode = '10;RFDEBUG=';
		}
		if ( state ) {
			mode += 'ON;';
		}
		else {
			mode += 'OFF';
		}
		this.rfSend( mode );
	}
	this.port.rfTriStateInvert = function() {
		this.rfSend( '10;TRISTATEINVERT;' );
	}
	this.port.rfRtsClean = function() {
		this.rfSend( '10;RTSCLEAN;' );
	}
	this.port.rfRtsRecClean = function( code ) {
		value = Math.florr( code );
		if ( value != NaN ) {
			this.rfSend( '10;RTSRECCLEAN=' + value.toString() + ';' );
		}
	}
	this.port.rfRtsShow = function() {
		this.rfSend( '10;RTSSHOW;' );
	}
	this.port.rfRtsInvert = function() {
		this.rfSend( '10;RTSINVERT;' );
	}
	this.port.rfRtsLogTx = function() {
		this.rfSend( '10;RTSLONGTX;' );
	}

	// setup event handlers
	this.port.on( 'error', ( error ) => {
		log.error( "Error on serial port %s: %s", this.config.connection.port, error.message );
		rflink.status.lastError = new Date();
		rflink.status.errorCount++;
		rflink.status.error = error;
		this.emit( 'rferror', this.status );
		this.Restart();
	} );

	this.port.on( 'open', ( x ) => {
		this.ready = true;
		log.info( "RFLink port %s successfully opened", this.config.connection.port );
		this.status.lastOpened = new Date()
		this.status.sessionCount++;
		this.emit( 'rfopen', this.status );
	} );

	this.parser.on( 'data', ( data ) => {
		// data processor
		log.debug( "recv: %s ", data );
		this.status.messageCount++;
		this.status.lastMessage = new Date();

		// parse received data
		let elements = data.split( ';' );
		if ( elements.length < 3 ) {
			// TODO: special handling?
			log.warn( "TODO: Special Handling: '%s'", data );
			return;
		}

		let node = elements.shift().substr(-2);
		let pcnt = parseInt( elements.shift(), 16 );

		// startup phase
		if ( ! this.status.active ) {
			if ( node == '20' && pcnt === 0 ) {
				// store model name
				this.status.model = elements[0].replace(/^[^-]*-/,'').trimLeft().trimRight();
				if ( this.status.model.length < 6 ) {
					this.status.model = elements[0];
				}
				// request version
				this.port.rfVersion();
				if ( ! this.keepalive ) {
					let interval = this.config.keepalive * 1000;
					this.keepalive = setInterval( () => {
						if ( new Date() - this.status.lastMessage > interval * 3 ) {
							log.warn( "Connection appears to be dead. Restarting..." );
							this.status.deadCount++;
							this.Restart();
						}
						else {
							this.port.rfPing();
						}
					}, interval );
				}
			}
			if ( elements[0].split('=')[0] == 'VER' ) {
				let ver = decompose( elements );
				this.status.version = ver.ver;
				this.status.revision = ver.rev;
				this.status.build = ver.build;
				this.SetActive( true );
			}
			return;
		}

		// active phase
		switch ( node ) {
			case '10':
				break;
			case '11':
				break;
			case '20':
				let first = elements[0].split('=');
				let name, value;
				let time = new Date()
				switch ( first[0] ) {
					case 'PONG':
						// do not count as received message
						this.status.messageCount--;
						break;
					case 'DEBUG':
						// TODO: do something...
						break;
					case 'VER':
						// version response
						value = decompose( elements );
						this.status.version = value.ver;
						this.status.revision = value.rev;
						this.status.build = value.build;
						break;
					case 'RFDEBUG':
					case 'RFUDEBUG':
					case 'QRFDEBUG':
						// TODO: handle debug activation/deactivation
						value = first[1];
						break;
					case 'RTS CLEANED':
						break;
					case 'RECORD 00 CLEANED':
					case 'RECORD 01 CLEANED':
					case 'RECORD 02 CLEANED':
					case 'RECORD 03 CLEANED':
					case 'RECORD 04 CLEANED':
					case 'RECORD 05 CLEANED':
					case 'RECORD 06 CLEANED':
					case 'RECORD 07 CLEANED':
					case 'RECORD 08 CLEANED':
					case 'RECORD 09 CLEANED':
					case 'RECORD 10 CLEANED':
					case 'RECORD 11 CLEANED':
					case 'RECORD 12 CLEANED':
					case 'RECORD 13 CLEANED':
					case 'RECORD 14 CLEANED':
					case 'RECORD 15 CLEANED':
						break;
					case 'RTSINVERT':
					case 'RTSLONGTX':
					case 'TRISTATEINVERT':
						value = first[1];
						break;
					case 'CMD UNKNOWN':
						// ANSWER TO A 10;... wrong command
						// TODO, trigger next command....
						break;
					case 'OK':
						// ANSWER TO A 10;... good command
						// TODO, trigger next command....
						break;
					default:
						name = elements.shift();
						value = decompose( elements );
						value.name = name;
						value.Time = time.toISOString();
						value.ts = time.getTime();
						this.emit( 'rfdata', value );
						break;
				}
				break;
			default:
				log.warn( "Unknown message type received: '%s'", data);
				break;
		}
	} );

	this.port.on( 'close', () => {
		// close logic
		log.info( "Serial port '%s' closed", this.config.connection.port );
		this.SetActive( false );
		this.emit( 'rfclose', this.status );
	} );

	// open it!
	this.emit( 'rfstart', this.status );
	this.port.open();
	return this;
}

rflink.Restart = function() {
	if ( this.openretry || this.port ) {
		this.Stop();
		log.info( "Retrying to open serial port in %d second(s)",  this.config.retry );
		this.openretry = setTimeout( () => {
			delete this.openretry;
			this.Start();
		}, this.config.retry * 1000 );
	}
}

rflink.Stop = function( callback ) {
	this.SetActive( false );
	this.ready = false;
	if ( this.openretry ) {
		clearTimeout( this.openretry );
		this.openretry = undefined;
	}
	if ( this.keepalive ) {
		clearInterval( this.keepalive );
		this.keepalive = undefined;
	}

	let onclose = ( error ) => {
		// ignore errors
		if ( this.port ) delete this.port;
		if ( this.parser ) delete this.parser;
		this.emit( 'rfstop', this.status );
		__fncall( callback, this, error );
	}

	if ( this.port ) {
		this.port.close( onclose );
	}
	else {
		onclose.call( this );
	}
}

// module exports
module.exports = rflink;
