import * as baAsn1 from '../asn1'
import * as baEnum from '../enum'
import {
	EncodeBuffer,
	BACNetObjectID,
	ApplicationData,
	DecodeAcknowledgeSingleResult,
	BACNetPropertyID,
	ReadPropertyRequest,
} from '../types'

export const encode = (
	buffer: EncodeBuffer,
	objectType: number,
	objectInstance: number,
	propertyId: number,
	arrayIndex: number,
) => {
	if (objectType <= baEnum.ASN1_MAX_OBJECT) {
		baAsn1.encodeContextObjectId(buffer, 0, objectType, objectInstance)
	}
	if (propertyId <= baEnum.ASN1_MAX_PROPERTY_ID) {
		baAsn1.encodeContextEnumerated(buffer, 1, propertyId)
	}
	if (arrayIndex !== baEnum.ASN1_ARRAY_ALL) {
		baAsn1.encodeContextUnsigned(
			buffer,
			2,
			arrayIndex || baEnum.ASN1_ARRAY_ALL,
		)
	}
}

export const decode = (
	buffer: Buffer,
	offset: number,
	apduLen: number,
): ReadPropertyRequest | undefined => {
	let len = 0

	if (apduLen < 7) return undefined
	if (!baAsn1.decodeIsContextTag(buffer, offset + len, 0)) return undefined

	len++
	const objectIdResult = baAsn1.decodeObjectId(buffer, offset + len)
	len += objectIdResult.len

	const objectId: BACNetObjectID = {
		type: objectIdResult.objectType,
		instance: objectIdResult.instance,
	}

	const property: BACNetPropertyID = {
		id: 0,
		index: baEnum.ASN1_ARRAY_ALL,
	}

	const result = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
	len += result.len

	if (result.tagNumber !== 1) return undefined

	const enumResult = baAsn1.decodeEnumerated(
		buffer,
		offset + len,
		result.value,
	)
	len += enumResult.len
	property.id = enumResult.value

	if (len < apduLen) {
		const tagResult = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
		len += tagResult.len

		if (tagResult.tagNumber === 2 && len < apduLen) {
			const unsignedResult = baAsn1.decodeUnsigned(
				buffer,
				offset + len,
				tagResult.value,
			)
			len += unsignedResult.len
			property.index = unsignedResult.value
		} else {
			return undefined
		}
	}

	if (len < apduLen) return undefined

	return {
		len,
		objectId,
		property,
	}
}

export const encodeAcknowledge = (
	buffer: EncodeBuffer,
	objectId: BACNetObjectID,
	propertyId: number,
	arrayIndex: number,
	values: any[],
) => {
	baAsn1.encodeContextObjectId(buffer, 0, objectId.type, objectId.instance)
	baAsn1.encodeContextEnumerated(buffer, 1, propertyId)
	if (arrayIndex !== baEnum.ASN1_ARRAY_ALL) {
		baAsn1.encodeContextUnsigned(buffer, 2, arrayIndex)
	}
	baAsn1.encodeOpeningTag(buffer, 3)
	values.forEach((value) => baAsn1.bacappEncodeApplicationData(buffer, value))
	baAsn1.encodeClosingTag(buffer, 3)
}

export const decodeAcknowledge = (
	buffer: Buffer,
	offset: number,
	apduLen: number,
): DecodeAcknowledgeSingleResult | undefined => {
	const objectId: BACNetObjectID = { type: 0, instance: 0 }
	const property: BACNetPropertyID = { id: 0, index: baEnum.ASN1_ARRAY_ALL }

	if (!baAsn1.decodeIsContextTag(buffer, offset, 0)) return undefined
	let len = 1

	const objectIdResult = baAsn1.decodeObjectId(buffer, offset + len)
	len += objectIdResult.len
	objectId.type = objectIdResult.objectType
	objectId.instance = objectIdResult.instance

	const tagResult = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
	len += tagResult.len
	if (tagResult.tagNumber !== 1) return undefined

	const enumResult = baAsn1.decodeEnumerated(
		buffer,
		offset + len,
		tagResult.value,
	)
	len += enumResult.len
	property.id = enumResult.value

	const indexTagResult = baAsn1.decodeTagNumberAndValue(buffer, offset + len)
	if (indexTagResult.tagNumber === 2) {
		len += indexTagResult.len
		const unsignedResult = baAsn1.decodeUnsigned(
			buffer,
			offset + len,
			indexTagResult.value,
		)
		len += unsignedResult.len
		property.index = unsignedResult.value
	} else {
		property.index = baEnum.ASN1_ARRAY_ALL
	}
	const values: ApplicationData[] = []
	if (!baAsn1.decodeIsOpeningTagNumber(buffer, offset + len, 3)) return
	len++
	while (apduLen - len > 1) {
		const result = baAsn1.bacappDecodeApplicationData(
			buffer,
			offset + len,
			apduLen + offset,
			objectId.type,
			property.id,
		)
		if (!result) return undefined
		len += result.len
		delete result.len
		values.push(result)
	}
	if (!baAsn1.decodeIsClosingTagNumber(buffer, offset + len, 3)) return
	len++
	return {
		len,
		objectId,
		property,
		values,
	}
}
