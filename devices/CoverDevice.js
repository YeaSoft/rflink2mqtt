// (c) 2020 YeaSoft Intl - Leo Moll
//
// This file implements the device class
// representing the majority of cover/blind/etc
// devices supported by RFLink

// activate strict mode
'use strict';

// load module dependencies
const path			= require( 'path' );

// load application modules
const log			= require( path.join( path.dirname( __dirname ), 'app-logger' ) );
const hass			= require( path.join( path.dirname( __dirname ), 'hass' ) );
const rflink		= require( path.join( path.dirname( __dirname ), 'rflink' ) );

// load device classes
const Device	= require( path.join( __dirname, 'Device' ) );

// sensor device class
class CoverDevice extends Device {
	constructor( dl, name, cfg ) {
		super( dl, 'cover', name, cfg );
		this.commands = [ 'CONTROL' ];
		this.state = undefined;
	}

	executeCommand( command, message ) {
		if ( command === 'CONTROL' ) {
			command = message.toUpperCase();
			if ( ['UP','DOWN','STOP'].includes( command ) ) {
				rflink.SendCommand( this.rfid, command, error => {
					if ( error ) {
						log.error( "Failed to send command 'CONTROL/%s' to '%s'", command, this.name );
					}
					else {
						this.processData( { cmd: command } );
					}
				} );
			}
			else {
				log.warn( "Ignoring unknown command 'CONTROL/%s' sent to '%s'", command, this.name );
			}
		}
	}

	processData( data, now ) {
		switch ( data.cmd ) {
			case 'UP':
				this.changeState( 'Open' );
				break;
			case 'DOWN':
				this.changeState( 'Closed' );
				break;
			}
	}

	changeState( newstate ) {
		if ( this.state != newstate ) {
			this.state = newstate;
			this.publishState();
		}
	}

	getState() {
		let state = super.getState();
		state[ "STATE" ] = this.state;
		return state;
	}

	publishConfig( callback ) {
		new hass.Cover( this ).publish( callback );
	}
}

// export class
module.exports = CoverDevice;