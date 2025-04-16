import * as baAsn1 from '../asn1'
import * as baEnum from '../enum'
import { EncodeBuffer } from '../types'

export const encode = (
	buffer: EncodeBuffer,
	errorClass: number,
	errorCode: number,
): void => {
	baAsn1.encodeApplicationEnumerated(buffer, errorClass)
	baAsn1.encodeApplicationEnumerated(buffer, errorCode)
}

export const decode = (buffer: Buffer, offset: number) => {
	const orgOffset = offset
	let result: any

	result = baAsn1.decodeTagNumberAndValue(buffer, offset)
	offset += result.len
	const errorClass = baAsn1.decodeEnumerated(buffer, offset, result.value)
	offset += errorClass.len

	result = baAsn1.decodeTagNumberAndValue(buffer, offset)
	offset += result.len
	const errorCode = baAsn1.decodeEnumerated(buffer, offset, result.value)
	offset += errorClass.len

	return {
		len: offset - orgOffset,
		class: errorClass.value,
		code: errorCode.value,
	}
}

export const buildMessage = (result: {
	class: number
	code: number
}): string => {
	return (
		'BacnetError Class: ' +
		baEnum.ErrorClassName[result.class] +
		' ' +
		'(' +
		result.class +
		') ' +
		'Code: ' +
		baEnum.ErrorCodeName[result.code] +
		' (' +
		result.code +
		')'
	)
}
