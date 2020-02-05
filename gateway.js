// (c) 2020 YeaSoft Intl - Leo Moll
//
// This file is the main implementation of the gateway

// activate strict mode
'use strict';

// load module dependencies
const path			= require( 'path' );
const config		= require( 'config' );
const events		= require( 'events' );

// load application modules
const log			= require( path.join( __dirname, 'app-logger' ) );

// load device claseses
const DeviceList	= require( path.join( __dirname, 'devices/DeviceList' ) );

// helper
function __fncallback( cb ) { return typeof cb === 'function' ? cb : () => {}; }
function __fncall( th, cb, ...args) { if ( typeof cb === 'function' ) cb.apply( th, args ); }

// the gateway
var gateway = module.exports;

// initialize members
gateway.rflink		= undefined;
gateway.mqtt		= undefined;
gateway.emitter		= new events();
gateway.devices		= new DeviceList();
gateway.config		= {};

gateway.LoadConfig = function() {
	// default configuration
	this.config = {
		name: 'rflink-01',
		id: '',
		prefix: '',
		updates: {
			state: 60,
			hass_state: 60,
			config: 86400,
		},
	}
	// merge user configurations with defaults
	let old = process.env.ALLOW_CONFIG_MUTATIONS;
	process.env.ALLOW_CONFIG_MUTATIONS = true;
	if ( config.has ( 'gateway' ) ) {
		config.util.extendDeep( this.config, config.get( 'gateway' ) );
	}
	process.env.ALLOW_CONFIG_MUTATIONS = old;
	// plausibility checks
	if ( !this.config.id ) {
		log.error( "No gateway id specified." );
		return false;
	}
	// limit status updates
	this.config.updates.state = Math.max( this.config.updates.state, 10 );
	this.config.updates.hass_state = Math.max( this.config.updates.hass_state, 60 );
	this.config.updates.config = Math.max( this.config.updates.config, 300 );
	return true;
}

gateway.TriggerUpdater = function() {
	if ( this.rflink.status.active && this.mqtt.status.active ) {
		// initial update all
		this.devices.refreshAll();
		// setup refreshers
		if ( ! this.states_updater ) {
			this.states_updater = setInterval( () => {
				this.devices.refreshState();
			}, this.config.updates.state * 1000 );
		}
		if ( ! this.hass_states_updater ) {
			this.hass_states_updater = setInterval( () => {
				this.devices.refreshHassState();
			}, this.config.updates.hass_state * 1000 );
		}
		if ( ! this.config_updater ) {
			this.config_updater = setInterval( () => {
				this.devices.refreshConfig();
			}, this.config.updates.config * 1000 );
		}
	}
	else {
		// delete refreshers
		if ( this.states_updater ) {
			clearInterval( this.states_updater );
			delete this.states_updater;
		}
		if ( this.hass_states_updater ) {
			clearInterval( this.hass_states_updater );
			delete this.hass_states_updater;
		}
		if ( this.config_updater ) {
			clearInterval( this.config_updater );
			delete this.config_updater;
		}
	}
}

gateway.Start = function() {
	if ( ! this.LoadConfig() ) {
		return false;
	}

	// register devices
	if ( ! this.devices.load( this.config ) ) {
		return false;
	}

	// register event handler
	this.on( 'rfonline', ( status ) => {
		this.devices.setGatewayOnline( status );
		this.TriggerUpdater();
	} );

	this.on( 'mqonline', ( status ) => {
		this.TriggerUpdater();
	} );

	this.on( 'rfdata', ( data ) => {
		this.devices.dispatchData( data );
	} );

	this.on( 'mqmessage', ( topic, message ) => {
		this.rflink.SendRawCommand( message.toString(), ( error ) => {
			if ( error ) {
				log.error( "Command '%s' returned '%s'", message, error.message );
			}
			else {
				log.info( "Command '%s' returned OK", message );
			}
		} );

	} )

	const mqtt			= require( path.join( __dirname, 'mqtt' ) );
	const rflink		= require( path.join( __dirname, 'rflink' ) );

	if ( ! this.mqtt ) {
		this.mqtt = mqtt.Start();
	}
	if ( ! this.rflink ) {
		this.rflink = rflink.Start();
	}
	return true;
}

gateway.Stop = function( callback ) {
	const mqtt			= require( path.join( __dirname, 'mqtt' ) );
	const rflink		= require( path.join( __dirname, 'rflink' ) );
	this.rflink = rflink.Stop( ( error ) => {
		this.mqtt = mqtt.Stop( () => {
			__fncall( this, callback );
		} );
	} );
}

gateway.Reload = function() {

}

gateway.emit = function( ...args ) {
	// args.splice( 1, 0, this );
	return this.emitter.emit.apply( this.emitter, args );
}

gateway.on = function( eventName, listener ) {
	return this.emitter.on( eventName, listener );
}
