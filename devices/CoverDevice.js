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
const Device		= require( path.join( __dirname, 'Device' ) );

// sensor device class
class CoverDevice extends Device {
	constructor( dl, name, cfg ) {
		super( dl, 'cover', name, cfg );
		this.loadConfig( cfg );
	}

	// overridable: initialize will be called when the device is online for the first time
	initialize( callback ) {
		if ( this.advanced ) {
			this.setPositionUncertain();
			this.call( callback );
			if ( this.isDeferPosition() ) {
				let target = this.getDeferPosition();
				this.clearDeferPosition();
				this.startMove( target );
			}
		}
		this.call( callback );
	}

	// overridable: publishConfig will be called to publish a HASS configuration message
	publishConfig( callback ) {
		new hass.Cover( this ).publish( callback );
	}

	// overridable: executeCommand will be called when the device receives an mqtt command message
	executeCommand( command, message ) {
		if ( this.advanced ) {
			this.executeCommandAdvanced( command, message );
		}
		else {
			this.executeCommandSimple( command, message );
		}
	}

	// overridable: processData will be called when the device gets data from the RFLink gateway
	processData( data, now ) {
		if ( this.advanced ) {
			this.processDataAdvanced( data, now );
		}
		else {
			this.processDataSimple( data, now );
		}
	}

	// overridable: getState will be called for getting a valid name/tele/STATE payload (should be chained)
	getState() {
		if ( this.state === undefined ) {
			// if we do not have a state, do not send it
			return undefined;
		}
		let state = super.getState();
		state[ this.advanced ? 'POSITION' : 'STATE' ] = this.state;
		return state;
	}

	executeCommandSimple( command, message ) {
		if ( command === 'CONTROL' ) {
			message = message.toUpperCase();
			if ( ['UP','DOWN','STOP'].includes( message ) ) {
				rflink.SendCommand( this.rfid, message, error => {
					if ( error ) {
						log.error( "Failed to send command cmnd/CONTROL '%s' to '%s'", message, this.name );
					}
					else {
						this.processData( { cmd: command } );
					}
				} );
			}
			else {
				log.warn( "Ignoring unknown command cmnd/CONTROL '%s' sent to '%s'", message, this.name );
			}
		}
	}

	processDataSimple( data, now ) {
		switch ( data.cmd ) {
			case 'UP':
				this.changeState( 'Open' );
				break;
			case 'DOWN':
				this.changeState( 'Closed' );
				break;
		}
	}

	executeCommandAdvanced( command, message ) {
		switch ( command ) {
			case 'CONTROL':
				switch ( message.toUpperCase() ) {
					case 'UP':
						return this.startMove( 100 );
					case 'DOWN':
						return this.startMove( 0 );
					case 'STOP':
						return this.stopMove();
					default:
						return log.warn( "Ignoring unknown command '%' on cmnd/CONTROL sent to '%s'", message, this.name );
				}
			case 'POSITION':
				let position = this.getNum( message );
				if ( position !== NaN ) {
					return this.startMove( position );
				}
				return log.warn( "Ignoring invalid position '%s' on cmnd/POSITION sent to '%s'", message, this.name );
			case 'RESET':
				return this.recalibrate();
			default:
				return log.warn( "Ignoring unsupported cmnd/%s sent to '%s'", command, this.name );
		}
	}

	processDataAdvanced( data, now ) {
		switch ( data.cmd ) {
			case 'UP':
				if ( ! this.isReceivedCommandInterventing() ) {
					this.startMove( 100, true );
				}
				break;
			case 'DOWN':
				if ( ! this.isReceivedCommandInterventing() ) {
					this.startMove( 0, true );
				}
				break;
			case 'STOP':
				if ( ! this.isReceivedCommandInterventing() ) {
					this.stopMove( true );
				}
				break;
		}
	}

	/**
	 * This method drives the cover to the specified postion starting from an unknown position.
	 * This is done by driving the cover to the best suited knowable position (open or closed)
	 * and then driving it back to the desired position.
	 *
	 * @param {number} target target position between 0 (open) and 100 (closed)
	 */
	recalibrate( target ) {
		// limit target position between 0 and 100
		target = Math.min( 100, Math.max( 0, target ) );
		if ( target === NaN ) {
			if ( typeof this.position === 'number' ) {
				target = this.position;
			}
			else {
				target = 100;
			}
		}

		if ( this.isRecalibrating() ) {
			// there is already a recalibration ongoing - change the target and let it go
			this.setRecalibrationTarget( target );
			return log.info( "Changed target position for recalibration of '%s' to %d", this.name, target );
		}

		let command, duration;
		if ( target < 50 ) {
			// recalibrate by closing it
			command = 'DOWN';
			duration = this.config.down_full * 1000;
		}
		else {
			// recalibrate by opening it
			command = 'UP';
			duration = this.config.up_full * 1000;
		}
		log.info( "Starting recalibration of '%s' with target position %d by moving to a known position...", this.name, target );
		this.setRecalibrationTarget( target );
		rflink.SendCommand( this.rfid, command, error => {
			if ( error ) {
				this.clearRecalibrationTarget();
				this.setPositionUncertain();
				return log.error( "Recalibration of '%s' failed.", this.name );
			}
			this.setRecalibrationTimer( () => {
				// it may be changed in the meantime...
				log.info( "Recalibration of '%s' finished.", this.name );
				target = this.getRecalibrationTarget();
				this.clearRecalibrationTarget();
				this.clearPositionUncertain();
				this.changePosition( command === 'UP' ? 100 : 0 );
				this.startMove( target );
			}, duration );
		} );
	}

	/**
	 * This method initiates movement towards the specified position
	 *
	 * @param {number} target target position between 0 (open) and 100 (closed)
	 * @param {boolean} do_not_send if true, no real command is sent via rflink
	 */
	startMove( target, do_not_send ) {
		if ( ! this.online ) {
			return this.setDeferPosition( target );
		}

		// special handling for special situations
		if ( this.isPositionUncertain() || this.isRecalibrating() ) {
			return this.recalibrate( target );
		}

		// limit target position between 0 and 100
		target = Math.min( 100, Math.max( 0, target ) );
		let delta = target - this.getCurrentPosition();
		let duration_multiplier = target == 0 || target == 100 ? 1.1 : 1;
		let command, duration, full_time;

		// check if we must switch the direction...
		if ( ( target * this.direction_time ) < 0 ) {
			// ...then stop first and than move again
			this.stopMove( do_not_send, error => {
				if ( ! error ) {
					this.startMove( target, do_not_send );
				}
			} );
			return undefined;
		}

		// ignore too short movements
		if ( Math.abs( delta ) < 3 ) {
			// stop in case it is moving...
			if ( Math.abs( delta ) > 0 ) {
				log.debug( "Ignoring too small move delta '%f' for cover '%s'", delta, this.name );
			}
			if ( this.isMoving() ) {
				this.stopMove( do_not_send );
			}
			return undefined;
		}

		// if already moving, we do not need to start movement
		if ( this.isMoving() ) {
			// compute new duration in msec needed to reach target position
			duration = Math.abs( delta * this.direction_time * 10 * duration_multiplier );
			// change stop timer
			log.info( "Continuing to move cover '%s' by '%f' for %f milliseconds", this.name, Math.abs( delta ), duration );
			return this.setStopTimer( duration );
		}

		// initialize operation parameters
		if ( delta < 0 ) {
			// move down
			full_time = - this.config.down_full;
			duration = Math.abs( delta * full_time * 10 * duration_multiplier );
			command = 'DOWN';
		}
		else {
			// move up
			full_time = this.config.up_full;
			duration = Math.abs( delta * full_time * 10 * duration_multiplier );
			command = 'UP';
		}

		log.info( "Starting to move %s cover '%s' by '%f' for %f milliseconds", command.toLowerCase(), this.name, Math.abs( delta ), duration );
		if ( do_not_send ) {
			// we do not really send the command
			this.startMoving( full_time, duration, new Date().getTime(), true );
		}
		else {
			rflink.SendCommand( this.rfid, command, ( error, sent, acktime ) => {
				if ( error ) {
					return log.error( "Failed to send %s command to cover '%s'", command, this.name );
				}
				this.startMoving( full_time, Math.max( duration - acktime, 1), sent, target == 0 || target == 100, acktime );
			} );
		}
	}

	/**
	 * This method stops a movement of the cover
	 *
	 * @param {boolean} do_not_send if true, no STOP command is sent via rflink
	 * @param {function} callback optional callback function with error parameter that will be called as soon as the stop has been completed
	 */
	stopMove( do_not_send, callback ) {
		this.clearStopTimer();
		this.clearUpdateTimer();
		if ( do_not_send ) {
			this.endMoving();
			this.call( callback );
		}
		else {
			rflink.SendCommand( this.rfid, 'STOP', ( error, sent, acktime ) => {
				if ( error ) {
					log.error( "Failed to stop moving cover '%s' - position uncertain" );
					this.endMoving( sent, -1 );
					if ( this.isMoving() ) this.setPositionUncertain();
				}
				else {
					this.endMoving( sent, acktime );
				}
				this.call( callback, error );
			} );
		}
	}

	loadConfig( cfg ) {
		let mycfg = {
			up: this.getNum( cfg.up, 0 ),
			up_close: this.getNum( cfg.up_close, 0 ),
			down_close: this.getNum( cfg.down_close, 0 ),
			down: this.getNum( cfg.down, 0 ),
		};
		mycfg.up_full = mycfg.up_close + mycfg.up;
		mycfg.down_full = mycfg.down + mycfg.down_close;
		if ( mycfg.up > 0 && mycfg.down > 0 ) {
			this.advanced = true;
			this.commands = [ 'CONTROL', 'POSITION', 'RESET' ];
			this.state = undefined;
			this.position = undefined;
			this.direction_time = 0;
			this.config = mycfg;
		}
		else {
			this.advanced = false;
			this.commands = [ 'CONTROL' ];
			this.state = undefined;
		}
	}

	getNum( val, def ) {
		let ret = parseFloat( val );
		return ret != NaN ? ret : def || NaN;
	}

	changeState( newState ) {
		if ( this.state != newState ) {
			this.state = newState;
			this.publishState();
		}
	}

	changePosition( newPosition ) {
		// limit new position between 0 and 100
		newPosition = Math.min( 100, Math.max( 0, newPosition ) );
		if ( this.position != newPosition ) {
			this.position = newPosition;
			this.changeState( Math.round( newPosition / 5 ) * 5 );
		}
	}

	getCurrentPosition( at_time ) {
		if ( this.isMoving() ) {
			let duration = ( at_time || new Date().getTime() ) - this.start_time;
			let percents = duration / ( this.direction_time * 10 );
			let computed_position = Math.min( 100, Math.max( 0, this.start_position + percents ) );
			log.debug( "Cover '%s' position moved by '%f' to position '%f' after %d milliseconds", this.name, percents, computed_position, duration );
			return computed_position;
		}
		return this.position;
	}

	setStopTimer( duration, do_not_send ) {
		this.clearStopTimer();
		this.stopTimer = setTimeout( () => {
			this.stopMove( do_not_send );
		}, duration );
	}

	clearStopTimer() {
		if ( this.stopTimer ) {
			clearTimeout( this.stopTimer );
			delete this.stopTimer;
		}
	}

	setUpdateTimer( duration ) {
		if ( ! this.updateTimer ) {
			this.updateTimer = setInterval( () => {
				this.changePosition( this.getCurrentPosition() );
			}, duration );
		}
	}

	clearUpdateTimer() {
		if ( this.updateTimer ) {
			clearInterval( this.updateTimer );
			delete this.updateTimer;
		}
	}

	setRecalibrationTimer( callback, duration ) {
		this.clearRecalibrationTimer();
		this.recalibrationTimer = setTimeout( () => {
			this.call( callback );
			delete this.recalibrationTimer;
		}, duration );
	}

	clearRecalibrationTimer() {
		if ( this.recalibrationTimer ) {
			clearTimeout( this.recalibrationTimer );
			delete this.recalibrationTimer;
		}
	}

	/**
	 * Answers the question if a received command would interventing in a running recalibration.
	 * In such a case the recalibration will be interrupted and the position will be marked as
	 * uncertain.
	 */
	isReceivedCommandInterventing() {
		if ( this.isRecalibrating() ) {
			// interrupt immediately any activity and mark our position as uncertain
			this.clearRecalibrationTimer();
			this.clearRecalibrationTarget();
			this.setPositionUncertain();
			log.warn( "External intervention during recalibration of '%s' caused position to be uncertain", this.name );
			return true;
		}
		return this.isPositionUncertain();
	}

	isPositionUncertain() {
		return this.uncertain_position === true;
	}

	setPositionUncertain() {
		this.uncertain_position = true;
	}

	clearPositionUncertain() {
		delete this.uncertain_position;
	}

	isRecalibrating() {
		return typeof this.recalibrate_position === 'number';
	}

	getRecalibrationTarget() {
		return this.recalibrate_position;
	}

	setRecalibrationTarget( target ) {
		this.recalibrate_position = target;
	}

	clearRecalibrationTarget() {
		delete this.recalibrate_position;
	}

	isMoving() {
		return this.start_time !== undefined;
	}

	isDeferPosition() {
		return typeof this.deferred_position === 'number';
	}

	getDeferPosition() {
		return this.deferred_position;
	}

	setDeferPosition( target ) {
		this.deferred_position = Math.min( 100, Math.max( 0, target ) );
		log.info( "Cover '%s', will move to position %f as soon as it goes online", this.name, this.deferred_position );
	}

	clearDeferPosition() {
		delete this.deferred_position;
	}

	startMoving( direction_time, duration, start_time, do_not_send, acktime ) {
		if ( ! this.start_time ) {
			this.direction_time = direction_time;
			this.start_time = start_time;
			this.start_position = this.position;
			this.setStopTimer( duration, do_not_send );
			this.setUpdateTimer( 500 );
			if ( acktime === undefined ) {
				log.debug( "Motion of cover '%s' started at epoch %d, stop timer set in %d milliseconds", this.name, start_time, duration );
			}
			else {
				log.debug( "Motion of cover '%s' started at epoch %d, stop timer set in %d milliseconds (acktime: %s msec)", this.name, start_time, duration, acktime );
			}
			return true;
		}
	}

	endMoving( at_time, acktime ) {
		if ( this.start_time ) {
			let now = at_time || new Date().getTime();
			let duration = now - this.start_time;
			this.changePosition( this.getCurrentPosition( now ) );
			this.direction_time = 0;
			delete this.start_time;
			delete this.start_position;
			if ( acktime === undefined ) {
				log.info( "Stopped to move cover '%s' at position %f %% after %d milliseconds", this.name, this.position, duration );
			}
			else if ( acktime >= 0 ) {
				log.info( "Stopped to move cover '%s' at position %f %% after %d milliseconds (acktime: %d msec)", this.name, this.position, duration, acktime );
			}
			return true;
		}
	}
}

// export class
module.exports = CoverDevice;