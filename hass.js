// (c) 2020 YeaSoft Intl - Leo Moll
//
// This file implements the interface to home assistant

// activate strict mode
'use strict';

// load module dependencies
const path			= require( 'path' );

// load application modules
const log			= require( path.join( __dirname, 'app-logger' ) );
const mqtt			= require( path.join( __dirname, 'mqtt' ) );

// helper
function __fncallback( cb ) { return typeof cb === 'function' ? cb : () => {}; }
function __fncall( cb, th, ...args) { if ( typeof cb === 'function' ) cb.apply( th, args ); }

// hass config classes
class BaseConfig {
	constructor( device, deviceclass, id_postfix, name_postfix ) {
		id_postfix = id_postfix ? '_' + id_postfix : '';
		name_postfix = name_postfix ? ' ' + name_postfix : id_postfix.replace( /_/g, ' ' );
		this.device = device;
		this.deviceclass = deviceclass;
		this.config = {
			"name": device.name + name_postfix,
			"state_topic": "~SENSOR",
			"availability_topic": "~LWT",
			"force_update": true,
			"payload_available": "Online",
			"payload_not_available": "Offline",
			"json_attributes_topic": "~HASS_STATE",
			"unique_id": device.id + id_postfix,
			"device": {
				"identifiers": [ device.id ],
				"name": device.name,
				"manufacturer":"Nodo RadioFrequencyLink",
				"model": device.model || device.rfid.split( ':' )[0] || 'Unknown',
			},
			"~": device.name + "/tele/"
		}
	}

	set( key, value ) {
		this.config[ key ] = value;
		return this;
	}

	setIcon( icon ) { return this.set( 'icon', icon || "mdi:information-outline" ); }
	setUnit( unit ) { return this.set( 'unit_of_measurement', unit ); }
	setValue( valueKey ) { return this.set( 'value_template', `{{value_json.${valueKey}}}` ); }
	setClass( deviceClass ) { return this.set( 'device_class', deviceClass ); }
	setStateTopic( topic ) { return this.set( 'state_topic', topic ); }

	publish( callback ) {
		mqtt.Publish( 'homeassistant/' + this.deviceclass + '/' + this.config.unique_id + '/config', JSON.stringify( this.config ), true, callback );
	}
}

class Sensor extends BaseConfig {
	constructor( device, id_postfix, name_postfix ) {
		super( device, 'sensor', id_postfix, name_postfix );
	}
}

class BinarySensor extends BaseConfig {
	constructor( device, id_postfix, name_postfix ) {
		super( device, 'binary_sensor', id_postfix, name_postfix );
		this.set( 'payload_on', true );
		this.set( 'payload_off', true );
	}
}

class Thermometer extends Sensor {
	constructor( device, value, id_postfix, name_postfix ) {
		super( device, id_postfix || "Temperature", name_postfix );
		this.setClass( 'temperature' ).setUnit( "°C" ).setValue( value || 'temperature' );
	}
}

class Hygrometer extends Sensor {
	constructor( device, value, id_postfix, name_postfix ) {
		super( device, id_postfix || "Humidity", name_postfix );
		this.setClass( 'humidity' ).setUnit( "%" ).setValue( value || 'humidity' );
	}
}

class Barometer extends Sensor {
	constructor( device, value, id_postfix, name_postfix ) {
		super( device, id_postfix || "Pressure", name_postfix );
		this.setClass( 'pressure' ).setUnit( "hPa" ).setValue( value || 'pressure' );
	}
}

class Photometer extends Sensor {
	constructor( device, value, id_postfix, name_postfix ) {
		super( device, id_postfix || "Luminosity", name_postfix );
		this.setClass( 'illuminance' ).setUnit( "lx" ).setValue( value || 'illuminance' );
	}
}

class Powermeter extends Sensor {
	constructor( device, value, id_postfix, name_postfix ) {
		super( device, id_postfix || "Power", name_postfix );
		this.setClass( 'power' ).setUnit( "W" ).setValue( value || 'power' );
	}
}

class SignalStrength extends Sensor {
	constructor( device, value, id_postfix, name_postfix ) {
		super( device, id_postfix || "Signal_Strength", name_postfix );
		this.setClass( 'signal_strength' ).setUnit( "dB" ).setValue( value || 'signal_strength' );
	}
}

class Battery extends BinarySensor {
	constructor( device, value, id_postfix, name_postfix ) {
		super( device, id_postfix || 'Battery', name_postfix );
		this.setClass( 'battery' ).setValue( value || 'battery' );
	}
}

class SmokeDetector extends BinarySensor {
	constructor( device, value, id_postfix, name_postfix ) {
		super( device, id_postfix || 'Smoke_Detector', name_postfix );
		this.setClass( 'smoke' ).setValue( value || 'smokealert' );
	}
}

class MotionDetector extends BinarySensor {
	constructor( device, value, id_postfix, name_postfix ) {
		super( device, id_postfix || 'Motion', name_postfix );
		this.setClass( 'motion' ).setValue( value || 'motion' );
	}
}

var hass = {
	BaseConfig: BaseConfig,
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
