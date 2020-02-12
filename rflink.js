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
const gateway		= require( path.join( __dirname, 'gateway' ) );

// module interface
var rflink = {
	ready: false,
	port: undefined,
	parser: undefined,
	openretry: undefined,
	keepalive: undefined,
	config: {},
	commands: [],
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
};

// helper functions
rflink.call = function( callback, ...args) {
	if ( typeof callback === 'function' ) {
		callback.apply( this, args );
	}
}

rflink.decompose = function( elements ) {
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

rflink.parse_debug = function( time, elements ) {
	let type = elements.shift();
	let value = this.decompose( elements );
	let debug = {
		name: 'rflink',
		id: this.config.id,
		Time: time.toISOString(),
		ts: time.getTime(),
		type: type,
		pulses: 0,
		durations: []
	};
	if ( parseInt( value.pulses ) != NaN ) {
		debug.pulses = parseInt( value.pulses );
		if ( typeof value[ 'pulses(usec)' ] === 'string' ) {
			debug.durations = value[ 'pulses(usec)' ].split( ',' );
			if ( debug.durations.length == 1 ) {
				// QRFDEBUG=ON
				if ( debug.durations[0].length == debug.pulses * 2 ) {
					// regular pattern
					let durations = [];
					for ( let i = 0; i < debug.pulses; i++ ) {
						let v = parseInt( debug.durations[0].slice( i * 2, ( i + 1 ) * 2 ), 16 );
						if ( v === NaN ) {
							// something went wrong. leave as it is and return
							debug.durations = debug.durations[0];
							debug.qrfdebug = true;
							return debug;
						}
						durations.push( v * 30 );
					}
					debug.durations = durations;
				}
				else {
					// this must be the pulses=290 bug leave as it is and return
					debug.durations = debug.durations[0];
					debug.qrfdebug = true;
				}
			}
		}
	}
	return debug;
}

rflink.SetActive = function( active ) {
	active = active ? true : false;
	if ( this.status.active != active ) {
		this.status.active = active;
		gateway.emit( 'rfonline', this.status );
	}
}

rflink.LoadConfig = function() {
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
		send_latency: 20,
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
	return true;
}

rflink.Start = function() {
	if ( this.openretry || this.port ) {
		// already opening/open
		return this;
	}

	log.info( "Starting up rflink interface..." );
	if ( ! this.LoadConfig() ) {
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
	this.port.rfPing = function() {
		this.rfSend( '10;PING;' );
	}
	this.port.rfVersion = function() {
		this.rfSend( '10;VERSION;' );
	}

	// setup event handlers
	this.port.on( 'error', ( error ) => {
		log.error( "Error on serial port %s: %s", this.config.connection.port, error.message );
		rflink.status.lastError = new Date();
		rflink.status.errorCount++;
		rflink.status.error = error;
		gateway.emit( 'rferror', this.status );
		this.Restart();
	} );

	this.port.on( 'open', ( x ) => {
		this.ready = true;
		log.info( "RFLink port %s successfully opened", this.config.connection.port );
		this.status.lastOpened = new Date()
		this.status.sessionCount++;
		gateway.emit( 'rfopen', this.status );
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
				let ver = this.decompose( elements );
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
						// fill debug structure
						value = this.parse_debug( time, elements );
						gateway.emit( 'rfdata', value );
						break;
					case 'VER':
						// version response
						value = this.decompose( elements );
						this.status.version = value.ver;
						this.status.revision = value.rev;
						this.status.build = value.build;
						this.CompleteExecution( undefined, value );
						break;
					case 'RFDEBUG':
					case 'RFUDEBUG':
					case 'QRFDEBUG':
						this.CompleteExecution( undefined, first[1] );
						break;
					case 'RTS CLEANED':
						this.CompleteExecution( undefined, first[0] );
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
						this.CompleteExecution( undefined, first[0] );
						break;
					case 'RTSINVERT':
					case 'RTSLONGTX':
					case 'TRISTATEINVERT':
						this.CompleteExecution( undefined, first[1] );
						break;
					case 'CMD UNKNOWN':
						this.CompleteExecution( new Error( "Command unknown" ) );
						break;
					case 'OK':
						this.CompleteExecution();
						break;
					default:
						name = elements.shift();
						value = this.decompose( elements );
						value.name = name;
						value.Time = time.toISOString();
						value.ts = time.getTime();
						gateway.emit( 'rfdata', value );
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
		gateway.emit( 'rfclose', this.status );
	} );

	// open it!
	gateway.emit( 'rfstart', this.status );
	this.port.open();
	return this;
}

/**
 * Sends a command to a specified device
 *
 * @param {string} rfid identification of the target device
 * @param {string} command command string to send
 * @param {function} callback optional callback function( error, epoch_msec, acktime_msec ) that will be called as soon as the command has been completed
 */
rflink.SendCommand = function( rfid, command, callback ) {
	this.SendRawCommand( rfid.replace( /:/g, ';') + ';' + command, callback );
}

rflink.SendRawCommand = function( command, callback ) {
	if ( this.status.active ) {
		log.debug( "Enqueing command '%s'", command );
		this.commands.push( {
			command: command,
			callback: callback,
		} );
		this.status.commandCount++;
		this.TriggerExecution();
	}
	else {
		this.call( callback, new Error( 'RFLink not available' ), undefined, new Date().getTime(), 0 );
	}
}

rflink.TriggerExecution = function() {
	if ( this.commands.length ) {
		let cmd = this.commands[0];
		if ( ! cmd.executing ) {
			log.info( "Sending command '%s'", cmd.command );
			cmd.executing = new Date().getTime() + this.config.send_latency;
			this.port.write( `10;${cmd.command};\r\n`, ( error ) => {
				if ( error ) {
					// serious error - we will restart the connection
					log.error( "Error writing command '%s' on serial port %s: %s", cmd.command, this.config.communication.port, error.message );
					this.status.lastError = new Date();
					this.status.errorCount++;
					this.commands.shift();
					this.call( cmd.callback, error, undefined, cmd.executing, Math.max( new Date().getTime() - cmd.executing, 0 ) );
					this.Restart();
				}
				else if ( cmd.command.toUpperCase() === 'REBOOT' ) {
					// normally you get no confirmation for this command
					this.CompleteExecution();
				}
			} );
		}
	}
}

rflink.CompleteExecution = function( error, data ) {
	if ( this.commands.length ) {
		let cmd = this.commands[0];
		if ( cmd.executing ) {
			log.debug( "Completing execution of command '%s'", cmd.command );
			this.status.confirmCount++;
			this.commands.shift();
			this.call( cmd.callback, error, data, cmd.executing, Math.max( new Date().getTime() - cmd.executing, 0 ) );
		}
		else {
			log.warn( "CANARY: CompleteExecution without command in execution" );
		}
		this.TriggerExecution();
	}
	else {
		log.warn( "CANARY: CompleteExecution without any commands in queue" );
	}
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
		gateway.emit( 'rfstop', this.status );
		this.call( callback, error );
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
