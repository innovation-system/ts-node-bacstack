import * as baEnum from './enum'
import { EncodeBuffer, BACNetAddress, TargetResult } from './types'

const BACNET_PROTOCOL_VERSION = 1
const BacnetAddressTypes = {
	NONE: 0,
	IP: 1,
}

const decodeTarget = (buffer: Buffer, offset: number): TargetResult => {
	let len = 0
	const target: BACNetAddress = {
		type: BacnetAddressTypes.NONE,
		net: (buffer[offset + len++] << 8) | (buffer[offset + len++] << 0),
	}
	const adrLen = buffer[offset + len++]
	if (adrLen > 0) {
		target.adr = []
		for (let i = 0; i < adrLen; i++) {
			target.adr.push(buffer[offset + len++])
		}
	}
	return {
		target,
		len,
	}
}

const encodeTarget = (buffer: EncodeBuffer, target: BACNetAddress): void => {
	buffer.buffer[buffer.offset++] = (target.net & 0xff00) >> 8
	buffer.buffer[buffer.offset++] = (target.net & 0x00ff) >> 0
	if (target.net === 0xffff || !target.adr) {
		buffer.buffer[buffer.offset++] = 0
	} else {
		buffer.buffer[buffer.offset++] = target.adr.length
		if (target.adr.length > 0) {
			for (let i = 0; i < target.adr.length; i++) {
				buffer.buffer[buffer.offset++] = target.adr[i]
			}
		}
	}
}

export const decodeFunction = (
	buffer: Buffer,
	offset: number,
): number | undefined => {
	if (buffer[offset + 0] !== BACNET_PROTOCOL_VERSION) return undefined
	return buffer[offset + 1]
}

export const decode = (
	buffer: Buffer,
	offset: number,
):
	| {
			len: number
			funct: number
			destination?: BACNetAddress
			source?: BACNetAddress
			hopCount: number
			networkMsgType: number
			vendorId: number
	  }
	| undefined => {
	const orgOffset = offset
	offset++
	const funct = buffer[offset++]
	let destination: BACNetAddress | undefined
	if (funct & baEnum.NpduControlBits.DESTINATION_SPECIFIED) {
		const tmpDestination = decodeTarget(buffer, offset)
		offset += tmpDestination.len
		destination = tmpDestination.target
	}
	let source: BACNetAddress | undefined
	if (funct & baEnum.NpduControlBits.SOURCE_SPECIFIED) {
		const tmpSource = decodeTarget(buffer, offset)
		offset += tmpSource.len
		source = tmpSource.target
	}
	let hopCount = 0
	if (funct & baEnum.NpduControlBits.DESTINATION_SPECIFIED) {
		hopCount = buffer[offset++]
	}
	let networkMsgType = baEnum.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK
	let vendorId = 0
	if (funct & baEnum.NpduControlBits.NETWORK_LAYER_MESSAGE) {
		networkMsgType = buffer[offset++]
		if (networkMsgType >= 0x80) {
			vendorId = (buffer[offset++] << 8) | (buffer[offset++] << 0)
		} else if (
			networkMsgType ===
			baEnum.NetworkLayerMessageType.WHO_IS_ROUTER_TO_NETWORK
		) {
			offset += 2
		}
	}
	if (buffer[orgOffset + 0] !== BACNET_PROTOCOL_VERSION) return undefined
	return {
		len: offset - orgOffset,
		funct,
		destination,
		source,
		hopCount,
		networkMsgType,
		vendorId,
	}
}

export const encode = (
	buffer: EncodeBuffer,
	funct: number,
	destination?: BACNetAddress | string,
	source?: BACNetAddress,
	hopCount?: number,
	networkMsgType?: number,
	vendorId?: number,
): void => {
	const isDestinationAddress = destination && typeof destination !== 'string'
	const hasDestination =
		isDestinationAddress && (destination as BACNetAddress).net > 0
	const hasSource = source && source.net > 0 && source.net !== 0xffff

	buffer.buffer[buffer.offset++] = BACNET_PROTOCOL_VERSION
	buffer.buffer[buffer.offset++] =
		funct |
		(hasDestination ? baEnum.NpduControlBits.DESTINATION_SPECIFIED : 0) |
		(hasSource ? baEnum.NpduControlBits.SOURCE_SPECIFIED : 0)

	if (hasDestination) {
		encodeTarget(buffer, destination as BACNetAddress)
	}

	if (hasSource) {
		encodeTarget(buffer, source)
	}

	if (hasDestination) {
		buffer.buffer[buffer.offset++] = hopCount || 0
	}

	if ((funct & baEnum.NpduControlBits.NETWORK_LAYER_MESSAGE) > 0) {
		buffer.buffer[buffer.offset++] = networkMsgType || 0
		if ((networkMsgType || 0) >= 0x80) {
			buffer.buffer[buffer.offset++] = ((vendorId || 0) & 0xff00) >> 8
			buffer.buffer[buffer.offset++] = ((vendorId || 0) & 0x00ff) >> 0
		}
	}
}
