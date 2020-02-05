// (c) 2020 YeaSoft Intl - Leo Moll
//
// This file implements the device class
// representing the RFLink gateway itself

// activate strict mode
'use strict';

// load module dependencies
const path			= require( 'path' );

// load application modules
const log			= require( path.join( path.dirname( __dirname ), 'app-logger' ) );
const hass			= require( path.join( path.dirname( __dirname ), 'hass' ) );
const rflink		= require( path.join( path.dirname( __dirname ), 'rflink' ) );

// load device classes
const BaseDevice	= require( path.join( __dirname, 'BaseDevice' ) );

// gateway device class
class GatewayDevice extends BaseDevice {
	constructor( dl, name, config ) {
		super( dl, 'gateway', name, config );
		this.commands = [ 'RAW' ]
		this.status = {};
	}

	executeCommand( command, message ) {
		if ( command == 'RAW' ) {
			log.info( "Sending raw command '%s'...", message );
			rflink.SendRawCommand( message, ( error ) => {
				if ( error ) {
					log.error( "Raw command '%s' returned '%s'", message, error.message );
				}
				else {
					log.info( "Raw command '%s' returned OK", message );
				}
			} );
		}
	}

	getHassState() {
		let hass_state = super.getHassState();
		let gate_state = this.status;
		hass_state[ 'Uptime' ] = this.secondsToDTHHMMSS( this.getUpTime() );
		hass_state[ 'Last Connected' ] = gate_state.lastOpened;
		hass_state[ 'Last Message' ] = gate_state.lastMessage;
		hass_state[ 'Last Error' ] = gate_state.lastError;
		hass_state[ 'Connections' ] = gate_state.sessionCount || 0;
		hass_state[ 'Total Messages' ] = gate_state.messageCount || 0;
		hass_state[ 'Dispatched Messages' ] = this.dl.dispatchCount;
		hass_state[ 'Commands' ] = gate_state.commandCount || 0;
		hass_state[ 'Confirmations' ] = gate_state.confirmCount || 0;
		hass_state[ 'Errors' ] = gate_state.errorCount || 0;
		return hass_state;
	}

	publishConfig( callback ) {
		new hass.Sensor( this ).setIcon().setValue( 'MsgRate' ).setUnit( "Msgs/h" ).publish( callback );
	}
}

// export class
module.exports = GatewayDevice;