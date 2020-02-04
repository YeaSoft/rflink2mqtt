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
const hass			= require( path.join( __dirname, 'hass' ) );
const mqtt			= require( path.join( __dirname, 'mqtt' ) );
const rflink		= require( path.join( __dirname, 'rflink' ) );

// load application info
const appinfo		= require( path.join( __dirname, 'package.json' ) );

// helper
function __fncallback( cb ) { return typeof cb === 'function' ? cb : () => {}; }
function __fncall( th, cb, ...args) { if ( typeof cb === 'function' ) cb.apply( th, args ); }

// device list class
class DeviceList {
	constructor() {
		this.devices = [];
		this.findmap = {};
		this.gateway = undefined;
	}

	init( cfg ) {
		cfg.class = 'gateway';
		cfg.rfid = 'RFLink Gateway';
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
		let key = `${data.name}:${data.id}`;
		let device = this.findmap[key];
		if ( device ) {
			device.dispatchData( data, now );
		}
		if ( this.gateway ) {
			this.gateway.dispatchData( data, now );
		}
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
		this.devices.forEach( device => { device.setGatewayOnline( status.active ); } );
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
		gateway.mqtt.Publish( 'homeassistant/' + type + '/' + config.unique_id + '/config', JSON.stringify( config ), true, callback );
	}

	publish( topic, message, retain, callback ) {
		gateway.mqtt.Publish( gateway.devices.gateway.prefix + this.name + '/' + topic, message, retain, callback );
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

class Device extends BaseDevice {
	getHassState( hass_state ) {
		hass_state = super.getHassState( hass_state );
		hass_state[ 'Module' ] = this.rfid.split( ':' )[0];
		hass_state[ 'Id' ] = this.rfid.split( ':' )[1];
		hass_state[ 'Uptime' ] = this.secondsToDTHHMMSS( this.getUpTime() );
		return hass_state;
	}
}

// gateway device class
class GatewayDevice extends BaseDevice {
	constructor( dl, name, config ) {
		super( dl, 'gateway', name, config );
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

	getHassState() {
		let hass_state = super.getHassState();
		let gate_state = this.dl.gateway.status;
		hass_state[ 'Uptime' ] = this.secondsToDTHHMMSS( this.getUpTime() );
		hass_state[ 'Last Connected' ] = gate_state.lastOpened;
		hass_state[ 'Last Message' ] = gate_state.lastMessage;
		hass_state[ 'Last Error' ] = gate_state.lastError;
		hass_state[ 'Connections' ] = gate_state.sessionCount || 0;
		hass_state[ 'Messages' ] = gate_state.messageCount || 0;
		hass_state[ 'Commands' ] = gate_state.commandCount || 0;
		hass_state[ 'Confirmations' ] = gate_state.confirmCount || 0;
		hass_state[ 'Errors' ] = gate_state.errorCount || 0;
		return hass_state;
	}

	getSubscriptions() {
		return [ this.prefix + this.name + '/cmnd/#' ];
	}

	publishConfig( callback ) {
		new hass.Sensor( this ).setIcon().setStateTopic( '~STATE' ).setValue( 'MsgRate' ).setUnit( "Msgs/h" ).publish( callback );
	}
}

// sensor device class
class SensorDevice extends Device {
	constructor( dl, name, cfg ) {
		super( dl, 'sensor', name, cfg );
		this.features = ( cfg.features || '' ).toLowerCase().split(',');
		this.expiration = cfg.expiration || 1800;
	}

	setNumericValue( result, key, val, base, mul, min, max ) {
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
			result[ key ] = value;
		}
		return value;
	}

	setTemperatureValue( result, key, val ) {
		let value = undefined;
		if ( ( value = parseInt( val, 16 ) ) != NaN ) {
			if ( value > 32767 ) {
				value -= 32768;
				value /= -10;
			}
			else {
				value /= 10;
			}
			result[ key ] = value;
		}
		return value;
	}

	dispatchData( data, now ) {
		// sensors go online when they receive data
		this.updateMessageRate( data, now );
		this.setOnline( true );
		let sensor = {
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
						this.setTemperatureValue( sensor, 'temperature', value );
						break;
					case 'hum':
						// HUM=99 => Humidity (decimal value: 0-100 to indicate relative humidity in %)
						this.setNumericValue( sensor, 'humidity', value, 10, 1, 0.0, 100.0 );
						break;
					case 'baro':
						// BARO=9999 => Barometric pressure (hexadecimal)
						this.setNumericValue( sensor, 'pressure', value, 16 );
						break;
					case 'hstatus':
						// HSTATUS=99 => 0=Normal, 1=Comfortable, 2=Dry, 3=Wet
						if ( ( value = this.setNumericValue( sensor, 'hstatus', value, 10, 1, 0, 3 ) ) != undefined ) {
							sensor.hstatus_readable = [ 'Normal','Comfortable','Dry','Wet' ][ value ];
						}
						break;
					case 'bforecast':
						// BFORECAST=99 => 0=No Info/Unknown, 1=Sunny, 2=Partly Cloudy, 3=Cloudy, 4=Rain
						if ( ( value = this.setNumericValue( sensor, 'forecast', value, 10, 1, 0, 3 ) ) != undefined ) {
							sensor.forecast_readable = [ 'No Info/Unknown','Sunny','Partly Cloudy','Cloudy' ][ value ];
						}
						break;
					case 'uv':
						// UV=9999 => UV intensity (hexadecimal)
						this.setNumericValue( sensor, 'uv', value, 16 );
						break;
					case 'lux':
						// LUX=9999 => Light intensity (hexadecimal)
						this.setNumericValue( sensor, 'illuminance', value, 16 );
						break;
					case 'bat':
						// BAT=OK => Battery status indicator (OK/LOW)
						sensor.battery = value.toLowerCase() === 'low';
						break;
					case 'rain':
						// RAIN=1234 => Total rain in mm. (hexadecimal) 0x8d = 141 decimal = 14.1 mm (needs division by 10)
						this.setNumericValue( sensor, 'rain', value, 16, 0.1 );
						break;
					case 'rainrate':
						// RAINRATE=1234 => Rain rate in mm. (hexadecimal) 0x8d = 141 decimal = 14.1 mm (needs division by 10)
						this.setNumericValue( sensor, 'rainrate', value, 16, 0.1 );
						break;
					case 'winsp':
						// WINSP=9999 => Wind speed in km. p/h (hexadecimal) needs division by 10
						this.setNumericValue( sensor, 'wind_speed', value, 16, 0.1 );
						break;
					case 'awinsp':
						// AWINSP=9999 => Average Wind speed in km. p/h (hexadecimal) needs division by 10
						this.setNumericValue( sensor, 'wind_speed_average', value, 16, 0.1 );
						break;
					case 'wings':
						// WINGS=9999 => Wind Gust in km. p/h (hexadecimal)
						this.setNumericValue( sensor, 'wind_gust', value, 16 );
						break;
					case 'windir':
						// WINDIR=123 => Wind direction (integer value from 0-15) reflecting 0-360 degrees in 22.5 degree steps
						this.setNumericValue( sensor, 'wind_direction', value, 10, 22.5 );
						break;
					case 'winchl':
						// WINCHL => wind chill (hexadecimal, see TEMP)
						this.setTemperatureValue( sensor, 'wind_chill', value );
						break;
					case 'wintmp':
						// WINTMP=1234 => Wind meter temperature reading (hexadecimal, see TEMP)
						this.setTemperatureValue( sensor, 'wind_temperature', value );
						break;
					case 'chime':
						// CHIME=123 => Chime/Doorbell melody number
						this.setNumericValue( sensor, 'chime', value, 10 );
						break;
					case 'smokealert':
						// SMOKEALERT=ON => ON/OFF
						sensor.smokealert = value.toLowercase() == 'on';
						break;
					case 'pir':
						// PIR=ON => ON/OFF
						sensor.motion = value.toLowercase() == 'on';
						break;
					case 'co2':
						// CO2=1234 => CO2 air quality
						this.setNumericValue( sensor, 'co', value, 10 );
						break;
					case 'sound':
						// SOUND=1234 => Noise level
						this.setNumericValue( sensor, 'noise', value, 10 );
						break;
					case 'kwatt':
						// KWATT=9999 => KWatt (hexadecimal)
						this.setNumericValue( sensor, 'power', value, 16, 1000 );
						break;
					case 'watt':
						// WATT=9999 => Watt (hexadecimal)
						this.setNumericValue( sensor, 'power', value, 16 );
						break;
					case 'current':
						// CURRENT=1234 => Current phase 1
						this.setNumericValue( sensor, 'current', value, 10 );
						break;
					case 'current2':
						// CURRENT2=1234 => Current phase 2 (CM113)
						this.setNumericValue( sensor, 'current_phase2', value, 10 );
						break;
					case 'current3':
						// CURRENT3=1234 => Current phase 3 (CM113)
						this.setNumericValue( sensor, 'current_phase3', value, 10 );
						break;
					case 'dist':
						// DIST=1234 => Distance
						this.setNumericValue( sensor, 'distance', value, 10 );
						break;
					case 'meter':
						// METER=1234 => Meter values (water/electricity etc.)
						this.setNumericValue( sensor, 'meter', value, 10 );
						break;
					case 'volt':
						// VOLT=1234 => Voltage
						this.setNumericValue( sensor, 'voltage', value, 10 );
						break;
					case 'rgbw':
						// RGBW=9999 => Milight: provides 1 byte color and 1 byte brightness value
						log.warn( "Still unknown output: '%s'", value );
						sensor.rgbw = value;
						break;
				}
			}
		} );
		this.publish( 'tele/SENSOR', JSON.stringify( sensor ) );
		this.publishState();
	}

	setGatewayOnline( online ) {
		// sensors go online when they receive data
		// sensors go offline when the gateway goes offline
		if ( ! online ) {
			this.setOnline( false );
		}
	}

	publishConfig( callback ) {
		// each sensor should have at least a status entity
		new hass.Sensor( this, 'Status' ).setIcon().setValue( 'msgrate' ).setUnit( 'Msgs/h' ).publish();
		// create sensor/binary_sensor entity for each measuring
		this.features.forEach( ( feature ) => {
			switch ( feature ) {
				case 'temp':
					new hass.Thermometer( this ).publish();
					break;
				case 'hum':
					new hass.Hygrometer( this ).publish();
					break;
				case 'baro':
					new hass.Barometer( this ).publish();
					break;
				case 'hstatus':
					// HSTATUS=99 => 0=Normal, 1=Comfortable, 2=Dry, 3=Wet
					log.error( "Sensor Feature '%s' not implemented for autocreation", feature );
					break;
				case 'bforecast':
					// BFORECAST=99 => 0=No Info/Unknown, 1=Sunny, 2=Partly Cloudy, 3=Cloudy, 4=Rain
					log.error( "Sensor Feature '%s' not implemented for autocreation", feature );
					break;
				case 'uv':
					new hass.Sensor( this, 'UV', 'Ultraviolet' ).setValue( 'uv' ).setIcon( 'mdi:white-balance-sunny' ).publish();
					break;
				case 'lux':
					new hass.Photometer( this ).publish();
					break;
				case 'bat':
					new hass.Battery( this ).publish();
					break;
				case 'rain':
					new hass.Sensor( this, 'Rain' ).setValue( 'rain' ).setUnit( 'mm' ).setIcon( 'mdi:weather-rainy' ).publish();
					break;
				case 'rainrate':
					new hass.Sensor( this, 'Rain_Rate' ).setValue( 'rainrate' ).setUnit( 'mm' ).setIcon( 'mdi:weather-rainy' ).publish();
					break;
				case 'winsp':
					new hass.Sensor( this, 'Wind_Speed' ).setValue( 'wind_speed' ).setUnit( 'km/h' ).setIcon( 'mdi:weather-windy' ).publish();
					break;
				case 'awinsp':
					new hass.Sensor( this, 'Wind_Speed_Average' ).setValue( 'wind_speed_average' ).setUnit( 'km/h' ).setIcon( 'mdi:weather-windy' ).publish();
					break;
				case 'wings':
					new hass.Sensor( this, 'Wind_Gust' ).setValue( 'wind_gust' ).setUnit( 'km/h' ).setIcon( 'mdi:sign-direction' ).publish();
					break;
				case 'windir':
					new hass.Sensor( this, 'Wind_Direction' ).setValue( 'wind_direction' ).setUnit( '°' ).setIcon( 'mdi:sign-direction' ).publish();
					break;
				case 'winchl':
					new hass.Thermometer( this, 'wind_chill', "Wind_Chill" ).publish();
					break;
				case 'wintmp':
					new hass.Thermometer( this, 'wind_temperature', "Wind_Temperature" ).publish();
					break;
				case 'chime':
					// CHIME=123 => Chime/Doorbell melody number
					//this.setNumericValue( sensor, 'chime', value, 10 );
					log.error( "Sensor Feature '%s' not implemented for autocreation", feature );
					break;
				case 'smokealert':
					new hass.SmokeDetector( this ).setIcon( 'mdi:smoking' ).publish()
					break;
				case 'pir':
					new hass.MotionDetector( this ).setIcon( 'mdi:motion-senso' ).publish()
					break;
				case 'co2':
					new hass.Sensor( this, 'CO2', "co2 Air Quality" ).setValue( 'co' ).setIcon( 'mdi:periodic-table-co2' ).publish();
					break;
				case 'sound':
					new hass.SignalStrength( this, 'noise', "Noise_Level" ).setIcon( 'mdi:speaker-wireless' ).publish();
					break;
				case 'watt':
				case 'kwatt':
					new hass.Powermeter( this ).setIcon( 'mdi:gauge' ).publish();
					break;
				case 'current':
					new hass.Sensor( this, 'Current' ).setValue( 'current' ).setUnit( 'A' ).setIcon( 'mdi:flash' ).publish();
					break;
				case 'current2':
					new hass.Sensor( this, 'Current_P2', "Current Phase 2" ).setValue( 'current_phase2' ).setUnit( 'A' ).setIcon( 'mdi:flash' ).publish();
					break;
				case 'current3':
					new hass.Sensor( this, 'Current_P3', "Current Phase 3" ).setValue( 'current_phase3' ).setUnit( 'A' ).setIcon( 'mdi:flash' ).publish();
					break;
				case 'dist':
					new hass.Sensor( this, 'Distance' ).setValue( 'distance' ).setIcon( 'mdi:map-marker-distance' ).publish();
					break;
				case 'meter':
					new hass.Sensor( this, 'Meter' ).setValue( 'meter' ).setIcon( 'mdi:gauge' ).publish();
					break;
				case 'volt':
					new hass.Sensor( this, 'Voltage' ).setValue( 'voltage' ).setUnit( 'V' ).setIcon( 'mdi:flash' ).publish();
					break;
				case 'rgbw':
					// RGBW=9999 => Milight: provides 1 byte color and 1 byte brightness value
					//log.warn( "Still unknown output: '%s'", value );
					//sensor.rgbw = value;
					log.error( "Sensor Feature '%s' not implemented for autocreation", feature );
					break;
			}
		} );
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

	if ( ! this.mqtt ) {
		this.mqtt = mqtt.Start();
	}
	if ( ! this.rflink ) {
		this.rflink = rflink.Start();
	}
	return true;
}

gateway.Stop = function( callback ) {
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

// module exports
module.exports = gateway;
