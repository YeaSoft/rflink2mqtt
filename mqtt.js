// (c) 2020 YeaSoft Intl - Leo Moll
//
// This file handles the mqtt connection

// activate strict mode
'use strict';

// load module dependencies
const path			= require( 'path' );
const config		= require( 'config' );
const mqtt			= require( 'mqtt' );

// load application modeles
const log			= require( path.join( __dirname, 'app-logger' ) );

// helper
function __fncallback( cb ) { return typeof cb === 'function' ? cb : () => {}; }
function __fncall( cb, th, ...args) { if ( typeof cb === 'function' ) cb.call( th, args ); }

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

mqttclient.Start = function( gateway ) {
	log.info( "Starting up mqtt interface" );

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

	if ( !this.config.connection.url ) {
		// check if there is at least one server object in the options
		let options = this.config.connection.options;
		if ( !options || !options.servers || !options.servers.length ) {
			// no url specified
			log.error( "No mqtt url specified.");
			return undefined;
		}
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
	} );

	// this.client.on( 'reconnect', () => {

	// } );

	this.client.on( 'close', () => {
		log.info( "mqtt connection closed" );
		this.status.active = false;
	} );

	this.client.on( 'disconnect', ( packet ) => {
		log.info( "mqtt connection disconnected" );
		this.status.active = false;

	} );

	this.client.on( 'offline', () => {
		log.info( "mqtt connection offline" );
		this.status.active = false;
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
			__fncall( callback, this );
		} );
	}
	else {
		__fncall( callback, this );
	}
}

// module exports
module.exports = mqttclient;
