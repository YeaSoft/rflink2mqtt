// (c) 2020 YeaSoft Intl - Leo Moll
//
// This file handles the mqtt connection

// activate strict mode
'use strict';

// load module dependencies
const path			= require( 'path' );
const config		= require( 'config' );
const mqtt			= require( 'mqtt' );

// load application modules
const log			= require( path.join( __dirname, 'app-logger' ) );
const gateway		= require( path.join( __dirname, 'gateway' ) );

// helper
function __fncallback( cb ) { return typeof cb === 'function' ? cb : () => {}; }
function __fncall( th, cb, ...args) { if ( typeof cb === 'function' ) cb.apply( th, args ); }

// module interface
var mqttclient = {
	ready: false,
	client: undefined,
	status: {
		active: false,
		lastConnect: undefined,
		lastMessage: undefined,
		lastError: undefined,
		dataCount: 0,
		commandCount: 0,
		sessionCount: 0,
		deadCount: 0,
		confirmedCount: 0,
		errorCount: 0,
	},
};

mqttclient.SetActive = function( active ) {
	active = active ? true : false;
	if ( this.status.active != active ) {
		this.status.active = active;
		gateawy.emit( 'mqonline', this.status );
	}
}

mqttclient.LoadConfig = function() {
	// default configuration
	this.config = {
		connection: {
			url: null,
			options: undefined,
		},
		qos: {
			subscribe: 0,
			publish: 0,
		},
	}
	// merge user configurations with defaults
	let old = process.env.ALLOW_CONFIG_MUTATIONS;
	process.env.ALLOW_CONFIG_MUTATIONS = true;
	if ( config.has ( 'mqtt' ) ) {
		config.util.extendDeep( this.config, config.get( 'mqtt' ) );
	}
	process.env.ALLOW_CONFIG_MUTATIONS = old;
	// plausibility checks
	if ( !this.config.connection.url ) {
		// check if there is at least one server object in the options
		let options = this.config.connection.options;
		if ( !options || !options.servers || !options.servers.length ) {
			// no url specified
			log.error( "No mqtt url specified.");
			return undefined;
		}
	}
	return true;
}

mqttclient.Start = function() {
	if ( this.client ) {
		// already opening/open
		return this;
	}

	log.info( "Starting up mqtt interface..." );
	if ( ! this.LoadConfig() ) {
		return undefined;
	}

	// setup communication objects
	try {
		if ( this.config.connection.url ) {
			this.client = mqtt.connect( this.config.connection.url, this.config.connection.options );
		}
		else {
			this.client = mqtt.connect( this.config.connection.options );
		}
	}
	catch( error ) {
		log.error( "Wrong mqtt options specified: ", error );
		this.Stop();
		return undefined;
	}

	this.client.on( 'connect', ( connack ) => {
		log.info( "mqtt connection established" );
		this.status.active = true;
		this.status.lastConnect = new Date();
		this.status.sessionCount++;

		this.client.subscribe( gateway.devices.getSubscriptions(), { qos: this.config.qos.subscribe }, ( error, granted ) => {
			if ( error ) {
				log.error( "mqtt subscription error %s", error.message );
				this.status.errorCount++;
			}
			else {
				granted.forEach( ( grant ) => {
					log.info( "matt subscribed to %s with qos %d", grant.topic, grant.qos );
				} );
			}
		} );
		this.SetActive( true );
	} );

	// this.client.on( 'reconnect', () => {

	// } );

	this.client.on( 'close', () => {
		log.info( "mqtt connection closed" );
		this.SetActive( false );
	} );

	this.client.on( 'disconnect', ( packet ) => {
		log.info( "mqtt connection disconnected" );
		this.SetActive( false );
	} );

	this.client.on( 'offline', () => {
		log.info( "mqtt connection offline" );
		this.SetActive( false );
	} );

	this.client.on( 'error', ( error ) => {
		log.error( "mqtt error: %s", error.message );
		this.status.lastError = new Date();
		this.status.errorCount++;
	} );

	// this.client.on( 'end', () => {

	// } );

	this.client.on( 'message', ( topic, message, packet ) => {
		log.debug( "mqtt Message: '%s' '%s'", topic, message );
		this.status.lastMessage = new Date();
		this.status.dataCount++;
		gateway.emit( 'mqmessage', topic, message );
	} );

	// this.client.on( 'packetsend', ( packet ) => {

	// } );

	// this.client.on( 'packetreceive', ( packet ) => {

	// } );

	return this;
}

mqttclient.Publish = function( topic, message, retain, callback ) {
	if ( typeof retain === 'function ') {
		callback = retain;
		retain = false;
	}
	else if ( typeof callback != 'function' ) {
		callback = function() {};
	}
	if ( this.status.active ) {
		this.client.publish(
			topic,
			message,
			{ qos: this.config.qos.subscribe, retain: true },
			callback
		);
	}
	else {
		callback( new Error('not connected') );
	}
}

mqttclient.Stop = function( callback ) {
	this.ready = false;
	this.status.active = false;
	if ( this.client ) {
		this.client.end( true, {
			reasonCode: 0,
			properties: {
				reasonString: "Regular client shutdown"
			}
		}, () => {
			delete this.client;
			__fncall( this, callback );
		} );
	}
	else {
		__fncall( this, callback );
	}
}

// module exports
module.exports = mqttclient;
