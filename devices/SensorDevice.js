// (c) 2020 YeaSoft Intl - Leo Moll
//
// This file implements the device class
// representing the RFLink gateway itself

// activate strict mode
'use strict';

// load module dependencies
const path			= require( 'path' );

// load application modules
const hass			= require( path.join( path.dirname( __dirname ), 'hass' ) );

// load device classes
const Device	= require( path.join( __dirname, 'Device' ) );

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

// export class
module.exports = SensorDevice;