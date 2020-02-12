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
		this.commands = [ 'RAW', 'RFDEBUG', 'RFUDEBUG', 'QRFDEBUG', 'TRISTATEINVERT', 'RTSCLEAN', 'RTSRECCLEAN', 'RTSSHOW', 'RTSINVERT', 'RTSLONGTX' ]
		this.status = {};
	}

	// overridable: publishConfig will be called to publish a HASS configuration message
	publishConfig() {
		new hass.Gateway( this ).publish();
	}

	// overridable: executeCommand will be called when the device receives an mqtt command message
	executeCommand( command, message ) {
		switch ( command ) {
			case 'RTSCLEAN':
			case 'RTSSHOW':
			case 'RTSINVERT':
			case 'RTSLONGTX':
			case 'TRISTATEINVERT':
				// commands with no parameters
				rflink.SendRawCommand( command, ( error, data ) => {
					if ( error ) {
						this.setCommandError( error );
						log.error( "Failed to send command cmnd/%s to '%s'", command, this.name );
					}
					else {
						this.setCommandResult( data );
					}
				} );
				break;
			case 'RFDEBUG':
			case 'RFUDEBUG':
			case 'QRFDEBUG':
				// ON/OFF commands
				message = message.toUpperCase();
				if ( ['ON','OFF'].includes( message ) ) {
					rflink.SendRawCommand( `${command}=${message}`, ( error, data ) => {
						if ( error ) {
							this.setCommandError( error );
							log.error( "Failed to send command cmnd/%s '%s' to '%s'", command, message, this.name );
						}
						else {
							this.setCommandResult( data );
						}
					} );
				}
				else {
					this.setCommandError( `Invalid setting '${message}' supplied` );
					log.warn( "Ignoring invalid cmnd/%s setting '%s' sent to '%s'", command, message, this.name );
				}
				break;
			case 'RAW':
				log.info( "Sending raw command '%s'...", message );
				rflink.SendRawCommand( message, ( error ) => {
					if ( error ) {
						this.setCommandError( error );
						log.error( "Raw command '%s' returned '%s'", message, error.message );
					}
					else {
						this.setCommandResult( message );
						log.info( "Raw command '%s' returned OK", message );
					}
				} );
				break;
			default:
				this.setCommandError( "Command unknown" );
				return log.warn( "Ignoring unsupported cmnd/%s sent to '%s'", command, this.name );
		}
	}

	// overridable: processData will be called when the device gets data from the RFLink gateway
	processData( data, now ) {
		switch ( data.type ) {
			case 'DEBUG':
				return this.publish( 'tele/DEBUG', JSON.stringify( data ) );
		}
	}

	// overridable: getHassState will be called for getting a name/tele/HASS_STATE payload (should be chained)
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
}

// export class
module.exports = GatewayDevice;