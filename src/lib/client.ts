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
	DecodeAcknowledgeMultipleResult,
	BACNetReadAccessSpecification,
	DeviceCommunicationOptions,
	ReinitializeDeviceOptions,
	EncodeBuffer,
	BACnetMessage,
	BACnetMessageBase,
	BACnetMessageHeader,
	BACnetError,
	BACNetEventInformation,
	BACNetReadAccess,
	BACNetAlarm,
	BACNetBitString,
	Abort,
	SimpleAck,
	SegmentAck,
	UnconfirmedServiceRequest,
	ConfirmedServiceRequest,
	ServiceMessage,
	SegmentableMessage,
	ConfirmedServiceRequestMessage,
	ComplexAck,
	ComplexAckMessage,
	HasInvokeId,
	ReceiverAddress,
} from './types'

const debug = debugLib('bacnet')
const trace = debugLib('bacnet:client:trace')

const ALL_INTERFACES = '0.0.0.0'
const LOCALHOST_INTERFACES_IPV4 = '127.0.0.1'
const BROADCAST_ADDRESS = '255.255.255.255'
const DEFAULT_HOP_COUNT = 0xff
const BVLC_HEADER_LENGTH = 4
const BVLC_FWD_HEADER_LENGTH = 10 // FORWARDED_NPDU

const beU = baEnum.UnconfirmedServiceChoice
const unconfirmedServiceMap = {
	[beU.I_AM]: 'iAm',
	[beU.WHO_IS]: 'whoIs',
	[beU.WHO_HAS]: 'whoHas',
	[beU.UNCONFIRMED_COV_NOTIFICATION]: 'covNotifyUnconfirmed',
	[beU.TIME_SYNCHRONIZATION]: 'timeSync',
	[beU.UTC_TIME_SYNCHRONIZATION]: 'timeSyncUTC',
	[beU.UNCONFIRMED_EVENT_NOTIFICATION]: 'eventNotify',
	[beU.I_HAVE]: 'iHave',
	[beU.UNCONFIRMED_PRIVATE_TRANSFER]: 'privateTransfer',
}
const beC = baEnum.ConfirmedServiceChoice
const confirmedServiceMap = {
	[beC.READ_PROPERTY]: 'readProperty',
	[beC.WRITE_PROPERTY]: 'writeProperty',
	[beC.READ_PROPERTY_MULTIPLE]: 'readPropertyMultiple',
	[beC.WRITE_PROPERTY_MULTIPLE]: 'writePropertyMultiple',
	[beC.CONFIRMED_COV_NOTIFICATION]: 'covNotify',
	[beC.ATOMIC_WRITE_FILE]: 'atomicWriteFile',
	[beC.ATOMIC_READ_FILE]: 'atomicReadFile',
	[beC.SUBSCRIBE_COV]: 'subscribeCov',
	[beC.SUBSCRIBE_COV_PROPERTY]: 'subscribeProperty',
	[beC.DEVICE_COMMUNICATION_CONTROL]: 'deviceCommunicationControl',
	[beC.REINITIALIZE_DEVICE]: 'reinitializeDevice',
	[beC.CONFIRMED_EVENT_NOTIFICATION]: 'eventNotify',
	[beC.READ_RANGE]: 'readRange',
	[beC.CREATE_OBJECT]: 'createObject',
	[beC.DELETE_OBJECT]: 'deleteObject',
	[beC.ACKNOWLEDGE_ALARM]: 'alarmAcknowledge',
	[beC.GET_ALARM_SUMMARY]: 'getAlarmSummary',
	[beC.GET_ENROLLMENT_SUMMARY]: 'getEnrollmentSummary',
	[beC.GET_EVENT_INFORMATION]: 'getEventInformation',
	[beC.LIFE_SAFETY_OPERATION]: 'lifeSafetyOperation',
	[beC.ADD_LIST_ELEMENT]: 'addListElement',
	[beC.REMOVE_LIST_ELEMENT]: 'removeListElement',
	[beC.CONFIRMED_PRIVATE_TRANSFER]: 'privateTransfer',
}

/**
 * To be able to communicate to BACNET devices, you have to initialize a new bacnet instance.
 * @class bacnet
 * @param {object=} this._settings - The options object used for parameterizing the bacnet.
 * @param {number=} [options.port=47808] - BACNET communication port for listening and sending.
 * @param {string=} options.interface - Specific BACNET communication interface if different from primary one.
 * @param {string=} [options.broadcastAddress=255.255.255.255] - The address used for broadcast messages.
 * @param {number=} [options.apduTimeout=3000] - The timeout in milliseconds until a transaction should be interpreted as error.
 * @example
 * const bacnet = require('node-bacnet');
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
			interface: options.interface || ALL_INTERFACES,
			transport: options.transport,
			broadcastAddress: options.broadcastAddress || BROADCAST_ADDRESS,
			apduTimeout: options.apduTimeout || 3000,
		}

		options.reuseAddr =
			options.reuseAddr === undefined ? true : !!options.reuseAddr

		this._transport =
			this._settings.transport ||
			new Transport({
				port: this._settings.port,
				interface: this._settings.interface,
				broadcastAddress: this._settings.broadcastAddress,
				reuseAddr: options.reuseAddr,
			} as TransportSettings)

		// Setup code
		this._transport.on('message', this._receiveData.bind(this))
		this._transport.on('error', this._receiveError.bind(this))
		this._transport.on('listening', () => this.emit('listening'))
		this._transport.open()
	}

	/**
	 *
	 * @returns {number}
	 * @private
	 */
	private _getInvokeId() {
		const id = this._invokeCounter++
		if (id >= 256) this._invokeCounter = 1
		return id - 1
	}

	/**
	 *
	 * @param id
	 * @param err
	 * @param result
	 * @returns {*}
	 * @private
	 */
	private _invokeCallback(id: number, err: Error | null, result?: any) {
		const callback = this._invokeStore[id]
		if (callback) {
			return void callback(err, result)
		}
		debug('InvokeId', id, 'not found -> drop package')
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

	/**
	 *
	 * @param isForwarded
	 * @returns {{offset: (number), buffer: *}}
	 * @private
	 */
	private _getBuffer(isForwarded?) {
		return Object.assign(
			{},
			{
				buffer: Buffer.alloc(this._transport.getMaxPayload()),
				offset: isForwarded
					? BVLC_FWD_HEADER_LENGTH
					: BVLC_HEADER_LENGTH,
			},
		)
	}

	/**
	 *
	 * @param invokeId
	 * @param buffer
	 * @param offset
	 * @param length
	 * @returns {*}
	 * @private
	 */
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

	/**
	 *
	 * @param invokeId
	 * @param reason
	 * @private
	 */
	private _processAbort(invokeId: number, reason: number) {
		this._invokeCallback(
			invokeId,
			new Error(`BacnetAbort - Reason:${reason}`),
		)
	}

	/**
	 *
	 * @param receiver
	 * @param negative
	 * @param server
	 * @param originalInvokeId
	 * @param sequencenumber
	 * @param actualWindowSize
	 * @private
	 */
	private _segmentAckResponse(
		receiver: string | ReceiverAddress,
		negative: boolean,
		server: boolean,
		originalInvokeId: number,
		sequencenumber: number,
		actualWindowSize: number,
	) {
		const receiverObj =
			typeof receiver === 'string' ? { address: receiver } : receiver
		const buffer = this._getBuffer(receiverObj && receiverObj.forwardedFrom)
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
			baEnum.PduType.SEGMENT_ACK |
				(negative ? baEnum.PduSegAckBit.NEGATIVE_ACK : 0) |
				(server ? baEnum.PduSegAckBit.SERVER : 0),
			originalInvokeId,
			sequencenumber,
			actualWindowSize,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(
			buffer.buffer,
			buffer.offset,
			typeof receiver === 'string' ? receiver : receiver.address,
		)
	}

	/**
	 *
	 * @param msg
	 * @param first
	 * @param moreFollows
	 * @param buffer
	 * @param offset
	 * @param length
	 * @private
	 */
	private _performDefaultSegmentHandling(
		msg: BACnetMessage,
		first: boolean,
		moreFollows: boolean,
		buffer: Buffer,
		offset: number,
		length: number,
	): void {
		if (first) {
			this._segmentStore = []
			msg.type &= ~baEnum.PduConReqBit.SEGMENTED_MESSAGE

			let apduHeaderLen = 3
			if (
				(msg.type & baEnum.PDU_TYPE_MASK) ===
				baEnum.PduType.CONFIRMED_REQUEST
			) {
				apduHeaderLen = 4
			}

			const apdubuffer: EncodeBuffer = this._getBuffer()
			apdubuffer.offset = 0
			buffer.copy(
				apdubuffer.buffer,
				apduHeaderLen,
				offset,
				offset + length,
			)

			if (
				(msg.type & baEnum.PDU_TYPE_MASK) ===
				baEnum.PduType.CONFIRMED_REQUEST
			) {
				const confirmedMsg = msg as ConfirmedServiceRequest &
					BACnetMessageBase
				baApdu.encodeConfirmedServiceRequest(
					apdubuffer,
					msg.type,
					confirmedMsg.service,
					confirmedMsg.maxSegments,
					confirmedMsg.maxApdu,
					confirmedMsg.invokeId,
					0,
					0,
				)
			} else {
				const complexMsg = msg as ComplexAck & BACnetMessageBase
				baApdu.encodeComplexAck(
					apdubuffer,
					msg.type,
					complexMsg.service,
					complexMsg.invokeId,
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
			msg.type &= ~baEnum.PduConReqBit.SEGMENTED_MESSAGE
			this._handlePdu(apduBuffer, 0, apduBuffer.length, msg.header)
		}
	}

	/**
	 *
	 * @param msg
	 * @param server
	 * @param buffer
	 * @param offset
	 * @param length
	 * @private
	 */
	private _processSegment(
		msg: SegmentableMessage &
			(ConfirmedServiceRequestMessage | ComplexAckMessage),
		server: boolean,
		buffer: Buffer,
		offset: number,
		length: number,
	): void {
		let first = false

		if (msg.sequencenumber === 0 && this._lastSequenceNumber === 0) {
			first = true
		} else {
			if (msg.sequencenumber !== this._lastSequenceNumber + 1) {
				return this._segmentAckResponse(
					msg.header.sender.address,
					true,
					server,
					msg.invokeId,
					this._lastSequenceNumber,
					msg.proposedWindowNumber,
				)
			}
		}

		this._lastSequenceNumber = msg.sequencenumber
		const moreFollows = !!(msg.type & baEnum.PduConReqBit.MORE_FOLLOWS)

		if (!moreFollows) {
			this._lastSequenceNumber = 0
		}

		if (
			msg.sequencenumber % msg.proposedWindowNumber === 0 ||
			!moreFollows
		) {
			this._segmentAckResponse(
				msg.header.sender.address,
				false,
				server,
				msg.invokeId,
				msg.sequencenumber,
				msg.proposedWindowNumber,
			)
		}

		this._performDefaultSegmentHandling(
			msg,
			first,
			moreFollows,
			buffer,
			offset,
			length,
		)
	}

	/**
	 *
	 * @param serviceMap
	 * @param content
	 * @param buffer
	 * @param offset
	 * @param length
	 * @returns {*}
	 * @private
	 */
	private _processServiceRequest(
		serviceMap: Record<number, string>,
		content: ServiceMessage,
		buffer: Buffer,
		offset: number,
		length: number,
	): void {
		const sender = content.header?.sender
		if (sender?.address === LOCALHOST_INTERFACES_IPV4) {
			debug(
				'Received and skipped localhost service request:',
				content.service,
			)
			return
		}

		const name = serviceMap[content.service]
		if (!name) {
			debug('Received unsupported service request:', content.service)
			return
		}

		// Use type assertion to access potential invokeId property
		const confirmedMsg = content as Partial<ConfirmedServiceRequest> &
			BACnetMessageBase
		const id = confirmedMsg.invokeId ? '@' + confirmedMsg.invokeId : ''
		trace(`Received service request${id}:`, name)

		// Find a function to decode the packet.
		const serviceHandler = baServices[name]
		if (serviceHandler) {
			try {
				content.payload = serviceHandler.decode(buffer, offset, length)
				trace(
					`Handled service request${id}:`,
					name,
					JSON.stringify(content),
				)
			} catch (e) {
				// Sometimes incomplete or corrupted messages will cause exceptions
				// during decoding, but we don't want these to terminate the program, so
				// we'll just log them and ignore them.
				debug('Exception thrown when processing message:', e)
				debug('Original message was', name + ':', content)
				return
			}
			if (!content.payload) {
				return debug('Received invalid', name, 'message')
			}
		} else {
			debug('No serviceHandler defined for:', name)
			// Call the callback anyway, just with no payload.
		}

		// Call the user code, if they've defined a callback.
		if (this.listenerCount(name)) {
			trace('listener count by name emits ' + name + ' with content')
			this.emit(name, content)
		} else {
			if (this.listenerCount('unhandledEvent')) {
				trace('unhandled event emiting with content')
				this.emit('unhandledEvent', content)
			} else {
				// No 'unhandled event' handler, so respond with an error ourselves.
				// This is better than doing nothing, which can often make the other
				// device think we have gone offline.
				trace(
					'no unhandled event handler with header: ' +
						JSON.stringify(content.header),
				)
				if (content.header?.expectingReply) {
					debug('Replying with error for unhandled service:', name)
					// Make sure we don't reply pretending to be the caller, if we got a
					// forwarded message!  Really this should be overridden to be your
					// own IP, but only if it's not null/undefined to begin with.
					if (content.header.sender) {
						content.header.sender.forwardedFrom = null
					}
					this.errorResponse(
						content.header.sender,
						content.service,
						confirmedMsg.invokeId,
						baEnum.ErrorClass.SERVICES,
						baEnum.ErrorCode.REJECT_UNRECOGNIZED_SERVICE,
					)
				}
			}
		}
	}

	/**
	 * @param buffer
	 * @param offset
	 * @param length
	 * @param header
	 * @private
	 */
	private _handlePdu(
		buffer: Buffer,
		offset: number,
		length: number,
		header: BACnetMessageHeader,
	): void {
		let msg: BACnetMessage
		trace('handlePdu Header: ', header)

		// Handle different PDU types
		switch (header.apduType & baEnum.PDU_TYPE_MASK) {
			case baEnum.PduType.UNCONFIRMED_REQUEST:
				msg = baApdu.decodeUnconfirmedServiceRequest(
					buffer,
					offset,
				) as UnconfirmedServiceRequest & BACnetMessageBase
				msg.header = header
				msg.header.confirmedService = false
				this._processServiceRequest(
					unconfirmedServiceMap,
					msg,
					buffer,
					offset + msg.len,
					length - msg.len,
				)
				break

			case baEnum.PduType.SIMPLE_ACK:
				msg = baApdu.decodeSimpleAck(buffer, offset) as SimpleAck &
					BACnetMessageBase &
					HasInvokeId
				offset += msg.len
				length -= msg.len
				this._invokeCallback((msg as HasInvokeId).invokeId, null, {
					msg: msg,
					buffer: buffer,
					offset: offset + msg.len,
					length: length - msg.len,
				})
				break

			case baEnum.PduType.COMPLEX_ACK:
				msg = baApdu.decodeComplexAck(
					buffer,
					offset,
				) as ComplexAckMessage
				msg.header = header
				if (
					(header.apduType &
						baEnum.PduConReqBit.SEGMENTED_MESSAGE) ===
					0
				) {
					this._invokeCallback((msg as HasInvokeId).invokeId, null, {
						msg: msg,
						buffer: buffer,
						offset: offset + msg.len,
						length: length - msg.len,
					})
				} else {
					this._processSegment(
						msg as SegmentableMessage &
							(
								| ConfirmedServiceRequestMessage
								| ComplexAckMessage
							),
						true,
						buffer,
						offset + msg.len,
						length - msg.len,
					)
				}
				break

			case baEnum.PduType.SEGMENT_ACK:
				msg = baApdu.decodeSegmentAck(buffer, offset) as SegmentAck &
					BACnetMessageBase
				msg.header = header
				this._processSegment(
					msg as unknown as (ConfirmedServiceRequest | ComplexAck) &
						BACnetMessageBase,
					true,
					buffer,
					offset + msg.len,
					length - msg.len,
				)
				break

			case baEnum.PduType.ERROR:
				msg = baApdu.decodeError(buffer, offset) as BACnetError &
					BACnetMessageBase
				this._invokeCallback((msg as HasInvokeId).invokeId, null, {
					msg: msg,
					buffer: buffer,
					offset: offset + msg.len,
					length: length - msg.len,
				})
				break

			case baEnum.PduType.REJECT:
			case baEnum.PduType.ABORT:
				msg = baApdu.decodeAbort(buffer, offset) as Abort &
					BACnetMessageBase
				this._processAbort(msg.invokeId, msg.reason)
				break

			case baEnum.PduType.CONFIRMED_REQUEST:
				msg = baApdu.decodeConfirmedServiceRequest(
					buffer,
					offset,
				) as ConfirmedServiceRequest & BACnetMessageBase
				msg.header = header
				msg.header.confirmedService = true
				if (
					(header.apduType &
						baEnum.PduConReqBit.SEGMENTED_MESSAGE) ===
					0
				) {
					this._processServiceRequest(
						confirmedServiceMap,
						msg,
						buffer,
						offset + msg.len,
						length - msg.len,
					)
				} else {
					this._processSegment(
						msg as SegmentableMessage &
							(
								| ConfirmedServiceRequestMessage
								| ComplexAckMessage
							),
						true,
						buffer,
						offset + msg.len,
						length - msg.len,
					)
				}
				break

			default:
				debug(
					`Received unknown PDU type ${header.apduType} -> Drop packet`,
				)
				break
		}
	}

	/**
	 * @param buffer
	 * @param offset
	 * @param msgLength
	 * @param header
	 * @returns {void}
	 * @private
	 */
	private _handleNpdu(
		buffer: Buffer,
		offset: number,
		msgLength: number,
		header: BACnetMessageHeader,
	): void {
		// Check data length
		if (msgLength <= 0) {
			return trace('No NPDU data -> Drop package')
		}

		// Parse baNpdu header
		const result = baNpdu.decode(buffer, offset)
		if (!result) {
			return trace('Received invalid NPDU header -> Drop package')
		}

		if (result.funct & baEnum.NpduControlBit.NETWORK_LAYER_MESSAGE) {
			return trace('Received network layer message -> Drop package')
		}

		offset += result.len
		msgLength -= result.len

		if (msgLength <= 0) {
			return trace('No APDU data -> Drop package')
		}

		header.apduType = baApdu.getDecodedType(buffer, offset)
		header.expectingReply = !!(
			result.funct & baEnum.NpduControlBit.EXPECTING_REPLY
		)

		this._handlePdu(buffer, offset, msgLength, header)
	}

	/**
	 * @param buffer
	 * @param remoteAddress
	 * @returns {void}
	 * @private
	 */
	private _receiveData(buffer: Buffer, remoteAddress: string): void {
		// Check data length
		if (buffer.length < baEnum.BVLC_HEADER_LENGTH) {
			return trace('Received invalid data -> Drop package')
		}

		// Parse BVLC header
		const result = baBvlc.decode(buffer, 0)
		if (!result) {
			return trace('Received invalid BVLC header -> Drop package')
		}

		const header: BACnetMessageHeader = {
			// Which function the packet came in on, so later code can distinguish
			// between ORIGINAL_BROADCAST_NPDU and DISTRIBUTE_BROADCAST_TO_NETWORK.
			func: result.func,
			sender: {
				// Address of the host we are directly connected to. String, IP:port.
				address: remoteAddress,
				// If the host is a BBMD passing messages along to another node, this
				// is the address of the distant BACnet node. String, IP:port.
				// Typically we won't have network connectivity to this address, but
				// we have to include it in replies so the host we are connect to knows
				// where to forward the messages.
				forwardedFrom: null,
			},
			apduType: 0,
			expectingReply: false,
		}
		// Check BVLC function
		switch (result.func) {
			case baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU:
			case baEnum.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU:
				this._handleNpdu(
					buffer,
					result.len,
					buffer.length - result.len,
					header,
				)
				break

			case baEnum.BvlcResultPurpose.FORWARDED_NPDU:
				// Preserve the IP of the node behind the BBMD so we know where to send
				// replies back to.
				header.sender.forwardedFrom = result.originatingIP
				this._handleNpdu(
					buffer,
					result.len,
					buffer.length - result.len,
					header,
				)
				break

			case baEnum.BvlcResultPurpose.REGISTER_FOREIGN_DEVICE:
				const decodeResult = baServices.registerForeignDevice.decode(
					buffer,
					result.len,
					buffer.length - result.len,
				)
				if (!decodeResult) {
					return trace(
						'Received invalid registerForeignDevice message',
					)
				}
				this.emit('registerForeignDevice', {
					header: header,
					payload: decodeResult,
				})
				break

			case baEnum.BvlcResultPurpose.DISTRIBUTE_BROADCAST_TO_NETWORK:
				this._handleNpdu(
					buffer,
					result.len,
					buffer.length - result.len,
					header,
				)
				break

			default:
				debug(
					'Received unknown BVLC function ' +
						result.func +
						' -> Drop package',
				)
				break
		}
	}

	private _receiveError(err: Error) {
		/**
		 * @event bacnet.error
		 * @param {error} err - The error object thrown by the underlying transport layer.
		 * @example
		 * const bacnet = require('node-bacnet');
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
	 * @param receiver - IP address of the target device or address object
	 * @param options - Options for the who-is request (low/high limit)
	 * @fires bacnet.iAm
	 */
	public whoIs(
		receiver?:
			| {
					address?: string
					forwardedFrom?: string
					lowLimit?: number
					highLimit?: number
			  }
			| string,
		options?: WhoIsOptions,
	): void {
		if (!options) {
			if (
				receiver &&
				typeof receiver === 'object' &&
				receiver.address === undefined &&
				receiver.forwardedFrom === undefined &&
				(receiver.lowLimit !== undefined ||
					receiver.highLimit !== undefined)
			) {
				// receiver seems to be an options object
				options = receiver as WhoIsOptions
				receiver = undefined
			}
		}
		options = options || {}

		const settings = {
			lowLimit: options.lowLimit,
			highLimit: options.highLimit,
		}

		const buffer = this._getBuffer(
			receiver && typeof receiver === 'object'
				? receiver.forwardedFrom
				: undefined,
		)

		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			receiver,
			null,
			DEFAULT_HOP_COUNT,
			baEnum.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK,
			0,
		)

		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			baEnum.PduType.UNCONFIRMED_REQUEST,
			baEnum.UnconfirmedServiceChoice.WHO_IS,
		)

		baServices.whoIs.encode(buffer, settings.lowLimit, settings.highLimit)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * The timeSync command sets the time of a target device.
	 * @param receiver - IP address or sender object of the target device
	 * @param dateTime - The date and time to set on the target device
	 */
	timeSync(
		receiver: string | { address: string; forwardedFrom?: string },
		dateTime: Date,
	): void {
		const buffer: EncodeBuffer = this._getBuffer(
			receiver && typeof receiver !== 'string' && receiver.forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			receiver,
		)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			baEnum.PduType.UNCONFIRMED_REQUEST,
			baEnum.UnconfirmedServiceChoice.TIME_SYNCHRONIZATION,
		)
		baServices.timeSync.encode(buffer, dateTime)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * The timeSyncUTC command sets the UTC time of a target device.
	 * @param receiver - IP address or sender object of the target device
	 * @param dateTime - The date and time to set on the target device
	 */
	timeSyncUTC(
		receiver: string | { address: string; forwardedFrom?: string },
		dateTime: Date,
	): void {
		const buffer: EncodeBuffer = this._getBuffer(
			receiver && typeof receiver !== 'string' && receiver.forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			receiver,
		)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			baEnum.PduType.UNCONFIRMED_REQUEST,
			baEnum.UnconfirmedServiceChoice.UTC_TIME_SYNCHRONIZATION,
		)
		baServices.timeSync.encode(buffer, dateTime)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * The readProperty command reads a single property of an object from a device.
	 * @param receiver - IP address or sender object of the target device
	 * @param objectId - The BACNET object ID to read
	 * @param propertyId - The BACNET property id in the specified object to read
	 * @param options - Options for the read operation
	 * @param next - The callback containing an error, in case of a failure and value object in case of success
	 */
	readProperty(
		receiver: string | { address: string; forwardedFrom?: string },
		objectId: BACNetObjectID,
		propertyId: number,
		options: ReadPropertyOptions | DataCallback<any>,
		next?: DataCallback<any>,
	): void {
		next = next || (options as DataCallback<any>)
		const settings: ReadPropertyOptions = {
			maxSegments:
				(options as ReadPropertyOptions).maxSegments ||
				baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ReadPropertyOptions).maxApdu ||
				baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ReadPropertyOptions).invokeId ||
				this._getInvokeId(),
			arrayIndex:
				(options as ReadPropertyOptions).arrayIndex !== undefined
					? (options as ReadPropertyOptions).arrayIndex
					: baEnum.ASN1_ARRAY_ALL,
		}

		const buffer: EncodeBuffer = this._getBuffer(
			receiver && typeof receiver !== 'string' && receiver.forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
			null,
			DEFAULT_HOP_COUNT,
			baEnum.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK,
			0,
		)

		const type =
			baEnum.PduType.CONFIRMED_REQUEST |
			(settings.maxSegments !== baEnum.MaxSegmentsAccepted.SEGMENTS_0
				? baEnum.PduConReqBit.SEGMENTED_RESPONSE_ACCEPTED
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
		this.sendBvlc(receiver, buffer)

		this._addCallback(settings.invokeId, (err, data) => {
			if (err) {
				return void (next as DataCallback<any>)(err)
			}

			const result = baServices.readProperty.decodeAcknowledge(
				data.buffer,
				data.offset,
				data.length,
			)
			if (!result) {
				return void (next as DataCallback<any>)(
					new Error('INVALID_DECODING'),
				)
			}

			;(next as DataCallback<any>)(null, result)
		})
	}

	/**
	 * The writeProperty command writes a single property of an object to a device.
	 * @param receiver - IP address or sender object of the target device
	 * @param objectId - The BACNET object ID to write
	 * @param propertyId - The BACNET property id in the specified object to write
	 * @param values - A list of values to be written to the specified property
	 * @param options - Options for the write operation
	 * @param next - The callback containing an error, in case of a failure and value object in case of success
	 */
	writeProperty(
		receiver: string | { address: string; forwardedFrom?: string },
		objectId: BACNetObjectID,
		propertyId: number,
		values: BACNetAppData[],
		options: WritePropertyOptions | ErrorCallback,
		next?: ErrorCallback,
	): void {
		next = next || (options as ErrorCallback)
		const settings: WritePropertyOptions = {
			maxSegments:
				(options as WritePropertyOptions).maxSegments ||
				baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as WritePropertyOptions).maxApdu ||
				baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as WritePropertyOptions).invokeId ||
				this._getInvokeId(),
			arrayIndex:
				(options as WritePropertyOptions).arrayIndex ||
				baEnum.ASN1_ARRAY_ALL,
			priority:
				(options as WritePropertyOptions).priority ||
				baEnum.ASN1_NO_PRIORITY,
		}

		const buffer: EncodeBuffer = this._getBuffer(
			receiver && typeof receiver !== 'string' && receiver.forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
			null,
			DEFAULT_HOP_COUNT,
			baEnum.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK,
			0,
		)

		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
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
		this.sendBvlc(receiver, buffer)

		this._addCallback(settings.invokeId, (err, data) => {
			;(next as ErrorCallback)(err)
		})
	}

	/**
	 * The readPropertyMultiple command reads multiple properties in multiple objects from a device.
	 */
	readPropertyMultiple(
		receiver: string | { address: string; forwardedFrom?: string },
		propertiesArray: BACNetReadAccessSpecification[],
		options: ServiceOptions | DataCallback<DecodeAcknowledgeMultipleResult>,
		next?: DataCallback<DecodeAcknowledgeMultipleResult>,
	): void {
		next =
			next || (options as DataCallback<DecodeAcknowledgeMultipleResult>)
		const settings = {
			maxSegments:
				(options as ServiceOptions).maxSegments ||
				baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer(
			receiver && (receiver as { forwardedFrom?: string }).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
			null,
			DEFAULT_HOP_COUNT,
			baEnum.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK,
			0,
		)
		const type =
			baEnum.PduType.CONFIRMED_REQUEST |
			(settings.maxSegments !== baEnum.MaxSegmentsAccepted.SEGMENTS_0
				? baEnum.PduConReqBit.SEGMENTED_RESPONSE_ACCEPTED
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
		this.sendBvlc(receiver, buffer)
		this._addCallback(settings.invokeId, (err, data) => {
			if (err) {
				return void next(err)
			}
			const result = baServices.readPropertyMultiple.decodeAcknowledge(
				data.buffer,
				data.offset,
				data.length,
			)
			if (!result) {
				return void next(new Error('INVALID_DECODING'))
			}
			next(null, result)
		})
	}

	/**
	 * The writePropertyMultiple command writes multiple properties in multiple objects to a device.
	 */
	writePropertyMultiple(
		receiver: string | { address: string; forwardedFrom?: string },
		values: Array<{
			objectId: BACNetObjectID
			values: Array<{
				property: { id: number; index: number }
				value: Array<{ type: number; value: any }>
				priority: number
			}>
		}>,
		options: ServiceOptions | ErrorCallback,
		next?: ErrorCallback,
	): void {
		next = next || (options as ErrorCallback)
		const settings = {
			maxSegments:
				(options as ServiceOptions).maxSegments ||
				baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer(
			receiver && (receiver as { forwardedFrom?: string }).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.WRITE_PROPERTY_MULTIPLE,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
		)
		baServices.writePropertyMultiple.encodeObject(buffer, values)
		this.sendBvlc(receiver, buffer)
		this._addCallback(settings.invokeId, (err, data) => {
			next(err)
		})
	}

	/**
	 * The confirmedCOVNotification command is used to push notifications to other
	 * systems that have registered with us via a subscribeCOV message.
	 */
	confirmedCOVNotification(
		receiver: string | { address: string; forwardedFrom?: string },
		monitoredObject: BACNetObjectID,
		subscribeId: number,
		initiatingDeviceId: number,
		lifetime: number,
		values: Array<{
			property: { id: number }
			value: Array<{ type: number; value: any }>
		}>,
		options: ServiceOptions | ErrorCallback,
		next?: ErrorCallback,
	): void {
		next = next || (options as ErrorCallback)
		const settings = {
			maxSegments:
				(options as ServiceOptions).maxSegments ||
				baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.CONFIRMED_COV_NOTIFICATION,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.covNotify.encode(
			buffer,
			subscribeId,
			initiatingDeviceId,
			monitoredObject,
			lifetime,
			values,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this.sendBvlc(receiver, buffer)
		this._addCallback(settings.invokeId, (err, data) => {
			if (err) {
				return void next(err)
			}
			next()
		})
	}

	/**
	 * The deviceCommunicationControl command enables or disables network communication of the target device.
	 */
	deviceCommunicationControl(
		receiver: string | { address: string; forwardedFrom?: string },
		timeDuration: number,
		enableDisable: number,
		options: DeviceCommunicationOptions | ErrorCallback,
		next?: ErrorCallback,
	): void {
		next = next || (options as ErrorCallback)
		const settings = {
			maxSegments:
				(options as DeviceCommunicationOptions).maxSegments ||
				baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as DeviceCommunicationOptions).maxApdu ||
				baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as DeviceCommunicationOptions).invokeId ||
				this._getInvokeId(),
			password: (options as DeviceCommunicationOptions).password,
		}
		const buffer = this._getBuffer(
			receiver && (receiver as { forwardedFrom?: string }).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
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
		this.sendBvlc(receiver, buffer)
		this._addCallback(settings.invokeId, (err, data) => {
			next(err)
		})
	}

	/**
	 * The reinitializeDevice command initiates a restart of the target device.
	 */
	reinitializeDevice(
		receiver: string | { address: string; forwardedFrom?: string },
		state: number,
		options: ReinitializeDeviceOptions | ErrorCallback,
		next?: ErrorCallback,
	): void {
		next = next || (options as ErrorCallback)
		const settings = {
			maxSegments:
				(options as ReinitializeDeviceOptions).maxSegments ||
				baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ReinitializeDeviceOptions).maxApdu ||
				baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ReinitializeDeviceOptions).invokeId ||
				this._getInvokeId(),
			password: (options as ReinitializeDeviceOptions).password,
		}
		const buffer = this._getBuffer(
			receiver && (receiver as { forwardedFrom?: string }).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.REINITIALIZE_DEVICE,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.reinitializeDevice.encode(buffer, state, settings.password)
		this.sendBvlc(receiver, buffer)
		this._addCallback(settings.invokeId, (err, data) => {
			next(err)
		})
	}

	/**
	 * Writes a file to a remote device.
	 */
	writeFile(
		receiver: string | { address: string; forwardedFrom?: string },
		objectId: BACNetObjectID,
		position: number,
		fileBuffer: Buffer,
		options: ServiceOptions | DataCallback<any>,
		next?: DataCallback<any>,
	): void {
		next = next || (options as DataCallback<any>)
		const settings = {
			maxSegments:
				(options as ServiceOptions).maxSegments ||
				baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer(
			receiver && (receiver as { forwardedFrom?: string }).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.ATOMIC_WRITE_FILE,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		const blocks: number[][] = [Array.from(fileBuffer)]
		baServices.atomicWriteFile.encode(
			buffer,
			false,
			objectId,
			position,
			blocks,
		)
		this.sendBvlc(receiver, buffer)
		this._addCallback(settings.invokeId, (err, data) => {
			if (err) {
				return void next(err)
			}
			const result = baServices.atomicWriteFile.decodeAcknowledge(
				data.buffer,
				data.offset,
			)
			if (!result) {
				return void next(new Error('INVALID_DECODING'))
			}
			next(null, result)
		})
	}

	/**
	 * Reads a file from a remote device.
	 */
	readFile(
		receiver: string | { address: string; forwardedFrom?: string },
		objectId: BACNetObjectID,
		position: number,
		count: number,
		options: ServiceOptions | DataCallback<any>,
		next?: DataCallback<any>,
	): void {
		next = next || (options as DataCallback<any>)
		const settings = {
			maxSegments:
				(options as ServiceOptions).maxSegments ||
				baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer(
			receiver && (receiver as { forwardedFrom?: string }).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
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
		this.sendBvlc(receiver, buffer)
		this._addCallback(settings.invokeId, (err, data) => {
			if (err) {
				return void next(err)
			}
			const result = baServices.atomicReadFile.decodeAcknowledge(
				data.buffer,
				data.offset,
			)
			if (!result) {
				return void next(new Error('INVALID_DECODING'))
			}
			next(null, result)
		})
	}

	/**
	 * Reads a range of data from a remote device.
	 */
	readRange(
		receiver: string | { address: string; forwardedFrom?: string },
		objectId: BACNetObjectID,
		idxBegin: number,
		quantity: number,
		options: ServiceOptions | DataCallback<any>,
		next?: DataCallback<any>,
	): void {
		next = next || (options as DataCallback<any>)
		const settings = {
			maxSegments:
				(options as ServiceOptions).maxSegments ||
				baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer(
			receiver && (receiver as { forwardedFrom?: string }).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
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
		this.sendBvlc(receiver, buffer)
		this._addCallback(settings.invokeId, (err, data) => {
			if (err) {
				return void next(err)
			}
			const result = baServices.readRange.decodeAcknowledge(
				data.buffer,
				data.offset,
				data.length,
			)
			if (!result) {
				return void next(new Error('INVALID_DECODING'))
			}
			next(null, result)
		})
	}

	/**
	 * Subscribes to Change of Value (COV) notifications for an object
	 */
	public subscribeCov(
		receiver: string | { address: string; forwardedFrom?: string },
		objectId: BACNetObjectID,
		subscribeId: number,
		cancel: boolean,
		issueConfirmedNotifications: boolean,
		lifetime: number,
		options: ServiceOptions,
		next?: ErrorCallback,
	): void {
		next = next || (options as unknown as ErrorCallback)
		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer(
			receiver && (receiver as any).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
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
		this.sendBvlc(receiver, buffer)
		this._addCallback(
			settings.invokeId,
			(err: Error | null, data?: any) => {
				if (err) {
					return void next!(err)
				}
				next!()
			},
		)
	}

	/**
	 * Subscribes to Change of Value (COV) notifications for a specific property
	 */
	public subscribeProperty(
		receiver: string | { address: string; forwardedFrom?: string },
		objectId: BACNetObjectID,
		monitoredProperty: BACNetPropertyID,
		subscribeId: number,
		cancel: boolean,
		issueConfirmedNotifications: boolean,
		options: ServiceOptions,
		next?: ErrorCallback,
	): void {
		next = next || (options as unknown as ErrorCallback)
		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer(
			receiver && (receiver as any).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
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
		this.sendBvlc(receiver, buffer)
		this._addCallback(
			settings.invokeId,
			(err: Error | null, data?: any) => {
				if (err) {
					return void next!(err)
				}
				next!()
			},
		)
	}

	/**
	 * Sends an unconfirmed COV notification to a device
	 */
	public unconfirmedCOVNotification(
		receiver: string | { address: string },
		subscriberProcessId: number,
		initiatingDeviceId: number,
		monitoredObjectId: BACNetObjectID,
		timeRemaining: number,
		values: Array<{
			property: {
				id: number
				index?: number
			}
			value: BACNetAppData[]
		}>,
	): void {
		const buffer = this._getBuffer()
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			receiver,
		)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			baEnum.PduType.UNCONFIRMED_REQUEST,
			baEnum.UnconfirmedServiceChoice.UNCONFIRMED_COV_NOTIFICATION,
		)
		baServices.covNotify.encode(
			buffer,
			subscriberProcessId,
			initiatingDeviceId,
			monitoredObjectId,
			timeRemaining,
			values,
		)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
			buffer.offset,
		)
		this._transport.send(
			buffer.buffer,
			buffer.offset,
			(receiver && (receiver as { address?: string }).address) || null,
		)
	}

	/**
	 * Creates a new object in a device
	 */
	public createObject(
		receiver: string | { address: string; forwardedFrom?: string },
		objectId: BACNetObjectID,
		values: Array<{
			property: {
				id: number
				index?: number
			}
			value: BACNetAppData[]
		}>,
		options: ServiceOptions,
		next?: ErrorCallback,
	): void {
		next = next || (options as unknown as ErrorCallback)
		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer(
			receiver && (receiver as any).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.CREATE_OBJECT,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.createObject.encode(buffer, objectId, values)
		this.sendBvlc(receiver, buffer)
		this._addCallback(
			settings.invokeId,
			(err: Error | null, data?: any) => {
				if (err) {
					return void next!(err)
				}
				next!()
			},
		)
	}

	/**
	 * Deletes an object from a device
	 */
	public deleteObject(
		receiver: string | { address: string; forwardedFrom?: string },
		objectId: BACNetObjectID,
		options: ServiceOptions,
		next?: ErrorCallback,
	): void {
		next = next || (options as unknown as ErrorCallback)
		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer(
			receiver && (receiver as any).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.DELETE_OBJECT,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.deleteObject.encode(buffer, objectId)
		this.sendBvlc(receiver, buffer)
		this._addCallback(
			settings.invokeId,
			(err: Error | null, data?: any) => {
				if (err) {
					return void next!(err)
				}
				next!()
			},
		)
	}

	/**
	 * Removes an element from a list property
	 */
	public removeListElement(
		receiver: string | { address: string; forwardedFrom?: string },
		objectId: BACNetObjectID,
		reference: {
			id: number
			index: number
		},
		values: BACNetAppData[],
		options: ServiceOptions,
		next?: ErrorCallback,
	): void {
		next = next || (options as unknown as ErrorCallback)
		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer(
			receiver && (receiver as any).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
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
		this.sendBvlc(receiver, buffer)
		this._addCallback(
			settings.invokeId,
			(err: Error | null, data?: any) => {
				if (err) {
					return void next!(err)
				}
				next!()
			},
		)
	}

	/**
	 * Adds an element to a list property
	 */
	public addListElement(
		receiver: string | { address: string; forwardedFrom?: string },
		objectId: BACNetObjectID,
		reference: {
			id: number
			index: number
		},
		values: BACNetAppData[],
		options: ServiceOptions,
		next?: ErrorCallback,
	): void {
		next = next || (options as unknown as ErrorCallback)
		const settings = {
			maxSegments:
				options.maxSegments || baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				options.maxApdu || baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId: options.invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer(
			receiver && (receiver as any).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
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
		this.sendBvlc(receiver, buffer)
		this._addCallback(
			settings.invokeId,
			(err: Error | null, data?: any) => {
				if (err) {
					return void next!(err)
				}
				next!()
			},
		)
	}

	/**
	 * Gets the alarm summary from a device.
	 * @param receiver - IP address of the target device
	 * @param options - Service options
	 * @param next - Callback function
	 */
	getAlarmSummary(
		receiver: string | { address: string; forwardedFrom?: string },
		options: ServiceOptions | DataCallback<BACNetAlarm[]>,
		next?: DataCallback<BACNetAlarm[]>,
	): void {
		next = next || (options as DataCallback<BACNetAlarm[]>)
		const settings: ServiceOptions = {
			maxSegments:
				(options as ServiceOptions).maxSegments ||
				baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer(
			receiver && (receiver as any).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.GET_ALARM_SUMMARY,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		this.sendBvlc(receiver, buffer)
		this._addCallback(settings.invokeId, (err, data) => {
			if (err) {
				return void next(err)
			}
			const result = baServices.alarmSummary.decode(
				data.buffer,
				data.offset,
				data.length,
			)
			if (!result) {
				return void next(new Error('INVALID_DECODING'))
			}
			next(null, result.alarms)
		})
	}

	/**
	 * Gets event information from a device.
	 * @param receiver - IP address of the target device
	 * @param objectId - Object identifier
	 * @param options - Service options
	 * @param next - Callback function
	 */
	getEventInformation(
		receiver: string | { address: string; forwardedFrom?: string },
		objectId: BACNetObjectID,
		options: ServiceOptions | DataCallback<BACNetEventInformation[]>,
		next?: DataCallback<BACNetEventInformation[]>,
	): void {
		next = next || (options as DataCallback<BACNetEventInformation[]>)
		const settings: ServiceOptions = {
			maxSegments:
				(options as ServiceOptions).maxSegments ||
				baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer(
			receiver && (receiver as any).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
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
		this.sendBvlc(receiver, buffer)
		this._addCallback(settings.invokeId, (err, data) => {
			if (err) {
				return void next(err)
			}
			const result = baServices.eventInformation.decode(
				data.buffer,
				data.offset,
				data.length,
			)
			if (!result) {
				return void next(new Error('INVALID_DECODING'))
			}
			next(null, result.alarms)
		})
	}

	/**
	 * Acknowledges an alarm.
	 * @param receiver - IP address of the target device
	 * @param objectId - Object identifier
	 * @param eventState - Event state to acknowledge
	 * @param ackText - Acknowledgement text
	 * @param evTimeStamp - Event timestamp
	 * @param ackTimeStamp - Acknowledgement timestamp
	 * @param options - Service options
	 * @param next - Callback function
	 */
	acknowledgeAlarm(
		receiver: string | { address: string; forwardedFrom?: string },
		objectId: BACNetObjectID,
		eventState: number,
		ackText: string,
		evTimeStamp: Date,
		ackTimeStamp: Date,
		options: ServiceOptions | ErrorCallback,
		next?: ErrorCallback,
	): void {
		next = next || (options as ErrorCallback)
		const settings: ServiceOptions = {
			maxSegments:
				(options as ServiceOptions).maxSegments ||
				baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer(
			receiver && (receiver as any).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
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
		this.sendBvlc(receiver, buffer)
		this._addCallback(settings.invokeId, (err, data) => {
			if (err) {
				return void next(err)
			}
			next()
		})
	}

	/**
	 * Sends a confirmed private transfer.
	 * @param receiver - IP address of the target device
	 * @param vendorId - Vendor ID
	 * @param serviceNumber - Service number
	 * @param data - Data to transfer
	 * @param options - Service options
	 * @param next - Callback function
	 */
	confirmedPrivateTransfer(
		receiver: string | { address: string; forwardedFrom?: string },
		vendorId: number,
		serviceNumber: number,
		data: any,
		options: ServiceOptions | ErrorCallback,
		next?: ErrorCallback,
	): void {
		next = next || (options as ErrorCallback)
		const settings: ServiceOptions = {
			maxSegments:
				(options as ServiceOptions).maxSegments ||
				baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer(
			receiver && (receiver as any).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.CONFIRMED_PRIVATE_TRANSFER,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.privateTransfer.encode(buffer, vendorId, serviceNumber, data)
		this.sendBvlc(receiver, buffer)
		this._addCallback(settings.invokeId, (err, data) => {
			if (err) {
				return void next(err)
			}
			next()
		})
	}

	/**
	 * Sends an unconfirmed private transfer.
	 * @param receiver - IP address of the target device
	 * @param vendorId - Vendor ID
	 * @param serviceNumber - Service number
	 * @param data - Data to transfer
	 */
	unconfirmedPrivateTransfer(
		receiver: string | { address: string; forwardedFrom?: string },
		vendorId: number,
		serviceNumber: number,
		data: any,
	): void {
		const buffer = this._getBuffer(
			receiver && (receiver as any).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			receiver,
		)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			baEnum.PduType.UNCONFIRMED_REQUEST,
			baEnum.UnconfirmedServiceChoice.UNCONFIRMED_PRIVATE_TRANSFER,
		)
		baServices.privateTransfer.encode(buffer, vendorId, serviceNumber, data)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * Gets enrollment summary from a device.
	 * @param receiver - IP address of the target device
	 * @param acknowledgmentFilter - Acknowledgment filter
	 * @param options - Service options with additional filters
	 * @param next - Callback function
	 */
	getEnrollmentSummary(
		receiver: string | { address: string; forwardedFrom?: string },
		acknowledgmentFilter: number,
		options:
			| (ServiceOptions & {
					enrollmentFilter?: any
					eventStateFilter?: any
					eventTypeFilter?: any
					priorityFilter?: any
					notificationClassFilter?: any
			  })
			| DataCallback<any>,
		next?: DataCallback<any>,
	): void {
		next = next || (options as DataCallback<any>)
		const settings: ServiceOptions = {
			maxSegments:
				(options as ServiceOptions).maxSegments ||
				baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer(
			receiver && (receiver as any).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
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
			(options as any).enrollmentFilter,
			(options as any).eventStateFilter,
			(options as any).eventTypeFilter,
			(options as any).priorityFilter,
			(options as any).notificationClassFilter,
		)
		this.sendBvlc(receiver, buffer)
		this._addCallback(settings.invokeId, (err, data) => {
			if (err) {
				return void next(err)
			}
			const result = baServices.getEnrollmentSummary.decodeAcknowledge(
				data.buffer,
				data.offset,
				data.length,
			)
			if (!result) {
				return void next(new Error('INVALID_DECODING'))
			}
			next(null, result)
		})
	}

	/**
	 * Sends an unconfirmed event notification.
	 * @param receiver - IP address of the target device
	 * @param eventNotification - Event notification data
	 */
	unconfirmedEventNotification(
		receiver: string | { address: string; forwardedFrom?: string },
		eventNotification: any,
	): void {
		const buffer = this._getBuffer(
			receiver && (receiver as any).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			receiver,
		)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			baEnum.PduType.UNCONFIRMED_REQUEST,
			baEnum.UnconfirmedServiceChoice.UNCONFIRMED_EVENT_NOTIFICATION,
		)
		baServices.eventNotifyData.encode(buffer, eventNotification)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * Sends a confirmed event notification.
	 * @param receiver - IP address of the target device
	 * @param eventNotification - Event notification data
	 * @param options - Service options
	 * @param next - Callback function
	 */
	confirmedEventNotification(
		receiver: string | { address: string; forwardedFrom?: string },
		eventNotification: any,
		options: ServiceOptions | ErrorCallback,
		next?: ErrorCallback,
	): void {
		next = next || (options as ErrorCallback)
		const settings: ServiceOptions = {
			maxSegments:
				(options as ServiceOptions).maxSegments ||
				baEnum.MaxSegmentsAccepted.SEGMENTS_65,
			maxApdu:
				(options as ServiceOptions).maxApdu ||
				baEnum.MaxApduLengthAccepted.OCTETS_1476,
			invokeId:
				(options as ServiceOptions).invokeId || this._getInvokeId(),
		}
		const buffer = this._getBuffer(
			receiver && (receiver as any).forwardedFrom,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE |
				baEnum.NpduControlBit.EXPECTING_REPLY,
			receiver,
		)
		baApdu.encodeConfirmedServiceRequest(
			buffer,
			baEnum.PduType.CONFIRMED_REQUEST,
			baEnum.ConfirmedServiceChoice.CONFIRMED_EVENT_NOTIFICATION,
			settings.maxSegments,
			settings.maxApdu,
			settings.invokeId,
			0,
			0,
		)
		baServices.eventNotifyData.encode(buffer, eventNotification)
		this.sendBvlc(receiver, buffer)
		this._addCallback(settings.invokeId, (err, data) => {
			if (err) {
				return void next(err)
			}
			next()
		})
	}

	/**
	 * The readPropertyResponse call sends a response with information about one of our properties.
	 * @param receiver - IP address of the target device or receiver object
	 * @param invokeId - ID of the original readProperty request
	 * @param objectId - objectId from the original request
	 * @param property - property being read, taken from the original request
	 * @param value - property value to be returned
	 * @param options - varying behaviour for special circumstances
	 */
	readPropertyResponse(
		receiver: string | { address: string; forwardedFrom?: string },
		invokeId: number,
		objectId: BACNetObjectID,
		property: BACNetPropertyID,
		value: BACNetAppData[] | BACNetAppData,
		options: { forwardedFrom?: string } = {},
	): void {
		const buffer = this._getBuffer(
			receiver && typeof receiver !== 'string'
				? receiver.forwardedFrom
				: undefined,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			receiver,
		)
		baApdu.encodeComplexAck(
			buffer,
			baEnum.PduType.COMPLEX_ACK,
			baEnum.ConfirmedServiceChoice.READ_PROPERTY,
			invokeId,
		)

		const valueArray = Array.isArray(value) ? value : [value]

		baServices.readProperty.encodeAcknowledge(
			buffer,
			objectId,
			property.id,
			property.index,
			valueArray,
		)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * Sends a response with information about multiple properties.
	 * @param receiver - IP address of the target device or receiver object
	 * @param invokeId - ID of the original readPropertyMultiple request
	 * @param values - Array of property values to return
	 */
	readPropertyMultipleResponse(
		receiver: string | { address: string; forwardedFrom?: string },
		invokeId: number,
		values: BACNetReadAccess[],
	): void {
		const buffer = this._getBuffer(
			receiver && typeof receiver !== 'string'
				? receiver.forwardedFrom
				: undefined,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			receiver,
		)
		baApdu.encodeComplexAck(
			buffer,
			baEnum.PduType.COMPLEX_ACK,
			baEnum.ConfirmedServiceChoice.READ_PROPERTY_MULTIPLE,
			invokeId,
		)
		baServices.readPropertyMultiple.encodeAcknowledge(buffer, values)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * The iAmResponse command is sent as a reply to a whoIs request.
	 * @param receiver - address to send packet to, null for local broadcast
	 * @param deviceId - Our device ID
	 * @param segmentation - an enum.Segmentation value
	 * @param vendorId - The numeric ID assigned to the organisation providing this application
	 */
	iAmResponse(
		receiver: { address?: string; forwardedFrom?: string } | null,
		deviceId: number,
		segmentation: number,
		vendorId: number,
	): void {
		const buffer = this._getBuffer(receiver?.forwardedFrom)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			receiver,
		)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			baEnum.PduType.UNCONFIRMED_REQUEST,
			baEnum.UnconfirmedServiceChoice.I_AM,
		)
		baServices.iAm.encode(
			buffer,
			deviceId,
			this._transport.getMaxPayload(),
			segmentation,
			vendorId,
		)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * Sends an iHave response.
	 * @param receiver - IP address of the target device or receiver object
	 * @param deviceId - Our device ID
	 * @param objectId - The object ID that we have
	 * @param objectName - The name of the object
	 */
	iHaveResponse(
		receiver: { address?: string; forwardedFrom?: string } | null,
		deviceId: BACNetObjectID,
		objectId: BACNetObjectID,
		objectName: string,
	): void {
		const buffer = this._getBuffer(receiver?.forwardedFrom)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			receiver,
		)
		baApdu.encodeUnconfirmedServiceRequest(
			buffer,
			baEnum.PduType.UNCONFIRMED_REQUEST,
			baEnum.UnconfirmedServiceChoice.I_HAVE,
		)
		baServices.iHave.encode(buffer, deviceId, objectId, objectName)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * Sends a simple acknowledgement response.
	 * @param receiver - IP address of the target device or receiver object
	 * @param service - Service being acknowledged
	 * @param invokeId - Original invoke ID
	 */
	simpleAckResponse(
		receiver: { address?: string; forwardedFrom?: string } | string,
		service: number,
		invokeId: number,
	): void {
		const buffer = this._getBuffer(
			receiver && typeof receiver !== 'string'
				? receiver.forwardedFrom
				: undefined,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			receiver,
		)
		baApdu.encodeSimpleAck(
			buffer,
			baEnum.PduType.SIMPLE_ACK,
			service,
			invokeId,
		)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * Sends an error response.
	 * @param receiver - IP address of the target device or receiver object
	 * @param service - Service that had an error
	 * @param invokeId - Original invoke ID
	 * @param errorClass - Error class code
	 * @param errorCode - Specific error code
	 */
	errorResponse(
		receiver: { address?: string; forwardedFrom?: string } | string,
		service: number,
		invokeId: number,
		errorClass: number,
		errorCode: number,
	): void {
		trace(
			`error response on ${JSON.stringify(receiver)} service: ${JSON.stringify(service)} invokeId: ${invokeId} errorClass: ${errorClass} errorCode: ${errorCode}`,
		)
		trace(
			`error message ${baServices.error.buildMessage({ class: errorClass, code: errorCode })}`,
		)
		const buffer = this._getBuffer(
			receiver && typeof receiver !== 'string'
				? receiver.forwardedFrom
				: undefined,
		)
		baNpdu.encode(
			buffer,
			baEnum.NpduControlPriority.NORMAL_MESSAGE,
			receiver,
		)
		baApdu.encodeError(buffer, baEnum.PduType.ERROR, service, invokeId)
		baServices.error.encode(buffer, errorClass, errorCode)
		this.sendBvlc(receiver, buffer)
	}

	/**
	 * Sends a BACnet Virtual Link Control message.
	 * @param receiver - IP address of the target device or receiver object
	 * @param buffer - Buffer containing the message
	 */
	sendBvlc(
		receiver: { address?: string; forwardedFrom?: string } | string | null,
		buffer: EncodeBuffer,
	): void {
		if (typeof receiver === 'string') {
			receiver = {
				address: receiver,
			}
		}

		if (receiver && receiver.forwardedFrom) {
			// Remote node address given, forward to BBMD
			baBvlc.encode(
				buffer.buffer,
				baEnum.BvlcResultPurpose.FORWARDED_NPDU,
				buffer.offset,
				receiver.forwardedFrom,
			)
		} else if (receiver && receiver.address) {
			// Specific address, unicast
			baBvlc.encode(
				buffer.buffer,
				baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU,
				buffer.offset,
			)
		} else {
			// No address, broadcast
			baBvlc.encode(
				buffer.buffer,
				baEnum.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU,
				buffer.offset,
			)
		}

		this._transport.send(
			buffer.buffer,
			buffer.offset,
			(receiver && receiver.address) || null,
		)
	}

	/**
	 * The resultResponse is a BVLC-Result message used to respond to certain events, such as BBMD registration.
	 * This message cannot be wrapped for passing through a BBMD, as it is used as a BBMD control message.
	 * @param receiver - IP address of the target device or receiver object
	 * @param resultCode - Single value from BvlcResultFormat enum
	 */
	resultResponse(receiver: { address: string }, resultCode: number): void {
		const buffer = this._getBuffer()
		baApdu.encodeResult(buffer, resultCode)
		baBvlc.encode(
			buffer.buffer,
			baEnum.BvlcResultPurpose.BVLC_RESULT,
			buffer.offset,
		)
		this._transport.send(buffer.buffer, buffer.offset, receiver.address)
	}

	/**
	 * Unloads the current bacnet instance and closes the underlying UDP socket.
	 */
	close(): void {
		this._transport.close()
	}

	/**
	 * Helper function to take an array of enums and produce a bitstring suitable
	 * for inclusion as a property.
	 * @param items - Array of bit positions to set in the bitstring
	 * @returns BACnet bitstring object
	 */
	static createBitstring(items: number[]): BACNetBitString {
		let offset = 0
		const bytes: number[] = []
		let bitsUsed = 0

		while (items.length) {
			// Find any values between offset and offset+8, for the next byte
			let value = 0
			items = items.filter((i) => {
				if (i >= offset + 8) {
					return true
				} // leave for future iteration
				value |= 1 << (i - offset)
				bitsUsed = Math.max(bitsUsed, i)
				return false // remove from list
			})
			bytes.push(value)
			offset += 8
		}
		bitsUsed++

		return {
			value: bytes,
			bitsUsed,
		}
	}
}
