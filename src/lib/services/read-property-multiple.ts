import * as baAsn1 from '../asn1'
import {
	BACNetReadAccessSpecification,
	DecodeAcknowledgeMultipleResult,
	EncodeBuffer,
	ReadAccessDecode,
} from '../types'

export const encode = (
	buffer: EncodeBuffer,
	properties: BACNetReadAccessSpecification[],
) => {
	properties.forEach((value) =>
		baAsn1.encodeReadAccessSpecification(buffer, value),
	)
}

export const decode = (buffer: Buffer, offset: number, apduLen: number) => {
	let len = 0
	const values = []
	while (apduLen - len > 0) {
		const decodedValue = baAsn1.decodeReadAccessSpecification(
			buffer,
			offset + len,
			apduLen - len,
		)
		if (!decodedValue) return
		len += decodedValue.len
		values.push(decodedValue.value)
	}
	return {
		len,
		properties: values,
	}
}

export const encodeAcknowledge = (buffer: EncodeBuffer, values: any[]) => {
	values.forEach((value) => baAsn1.encodeReadAccessResult(buffer, value))
}

export const decodeAcknowledge = (
	buffer: Buffer,
	offset: number,
	apduLen: number,
): DecodeAcknowledgeMultipleResult => {
	let len = 0
	const values: ReadAccessDecode['value'][] = []
	while (apduLen - len > 0) {
		const result = baAsn1.decodeReadAccessResult(
			buffer,
			offset + len,
			apduLen - len,
		)
		if (!result) return
		len += result.len
		values.push(result.value)
	}
	return {
		len,
		values,
	}
}
