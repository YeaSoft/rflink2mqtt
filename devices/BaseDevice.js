// (c) 2020 YeaSoft Intl - Leo Moll
//
// This file implements the base
// class of all device classes

// activate strict mode
'use strict';

// load module dependencies
const path			= require( 'path' );

// load application modules
const mqtt			= require( path.join( path.dirname( __dirname ), 'mqtt' ) );
const gateway		= require( path.join( path.dirname( __dirname ), 'gateway' ) );

// load application info
const appinfo		= require( path.join( path.dirname( __dirname ), 'package.json' ) );

// helper
function __fncall( th, cb, ...args) { if ( typeof cb === 'function' ) cb.apply( th, args ); }

// generic base device class
class BaseDevice {
	constructor( dl, type, name, cfg ) {
		this.dl = dl;
		this.id = cfg.id.replace(/[_-]/g,'').toUpperCase();
		this.type = type;
		this.name = name;
		this.rfid = cfg.rfid;
		this.online = undefined;
		this.datats = [];
		this.birth = new Date().getTime();
		this.mrate = 0;
		this.count = 0;
	}

	dispatchData( data, now ) {
		this.updateMessageRate( data, now );
	}


	updateMessageRate( data, now ) {
		let last = now - 3600000;
		this.datats.push( data.ts );
		this.count++;
		// discard old samples
		while ( this.datats.length && this.datats[0] < last ) {
			this.datats.shift();
		}
		// recalculate message rate
		if ( last > this.birth ) {
			this.mrate = this.datats.length;
		}
		else if ( this.datats.length > 1 ) {
			let time = now - this.birth;
			this.mrate = Math.floor( this.datats.length * 3600000 / time );
		}
	}

	setOnline( online, callback ) {
		online = online === true;
		if ( this.online != online ) {
			this.online = online;
			this.publishOnline( ( error ) => {
				if ( error ) {
					__fncall( this, callback, error );
				}
				else {
					this.publishState( () => {
						this.publishHassState( callback );
					} );
				}
			} );
		}
		else {
			__fncall( this, callback );
		}
	}

	setGatewayOnline( online ) {}

	publishOnline( callback ) {
		let message = this.online ? 'Online' : 'Offline';
		this.publish( 'tele/LWT', message, true, callback );
	}

	publishState( callback ) {
		let state = this.getState();
		this.publish( 'tele/STATE', JSON.stringify( state ), false, callback );
	}

	publishHassState( callback ) {
		let hass_state = this.getHassState();
		this.publish( 'tele/HASS_STATE', JSON.stringify( hass_state ), false, callback );
	}

	publishConfig() {}

	publish_config_message( type, config, callback ) {
		mqtt.Publish( 'homeassistant/' + type + '/' + config.unique_id + '/config', JSON.stringify( config ), true, callback );
	}

	publish( topic, message, retain, callback ) {
		mqtt.Publish( gateway.devices.gateway.prefix + this.name + '/' + topic, message, retain, callback );
	}

	getSubscriptions() { return [] }

	getState() {
		let state = {};
		let uts = this.getUpTime();
		state[ 'Time' ] = new Date();
		state[ 'Uptime' ] = this.secondsToDTHHMMSS( uts );
		state[ 'UptimeSec' ] = uts;
		state[ 'MqttCount' ] = this.count;
		state[ 'MsgRate' ] = this.mrate;
		state[ 'ONLINE' ] = this.online;
		return state;
	}

	getHassState() {
		let hass_state = {};
		hass_state[ 'Model' ] = this.dl.gateway.status.model;
		hass_state[ 'Version' ] = this.dl.gateway.status.version;
		hass_state[ 'Revision' ] = this.dl.gateway.status.revision;
		hass_state[ 'Build' ] = this.dl.gateway.status.build;
		hass_state[ 'Gateway' ] = appinfo.version;
		return hass_state;
	}

	getUpTime() {
		let now = new Date();
		return  Math.floor( ( now.getTime() - this.birth ) / 1000 );
	}

	secondsToDTHHMMSS( seconds )  {
		seconds = Number( seconds );
		let d = Math.floor( seconds / 86400 );
		let h = Math.floor( seconds % 86400 / 3600);
		let m = Math.floor( seconds % 3600 / 60);
		let s = Math.floor( seconds % 60);
		return d + 'T' +
			( '0' + h ).slice( -2 ) + ':' +
			( '0' + m ).slice( -2 ) + ':' +
			( '0' + s ).slice( -2 );
	}
}

// export class
module.exports = BaseDevice;