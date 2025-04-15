import * as baAsn1 from '../asn1'
import * as baEnum from '../enum'
import { BACNetObjectID, EncodeBuffer } from '../types'

export const encode = (
	buffer: EncodeBuffer,
	isStream: boolean,
	objectId: BACNetObjectID,
	position: number,
	blocks: number[][],
): void => {
	baAsn1.encodeApplicationObjectId(buffer, objectId.type, objectId.instance)
	if (isStream) {
		baAsn1.encodeOpeningTag(buffer, 0)
		baAsn1.encodeApplicationSigned(buffer, position)
		baAsn1.encodeApplicationOctetString(
			buffer,
			blocks[0],
			0,
			blocks[0].length,
		)
		baAsn1.encodeClosingTag(buffer, 0)
	} else {
		baAsn1.encodeOpeningTag(buffer, 1)
		baAsn1.encodeApplicationSigned(buffer, position)
		baAsn1.encodeApplicationUnsigned(buffer, blocks.length)
		for (let i = 0; i < blocks.length; i++) {
			baAsn1.encodeApplicationOctetString(
				buffer,
				blocks[i],
				0,
				blocks[i].length,
			)
		}
		baAsn1.encodeClosingTag(buffer, 1)
	}
}

export const decode = (buffer: Buffer, offset: number, apduLen: number) => {
	let len = 0
	let result: any
	let decodedValue: any
	let isStream = false
	let position = 0
	const blocks = []
	let blockCount = 0

	result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
	len += result.len
	if (result.tagNumber !== baEnum.ApplicationTag.OBJECTIDENTIFIER)
		return undefined

	decodedValue = baAsn1.decodeObjectId(buffer, offset + len)
	len += decodedValue.len
	const objectId: BACNetObjectID = {
		type: decodedValue.objectType,
		instance: decodedValue.instance,
	}

	if (baAsn1.decodeIsOpeningTagNumber(buffer, offset + len, 0)) {
		isStream = true
		len++

		result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
		len += result.len
		if (result.tagNumber !== baEnum.ApplicationTag.SIGNED_INTEGER)
			return undefined

		decodedValue = baAsn1.decodeSigned(buffer, offset + len, result.value)
		len += decodedValue.len
		position = decodedValue.value

		result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
		len += result.len
		if (result.tagNumber !== baEnum.ApplicationTag.OCTET_STRING)
			return undefined

		decodedValue = baAsn1.decodeOctetString(
			buffer,
			offset + len,
			apduLen,
			0,
			result.value,
		)
		len += decodedValue.len
		blocks.push(decodedValue.value)

		if (!baAsn1.decodeIsClosingTagNumber(buffer, offset + len, 0))
			return undefined
		len++
	} else if (baAsn1.decodeIsOpeningTagNumber(buffer, offset + len, 1)) {
		isStream = false
		len++

		result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
		len += result.len
		if (result.tagNumber !== baEnum.ApplicationTag.SIGNED_INTEGER)
			return undefined

		decodedValue = baAsn1.decodeSigned(buffer, offset + len, result.value)
		len += decodedValue.len
		position = decodedValue.value

		result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
		len += result.len
		if (result.tagNumber !== baEnum.ApplicationTag.UNSIGNED_INTEGER)
			return undefined

		decodedValue = baAsn1.decodeUnsigned(buffer, offset + len, result.value)
		len += decodedValue.len
		blockCount = decodedValue.value

		for (let i = 0; i < blockCount; i++) {
			result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
			len += result.len
			if (result.tagNumber !== baEnum.ApplicationTag.OCTET_STRING)
				return undefined

			decodedValue = baAsn1.decodeOctetString(
				buffer,
				offset + len,
				apduLen,
				0,
				result.value,
			)
			len += decodedValue.len
			blocks.push(decodedValue.value)
		}

		if (!baAsn1.decodeIsClosingTagNumber(buffer, offset + len, 1))
			return undefined
		len++
	} else {
		return undefined
	}

	return {
		len,
		isStream,
		objectId,
		position,
		blocks,
	}
}

export const encodeAcknowledge = (
	buffer: EncodeBuffer,
	isStream: boolean,
	position: number,
): void => {
	if (isStream) {
		baAsn1.encodeContextSigned(buffer, 0, position)
	} else {
		baAsn1.encodeContextSigned(buffer, 1, position)
	}
}

export const decodeAcknowledge = (buffer: Buffer, offset: number) => {
	let len = 0
	let isStream = false
	let position = 0

	const result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
	len += result.len

	if (result.tagNumber === 0) {
		isStream = true
	} else if (result.tagNumber === 1) {
		isStream = false
	} else {
		return undefined
	}

	const decodedValue = baAsn1.decodeSigned(buffer, offset + len, result.value)
	len += decodedValue.len
	position = decodedValue.value

	return {
		len,
		isStream,
		position,
	}
}
