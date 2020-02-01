// (c) 2020 YeaSoft Intl - Leo Moll
//
// This file is the main implementation of the gateway

// activate strict mode
'use strict';

// load module dependencies
const path			= require( 'path' );
const config		= require( 'config' );
const events		= require( 'events' );

// load application modeles
const log			= require( path.join( __dirname, 'app-logger' ) );
const mqtt			= require( path.join( __dirname, 'mqtt' ) );
const rflink		= require( path.join( __dirname, 'rflink' ) );

// helper
function __fncallback( cb ) { return typeof cb === 'function' ? cb : () => {}; }
function __fncall( cb, th, ...args) { if ( typeof cb === 'function' ) cb.call( th, args ); }

// device list class
class DeviceList {
	constructor() {
		this.devices = [];
		this.findmap = {};
		this.gateway = undefined;
	}

	init( cfg ) {
		cfg.class = 'gateway';
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
				device = new GatewayDevice( name, cfg );
				break;
			case 'sensor':
				device = new SensorDevice( name, cfg );
				break;
			default:
				log.error( "Cannot create '%s' - unsupperted device class '%s'", name, cfg.class );
				return undefined;
		}
		this.devices.push( device );
		this.findmap[device.rfid] = device;
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
		let key = `${data.name}:${data.id}`;
		let device = this.findmap[key];
		if ( device ) {
			device.dispatchData( data, now );
		}
		if ( this.gateway ) {
			this.gateway.dispatchData( data, now );
		}
	}

	setOnline( online ) {
		this.devices.forEach( device => { device.setOnline( online ); } );
	}

	setGatewayOnline( status ) {
		this.gateway.status = status;
		this.devices.forEach( device => { device.setGatewayOnline( status.active ); } );
	}

	setGatewayStatus( status ) {
		this.gateway.status = status;
		this.devices.forEach( device => { device.publishState(); } );
	}

	publishOnline() {
		this.devices.forEach( device => { device.publishOnline(); } );
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

// generic device class
class Device {
	constructor( type, name, cfg ) {
		this.id = cfg.id;
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
					__fncall( callback, this, error );
				}
				else {
					this.publishState( callback );
				}
			} );
		}
		else {
			__fncall( callback, this );
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

	publish( topic, message, retain, callback ) {
		gateway.mqtt.Publish( gateway.devices.gateway.prefix + this.name + '/' + topic, message, retain, callback );
	}

	getSubscriptions() { return [] }

	getState( state ) {
		if ( state === undefined ) {
			state = {};
		}
		let now = new Date();
		let uts = Math.floor( ( now.getTime() - this.birth ) / 1000 );
		state.Time = now;
		state.Uptime = this.secondsToDTHHMMSS( uts );
		state.UptimeSec = uts;
		state.MqttCount = this.count;
		state.MsgRate = this.mrate;
		state.ONLINE = this.online;
		return state;
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

// gateway device class
class GatewayDevice extends Device {
	constructor( name, config ) {
		super( 'gateway', name, config );
		this.status = {};
		if ( config.prefix ) {
			this.prefix = config.prefix;
			if ( this.prefix.slice( -1 ) != '/' ) {
				this.prefix += '/';
			}
		}
		else {
			this.prefix = '';
		}
	}

	setGatewayOnline( online ) { this.setOnline( online ); }

	getSubscriptions() {
		return [ this.prefix + this.name + '/cmnd/#' ];
	}
}

// sensor device class
class SensorDevice extends Device {
	constructor( name, cfg ) {
		super( 'sensor', name, cfg );
		this.features = ( cfg.features || '' ).toLowerCase().split(',');
		this.expiration = cfg.expiration || 1800;
	}

	setNumericValue( status, key, val, base, mul, min, max ) {
		let value = undefined;
		if ( ( value = parseInt( val, base ) ) != NaN ) {
			if ( typeof min != 'undefined' ) {
				value = Math.max( value, min );
			}
			if ( typeof max != 'undefined' ) {
				value = Math.min( value, max );
			}
			if ( typeof mul != 'undefined' ) {
				value *= mul;
			}
			status[ key ] = value;
		}
		return value;
	}

	setTemperatureValue( status, key, val ) {
		let value = undefined;
		if ( ( value = parseInt( val, 16 ) ) != NaN ) {
			if ( value > 32767 ) {
				value -= 32768;
				value /= -10;
			}
			else {
				value /= 10;
			}
			status[ key ] = value;
		}
		return value;
	}

	dispatchData( data, now ) {
		this.updateMessageRate( data, now );
		this.setOnline( true );
		let status = {
			Time: data.Time,
			msgrate: this.mrate
		};
		this.features.forEach( ( feature ) => {
			let value = undefined;
			if ( feature in data ) {
				value = data[ feature ];
				switch( feature ) {
					case 'temp':
						// TEMP=9999 => Temperature celcius (hexadecimal), high bit contains negative sign, needs division by 10 (0xC0 = 192 decimal = 19.2 degrees)
						this.setTemperatureValue( status, 'temperature', value );
						break;
					case 'hum':
						// HUM=99 => Humidity (decimal value: 0-100 to indicate relative humidity in %)
						this.setNumericValue( status, 'humidity', value, 10, 1, 0.0, 100.0 );
						break;
					case 'baro':
						// BARO=9999 => Barometric pressure (hexadecimal)
						this.setNumericValue( status, 'pressure', value, 16 );
						break;
					case 'hstatus':
						// HSTATUS=99 => 0=Normal, 1=Comfortable, 2=Dry, 3=Wet
						if ( ( value = this.setNumericValue( status, 'hstatus', value, 10, 1, 0, 3 ) ) != undefined ) {
							status.hstatus_readable = [ 'Normal','Comfortable','Dry','Wet' ][ value ];
						}
						break;
					case 'bforecast':
						// BFORECAST=99 => 0=No Info/Unknown, 1=Sunny, 2=Partly Cloudy, 3=Cloudy, 4=Rain
						if ( ( value = this.setNumericValue( status, 'forecast', value, 10, 1, 0, 3 ) ) != undefined ) {
							status.forecast_readable = [ 'No Info/Unknown','Sunny','Partly Cloudy','Cloudy' ][ value ];
						}
						break;
					case 'uv':
						// UV=9999 => UV intensity (hexadecimal)
						this.setNumericValue( status, 'uv', value, 16 );
						break;
					case 'lux':
						// LUX=9999 => Light intensity (hexadecimal)
						this.setNumericValue( status, 'illuminance', value, 16 );
						break;
					case 'bat':
						// BAT=OK => Battery status indicator (OK/LOW)
						status.battery = value.toLowerCase() === 'low';
						break;
					case 'rain':
						// RAIN=1234 => Total rain in mm. (hexadecimal) 0x8d = 141 decimal = 14.1 mm (needs division by 10)
						this.setNumericValue( status, 'rain', value, 16, 0.1 );
						break;
					case 'rainrate':
						// RAINRATE=1234 => Rain rate in mm. (hexadecimal) 0x8d = 141 decimal = 14.1 mm (needs division by 10)
						this.setNumericValue( status, 'rainrate', value, 16, 0.1 );
						break;
					case 'winsp':
						// WINSP=9999 => Wind speed in km. p/h (hexadecimal) needs division by 10
						this.setNumericValue( status, 'wind_speed', value, 16, 0.1 );
						break;
					case 'awinsp':
						// AWINSP=9999 => Average Wind speed in km. p/h (hexadecimal) needs division by 10
						this.setNumericValue( status, 'wind_speed_average', value, 16, 0.1 );
						break;
					case 'wings':
						// WINGS=9999 => Wind Gust in km. p/h (hexadecimal)
						this.setNumericValue( status, 'wind_gust', value, 16 );
						break;
					case 'windir':
						// WINDIR=123 => Wind direction (integer value from 0-15) reflecting 0-360 degrees in 22.5 degree steps
						this.setNumericValue( status, 'wind_direction', value, 10, 22.5 );
						break;
					case 'winchl':
						// WINCHL => wind chill (hexadecimal, see TEMP)
						this.setTemperatureValue( status, 'wind_chill', value );
						break;
					case 'wintmp':
						// WINTMP=1234 => Wind meter temperature reading (hexadecimal, see TEMP)
						this.setTemperatureValue( status, 'wind_temperature', value );
						break;
					case 'chime':
						// CHIME=123 => Chime/Doorbell melody number
						this.setNumericValue( status, 'chime', value, 10 );
						break;
					case 'smokealert':
						// SMOKEALERT=ON => ON/OFF
						status.smokealert = value.toLowercase() == 'on';
						break;
					case 'pir':
						// PIR=ON => ON/OFF
						status.motion = value.toLowercase() == 'on';
						break;
					case 'co2':
						// CO2=1234 => CO2 air quality
						this.setNumericValue( status, 'co', value, 10 );
						break;
					case 'sound':
						// SOUND=1234 => Noise level
						this.setNumericValue( status, 'noise', value, 10 );
						break;
					case 'kwatt':
						// KWATT=9999 => KWatt (hexadecimal)
						this.setNumericValue( status, 'power', value, 16, 1000 );
						break;
					case 'watt':
						// WATT=9999 => Watt (hexadecimal)
						this.setNumericValue( status, 'power', value, 16 );
						break;
					case 'current':
						// CURRENT=1234 => Current phase 1
						this.setNumericValue( status, 'current', value, 10 );
						break;
					case 'current2':
						// CURRENT2=1234 => Current phase 2 (CM113)
						this.setNumericValue( status, 'current_phase2', value, 10 );
						break;
					case 'current3':
						// CURRENT3=1234 => Current phase 3 (CM113)
						this.setNumericValue( status, 'current_phase3', value, 10 );
						break;
					case 'dist':
						// DIST=1234 => Distance
						this.setNumericValue( status, 'distance', value, 10 );
						break;
					case 'meter':
						// METER=1234 => Meter values (water/electricity etc.)
						this.setNumericValue( status, 'meter', value, 10 );
						break;
					case 'volt':
						// VOLT=1234 => Voltage
						this.setNumericValue( status, 'voltage', value, 10 );
						break;
					case 'rgbw':
						// RGBW=9999 => Milight: provides 1 byte color and 1 byte brightness value
						log.warn( "Still unknown output: '%s'", value );
						status.rgbw = value;
						break;
				}
			}
		} );
		this.publish( 'tele/SENSOR', JSON.stringify( status ) );
	}

	setGatewayOnline( online ) {
		// set the sensor offline when the gateway goes offline
		if ( ! online ) {
			this.setOnline( false );
		}
	}
}

// the gateway
var gateway = {
	rflink: undefined,
	mqtt: undefined,
	emitter: new events(),
	devices: new DeviceList(),
	config: {},
}

gateway.Start = function() {
	// default configuration
	this.config = {
		name: 'rflink-01',
		id: '',
		prefix: '',
	}
	let old = process.env.ALLOW_CONFIG_MUTATIONS;
	process.env.ALLOW_CONFIG_MUTATIONS = true;
	if ( config.has ( 'gateway' ) ) {
		config.util.extendDeep( this.config, config.get( 'gateway' ) );
	}
	process.env.ALLOW_CONFIG_MUTATIONS = old;

	if ( !this.config.id ) {
		log.error( "No gateway id specified." );
		return false;
	}

	// register devices
	this.devices.load( this.config );

	// register device handler
	// this.emitter.on( 'rfstart', ( status ) => {} );
	// this.emitter.on( 'rfopen', ( status ) => {} );

	this.emitter.on( 'rfonline', ( status ) => {
		this.devices.setGatewayOnline( status );
	} );

	this.emitter.on( 'rfstatus', ( status ) => {
		this.devices.setGatewayStatus( status );
	} );

	// this.emitter.on( 'rfclose', ( status ) => {} );
	// this.emitter.on( 'rfstop', ( status ) => {} );

	this.emitter.on( 'rfdata', ( data ) => {
		this.devices.dispatchData( data );
	} );

	if ( ! this.mqtt ) {
		this.mqtt = mqtt.Start( this );
	}
	if ( ! this.rflink ) {
		this.rflink = rflink.Start( this );
	}
}

gateway.Stop = function( callback ) {
	this.rflink = rflink.Stop( ( error ) => {
		this.mqtt = mqtt.Stop( () => {
			__fncall( callback, this );
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

// module exports
module.exports = gateway;
