'use strict';

import * as baAsn1 from '../asn1';
import * as baEnum from '../enum';
import {EncodeBuffer, BACNetObjectID} from '../types';

export const encode = (buffer: EncodeBuffer, isStream: boolean, objectId: BACNetObjectID, position: number, count: number): void => {
  baAsn1.encodeApplicationObjectId(buffer, objectId.type, objectId.instance);
  if (isStream) {
    baAsn1.encodeOpeningTag(buffer, 0);
    baAsn1.encodeApplicationSigned(buffer, position);
    baAsn1.encodeApplicationUnsigned(buffer, count);
    baAsn1.encodeClosingTag(buffer, 0);
  } else {
    baAsn1.encodeOpeningTag(buffer, 1);
    baAsn1.encodeApplicationSigned(buffer, position);
    baAsn1.encodeApplicationUnsigned(buffer, count);
    baAsn1.encodeClosingTag(buffer, 1);
  }
};

export const decode = (buffer: Buffer, offset: number) => {
  let len = 0;
  let result;
  let decodedValue;
  let isStream = true;
  let objectId: BACNetObjectID = {type: 0, instance: 0}; // Properly initialized with type
  let position = -1;
  let count = 0;
  result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
  len += result.len;
  if (result.tagNumber !== baEnum.ApplicationTags.OBJECTIDENTIFIER) return undefined;
  decodedValue = baAsn1.decodeObjectId(buffer, offset + len);
  len += decodedValue.len;
  objectId = {type: decodedValue.objectType, instance: decodedValue.instance};
  if (baAsn1.decodeIsOpeningTagNumber(buffer, offset + len, 0)) {
    isStream = true;
    len++;
    result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== baEnum.ApplicationTags.SIGNED_INTEGER) return undefined;
    decodedValue = baAsn1.decodeSigned(buffer, offset + len, result.value);
    len += decodedValue.len;
    position = decodedValue.value;
    result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== baEnum.ApplicationTags.UNSIGNED_INTEGER) return undefined;
    decodedValue = baAsn1.decodeUnsigned(buffer, offset + len, result.value);
    len += decodedValue.len;
    count = decodedValue.value;
    if (!baAsn1.decodeIsClosingTagNumber(buffer, offset + len, 0)) return undefined;
    len++;
  } else if (baAsn1.decodeIsOpeningTagNumber(buffer, offset + len, 1)) {
    isStream = false;
    len++;
    result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== baEnum.ApplicationTags.SIGNED_INTEGER) return undefined;
    decodedValue = baAsn1.decodeSigned(buffer, offset + len, result.value);
    len += decodedValue.len;
    position = decodedValue.value;
    result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== baEnum.ApplicationTags.UNSIGNED_INTEGER) return undefined;
    decodedValue = baAsn1.decodeUnsigned(buffer, offset + len, result.value);
    len += decodedValue.len;
    count = decodedValue.value;
    if (!baAsn1.decodeIsClosingTagNumber(buffer, offset + len, 1)) return undefined;
    len++;
  } else {
    return undefined;
  }
  return {
    len: len,
    isStream: isStream,
    objectId: objectId,
    position: position,
    count: count
  };
};

export const encodeAcknowledge = (buffer: EncodeBuffer, isStream: boolean, endOfFile: boolean, position: number, blockCount: number, blocks: number[][], counts: number[]): void => {
  baAsn1.encodeApplicationBoolean(buffer, endOfFile);
  if (isStream) {
    baAsn1.encodeOpeningTag(buffer, 0);
    baAsn1.encodeApplicationSigned(buffer, position);
    baAsn1.encodeApplicationOctetString(buffer, blocks[0], 0, counts[0]);
    baAsn1.encodeClosingTag(buffer, 0);
  } else {
    baAsn1.encodeOpeningTag(buffer, 1);
    baAsn1.encodeApplicationSigned(buffer, position);
    baAsn1.encodeApplicationUnsigned(buffer, blockCount);
    for (let i = 0; i < blockCount; i++) {
      baAsn1.encodeApplicationOctetString(buffer, blocks[i], 0, counts[i]);
    }
    baAsn1.encodeClosingTag(buffer, 1);
  }
};

export const decodeAcknowledge = (buffer: Buffer, offset: number) => {
  let len = 0;
  let result: any;
  let decodedValue: any;
  let isStream = false;
  let position = 0;
  let targetBuffer: Buffer;

  result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
  len += result.len;
  if (result.tagNumber !== baEnum.ApplicationTags.BOOLEAN) return undefined;
  const endOfFile = result.value > 0;

  if (baAsn1.decodeIsOpeningTagNumber(buffer, offset + len, 0)) {
    isStream = true;
    len++;
    result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== baEnum.ApplicationTags.SIGNED_INTEGER) return undefined;
    decodedValue = baAsn1.decodeSigned(buffer, offset + len, result.value);
    len += decodedValue.len;
    position = decodedValue.value;
    result = baAsn1.decodeTagNumberAndValue(buffer, offset + len);
    len += result.len;
    if (result.tagNumber !== baEnum.ApplicationTags.OCTET_STRING) return undefined;
    targetBuffer = buffer.slice(offset + len, offset + len + result.value);
    len += result.value;
    if (!baAsn1.decodeIsClosingTagNumber(buffer, offset + len, 0)) return undefined;
    len++;
  } else if (baAsn1.decodeIsOpeningTagNumber(buffer, offset + len, 1)) {
    isStream = false;
    throw new Error('NotImplemented');
  } else {
    return undefined;
  }

  return {
    len: len,
    endOfFile: endOfFile,
    isStream: isStream,
    position: position,
    buffer: targetBuffer
  };
};
