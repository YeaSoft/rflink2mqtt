// (c) 2020 YeaSoft Intl - Leo Moll
//
// This file implements the interface to home assistant

// activate strict mode
'use strict';

// load module dependencies
const path			= require( 'path' );

// load application modules
const mqtt			= require( path.join( __dirname, 'mqtt' ) );

// hass config classes
class BaseConfig {
	constructor( device, deviceclass, id_postfix, name_postfix ) {
		id_postfix = id_postfix ? '_' + id_postfix : '';
		name_postfix = name_postfix ? ' ' + name_postfix : id_postfix.replace( /_/g, ' ' );
		this.device = device;
		this.deviceclass = deviceclass;
		this.config = {
			name: device.name + name_postfix,
			state_topic: "~tele/STATE",
			availability_topic: "~tele/LWT",
			payload_available: "Online",
			payload_not_available: "Offline",
			json_attributes_topic: "~tele/HASS_STATE",
			unique_id: device.id + id_postfix,
			device: {
				identifiers: [ device.id ],
				name: device.name,
				manufacturer: device.manufacturer || "Nodo RadioFrequencyLink",
				model: device.model || device.rfid.split( ':' )[0] || "Unknown",
			},
			"~": device.basetopic
		}
	}

	set( key, value ) {
		this.config[ key ] = value;
		return this;
	}

	unset( key ) {
		if ( key in this.config ) {
			delete this.config[ key ];
		}
	}

	setIcon( icon ) { return this.set( 'icon', icon || "mdi:information-outline" ); }
	setUnit( unit ) { return this.set( 'unit_of_measurement', unit ); }
	setJsonValueTemplate( valueKey ) { return this.set( 'value_template', `{{value_json.${valueKey}}}` ); }
	setClass( deviceClass ) { return this.set( 'device_class', deviceClass ); }
	setStateTopic( topic ) { return this.set( 'state_topic', topic ); }

	publish( callback ) {
		mqtt.Publish( 'homeassistant/' + this.deviceclass + '/' + this.config.unique_id + '/config', JSON.stringify( this.config ), true, callback );
	}
}

// gateway
class Gateway extends BaseConfig {
	constructor( device, id_postfix, name_postfix ) {
		super( device, 'sensor', id_postfix, name_postfix );
		this.set( 'force_update', true );
		this.setIcon( 'mdi:switch' );
		this.setJsonValueTemplate( 'MsgRate' ).setUnit( "Msgs/h" );
	}
}

// cover
class Cover extends BaseConfig {
	constructor( device, id_postfix, name_postfix ) {
		super( device, 'cover', id_postfix, name_postfix );
		this.set( 'optimistic', false );
		this.set( 'command_topic', "~cmnd/CONTROL" );
		this.set( 'payload_open', 'UP' )
		this.set( 'payload_close', 'DOWN' );
		this.set( 'payload_stop', 'STOP' );
		if ( device.advanced ) {
			// advanced mode
			this.setJsonPositionTemplate( 'POSITION' );
			this.unset( 'state_topic' );
			this.set( 'set_position_topic', "~cmnd/POSITION" );
			this.set( 'position_topic', "~tele/STATE" );
			this.set( 'position_open', 100 );
			this.set( 'position_closed', 0 );
			this.set( 'retain', true );
		}
		else {
			// simple mode
			this.setJsonValueTemplate( 'STATE' );
			this.set( 'state_open', 'Open' );
			this.set( 'state_closed', 'Closed' );
		}
	}
	setJsonPositionTemplate( valueKey ) { return this.set( 'position_template', `{{value_json.${valueKey}}}` ); }
}

// generic sensors
class Sensor extends BaseConfig {
	constructor( device, id_postfix, name_postfix ) {
		super( device, 'sensor', id_postfix, name_postfix );
		this.set( 'state_topic', '~tele/SENSOR' );
		this.set( 'force_update', true );
	}
}

class BinarySensor extends BaseConfig {
	constructor( device, id_postfix, name_postfix ) {
		super( device, 'binary_sensor', id_postfix, name_postfix );
		this.set( 'state_topic', '~tele/SENSOR' );
		this.set( 'force_update', true );
		this.set( 'payload_on', true );
		this.set( 'payload_off', false );
	}
}

// specific sensors
class Thermometer extends Sensor {
	constructor( device, value, id_postfix, name_postfix ) {
		super( device, id_postfix || "Temperature", name_postfix );
		this.setClass( 'temperature' ).setUnit( "??C" ).setJsonValueTemplate( value || 'temperature' );
	}
}

class Hygrometer extends Sensor {
	constructor( device, value, id_postfix, name_postfix ) {
		super( device, id_postfix || "Humidity", name_postfix );
		this.setClass( 'humidity' ).setUnit( "%" ).setJsonValueTemplate( value || 'humidity' );
	}
}

class Barometer extends Sensor {
	constructor( device, value, id_postfix, name_postfix ) {
		super( device, id_postfix || "Pressure", name_postfix );
		this.setClass( 'pressure' ).setUnit( "hPa" ).setJsonValueTemplate( value || 'pressure' );
	}
}

class Photometer extends Sensor {
	constructor( device, value, id_postfix, name_postfix ) {
		super( device, id_postfix || "Luminosity", name_postfix );
		this.setClass( 'illuminance' ).setUnit( "lx" ).setJsonValueTemplate( value || 'illuminance' );
	}
}

class Powermeter extends Sensor {
	constructor( device, value, id_postfix, name_postfix ) {
		super( device, id_postfix || "Power", name_postfix );
		this.setClass( 'power' ).setUnit( "W" ).setJsonValueTemplate( value || 'power' );
	}
}

class SignalStrength extends Sensor {
	constructor( device, value, id_postfix, name_postfix ) {
		super( device, id_postfix || "Signal_Strength", name_postfix );
		this.setClass( 'signal_strength' ).setUnit( "dB" ).setJsonValueTemplate( value || 'signal_strength' );
	}
}

class Battery extends BinarySensor {
	constructor( device, value, id_postfix, name_postfix ) {
		super( device, id_postfix || 'Battery', name_postfix );
		this.setClass( 'battery' ).setJsonValueTemplate( value || 'battery' );
	}
}

class SmokeDetector extends BinarySensor {
	constructor( device, value, id_postfix, name_postfix ) {
		super( device, id_postfix || 'Smoke_Detector', name_postfix );
		let auto_off = parseInt( this.device.auto_off ) || 0;
		if ( auto_off > 0 ) this.set( 'off_delay', auto_off );
		this.setClass( 'smoke' ).setJsonValueTemplate( value || 'smokealert' );
	}
}

class MotionDetector extends BinarySensor {
	constructor( device, value, id_postfix, name_postfix ) {
		super( device, id_postfix || 'Motion', name_postfix );
		if ( this.device.auto_off != 'none' ) this.set( 'off_delay', parseInt( this.device.auto_off ) || 1 );
		this.setClass( 'motion' ).setJsonValueTemplate( value || 'motion' );
	}
}

var hass = {
	BaseConfig: BaseConfig,
	Gateway: Gateway,
	Cover: Cover,
	Sensor: Sensor,
	BinarySensor: BinarySensor,
	Thermometer: Thermometer,
	Hygrometer: Hygrometer,
	Barometer: Barometer,
	Photometer: Photometer,
	Powermeter: Powermeter,
	SignalStrength: SignalStrength,
	Battery: Battery,
	SmokeDetector: SmokeDetector,
	MotionDetector: MotionDetector,
}

// module exports
module.exports = hass;
