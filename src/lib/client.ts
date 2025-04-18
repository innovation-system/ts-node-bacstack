// Util Modules
import { EventEmitter } from 'events'
import debugLib from 'debug'

// Local Modules
import Transport from './transport'
import * as baServices from './services'
import * as baAsn1 from './asn1'
import * as baApdu from './apdu'
import * as baNpdu from './npdu'
import * as baBvlc from './bvlc'
import * as baEnum from './enum'
import {
	BACNetObjectID,
	BACNetPropertyID,
	BACNetAppData,
	TransportSettings,
	ClientOptions,
	WhoIsOptions,
	ServiceOptions,
	ReadPropertyOptions,
	WritePropertyOptions,
	ErrorCallback,
	DataCallback,
	DecodeAcknowledgeSingleResult,
	DecodeAcknowledgeMultipleResult,
	BACNetReadAccessSpecification,
	DeviceCommunicationOptions,
	ReinitializeDeviceOptions,
} from './types'

const debug = debugLib('bacstack')

const DEFAULT_HOP_COUNT = 0xff
const BVLC_HEADER_LENGTH = 4

/**
 * To be able to communicate to BACNET devices, you have to initialize a new bacstack instance.
 * @class bacstack
 * @param {object=} this._settings - The options object used for parameterizing the bacstack.
 * @param {number=} [options.port=47808] - BACNET communication port for listening and sending.
 * @param {string=} options.interface - Specific BACNET communication interface if different from primary one.
 * @param {string=} [options.broadcastAddress=255.255.255.255] - The address used for broadcast messages.
 * @param {number=} [options.apduTimeout=3000] - The timeout in milliseconds until a transaction should be interpreted as error.
 * @example
 * const bacnet = require('bacstack');
 *
 * const client = new bacnet({
 *   port: 47809,                          // Use BAC1 as communication port
 *   interface: '192.168.251.10',          // Listen on a specific interface
 *   broadcastAddress: '192.168.251.255',  // Use the subnet broadcast address
 *   apduTimeout: 6000                     // Wait twice as long for response
 * });
 */
export default class Client extends EventEmitter {
	private _settings: ClientOptions

	private _transport: Transport

	private _invokeCounter = 1

	private _invokeStore: {
		[key: number]: (err: Error | null, data?: any) => void
	} = {}

	private _lastSequenceNumber = 0

	private _segmentStore: any[] = []

	constructor(options?: ClientOptions) {
		super()

		options = options || {}

		this._settings = {
			port: options.port || 47808,
			interface: options.interface,
			transport: options.transport,
			broadcastAddress: options.broadcastAddress || '255.255.255.255',
			apduTimeout: options.apduTimeout || 3000,
		}

		this._transport =
			this._settings.transport ||
			new Transport({
				port: this._settings.port,
				interface: this._settings.interface,
				broadcastAddress: this._settings.broadcastAddress,
			} as TransportSettings)

		// Setup code
		this._transport.on('message', this._receiveData.bind(this))
		this._transport.on('error', this._receiveError.bind(this))
		this._transport.on('listening', () => this.emit('listening'))
		this._transport.open()
	}

	// Helper utils
	private _getInvokeId() {
		const id = this._invokeCounter++
		if (id >= 256) this._invokeCounter = 1
		return id - 1
	}

	private _invokeCallback(id: number, err: Error | null, result?: any) {
		const callback = this._invokeStore[id]
		if (callback) return callback(err, result)
		debug('InvokeId ', id, ' not found -> drop package')
	}

	private _addCallback(
		id: number,
		callback: (err: Error | null, data?: any) => void,
	): void {
		const timeout = setTimeout(() => {
			delete this._invokeStore[id]
			callback(new Error('ERR_TIMEOUT'))
		}, this._settings.apduTimeout)
		this._invokeStore[id] = (err: Error | null, data: any) => {
			clearTimeout(timeout)
			delete this._invokeStore[id]
			callback(err, data)
		}
	}

	private _getBuffer() {
		return {
			buffer: Buffer.alloc(this._transport.getMaxPayload()),
			offset: BVLC_HEADER_LENGTH,
		}
	}

	// Service Handlers
	private _processError(
		invokeId: number,
		buffer: Buffer,
		offset: number,
		length: number,
	) {
		const result = baServices.error.decode(buffer, offset)
		if (!result) return debug('Couldn`t decode Error')
		this._invokeCallback(
			invokeId,
			new Error(
				`BacnetError - Class:${result.class} - Code:${result.code}`,
			),
		)
	}

	private _processAbort(invokeId: number, reason: number) {
		this._invokeCallback(
			invokeId,
			new Error(`BacnetAbort - Reason:${reason}`),
		)
	}

	private _segmentAckResponse(
		receiver: string,
		negative: boolean,
		server: boolean,
		originalInvokeId: number,
		sequencenumber: number,
		actualWindowSize: number,
	) {
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			receiver,
			null,
			DEFAULT_HOP_COUNT,
			baEnum.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK,
			0,
		)
		baApdu.encodeSegmentAck(
			buffer,
			baEnum.PduTypes.SEGMENT_ACK |
				(negative ? baEnum.PduSegAckBits.NEGATIVE_ACK : 0) |
				(server ? baEnum.PduSegAckBits.SERVER : 0),
			originalInvokeId,
			sequencenumber,
			actualWindowSize,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, receiver)
	}

	private _performDefaultSegmentHandling(
		sender: any,
		adr: string,
		type: number,
		service: number,
		invokeId: number,
		maxSegments: number,
		maxApdu: number,
		sequencenumber: number,
		first: boolean,
		moreFollows: number,
		buffer: Buffer,
		offset: number,
		length: number,
	) {
		if (first) {
			this._segmentStore = []
			type &= ~baEnum.PduConReqBits.SEGMENTED_MESSAGE
			let apduHeaderLen = 3
			if (
				(type & baEnum.PDU_TYPE_MASK) ===
				baEnum.PduTypes.CONFIRMED_REQUEST
			) {
				apduHeaderLen = 4
			}
			const apdubuffer = this._getBuffer()
			apdubuffer.offset = 0
			buffer.copy(
				apdubuffer.buffer,
				apduHeaderLen,
				offset,
				offset + length,
			)
			if (
				(type & baEnum.PDU_TYPE_MASK) ===
				baEnum.PduTypes.CONFIRMED_REQUEST
			) {
				baApdu.encodeConfirmedServiceRequest(
					apdubuffer,
					type,
					service,
					maxSegments,
					maxApdu,
					invokeId,
					0,
					0,
				)
			} else {
				baApdu.encodeComplexAck(
					apdubuffer,
					type,
					service,
					invokeId,
					0,
					0,
				)
			}
			this._segmentStore.push(
				apdubuffer.buffer.slice(0, length + apduHeaderLen),
			)
		} else {
			this._segmentStore.push(buffer.slice(offset, offset + length))
		}
		if (!moreFollows) {
			const apduBuffer = Buffer.concat(this._segmentStore)
			this._segmentStore = []
			type &= ~baEnum.PduConReqBits.SEGMENTED_MESSAGE
			this._handlePdu(adr, type, apduBuffer, 0, apduBuffer.length)
		}
	}

	private _processSegment(
		receiver: string,
		type: number,
		service: number,
		invokeId: number,
		maxSegments: number,
		maxApdu: number,
		server: boolean,
		sequencenumber: number,
		proposedWindowNumber: number,
		buffer: Buffer,
		offset: number,
		length: number,
	) {
		let first = false
		if (sequencenumber === 0 && this._lastSequenceNumber === 0) {
			first = true
		} else if (sequencenumber !== this._lastSequenceNumber + 1) {
			return this._segmentAckResponse(
				receiver,
				true,
				server,
				invokeId,
				this._lastSequenceNumber,
				proposedWindowNumber,
			)
		}
		this._lastSequenceNumber = sequencenumber
		const moreFollows = type & baEnum.PduConReqBits.MORE_FOLLOWS
		if (!moreFollows) {
			this._lastSequenceNumber = 0
		}
		if (sequencenumber % proposedWindowNumber === 0 || !moreFollows) {
			this._segmentAckResponse(
				receiver,
				false,
				server,
				invokeId,
				sequencenumber,
				proposedWindowNumber,
			)
		}
		this._performDefaultSegmentHandling(
			this,
			receiver,
			type,
			service,
			invokeId,
			maxSegments,
			maxApdu,
			sequencenumber,
			first,
			moreFollows,
			buffer,
			offset,
			length,
		)
	}

	private _processConfirmedServiceRequest(
		address: string,
		type: number,
		service: number,
		maxSegments: number,
		maxApdu: number,
		invokeId: number,
		buffer: Buffer,
		offset: number,
		length: number,
	) {
		debug('Handle this._processConfirmedServiceRequest')
		if (service === baEnum.ConfirmedServiceChoice.READ_PROPERTY) {
			const result = baServices.readProperty.decode(
				buffer,
				offset,
				length,
			)
			if (!result) return debug('Received invalid readProperty message')
			this.emit('readProperty', {
				address,
				invokeId,
				request: result,
			})
		} else if (service === baEnum.ConfirmedServiceChoice.WRITE_PROPERTY) {
			const result = baServices.writeProperty.decode(
				buffer,
				offset,
				length,
			)
			if (!result) return debug('Received invalid writeProperty message')
			this.emit('writeProperty', {
				address,
				invokeId,
				request: result,
			})
		} else if (
			service === baEnum.ConfirmedServiceChoice.READ_PROPERTY_MULTIPLE
		) {
			const result = baServices.readPropertyMultiple.decode(
				buffer,
				offset,
				length,
			)
			if (!result)
				return debug('Received invalid readPropertyMultiple message')
			this.emit('readPropertyMultiple', {
				address,
				invokeId,
				request: result,
			})
		} else if (
			service === baEnum.ConfirmedServiceChoice.WRITE_PROPERTY_MULTIPLE
		) {
			const result = baServices.writePropertyMultiple.decode(
				buffer,
				offset,
				length,
			)
			if (!result)
				return debug('Received invalid writePropertyMultiple message')
			this.emit('writePropertyMultiple', {
				address,
				invokeId,
				request: result,
			})
		} else if (
			service === baEnum.ConfirmedServiceChoice.CONFIRMED_COV_NOTIFICATION
		) {
			const result = baServices.covNotify.decode(buffer, offset, length)
			if (!result) return debug('Received invalid covNotify message')
			this.emit('covNotify', {
				address,
				invokeId,
				request: result,
			})
		} else if (
			service === baEnum.ConfirmedServiceChoice.ATOMIC_WRITE_FILE
		) {
			const result = baServices.atomicWriteFile.decode(
				buffer,
				offset,
				length,
			)
			if (!result)
				return debug('Received invalid atomicWriteFile message')
			this.emit('atomicWriteFile', {
				address,
				invokeId,
				request: result,
			})
		} else if (service === baEnum.ConfirmedServiceChoice.ATOMIC_READ_FILE) {
			const result = baServices.atomicReadFile.decode(buffer, offset)
			if (!result) return debug('Received invalid atomicReadFile message')
			this.emit('atomicReadFile', {
				address,
				invokeId,
				request: result,
			})
		} else if (service === baEnum.ConfirmedServiceChoice.SUBSCRIBE_COV) {
			const result = baServices.subscribeCov.decode(
				buffer,
				offset,
				length,
			)
			if (!result) return debug('Received invalid subscribeCOV message')
			this.emit('subscribeCOV', {
				address,
				invokeId,
				request: result,
			})
		} else if (
			service === baEnum.ConfirmedServiceChoice.SUBSCRIBE_COV_PROPERTY
		) {
			const result = baServices.subscribeProperty.decode(buffer, offset)
			if (!result)
				return debug('Received invalid subscribeProperty message')
			this.emit('subscribeProperty', {
				address,
				invokeId,
				request: result,
			})
		} else if (
			service ===
			baEnum.ConfirmedServiceChoice.DEVICE_COMMUNICATION_CONTROL
		) {
			const result = baServices.deviceCommunicationControl.decode(
				buffer,
				offset,
				length,
			)
			if (!result)
				return debug(
					'Received invalid deviceCommunicationControl message',
				)
			this.emit('deviceCommunicationControl', {
				address,
				invokeId,
				request: result,
			})
		} else if (
			service === baEnum.ConfirmedServiceChoice.REINITIALIZE_DEVICE
		) {
			const result = baServices.reinitializeDevice.decode(
				buffer,
				offset,
				length,
			)
			if (!result)
				return debug('Received invalid reinitializeDevice message')
			this.emit('reinitializeDevice', {
				address,
				invokeId,
				request: result,
			})
		} else if (
			service ===
			baEnum.ConfirmedServiceChoice.CONFIRMED_EVENT_NOTIFICATION
		) {
			const result = baServices.eventNotifyData.decode(buffer, offset)
			if (!result)
				return debug('Received invalid eventNotifyData message')
			this.emit('eventNotifyData', {
				address,
				invokeId,
				request: result,
			})
		} else if (service === baEnum.ConfirmedServiceChoice.READ_RANGE) {
			const result = baServices.readRange.decode(buffer, offset, length)
			if (!result) return debug('Received invalid readRange message')
			this.emit('readRange', {
				address,
				invokeId,
				request: result,
			})
		} else if (service === baEnum.ConfirmedServiceChoice.CREATE_OBJECT) {
			const result = baServices.createObject.decode(
				buffer,
				offset,
				length,
			)
			if (!result) return debug('Received invalid createObject message')
			this.emit('createObject', {
				address,
				invokeId,
				request: result,
			})
		} else if (service === baEnum.ConfirmedServiceChoice.DELETE_OBJECT) {
			const result = baServices.deleteObject.decode(
				buffer,
				offset,
				length,
			)
			if (!result) return debug('Received invalid deleteObject message')
			this.emit('deleteObject', {
				address,
				invokeId,
				request: result,
			})
		} else if (
			service === baEnum.ConfirmedServiceChoice.ACKNOWLEDGE_ALARM
		) {
			const result = baServices.alarmAcknowledge.decode(
				buffer,
				offset,
				length,
			)
			if (!result)
				return debug('Received invalid alarmAcknowledge message')
			this.emit('alarmAcknowledge', {
				address,
				invokeId,
				request: result,
			})
		} else if (
			service === baEnum.ConfirmedServiceChoice.GET_ALARM_SUMMARY
		) {
			this.emit('getAlarmSummary', {
				address,
				invokeId,
			})
		} else if (
			service === baEnum.ConfirmedServiceChoice.GET_ENROLLMENT_SUMMARY
		) {
			const result = baServices.getEnrollmentSummary.decode(
				buffer,
				offset,
			)
			if (!result)
				return debug('Received invalid getEntrollmentSummary message')
			this.emit('getEntrollmentSummary', {
				address,
				invokeId,
				request: result,
			})
		} else if (
			service === baEnum.ConfirmedServiceChoice.GET_EVENT_INFORMATION
		) {
			const result = baServices.getEventInformation.decode(buffer, offset)
			if (!result)
				return debug('Received invalid getEventInformation message')
			this.emit('getEventInformation', {
				address,
				invokeId,
				request: result,
			})
		} else if (
			service === baEnum.ConfirmedServiceChoice.LIFE_SAFETY_OPERATION
		) {
			const result = baServices.lifeSafetyOperation.decode(
				buffer,
				offset,
				length,
			)
			if (!result)
				return debug('Received invalid lifeSafetyOperation message')
			this.emit('lifeSafetyOperation', {
				address,
				invokeId,
				request: result,
			})
		} else if (service === baEnum.ConfirmedServiceChoice.ADD_LIST_ELEMENT) {
			const result = baServices.addListElement.decode(
				buffer,
				offset,
				length,
			)
			if (!result) return debug('Received invalid addListElement message')
			this.emit('addListElement', {
				address,
				invokeId,
				request: result,
			})
		} else if (
			service === baEnum.ConfirmedServiceChoice.REMOVE_LIST_ELEMENT
		) {
			const result = baServices.addListElement.decode(
				buffer,
				offset,
				length,
			)
			if (!result)
				return debug('Received invalid removeListElement message')
			this.emit('removeListElement', {
				address,
				invokeId,
				request: result,
			})
		} else if (
			service === baEnum.ConfirmedServiceChoice.CONFIRMED_PRIVATE_TRANSFER
		) {
			const result = baServices.privateTransfer.decode(
				buffer,
				offset,
				length,
			)
			if (!result)
				return debug('Received invalid privateTransfer message')
			this.emit('privateTransfer', {
				address,
				invokeId,
				request: result,
			})
		} else {
			debug('Received unsupported confirmed service request')
		}
	}

	private _processUnconfirmedServiceRequest(
		address: string,
		type: number,
		service: number,
		buffer: Buffer,
		offset: number,
		length: number,
	) {
		debug('Handle this._processUnconfirmedServiceRequest')
		if (service === baEnum.UnconfirmedServiceChoice.I_AM) {
			const result = baServices.iAmBroadcast.decode(buffer, offset)
			if (!result) return debug('Received invalid iAm message')

			/**
			 * The iAm event represents the response to a whoIs request to detect all devices in a BACNET network.
			 * @event bacstack.iAm
			 * @param {object} device - An object representing the detected device.
			 * @param {string} device.address - The IP address of the detected device.
			 * @param {number} device.deviceId - The BACNET device-id of the detected device.
			 * @param {number} device.maxApdu - The max APDU size the detected device is supporting.
			 * @param {number} device.segmentation - The type of segmentation the detected device is supporting.
			 * @param {number} device.vendorId - The BACNET vendor-id of the detected device.
			 * @example
			 * const bacnet = require('bacstack');
			 * const client = new bacnet();
			 *
			 * client.on('iAm', (device) => {
			 *   console.log('address: ', device.address, ' - deviceId: ', device.deviceId, ' - maxApdu: ', device.maxApdu, ' - segmentation: ', device.segmentation, ' - vendorId: ', device.vendorId);
			 * });
			 */
			this.emit('iAm', {
				address,
				deviceId: result.deviceId,
				maxApdu: result.maxApdu,
				segmentation: result.segmentation,
				vendorId: result.vendorId,
			})
		} else if (service === baEnum.UnconfirmedServiceChoice.WHO_IS) {
			const result = baServices.whoIs.decode(buffer, offset, length)
			if (!result) return debug('Received invalid WhoIs message')

			/**
			 * The whoIs event represents the request for an IAm reponse to detect all devices in a BACNET network.
			 * @event bacstack.whoIs
			 * @param {object} request - An object representing the received request.
			 * @param {string} request.address - The IP address of the device sending the request.
			 * @param {number=} request.lowLimit - The lower limit of the BACNET device-id.
			 * @param {number=} request.highLimit - The higher limit of the BACNET device-id.
			 * @example
			 * const bacnet = require('bacstack');
			 * const client = new bacnet();
			 *
			 * client.on('whoIs', (request) => {
			 *   console.log('address: ', device.address, ' - lowLimit: ', device.lowLimit, ' - highLimit: ', device.highLimit);
			 * });
			 */
			this.emit('whoIs', {
				address,
				lowLimit: result.lowLimit,
				highLimit: result.highLimit,
			})
		} else if (service === baEnum.UnconfirmedServiceChoice.WHO_HAS) {
			const result = baServices.whoHas.decode(buffer, offset, length)
			if (!result) return debug('Received invalid WhoHas message')
			this.emit('whoHas', {
				address,
				lowLimit: result.lowLimit,
				highLimit: result.highLimit,
				objectId: result.objectId,
				objectName: result.objectName,
			})
		} else if (
			service ===
			baEnum.UnconfirmedServiceChoice.UNCONFIRMED_COV_NOTIFICATION
		) {
			const result = baServices.covNotify.decode(buffer, offset, length)
			if (!result)
				return debug('Received invalid covNotifyUnconfirmed message')
			this.emit('covNotifyUnconfirmed', {
				address,
				request: result,
			})
		} else if (
			service === baEnum.UnconfirmedServiceChoice.TIME_SYNCHRONIZATION
		) {
			const result = baServices.timeSync.decode(buffer, offset)
			if (!result) return debug('Received invalid TimeSync message')

			/**
			 * The timeSync event represents the request to synchronize the local time to the received time.
			 * @event bacstack.timeSync
			 * @param {object} request - An object representing the received request.
			 * @param {string} request.address - The IP address of the device sending the request.
			 * @param {date} request.dateTime - The time to be synchronized to.
			 * @example
			 * const bacnet = require('bacstack');
			 * const client = new bacnet();
			 *
			 * client.on('timeSync', (request) => {
			 *   console.log('address: ', request.address, ' - dateTime: ', request.dateTime);
			 * });
			 */
			this.emit('timeSync', { address, dateTime: result.value })
		} else if (
			service === baEnum.UnconfirmedServiceChoice.UTC_TIME_SYNCHRONIZATION
		) {
			const result = baServices.timeSync.decode(buffer, offset)
			if (!result) return debug('Received invalid TimeSyncUTC message')

			/**
			 * The timeSyncUTC event represents the request to synchronize the local time to the received UTC time.
			 * @event bacstack.timeSyncUTC
			 * @param {object} request - An object representing the received request.
			 * @param {string} request.address - The IP address of the device sending the request.
			 * @param {date} request.dateTime - The time to be synchronized to.
			 * @example
			 * const bacnet = require('bacstack');
			 * const client = new bacnet();
			 *
			 * client.on('timeSyncUTC', (request) => {
			 *   console.log('address: ', request.address, ' - dateTime: ', request.dateTime);
			 * });
			 */
			this.emit('timeSyncUTC', {
				address,
				dateTime: result.value,
			})
		} else if (
			service ===
			baEnum.UnconfirmedServiceChoice.UNCONFIRMED_EVENT_NOTIFICATION
		) {
			const result = baServices.eventNotifyData.decode(buffer, offset)
			if (!result) return debug('Received invalid EventNotify message')
			this.emit('eventNotify', {
				address,
				eventData: result.eventData,
			})
		} else if (service === baEnum.UnconfirmedServiceChoice.I_HAVE) {
			const result = baServices.iHaveBroadcast.decode(
				buffer,
				offset,
				length,
			)
			if (!result) return debug('Received invalid ihaveBroadcast message')
			this.emit('ihaveBroadcast', {
				address,
				eventData: result.eventData,
			})
		} else if (
			service ===
			baEnum.UnconfirmedServiceChoice.UNCONFIRMED_PRIVATE_TRANSFER
		) {
			const result = baServices.privateTransfer.decode(
				buffer,
				offset,
				length,
			)
			if (!result)
				return debug('Received invalid privateTransfer message')
			this.emit('privateTransfer', {
				address,
				eventData: result.eventData,
			})
		} else {
			debug('Received unsupported unconfirmed service request')
		}
	}

	private _handlePdu(
		address: string,
		type: number,
		buffer: Buffer,
		offset: number,
		length: number,
	) {
		// Handle different PDU types
		switch (type & baEnum.PDU_TYPE_MASK) {
			case baEnum.PduTypes.UNCONFIRMED_REQUEST: {
				const result = baApdu.decodeUnconfirmedServiceRequest(
					buffer,
					offset,
				)
				this._processUnconfirmedServiceRequest(
					address,
					result.type,
					result.service,
					buffer,
					offset + result.len,
					length - result.len,
				)
				break
			}
			case baEnum.PduTypes.SIMPLE_ACK: {
				const result = baApdu.decodeSimpleAck(buffer, offset)
				offset += result.len
				length -= result.len
				this._invokeCallback(result.invokeId, null, {
					result,
					buffer,
					offset: offset + result.len,
					length: length - result.len,
				})
				break
			}
			case baEnum.PduTypes.COMPLEX_ACK: {
				const result = baApdu.decodeComplexAck(buffer, offset)
				if ((type & baEnum.PduConReqBits.SEGMENTED_MESSAGE) === 0) {
					this._invokeCallback(result.invokeId, null, {
						result,
						buffer,
						offset: offset + result.len,
						length: length - result.len,
					})
				} else {
					this._processSegment(
						address,
						result.type,
						result.service,
						result.invokeId,
						baEnum.MaxSegmentsAccepted.SEGMENTS_0,
						baEnum.MaxApduLengthAccepted.OCTETS_50,
						false,
						result.sequencenumber,
						result.proposedWindowNumber,
						buffer,
						offset + result.len,
						length - result.len,
					)
				}
				break
			}
			case baEnum.PduTypes.SEGMENT_ACK: {
				// FIXME: Segment ACK handling
				// const result = baApdu.decodeSegmentAck(buffer, offset);
				// m_last_segment_ack.Set(address, result.originalInvokeId, result.sequencenumber, result.actualWindowSize);
				// this._processSegmentAck(address, result.type, result.originalInvokeId, result.sequencenumber, result.actualWindowSize, buffer, offset + result.len, length - result.len);
				break
			}
			case baEnum.PduTypes.ERROR: {
				const result = baApdu.decodeError(buffer, offset)
				this._processError(
					result.invokeId,
					buffer,
					offset + result.len,
					length - result.len,
				)
				break
			}
			case baEnum.PduTypes.REJECT:
			case baEnum.PduTypes.ABORT: {
				const result = baApdu.decodeAbort(buffer, offset)
				this._processAbort(result.invokeId, result.reason)
				break
			}
			case baEnum.PduTypes.CONFIRMED_REQUEST:
				{
					const result = baApdu.decodeConfirmedServiceRequest(
						buffer,
						offset,
					)
					if ((type & baEnum.PduConReqBits.SEGMENTED_MESSAGE) === 0) {
						this._processConfirmedServiceRequest(
							address,
							result.type,
							result.service,
							result.maxSegments,
							result.maxApdu,
							result.invokeId,
							buffer,
							offset + result.len,
							length - result.len,
						)
					} else {
						this._processSegment(
							address,
							result.type,
							result.service,
							result.invokeId,
							result.maxSegments,
							result.maxApdu,
							true,
							result.sequencenumber,
							result.proposedWindowNumber,
							buffer,
							offset + result.len,
							length - result.len,
						)
					}
				}
				break
			default:
				debug('Received unknown PDU type -> Drop package')
				break
		}
	}

	private _handleNpdu(
		buffer: Buffer,
		offset: number,
		msgLength: number,
		remoteAddress: string,
	) {
		// Check data length
		if (msgLength <= 0) return debug('No NPDU data -> Drop package')
		// Parse baNpdu header
		const result = baNpdu.decode(buffer, offset)
		if (!result)
			return debug('Received invalid NPDU header -> Drop package')
		if (result.funct & baEnum.NpduControlBits.NETWORK_LAYER_MESSAGE) {
			return debug('Received network layer message -> Drop package')
		}
		offset += result.len
		msgLength -= result.len
		if (msgLength <= 0) return debug('No APDU data -> Drop package')
		const apduType = baApdu.getDecodedType(buffer, offset)
		this._handlePdu(remoteAddress, apduType, buffer, offset, msgLength)
	}

	private _receiveData(buffer: Buffer, remoteAddress: string) {
		// Check data length
		if (buffer.length < baEnum.BVLC_HEADER_LENGTH)
			return debug('Received invalid data -> Drop package')
		// Parse BVLC header
		const result = baBvlc.decode(buffer, 0)
		if (!result)
			return debug('Received invalid BVLC header -> Drop package')
		// Check BVLC function
		if (
			result.func === baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU ||
			result.func === baEnum.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU ||
			result.func === baEnum.BvlcResultPurpose.FORWARDED_NPDU
		) {
			this._handleNpdu(
				buffer,
				result.len,
				buffer.length - result.len,
				remoteAddress,
			)
		} else {
			debug('Received unknown BVLC function -> Drop package')
		}
	}

	private _receiveError(err: Error) {
		/**
		 * @event bacstack.error
		 * @param {error} err - The error object thrown by the underlying transport layer.
		 * @example
		 * const bacnet = require('bacstack');
		 * const client = new bacnet();
		 *
		 * client.on('error', (err) => {
		 *   console.log('Error occurred: ', err);
		 *   client.close();
		 * });
		 */
		this.emit('error', err)
	}

	/**
	 * The whoIs command discovers all BACNET devices in a network.
	 * @function bacstack.whoIs
	 * @param {object=} options
	 * @param {number=} options.lowLimit - Minimal device instance number to search for.
	 * @param {number=} options.highLimit - Maximal device instance number to search for.
	 * @param {string=} options.address - Unicast address if command should address a device directly.
	 * @fires bacstack.iAm
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * client.whoIs();
	 */
	whoIs(options?: WhoIsOptions) {
		options = options || {}
		const settings = {
			lowLimit: options.lowLimit,
			highLimit: options.highLimit,
			address: options.address || this._transport.getBroadcastAddress(),
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			this._settings.interface,
			null,
			DEFAULT_HOP_COUNT,
			baEnum.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK,
			0,
		)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.UNCONFIRMED_REQUEST,
			baEnum.UnconfirmedServiceChoice.WHO_IS,
		)
		baServices.whoIs.encode(buffer, settings.lowLimit, settings.highLimit)
		const npduType =
			this._settings.interface !== this._transport.getBroadcastAddress()
				? baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU
				: baEnum.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU
		baBvlc.encode(buffer.buffer, npduType, buffer.offset)
		this._transport.send(buffer.buffer, buffer.offset, settings.address)
	}

	/**
	 * The timeSync command sets the time of a target device.
	 * @function bacstack.timeSync
	 * @param {string} address - IP address of the target device.
	 * @param {date} dateTime - The date and time to set on the target device.
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * client.timeSync('192.168.1.43', new Date());
	 */
	timeSync(address: string, dateTime: Date) {
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			address,
		)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.UNCONFIRMED_REQUEST,
			baEnum.UnconfirmedServiceChoice.TIME_SYNCHRONIZATION,
		)
		baServices.timeSync.encode(buffer, dateTime)
		const npduType =
			address !== this._transport.getBroadcastAddress()
				? baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU
				: baEnum.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU
		baBvlc.encode(buffer.buffer, npduType, buffer.offset)
		this._transport.send(buffer.buffer, buffer.offset, address)
	}

	/**
	 * The timeSyncUTC command sets the UTC time of a target device.
	 * @function bacstack.timeSyncUTC
	 * @param {string} address - IP address of the target device.
	 * @param {date} dateTime - The date and time to set on the target device.
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * client.timeSyncUTC('192.168.1.43', new Date());
	 */
	timeSyncUTC(address: string, dateTime: Date) {
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			address,
		)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.UNCONFIRMED_REQUEST,
			baEnum.UnconfirmedServiceChoice.UTC_TIME_SYNCHRONIZATION,
		)
		baServices.timeSync.encode(buffer, dateTime)
		const npduType =
			address !== this._transport.getBroadcastAddress()
				? baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU
				: baEnum.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU
		baBvlc.encode(buffer.buffer, npduType, buffer.offset)
		this._transport.send(buffer.buffer, buffer.offset, address)
	}

	/**
	 * The readProperty command reads a single property of an object from a device.
	 * @function bacstack.readProperty
	 * @param {string} address - IP address of the target device.
	 * @param {object} objectId - The BACNET object ID to read.
	 * @param {number} objectId.type - The BACNET object type to read.
	 * @param {number} objectId.instance - The BACNET object instance to read.
	 * @param {number} propertyId - The BACNET property id in the specified object to read.
	 * @param {object=} options
	 * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
	 * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
	 * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
	 * @param {number=} options.arrayIndex - The array index of the property to be read.
	 * @param {function} next - The callback containing an error, in case of a failure and value object in case of success.
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * client.readProperty('192.168.1.43', {type: 8, instance: 44301}, 28, (err, value) => {
	 *   console.log('value: ', value);
	 * });
	 */
	readProperty(
		address: string,
		objectId: BACNetObjectID,
		propertyId: number,
		callback: DataCallback<DecodeAcknowledgeSingleResult>,
	): void
	readProperty(
		address: string,
		objectId: BACNetObjectID,
		propertyId: number,
		options: ReadPropertyOptions,
		callback: DataCallback<DecodeAcknowledgeSingleResult>,
	): void
	readProperty(
		address: string,
		objectId: BACNetObjectID,
		propertyId: number,
		optionsOrCallback:
			| ReadPropertyOptions
			| DataCallback<DecodeAcknowledgeSingleResult>,
		callback?: DataCallback<DecodeAcknowledgeSingleResult>,
	): void {
		if (typeof optionsOrCallback !== 'function' && !callback) {
			throw new Error('A callback function must be provided')
		}

		const next: DataCallback<DecodeAcknowledgeSingleResult> =
			typeof optionsOrCallback === 'function'
				? optionsOrCallback
				: callback

		const options: ReadPropertyOptions =
			typeof optionsOrCallback === 'function' ? {} : optionsOrCallback

		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
			arrayIndex: options.arrayIndex || baEnum.ASN1_ARRAY_ALL,
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
			null,
			DEFAULT_HOP_COUNT,
			baEnum.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK,
			0,
		)
		const type =
			baEnum.PduTypes.CONFIRMED_REQUEST |
			(settings.maxSegments !== baEnum.MaxSegmentsAccepted.SEGMENTS_0
				? baEnum.PduConReqBits.SEGMENTED_RESPONSE_ACCEPTED
				: 0)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			type,
			baEnum.ConfirmedServiceChoice.READ_PROPERTY,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.readProperty.encode(
			buffer,
			objectId.type,
			objectId.instance,
			propertyId,
			settings.arrayIndex,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err, data) => {
			if (err) return next(err)
			const result = baServices.readProperty.decodeAcknowledge(
				data.buffer,
				data.offset,
				data.length,
			)
			if (!result) return next(new Error('INVALID_DECODING'))
			next(null, result)
		})
	}

	/**
	 * The writeProperty command writes a single property of an object to a device.
	 * @function bacstack.writeProperty
	 * @param {string} address - IP address of the target device.
	 * @param {object} objectId - The BACNET object ID to write.
	 * @param {number} objectId.type - The BACNET object type to write.
	 * @param {number} objectId.instance - The BACNET object instance to write.
	 * @param {number} propertyId - The BACNET property id in the specified object to write.
	 * @param {object[]} values - A list of values to be written to the specified property.
	 * @param {ApplicationTags} values.tag - The data-type of the value to be written.
	 * @param {number} values.value - The actual value to be written.
	 * @param {object=} options
	 * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
	 * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
	 * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
	 * @param {number=} options.arrayIndex - The array index of the property to be read.
	 * @param {number=} options.priority - The priority of the value to be written.
	 * @param {function} next - The callback containing an error, in case of a failure.
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * client.writeProperty('192.168.1.43', {type: 8, instance: 44301}, 28, [
	 *   {type: bacnet.enum.ApplicationTags.REAL, value: 100}
	 * ], (err) => {
	 *   console.log('error: ', err);
	 * });
	 */
	writeProperty(
		address: string,
		objectId: BACNetObjectID,
		propertyId: number,
		values: BACNetAppData[],
		callback: ErrorCallback,
	): void
	writeProperty(
		address: string,
		objectId: BACNetObjectID,
		propertyId: number,
		values: BACNetAppData[],
		options: WritePropertyOptions,
		callback: ErrorCallback,
	): void
	writeProperty(
		address: string,
		objectId: BACNetObjectID,
		propertyId: number,
		values: BACNetAppData[],
		optionsOrCallback: WritePropertyOptions | ErrorCallback,
		callback?: ErrorCallback,
	): void {
		if (typeof optionsOrCallback !== 'function' && !callback) {
			throw new Error('A callback function must be provided')
		}

		const next: ErrorCallback =
			typeof optionsOrCallback === 'function'
				? optionsOrCallback
				: callback

		const options: WritePropertyOptions =
			typeof optionsOrCallback === 'function' ? {} : optionsOrCallback

		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
			arrayIndex: options.arrayIndex || baEnum.ASN1_ARRAY_ALL,
			priority: options.priority,
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
			null,
			DEFAULT_HOP_COUNT,
			baEnum.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK,
			0,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.WRITE_PROPERTY,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.writeProperty.encode(
			buffer,
			objectId.type,
			objectId.instance,
			propertyId,
			settings.arrayIndex,
			settings.priority,
			values,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err) => {
			if (next) next(err)
		})
	}

	/**
	 * The readPropertyMultiple command reads multiple properties in multiple objects from a device.
	 * @function bacstack.readPropertyMultiple
	 * @param {string} address - IP address of the target device.
	 * @param {object[]} propertiesArray - List of object and property specifications to be read.
	 * @param {object} propertiesArray.objectId - Specifies which object to read.
	 * @param {number} propertiesArray.objectId.type - The BACNET object type to read.
	 * @param {number} propertiesArray.objectId.instance - The BACNET object instance to read.
	 * @param {object[]} propertiesArray.properties - List of properties to be read.
	 * @param {number} propertiesArray.properties.id - The BACNET property id in the specified object to read. Also supports 8 for all properties.
	 * @param {object=} options
	 * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
	 * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
	 * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
	 * @param {function} next - The callback containing an error, in case of a failure and value object in case of success.
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * const propertiesArray = [
	 *   {objectId: {type: 8, instance: 4194303}, properties: [{id: 8}]}
	 * ];
	 * client.readPropertyMultiple('192.168.1.43', propertiesArray, (err, value) => {
	 *   console.log('value: ', value);
	 * });
	 */
	readPropertyMultiple(
		address: string,
		propertiesArray: BACNetReadAccessSpecification[],
		callback: DataCallback<DecodeAcknowledgeMultipleResult>,
	): void
	readPropertyMultiple(
		address: string,
		propertiesArray: BACNetReadAccessSpecification[],
		options: ServiceOptions,
		callback: DataCallback<DecodeAcknowledgeMultipleResult>,
	): void
	readPropertyMultiple(
		address: string,
		propertiesArray: BACNetReadAccessSpecification[],
		optionsOrCallback:
			| ServiceOptions
			| DataCallback<DecodeAcknowledgeMultipleResult>,
		callback?: DataCallback<DecodeAcknowledgeMultipleResult>,
	): void {
		if (typeof optionsOrCallback !== 'function' && !callback) {
			throw new Error('A callback function must be provided')
		}

		const next: DataCallback<DecodeAcknowledgeMultipleResult> =
			typeof optionsOrCallback === 'function'
				? optionsOrCallback
				: callback

		const options: ServiceOptions =
			typeof optionsOrCallback === 'function' ? {} : optionsOrCallback

		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
			null,
			DEFAULT_HOP_COUNT,
			baEnum.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK,
			0,
		)
		const type =
			baEnum.PduTypes.CONFIRMED_REQUEST |
			(settings.maxSegments !== baEnum.MaxSegmentsAccepted.SEGMENTS_0
				? baEnum.PduConReqBits.SEGMENTED_RESPONSE_ACCEPTED
				: 0)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			type,
			baEnum.ConfirmedServiceChoice.READ_PROPERTY_MULTIPLE,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.readPropertyMultiple.encode(buffer, propertiesArray)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err, data) => {
			if (err) return next(err)
			const result = baServices.readPropertyMultiple.decodeAcknowledge(
				data.buffer,
				data.offset,
				data.length,
			)
			if (!result) return next(new Error('INVALID_DECODING'))
			next(null, result)
		})
	}

	/**
	 * The writePropertyMultiple command writes multiple properties in multiple objects to a device.
	 * @function bacstack.writePropertyMultiple
	 * @param {string} address - IP address of the target device.
	 * @param {object[]} values - List of object and property specifications to be written.
	 * @param {object} values.objectId - Specifies which object to read.
	 * @param {number} values.objectId.type - The BACNET object type to read.
	 * @param {number} values.objectId.instance - The BACNET object instance to read.
	 * @param {object[]} values.values - List of properties to be written.
	 * @param {object} values.values.property - Property specifications to be written.
	 * @param {number} values.values.property.id - The BACNET property id in the specified object to write.
	 * @param {number} values.values.property.index - The array index of the property to be written.
	 * @param {object[]} values.values.value - A list of values to be written to the specified property.
	 * @param {ApplicationTags} values.values.value.tag - The data-type of the value to be written.
	 * @param {object} values.values.value.value - The actual value to be written.
	 * @param {number} values.values.priority - The priority to be used for writing to the property.
	 * @param {object=} options
	 * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
	 * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
	 * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
	 * @param {function} next - The callback containing an error, in case of a failure.
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * const values = [
	 *   {objectId: {type: 8, instance: 44301}, values: [
	 *     {property: {id: 28, index: 12}, value: [{type: bacnet.enum.ApplicationTags.BOOLEAN, value: true}], priority: 8}
	 *   ]}
	 * ];
	 * client.writePropertyMultiple('192.168.1.43', values, (err) => {
	 *   console.log('error: ', err);
	 * });
	 */
	writePropertyMultiple(
		address: string,
		values: any[],
		callback: ErrorCallback,
	): void
	writePropertyMultiple(
		address: string,
		values: any[],
		options: ServiceOptions,
		callback: ErrorCallback,
	): void
	writePropertyMultiple(
		address: string,
		values: any[],
		optionsOrCallback: ServiceOptions | ErrorCallback,
		callback?: ErrorCallback,
	): void {
		if (typeof optionsOrCallback !== 'function' && !callback) {
			throw new Error('A callback function must be provided')
		}

		const next: ErrorCallback =
			typeof optionsOrCallback === 'function'
				? optionsOrCallback
				: callback

		const options: ServiceOptions =
			typeof optionsOrCallback === 'function' ? {} : optionsOrCallback
		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.WRITE_PROPERTY_MULTIPLE,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
		)
		baServices.writePropertyMultiple.encodeObject(buffer, values)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err) => next(err))
	}

	/**
	 * The deviceCommunicationControl command enables or disables network communication of the target device.
	 * @function bacstack.deviceCommunicationControl
	 * @param {string} address - IP address of the target device.
	 * @param {number} timeDuration - The time to hold the network communication state in seconds. 0 for infinite.
	 * @param {EnableDisable} enableDisable - The network communication state to set.
	 * @param {object=} options
	 * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
	 * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
	 * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
	 * @param {string=} options.password - The optional password used to set the network communication state.
	 * @param {function} next - The callback containing an error, in case of a failure.
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * client.deviceCommunicationControl('192.168.1.43', 0, bacnet.enum.EnableDisable.DISABLE, (err) => {
	 *   console.log('error: ', err);
	 * });
	 */
	deviceCommunicationControl(
		address: string,
		timeDuration: number,
		enableDisable: number,
		callback: ErrorCallback,
	): void
	deviceCommunicationControl(
		address: string,
		timeDuration: number,
		enableDisable: number,
		options: DeviceCommunicationOptions,
		callback: ErrorCallback,
	): void
	deviceCommunicationControl(
		address: string,
		timeDuration: number,
		enableDisable: number,
		optionsOrCallback: DeviceCommunicationOptions | ErrorCallback,
		callback?: ErrorCallback,
	): void {
		if (typeof optionsOrCallback !== 'function' && !callback) {
			throw new Error('A callback function must be provided')
		}

		const next: ErrorCallback =
			typeof optionsOrCallback === 'function'
				? optionsOrCallback
				: callback

		const options: DeviceCommunicationOptions =
			typeof optionsOrCallback === 'function' ? {} : optionsOrCallback
		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
			password: options.password,
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.DEVICE_COMMUNICATION_CONTROL,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.deviceCommunicationControl.encode(
			buffer,
			timeDuration,
			enableDisable,
			settings.password,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err) => next(err))
	}

	/**
	 * The reinitializeDevice command initiates a restart of the target device.
	 * @function bacstack.reinitializeDevice
	 * @param {string} address - IP address of the target device.
	 * @param {ReinitializedState} state - The type of restart to be initiated.
	 * @param {object=} options
	 * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
	 * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
	 * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
	 * @param {string=} options.password - The optional password used to restart the device.
	 * @param {function} next - The callback containing an error, in case of a failure.
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * client.reinitializeDevice('192.168.1.43', bacnet.enum.ReinitializedState.COLDSTART, (err) => {
	 *   console.log('error: ', err);
	 * });
	 */
	reinitializeDevice(
		address: string,
		state: number,
		callback: ErrorCallback,
	): void
	reinitializeDevice(
		address: string,
		state: number,
		options: ReinitializeDeviceOptions,
		callback: ErrorCallback,
	): void
	reinitializeDevice(
		address: string,
		state: number,
		optionsOrCallback: ReinitializeDeviceOptions | ErrorCallback,
		callback?: ErrorCallback,
	): void {
		if (typeof optionsOrCallback !== 'function' && !callback) {
			throw new Error('A callback function must be provided')
		}

		const next: ErrorCallback =
			typeof optionsOrCallback === 'function'
				? optionsOrCallback
				: callback

		const options: ReinitializeDeviceOptions =
			typeof optionsOrCallback === 'function' ? {} : optionsOrCallback
		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
			password: options.password,
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.REINITIALIZE_DEVICE,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.reinitializeDevice.encode(buffer, state, settings.password)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err) => next(err))
	}

	/**
	 * The writeFile command writes a file buffer to a specific position of a file object.
	 * @function bacstack.writeFile
	 * @param {string} address - IP address of the target device.
	 * @param {object} objectId - The BACNET object ID representing the file object.
	 * @param {number} objectId.type - The BACNET object type representing the file object.
	 * @param {number} objectId.instance - The BACNET object instance representing the file object.
	 * @param {number} position - The position in the file to write at.
	 * @param {Array.<number[]>} fileBuffer - The content to be written to the file.
	 * @param {object=} options
	 * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
	 * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
	 * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
	 * @param {function} next - The callback containing an error, in case of a failure and value object in case of success.
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * client.writeFile('192.168.1.43', {type: 8, instance: 44301}, 0, [[5, 6, 7, 8], [5, 6, 7, 8]], (err, value) => {
	 *   console.log('value: ', value);
	 * });
	 */

	writeFile(
		address: string,
		objectId: BACNetObjectID,
		position: number,
		fileBuffer: number[][],
		callback: DataCallback<any>,
	): void
	writeFile(
		address: string,
		objectId: BACNetObjectID,
		position: number,
		fileBuffer: number[][],
		options: ServiceOptions,
		callback: DataCallback<any>,
	): void
	writeFile(
		address: string,
		objectId: BACNetObjectID,
		position: number,
		fileBuffer: number[][],
		optionsOrCallback: ServiceOptions | DataCallback<any>,
		callback?: DataCallback<any>,
	): void {
		if (typeof optionsOrCallback !== 'function' && !callback) {
			throw new Error('A callback function must be provided')
		}

		const next: DataCallback<any> =
			typeof optionsOrCallback === 'function'
				? optionsOrCallback
				: callback

		const options: ServiceOptions =
			typeof optionsOrCallback === 'function' ? {} : optionsOrCallback

		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.ATOMIC_WRITE_FILE,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.atomicWriteFile.encode(
			buffer,
			false,
			objectId,
			position,
			fileBuffer,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err, data) => {
			if (err) return next(err)
			const result = baServices.atomicWriteFile.decodeAcknowledge(
				data.buffer,
				data.offset,
			)
			if (!result) return next(new Error('INVALID_DECODING'))
			next(null, result)
		})
	}

	/**
	 * The readFile command reads a number of bytes at a specific position of a file object.
	 * @function bacstack.readFile
	 * @param {string} address - IP address of the target device.
	 * @param {object} objectId - The BACNET object ID representing the file object.
	 * @param {number} objectId.type - The BACNET object type representing the file object.
	 * @param {number} objectId.instance - The BACNET object instance representing the file object.
	 * @param {number} position - The position in the file to read at.
	 * @param {number} count - The number of octets to read.
	 * @param {object=} options
	 * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
	 * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
	 * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
	 * @param {function} next - The callback containing an error, in case of a failure and value object in case of success.
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * client.readFile('192.168.1.43', {type: 8, instance: 44301}, 0, 100, (err, value) => {
	 *   console.log('value: ', value);
	 * });
	 */
	readFile(
		address: string,
		objectId: BACNetObjectID,
		position: number,
		count: number,
		callback: DataCallback<any>,
	): void
	readFile(
		address: string,
		objectId: BACNetObjectID,
		position: number,
		count: number,
		options: ServiceOptions,
		callback: DataCallback<any>,
	): void
	readFile(
		address: string,
		objectId: BACNetObjectID,
		position: number,
		count: number,
		optionsOrCallback: ServiceOptions | DataCallback<any>,
		callback?: DataCallback<any>,
	): void {
		if (typeof optionsOrCallback !== 'function' && !callback) {
			throw new Error('A callback function must be provided')
		}

		const next: DataCallback<any> =
			typeof optionsOrCallback === 'function'
				? optionsOrCallback
				: callback

		const options: ServiceOptions =
			typeof optionsOrCallback === 'function' ? {} : optionsOrCallback

		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.ATOMIC_READ_FILE,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.atomicReadFile.encode(
			buffer,
			true,
			objectId,
			position,
			count,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err, data) => {
			if (err) return next(err)
			const result = baServices.atomicReadFile.decodeAcknowledge(
				data.buffer,
				data.offset,
			)
			if (!result) return next(new Error('INVALID_DECODING'))
			next(null, result)
		})
	}

	/**
	 * The readRange command reads a number if list items of an array or list object.
	 * @function bacstack.readRange
	 * @param {string} address - IP address of the target device.
	 * @param {object} objectId - The BACNET object ID to read.
	 * @param {number} objectId.type - The BACNET object type to read.
	 * @param {number} objectId.instance - The BACNET object instance to read.
	 * @param {number} idxBegin - The index of the first/last item to read.
	 * @param {number} quantity - The number of records to read.
	 * @param {object=} options
	 * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
	 * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
	 * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
	 * @param {function} next - The callback containing an error, in case of a failure and value object in case of success.
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * client.readRange('192.168.1.43', {type: 8, instance: 44301}, 0, 200, (err, value) => {
	 *   console.log('value: ', value);
	 * });
	 */
	readRange(
		address: string,
		objectId: BACNetObjectID,
		idxBegin: number,
		quantity: number,
		callback: DataCallback<any>,
	): void
	readRange(
		address: string,
		objectId: BACNetObjectID,
		idxBegin: number,
		quantity: number,
		options: ServiceOptions,
		callback: DataCallback<any>,
	): void
	readRange(
		address: string,
		objectId: BACNetObjectID,
		idxBegin: number,
		quantity: number,
		optionsOrCallback: ServiceOptions | DataCallback<any>,
		callback?: DataCallback<any>,
	): void {
		if (typeof optionsOrCallback !== 'function' && !callback) {
			throw new Error('A callback function must be provided')
		}

		const next: DataCallback<any> =
			typeof optionsOrCallback === 'function'
				? optionsOrCallback
				: callback

		const options: ServiceOptions =
			typeof optionsOrCallback === 'function' ? {} : optionsOrCallback

		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.READ_RANGE,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.readRange.encode(
			buffer,
			objectId,
			baEnum.PropertyIdentifier.LOG_BUFFER,
			baEnum.ASN1_ARRAY_ALL,
			baEnum.ReadRangeType.BY_POSITION,
			idxBegin,
			new Date(),
			quantity,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err, data) => {
			if (err) return next(err)
			const result = baServices.readRange.decodeAcknowledge(
				data.buffer,
				data.offset,
				data.length,
			)
			if (!result) return next(new Error('INVALID_DECODING'))
			next(null, result)
		})
	}

	/**
	 * The subscribeCOV command subscribes to an object for "Change of Value" notifications.
	 * @function bacstack.subscribeCOV
	 * @param {string} address - IP address of the target device.
	 * @param {object} objectId - The BACNET object ID to subscribe for.
	 * @param {number} objectId.type - The BACNET object type to subscribe for.
	 * @param {number} objectId.instance - The BACNET object instance to subscribe for.
	 * @param {number} subscribeId - A unique identifier to map the subscription.
	 * @param {boolean} cancel - Cancel an existing subscription instead of creating a new one.
	 * @param {boolean} issueConfirmedNotifications - Identifies if unconfirmed/confirmed notifications shall be returned.
	 * @param {number} lifetime - Number of seconds for the subscription to stay active, 0 for infinite.
	 * @param {object=} options
	 * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
	 * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
	 * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
	 * @param {function} next - The callback containing an error, in case of a failure.
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * client.subscribeCOV('192.168.1.43', {type: 8, instance: 44301}, 7, false, false, 0, (err) => {
	 *   console.log('error: ', err);
	 * });
	 */
	subscribeCOV(
		address: string,
		objectId: BACNetObjectID,
		subscribeId: number,
		cancel: boolean,
		issueConfirmedNotifications: boolean,
		lifetime: number,
		callback: ErrorCallback,
	): void
	subscribeCOV(
		address: string,
		objectId: BACNetObjectID,
		subscribeId: number,
		cancel: boolean,
		issueConfirmedNotifications: boolean,
		lifetime: number,
		options: ServiceOptions,
		callback: ErrorCallback,
	): void
	subscribeCOV(
		address: string,
		objectId: BACNetObjectID,
		subscribeId: number,
		cancel: boolean,
		issueConfirmedNotifications: boolean,
		lifetime: number,
		optionsOrCallback: ServiceOptions | ErrorCallback,
		callback?: ErrorCallback,
	): void {
		if (typeof optionsOrCallback !== 'function' && !callback) {
			throw new Error('A callback function must be provided')
		}

		const next: ErrorCallback =
			typeof optionsOrCallback === 'function'
				? optionsOrCallback
				: callback

		const options: ServiceOptions =
			typeof optionsOrCallback === 'function' ? {} : optionsOrCallback

		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.SUBSCRIBE_COV,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.subscribeCov.encode(
			buffer,
			subscribeId,
			objectId,
			cancel,
			issueConfirmedNotifications,
			lifetime,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err) => next(err))
	}

	/**
	 * The subscribeProperty command subscribes to a specific property of an object for "Change of Value" notifications.
	 * @function bacstack.subscribeProperty
	 * @param {string} address - IP address of the target device.
	 * @param {object} objectId - The BACNET object ID to subscribe for.
	 * @param {number} objectId.type - The BACNET object type to subscribe for.
	 * @param {number} objectId.instance - The BACNET object instance to subscribe for.
	 * @param {object} monitoredProperty
	 * @param {object} monitoredProperty.id - The property ID to subscribe for.
	 * @param {object} monitoredProperty.index - The property index to subscribe for.
	 * @param {number} subscribeId - A unique identifier to map the subscription.
	 * @param {boolean} cancel - Cancel an existing subscription instead of creating a new one.
	 * @param {boolean} issueConfirmedNotifications - Identifies if unconfirmed/confirmed notifications shall be returned.
	 * @param {object=} options
	 * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
	 * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
	 * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
	 * @param {function} next - The callback containing an error, in case of a failure.
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * client.subscribeProperty('192.168.1.43', {type: 8, instance: 44301}, {id: 80, index: 0}, 8, false, false, (err) => {
	 *   console.log('error: ', err);
	 * });
	 */
	subscribeProperty(
		address: string,
		objectId: BACNetObjectID,
		monitoredProperty: BACNetPropertyID,
		subscribeId: number,
		cancel: boolean,
		issueConfirmedNotifications: boolean,
		callback: ErrorCallback,
	): void
	subscribeProperty(
		address: string,
		objectId: BACNetObjectID,
		monitoredProperty: BACNetPropertyID,
		subscribeId: number,
		cancel: boolean,
		issueConfirmedNotifications: boolean,
		options: ServiceOptions,
		callback: ErrorCallback,
	): void
	subscribeProperty(
		address: string,
		objectId: BACNetObjectID,
		monitoredProperty: BACNetPropertyID,
		subscribeId: number,
		cancel: boolean,
		issueConfirmedNotifications: boolean,
		optionsOrCallback: ServiceOptions | ErrorCallback,
		callback?: ErrorCallback,
	): void {
		if (typeof optionsOrCallback !== 'function' && !callback) {
			throw new Error('A callback function must be provided')
		}

		const next: ErrorCallback =
			typeof optionsOrCallback === 'function'
				? optionsOrCallback
				: callback

		const options: ServiceOptions =
			typeof optionsOrCallback === 'function' ? {} : optionsOrCallback

		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.SUBSCRIBE_COV_PROPERTY,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.subscribeProperty.encode(
			buffer,
			subscribeId,
			objectId,
			cancel,
			issueConfirmedNotifications,
			0,
			monitoredProperty,
			false,
			0x0f,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err) => next(err))
	}

	createObject(
		address: string,
		objectId: BACNetObjectID,
		values: any,
		callback: ErrorCallback,
	): void
	createObject(
		address: string,
		objectId: BACNetObjectID,
		values: any,
		options: ServiceOptions,
		callback: ErrorCallback,
	): void
	createObject(
		address: string,
		objectId: BACNetObjectID,
		values: any,
		optionsOrCallback: ServiceOptions | ErrorCallback,
		callback?: ErrorCallback,
	): void {
		if (typeof optionsOrCallback !== 'function' && !callback) {
			throw new Error('A callback function must be provided')
		}

		const next: ErrorCallback =
			typeof optionsOrCallback === 'function'
				? optionsOrCallback
				: callback

		const options: ServiceOptions =
			typeof optionsOrCallback === 'function' ? {} : optionsOrCallback

		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.CREATE_OBJECT,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.createObject.encode(buffer, objectId, values)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err) => next(err))
	}

	/**
	 * The deleteObject command removes an object instance from a target device.
	 * @function bacstack.deleteObject
	 * @param {string} address - IP address of the target device.
	 * @param {object} objectId - The BACNET object ID to delete.
	 * @param {number} objectId.type - The BACNET object type to delete.
	 * @param {number} objectId.instance - The BACNET object instance to delete.
	 * @param {object=} options
	 * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
	 * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
	 * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
	 * @param {function} next - The callback containing an error, in case of a failure.
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * client.deleteObject('192.168.1.43', {type: 8, instance: 44301}, (err) => {
	 *   console.log('error: ', err);
	 * });
	 */

	deleteObject(
		address: string,
		objectId: BACNetObjectID,
		callback: ErrorCallback,
	): void
	deleteObject(
		address: string,
		objectId: BACNetObjectID,
		options: ServiceOptions,
		callback: ErrorCallback,
	): void
	deleteObject(
		address: string,
		objectId: BACNetObjectID,
		optionsOrCallback: ServiceOptions | ErrorCallback,
		callback?: ErrorCallback,
	): void {
		if (typeof optionsOrCallback !== 'function' && !callback) {
			throw new Error('A callback function must be provided')
		}

		const next: ErrorCallback =
			typeof optionsOrCallback === 'function'
				? optionsOrCallback
				: callback

		const options: ServiceOptions =
			typeof optionsOrCallback === 'function' ? {} : optionsOrCallback

		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.DELETE_OBJECT,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.deleteObject.encode(buffer, objectId)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err) => next(err))
	}

	removeListElement(
		address: string,
		objectId: BACNetObjectID,
		reference: BACNetPropertyID,
		values: any,
		callback: ErrorCallback,
	): void
	removeListElement(
		address: string,
		objectId: BACNetObjectID,
		reference: BACNetPropertyID,
		values: any,
		options: ServiceOptions,
		callback: ErrorCallback,
	): void
	removeListElement(
		address: string,
		objectId: BACNetObjectID,
		reference: BACNetPropertyID,
		values: any,
		optionsOrCallback: ServiceOptions | ErrorCallback,
		callback?: ErrorCallback,
	): void {
		if (typeof optionsOrCallback !== 'function' && !callback) {
			throw new Error('A callback function must be provided')
		}

		const next: ErrorCallback =
			typeof optionsOrCallback === 'function'
				? optionsOrCallback
				: callback

		const options: ServiceOptions =
			typeof optionsOrCallback === 'function' ? {} : optionsOrCallback
		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.REMOVE_LIST_ELEMENT,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.addListElement.encode(
			buffer,
			objectId,
			reference.id,
			reference.index,
			values,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err) => next(err))
	}

	addListElement(
		address: string,
		objectId: BACNetObjectID,
		reference: BACNetPropertyID,
		values: any,
		callback: ErrorCallback,
	): void
	addListElement(
		address: string,
		objectId: BACNetObjectID,
		reference: BACNetPropertyID,
		values: any,
		options: ServiceOptions,
		callback: ErrorCallback,
	): void
	addListElement(
		address: string,
		objectId: BACNetObjectID,
		reference: BACNetPropertyID,
		values: any,
		optionsOrCallback: ServiceOptions | ErrorCallback,
		callback?: ErrorCallback,
	): void {
		if (typeof optionsOrCallback !== 'function' && !callback) {
			throw new Error('A callback function must be provided')
		}

		const next: ErrorCallback =
			typeof optionsOrCallback === 'function'
				? optionsOrCallback
				: callback

		const options: ServiceOptions =
			typeof optionsOrCallback === 'function' ? {} : optionsOrCallback

		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.ADD_LIST_ELEMENT,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.addListElement.encode(
			buffer,
			objectId,
			reference.id,
			reference.index,
			values,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err) => next(err))
	}

	/**
	 * DEPRECATED The getAlarmSummary command returns a list of all active alarms on the target device.
	 * @function bacstack.getAlarmSummary
	 * @param {string} address - IP address of the target device.
	 * @param {object=} options
	 * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
	 * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
	 * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
	 * @param {function} next - The callback containing an error, in case of a failure and value object in case of success.
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * client.getAlarmSummary('192.168.1.43', (err, value) => {
	 *   console.log('value: ', value);
	 * });
	 */
	getAlarmSummary(address: string, callback: DataCallback<any>): void
	getAlarmSummary(
		address: string,
		options: ServiceOptions,
		callback: DataCallback<any>,
	): void
	getAlarmSummary(
		address: string,
		optionsOrCallback: ServiceOptions | DataCallback<any>,
		callback?: DataCallback<any>,
	): void {
		if (typeof optionsOrCallback !== 'function' && !callback) {
			throw new Error('A callback function must be provided')
		}

		const next: DataCallback<any> =
			typeof optionsOrCallback === 'function'
				? optionsOrCallback
				: callback

		const options: ServiceOptions =
			typeof optionsOrCallback === 'function' ? {} : optionsOrCallback

		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.GET_ALARM_SUMMARY,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err, data) => {
			if (err) return next(err)
			const result = baServices.alarmSummary.decode(
				data.buffer,
				data.offset,
				data.length,
			)
			if (!result) return next(new Error('INVALID_DECODING'))
			next(null, result)
		})
	}

	/**
	 * The getEventInformation command returns a list of all active event states on the target device.
	 * @function bacstack.getEventInformation
	 * @param {string} address - IP address of the target device.
	 * @param {object=} objectId - The optional BACNET object ID to continue preceding calls.
	 * @param {number=} objectId.type - The optional BACNET object type to continue preceding calls.
	 * @param {number=} objectId.instance - The optional BACNET object instance to continue preceding calls.
	 * @param {object=} options
	 * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
	 * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
	 * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
	 * @param {function} next - The callback containing an error, in case of a failure and value object in case of success.
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * client.getEventInformation('192.168.1.43', {}, (err, value) => {
	 *   console.log('value: ', value);
	 * });
	 */
	getEventInformation(
		address: string,
		objectId: BACNetObjectID,
		callback: DataCallback<any>,
	): void
	getEventInformation(
		address: string,
		objectId: BACNetObjectID,
		options: ServiceOptions,
		callback: DataCallback<any>,
	): void
	getEventInformation(
		address: string,
		objectId: BACNetObjectID,
		optionsOrCallback: ServiceOptions | DataCallback<any>,
		callback?: DataCallback<any>,
	): void {
		if (typeof optionsOrCallback !== 'function' && !callback) {
			throw new Error('A callback function must be provided')
		}

		const next: DataCallback<any> =
			typeof optionsOrCallback === 'function'
				? optionsOrCallback
				: callback

		const options: ServiceOptions =
			typeof optionsOrCallback === 'function' ? {} : optionsOrCallback

		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.GET_EVENT_INFORMATION,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baAsn1.encodeContextObjectId(
			buffer,
			0,
			objectId.type,
			objectId.instance,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err, data) => {
			if (err) return next(err)
			const result = baServices.eventInformation.decode(
				data.buffer,
				data.offset,
				data.length,
			)
			if (!result) return next(new Error('INVALID_DECODING'))
			next(null, result)
		})
	}

	acknowledgeAlarm(
		address: string,
		objectId: BACNetObjectID,
		eventState: number,
		ackText: string,
		evTimeStamp: any,
		ackTimeStamp: any,
		callback: ErrorCallback,
	): void
	acknowledgeAlarm(
		address: string,
		objectId: BACNetObjectID,
		eventState: number,
		ackText: string,
		evTimeStamp: any,
		ackTimeStamp: any,
		options: ServiceOptions,
		callback: ErrorCallback,
	): void
	acknowledgeAlarm(
		address: string,
		objectId: BACNetObjectID,
		eventState: number,
		ackText: string,
		evTimeStamp: any,
		ackTimeStamp: any,
		optionsOrCallback: ServiceOptions | ErrorCallback,
		callback?: ErrorCallback,
	): void {
		if (typeof optionsOrCallback !== 'function' && !callback) {
			throw new Error('A callback function must be provided')
		}

		const next: ErrorCallback =
			typeof optionsOrCallback === 'function'
				? optionsOrCallback
				: callback

		const options: ServiceOptions =
			typeof optionsOrCallback === 'function' ? {} : optionsOrCallback

		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.ACKNOWLEDGE_ALARM,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.alarmAcknowledge.encode(
			buffer,
			57,
			objectId,
			eventState,
			ackText,
			evTimeStamp,
			ackTimeStamp,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err) => next(err))
	}

	/**
	 * The confirmedPrivateTransfer command invokes a confirmed proprietary/non-standard service.
	 * @function bacstack.confirmedPrivateTransfer
	 * @param {string} address - IP address of the target device.
	 * @param {number} vendorId - The unique vendor identification code.
	 * @param {number} serviceNumber - The unique service identifier.
	 * @param {number[]} [data] - Optional additional payload data.
	 * @param {object=} options
	 * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
	 * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
	 * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
	 * @param {function} next - The callback containing an error, in case of a failure.
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * client.confirmedPrivateTransfer('192.168.1.43', 0, 7, [0x00, 0xaa, 0xfa, 0xb1, 0x00], (err) => {
	 *   console.log('error: ', err);
	 * });
	 */
	confirmedPrivateTransfer(
		address: string,
		vendorId: number,
		serviceNumber: number,
		data: number[],
		callback: ErrorCallback,
	): void
	confirmedPrivateTransfer(
		address: string,
		vendorId: number,
		serviceNumber: number,
		data: number[],
		options: ServiceOptions,
		callback: ErrorCallback,
	): void
	confirmedPrivateTransfer(
		address: string,
		vendorId: number,
		serviceNumber: number,
		data: number[],
		optionsOrCallback: ServiceOptions | ErrorCallback,
		callback?: ErrorCallback,
	): void {
		if (typeof optionsOrCallback !== 'function' && !callback) {
			throw new Error('A callback function must be provided')
		}

		const next: ErrorCallback =
			typeof optionsOrCallback === 'function'
				? optionsOrCallback
				: callback

		const options: ServiceOptions =
			typeof optionsOrCallback === 'function' ? {} : optionsOrCallback

		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.CONFIRMED_PRIVATE_TRANSFER,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.privateTransfer.encode(buffer, vendorId, serviceNumber, data)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err) => next(err))
	}

	/**
	 * The unconfirmedPrivateTransfer command invokes an unconfirmed proprietary/non-standard service.
	 * @function bacstack.unconfirmedPrivateTransfer
	 * @param {string} address - IP address of the target device.
	 * @param {number} vendorId - The unique vendor identification code.
	 * @param {number} serviceNumber - The unique service identifier.
	 * @param {number[]} [data] - Optional additional payload data.
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * client.unconfirmedPrivateTransfer('192.168.1.43', 0, 7, [0x00, 0xaa, 0xfa, 0xb1, 0x00]);
	 */
	unconfirmedPrivateTransfer(
		address: string,
		vendorId: number,
		serviceNumber: number,
		data: number[],
	) {
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			address,
		)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.UNCONFIRMED_REQUEST,
			baEnum.UnconfirmedServiceChoice.UNCONFIRMED_PRIVATE_TRANSFER,
		)
		baServices.privateTransfer.encode(buffer, vendorId, serviceNumber, data)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
	}

	/**
	 * DEPRECATED The getEnrollmentSummary command returns a list of event-initiating objects on the target device.
	 * @function bacstack.getEnrollmentSummary
	 * @param {string} address - IP address of the target device.
	 * @param {number} acknowledgmentFilter - Filter for ALL/ACKED/NOT-ACKED, 0/1/2.
	 * @param {object=} options
	 * @param {object=} options.enrollmentFilter - Filter for enrollment.
	 * @param {EventState=} options.eventStateFilter - Filter for event state.
	 * @param {EventType=} options.eventTypeFilter - Filter for event type.
	 * @param {object=} options.priorityFilter
	 * @param {number} options.priorityFilter.min - Filter for minimal priority
	 * @param {number} options.priorityFilter.max - Filter for maximal priority
	 * @param {number=} options.notificationClassFilter - Filter for notification class.
	 * @param {MaxSegmentsAccepted=} options.maxSegments - The maximimal allowed number of segments.
	 * @param {MaxApduLengthAccepted=} options.maxApdu - The maximal allowed APDU size.
	 * @param {number=} options.invokeId - The invoke ID of the confirmed service telegram.
	 * @param {function} next - The callback containing an error, in case of a failure and value object in case of success.
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * client.getEnrollmentSummary('192.168.1.43', 0, (err, value) => {
	 *   console.log('value: ', value);
	 * });
	 */
	getEnrollmentSummary(
		address: string,
		acknowledgmentFilter: number,
		options: any,
		next: (err?: Error, result?: any) => void,
	) {
		next = next || options
		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.GET_ENROLLMENT_SUMMARY,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.getEnrollmentSummary.encode(
			buffer,
			acknowledgmentFilter,
			options.enrollmentFilter,
			options.eventStateFilter,
			options.eventTypeFilter,
			options.priorityFilter,
			options.notificationClassFilter,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err, data) => {
			if (err) return next(err)
			const result = baServices.getEnrollmentSummary.decodeAcknowledge(
				data.buffer,
				data.offset,
				data.length,
			)
			if (!result) return next(new Error('INVALID_DECODING'))
			next(null, result)
		})
	}

	unconfirmedEventNotification(address: string, eventNotification: any) {
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			address,
		)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.UNCONFIRMED_REQUEST,
			baEnum.UnconfirmedServiceChoice.UNCONFIRMED_EVENT_NOTIFICATION,
		)
		baServices.eventNotifyData.encode(buffer, eventNotification)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
	}

	confirmedEventNotification(
		address: string,
		eventNotification: any,
		options: any,
		next: (err?: Error) => void,
	) {
		next = next || options
		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBits.EXPECTING_REPLY,
			address,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.CONFIRMED_EVENT_NOTIFICATION,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.eventNotifyData.encode(buffer, eventNotification)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, address)
		this._addCallback(settings.invokeId, (err) => next(err))
	}

	// Public Device Functions
	readPropertyResponse(
		receiver: string,
		invokeId: number,
		objectId: BACNetObjectID,
		property: BACNetPropertyID,
		value: any[],
	) {
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			receiver,
		)
		baApdu.encodeComplexAck(
			buffer,
			baEnum.PduTypes.COMPLEX_ACK,
			baEnum.ConfirmedServiceChoice.READ_PROPERTY,
			invokeId,
		)
		baServices.readProperty.encodeAcknowledge(
			buffer,
			objectId,
			property.id,
			property.index,
			value,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, receiver)
	}

	readPropertyMultipleResponse(
		receiver: string,
		invokeId: number,
		values: any[],
	) {
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			receiver,
		)
		baApdu.encodeComplexAck(
			buffer,
			baEnum.PduTypes.COMPLEX_ACK,
			baEnum.ConfirmedServiceChoice.READ_PROPERTY_MULTIPLE,
			invokeId,
		)
		baServices.readPropertyMultiple.encodeAcknowledge(buffer, values)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, receiver)
	}

	iAmResponse(deviceId: number, segmentation: number, vendorId: number) {
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			this._transport.getBroadcastAddress(),
		)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.UNCONFIRMED_REQUEST,
			baEnum.UnconfirmedServiceChoice.I_AM,
		)
		baServices.iAmBroadcast.encode(
			buffer,
			deviceId,
			this._transport.getMaxPayload(),
			segmentation,
			vendorId,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU,
			buffer.offset,
		)
		this._transport.send(
			buffer.buffer,
			buffer.offset,
			this._transport.getBroadcastAddress(),
		)
	}

	iHaveResponse(
		deviceId: BACNetObjectID,
		objectId: BACNetObjectID,
		objectName: string,
	) {
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			this._transport.getBroadcastAddress(),
		)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			baEnum.PduTypes.UNCONFIRMED_REQUEST,
			baEnum.UnconfirmedServiceChoice.I_HAVE,
		)
		baServices.iHaveBroadcast.encode(buffer, deviceId, objectId, objectName)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU,
			buffer.offset,
		)
		this._transport.send(
			buffer.buffer,
			buffer.offset,
			this._transport.getBroadcastAddress(),
		)
	}

	simpleAckResponse(receiver: string, service: number, invokeId: number) {
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			receiver,
		)
		baApdu.encodeSimpleAck(
			buffer,
			baEnum.PduTypes.SIMPLE_ACK,
			service,
			invokeId,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, receiver)
	}

	errorResponse(
		receiver: string,
		service: number,
		invokeId: number,
		errorClass: number,
		errorCode: number,
	) {
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			receiver,
		)
		baApdu.encodeError(buffer, baEnum.PduTypes.ERROR, service, invokeId)
		baServices.error.encode(buffer, errorClass, errorCode)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, receiver)
	}

	/**
	 * Unloads the current BACstack instance and closes the underlying UDP socket.
	 * @function bacstack.close
	 * @example
	 * const bacnet = require('bacstack');
	 * const client = new bacnet();
	 *
	 * client.close();
	 */
	close() {
		this._transport.close()
	}
}
