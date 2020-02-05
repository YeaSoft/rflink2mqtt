// (c) 2020 YeaSoft Intl - Leo Moll
//
// This file implements the generic device classes

// activate strict mode
'use strict';

// load module dependencies
const path			= require( 'path' );

// load device classes
const BaseDevice	= require( path.join( __dirname, 'BaseDevice' ) );

// generic device class
class Device extends BaseDevice {
	getHassState( hass_state ) {
		hass_state = super.getHassState( hass_state );
		hass_state[ 'Module' ] = this.rfid.split( ':' )[0];
		hass_state[ 'Id' ] = this.rfid.split( ':' )[1];
		hass_state[ 'Uptime' ] = this.secondsToDTHHMMSS( this.getUpTime() );
		return hass_state;
	}
}

// export class
module.exports = Device;