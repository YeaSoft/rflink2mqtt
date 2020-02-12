// (c) 2020 YeaSoft Intl - Leo Moll
//
// This file implements the devicelist and
// exports all device classes

// activate strict mode
'use strict';

// load module dependencies
const path			= require( 'path' );
const config		= require( 'config' );

// load application modules
const log			= require( path.join( path.dirname( __dirname ), 'app-logger' ) );

// load device classes
const GatewayDevice	= require( path.join( __dirname, 'GatewayDevice' ) );
const SensorDevice	= require( path.join( __dirname, 'SensorDevice' ) );
const CoverDevice = require( path.join( __dirname, 'CoverDevice' ) );

// device list class
class DeviceList {
	constructor() {
		this.devices = [];
		this.findmap = {};
		this.gateway = undefined;
		this.dispatchCount = 0;
		this.inited = false;
	}

	init( cfg ) {
		cfg.class = 'gateway';
		cfg.rfid = `rflink:${cfg.id}`;
		// this.empty();
		this.gateway = this.register( cfg.name, cfg );
	}

	create( name, cfg ) {
		if ( ! cfg.id ) {
			log.error( "Cannot create '%s' - no id specified", name );
			return undefined;
		}
		let device = undefined;
		switch( cfg.class ) {
			case 'gateway':
				device = new GatewayDevice( this, name, cfg );
				break;
			case 'sensor':
				device = new SensorDevice( this, name, cfg );
				break;
			case 'cover':
				device = new CoverDevice( this, name, cfg );
				break;
			default:
				log.error( "Cannot create '%s' - unsupperted device class '%s'", name, cfg.class );
				return undefined;
		}
		this.devices.push( device );
		this.findmap[ device.rfid ] = device;
		return device;
	}

	load( cfg ) {
		// register gateway
		this.init( cfg );

		// device list
		let devices = {};
		// merge user device list with defaults
		let old = process.env.ALLOW_CONFIG_MUTATIONS;
		process.env.ALLOW_CONFIG_MUTATIONS = true;
		if ( config.has ( 'device' ) ) {
			config.util.extendDeep( devices, config.get( 'device' ) );
		}
		process.env.ALLOW_CONFIG_MUTATIONS = old;

		// register devices
		for ( const [ key,  val ] of Object.entries( devices ) ) {
			this.register( key, val );
		}

		// check for duplicate ids
		let ids = this.devices.map( ( device ) => {
			return device.id
		} );
		if ( ids.some( ( item, index ) => { return ids.indexOf( item ) != index; } ) ) {
			this.empty();
			log.error( "Duplicate device id detected." );
			return false;
		}
		return true;
	}

	empty() {
		this.findmap = {};
		while ( this.devices.length ) {
			delete this.devices.pop();
		}
	}

	register( name, cfg ) {
		let device = this.find( name );
		if ( device ) {
			// patch it?
			return device;
		}
		return this.create( name, cfg );
	}

	find( name ) {
		for ( let device in this.devices ) {
			if ( device.name == name ) {
				return device;
			}
		}
		return undefined;
	}

	dispatchData( data ) {
		// still to consider if we may change the distribution method...
		let now = new Date().getTime();
		let key = data.switch ? `${data.name}:${data.id}:${data.switch}` : `${data.name}:${data.id}`;
		let device = this.findmap[key];
		if ( device ) {
			this.dispatchCount++;
			device.dispatchData( data, now );
		}
		if ( this.gateway ) {
			this.gateway.dispatchData( data, now );
		}
	}

	dispatchMessage( topic, message ) {
		this.devices.forEach( device => {
			device.dispatchMessage( topic, message.toString() );
		} );
	}

	refreshAll() {
		this.devices.forEach( device => {
			device.publishOnline( () => {
				device.publishState( () => {
					device.publishHassState( () => {
						device.publishConfig();
					} );
				} );
			} );
		} );
	}

	refreshOnline() {
		this.devices.forEach( device => { device.publishOnline(); } );
	}

	refreshState() {
		this.devices.forEach( device => { device.publishState(); } );
	}

	refreshHassState() {
		this.devices.forEach( device => { device.publishHassState(); } );
	}

	refreshConfig() {
		this.devices.forEach( device => { device.publishConfig(); } );
	}

	setOnline( online ) {
		this.devices.forEach( device => { device.setOnline( online ); } );
	}

	setGatewayOnline( status ) {
		this.gateway.status = status;
		if ( this.inited ) {
			this.devices.forEach( device => { device.setGatewayOnline( status.active ); } );
		}
		else if ( status.active ) {
			// first time online
			this.inited = true;
			this.devices.forEach( device => {
				device.initialize( () => {
					device.setGatewayOnline( status.active );
				} );
			} );
		}
	}

	getSubscriptions() {
		let topics = [];
		this.devices.forEach( device => {
			device.getSubscriptions().forEach( topic => {
				topics.push( topic );
			} );
		} );
		return topics;
	}
}

// export class
module.exports = DeviceList;