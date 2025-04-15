import * as baEnum from './enum'
import { BvlcPacket } from './types'

const DEFAULT_BACNET_PORT = 47808

export const encode = (
	buffer: Buffer,
	func: number,
	msgLength: number,
	originatingIP?: string,
): number => {
	buffer[0] = baEnum.BVLL_TYPE_BACNET_IP
	buffer[1] = func
	buffer[2] = (msgLength & 0xff00) >> 8
	buffer[3] = (msgLength & 0x00ff) >> 0
	if (originatingIP) {
		// This is always a FORWARDED_NPDU regardless of the 'func' parameter.
		if (func !== baEnum.BvlcResultPurpose.FORWARDED_NPDU) {
			throw new Error(
				'Cannot specify originatingIP unless ' +
					'BvlcResultPurpose.FORWARDED_NPDU is used.',
			)
		}
		// Encode the IP address and optional port into bytes.
		const [ipstr, portstr] = originatingIP.split(':')
		const port = parseInt(portstr, 10) || DEFAULT_BACNET_PORT
		const ip = ipstr.split('.')
		buffer[4] = parseInt(ip[0], 10)
		buffer[5] = parseInt(ip[1], 10)
		buffer[6] = parseInt(ip[2], 10)
		buffer[7] = parseInt(ip[3], 10)
		buffer[8] = (port & 0xff00) >> 8
		buffer[9] = (port & 0x00ff) >> 0
		return 6 + baEnum.BVLC_HEADER_LENGTH
	} else {
		if (func === baEnum.BvlcResultPurpose.FORWARDED_NPDU) {
			throw new Error(
				'Must specify originatingIP if ' +
					'BvlcResultPurpose.FORWARDED_NPDU is used.',
			)
		}
	}
	return baEnum.BVLC_HEADER_LENGTH
}

export const decode = (
	buffer: Buffer,
	_offset: number,
): BvlcPacket | undefined => {
	let len: number
	const func = buffer[1]
	const msgLength = (buffer[2] << 8) | (buffer[3] << 0)
	if (buffer[0] !== baEnum.BVLL_TYPE_BACNET_IP || buffer.length !== msgLength)
		return undefined
	let originatingIP = null
	switch (func) {
		case baEnum.BvlcResultPurpose.BVLC_RESULT:
		case baEnum.BvlcResultPurpose.ORIGINAL_UNICAST_NPDU:
		case baEnum.BvlcResultPurpose.ORIGINAL_BROADCAST_NPDU:
		case baEnum.BvlcResultPurpose.DISTRIBUTE_BROADCAST_TO_NETWORK:
		case baEnum.BvlcResultPurpose.REGISTER_FOREIGN_DEVICE:
		case baEnum.BvlcResultPurpose.READ_FOREIGN_DEVICE_TABLE:
		case baEnum.BvlcResultPurpose.DELETE_FOREIGN_DEVICE_TABLE_ENTRY:
		case baEnum.BvlcResultPurpose.READ_BROADCAST_DISTRIBUTION_TABLE:
		case baEnum.BvlcResultPurpose.WRITE_BROADCAST_DISTRIBUTION_TABLE:
		case baEnum.BvlcResultPurpose.READ_BROADCAST_DISTRIBUTION_TABLE_ACK:
		case baEnum.BvlcResultPurpose.READ_FOREIGN_DEVICE_TABLE_ACK:
			len = 4
			break
		case baEnum.BvlcResultPurpose.FORWARDED_NPDU:
			// Work out where the packet originally came from before the BBMD
			// forwarded it to us, so we can tell the BBMD where to send any reply to.
			const port = (buffer[8] << 8) | buffer[9]
			originatingIP = buffer.slice(4, 8).join('.')

			// Only add the port if it's not the usual one.
			if (port !== DEFAULT_BACNET_PORT) {
				originatingIP += ':' + port
			}

			len = 10
			break
		case baEnum.BvlcResultPurpose.SECURE_BVLL:
			return undefined
		default:
			return undefined
	}
	return {
		len,
		func,
		msgLength,
		originatingIP,
	}
}
