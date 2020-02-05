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
const BaseDevice	= require( path.join( __dirname, 'BaseDevice' ) );

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

// export class
module.exports = GatewayDevice;