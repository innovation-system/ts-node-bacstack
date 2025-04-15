'use strict';

import * as baAsn1 from './asn1';
import * as baEnum from './enum';
import {
	EncodeBuffer,
	ConfirmedServiceRequest,
	UnconfirmedServiceRequest,
	SimpleAck,
	ComplexAck,
	SegmentAck,
	BACnetError,
	Abort,
} from './types'

export const getDecodedType = (buffer: Buffer, offset: number): number => {
	return buffer[offset]
}

export const setDecodedType = (
	buffer: Buffer,
	offset: number,
	type: number,
): void => {
	buffer[offset] = type
}

export const getDecodedInvokeId = (buffer: Buffer, offset: number): number | undefined => {
  const type = getDecodedType(buffer, offset);
  switch (type & baEnum.PDU_TYPE_MASK) {
    case baEnum.PduType.SIMPLE_ACK:
    case baEnum.PduType.COMPLEX_ACK:
    case baEnum.PduType.ERROR:
    case baEnum.PduType.REJECT:
    case baEnum.PduType.ABORT:
      return buffer[offset + 1];
    case baEnum.PduType.CONFIRMED_REQUEST:
      return buffer[offset + 2];
    default:
      return undefined;
  }
};

export const encodeConfirmedServiceRequest = (buffer: EncodeBuffer, type: number, service: number, maxSegments: number, maxApdu: number, invokeId: number, sequencenumber?: number, proposedWindowSize?: number): void => {
  buffer.buffer[buffer.offset++] = type;
  buffer.buffer[buffer.offset++] = maxSegments | maxApdu;
  buffer.buffer[buffer.offset++] = invokeId;
  if ((type & baEnum.PduConReqBit.SEGMENTED_MESSAGE) > 0) {
    if (sequencenumber === undefined) {
      throw new Error('sequencenumber is undefined');
    }
    buffer.buffer[buffer.offset++] = sequencenumber;
    if (proposedWindowSize === undefined) {
      throw new Error('proposedWindowSize is undefined');
    }
    buffer.buffer[buffer.offset++] = proposedWindowSize;
  }
  buffer.buffer[buffer.offset++] = service;
};

export const decodeConfirmedServiceRequest = (buffer: Buffer, offset: number): ConfirmedServiceRequest => {
  const orgOffset = offset;
  const type = buffer[offset++];
  const maxSegments = buffer[offset] & 0xF0;
  const maxApdu = buffer[offset++] & 0x0F;
  const invokeId = buffer[offset++];
  let sequencenumber = 0;
  let proposedWindowNumber = 0;
  if ((type & baEnum.PduConReqBit.SEGMENTED_MESSAGE) > 0) {
    sequencenumber = buffer[offset++];
    proposedWindowNumber = buffer[offset++];
  }
  const service = buffer[offset++];
  return {
    len: offset - orgOffset,
    type: type,
    service: service,
    maxSegments: maxSegments,
    maxApdu: maxApdu,
    invokeId: invokeId,
    sequencenumber: sequencenumber,
    proposedWindowNumber: proposedWindowNumber
  };
};

export const encodeUnconfirmedServiceRequest = (
	buffer: EncodeBuffer,
	type: number,
	service: number,
): void => {
	buffer.buffer[buffer.offset++] = type
	buffer.buffer[buffer.offset++] = service
}

export const decodeUnconfirmedServiceRequest = (
	buffer: Buffer,
	offset: number,
): UnconfirmedServiceRequest => {
	const orgOffset = offset
	const type = buffer[offset++]
	const service = buffer[offset++]
	return {
		len: offset - orgOffset,
		type,
		service,
	}
}

export const encodeSimpleAck = (
	buffer: EncodeBuffer,
	type: number,
	service: number,
	invokeId: number,
): void => {
	buffer.buffer[buffer.offset++] = type
	buffer.buffer[buffer.offset++] = invokeId
	buffer.buffer[buffer.offset++] = service
}

export const decodeSimpleAck = (buffer: Buffer, offset: number): SimpleAck => {
	const orgOffset = offset
	const type = buffer[offset++]
	const invokeId = buffer[offset++]
	const service = buffer[offset++]
	return {
		len: offset - orgOffset,
		type,
		service,
		invokeId,
	}
}

export const encodeComplexAck = (buffer: EncodeBuffer, type: number, service: number, invokeId: number, sequencenumber?: number, proposedWindowNumber?: number): number => {
  let len = 3;
  buffer.buffer[buffer.offset++] = type;
  buffer.buffer[buffer.offset++] = invokeId;
  if ((type & baEnum.PduConReqBit.SEGMENTED_MESSAGE) > 0) {
    if (sequencenumber === undefined) {
      throw new Error('sequencenumber is undefined');
    }
    buffer.buffer[buffer.offset++] = sequencenumber;
    if (proposedWindowNumber === undefined) {
      throw new Error('proposedWindowNumber is undefined');
    }
    buffer.buffer[buffer.offset++] = proposedWindowNumber;
    len += 2;
  }
  buffer.buffer[buffer.offset++] = service;
  return len;
};

export const decodeComplexAck = (buffer: Buffer, offset: number): ComplexAck => {
  const orgOffset = offset;
  const type = buffer[offset++];
  const invokeId = buffer[offset++];
  let sequencenumber = 0;
  let proposedWindowNumber = 0;
  if ((type & baEnum.PduConReqBit.SEGMENTED_MESSAGE) > 0) {
    sequencenumber = buffer[offset++];
    proposedWindowNumber = buffer[offset++];
  }
  const service = buffer[offset++];
  return {
    len: offset - orgOffset,
    type: type,
    service: service,
    invokeId: invokeId,
    sequencenumber: sequencenumber,
    proposedWindowNumber: proposedWindowNumber
  };
};

export const encodeSegmentAck = (
	buffer: EncodeBuffer,
	type: number,
	originalInvokeId: number,
	sequencenumber: number,
	actualWindowSize: number,
): void => {
	buffer.buffer[buffer.offset++] = type
	buffer.buffer[buffer.offset++] = originalInvokeId
	buffer.buffer[buffer.offset++] = sequencenumber
	buffer.buffer[buffer.offset++] = actualWindowSize
}

export const decodeSegmentAck = (buffer: Buffer, offset: number): SegmentAck => {
  const orgOffset = offset;
  const type = buffer[offset++];
  const originalInvokeId = buffer[offset++];
  const sequencenumber = buffer[offset++];
  const actualWindowSize = buffer[offset++];
  return {
    len: offset - orgOffset,
    type: type,
    originalInvokeId: originalInvokeId,
    sequencenumber: sequencenumber,
    actualWindowSize: actualWindowSize
  };
};

export const encodeResult = (buffer: EncodeBuffer, resultCode: number): void => {
  baAsn1.encodeUnsigned(buffer, resultCode, 2);
};

export const decodeResult = (buffer: Buffer, offset: number): { len: number; resultCode: number } => {
  const orgOffset = offset;
  const decode = baAsn1.decodeUnsigned(buffer, offset, 2);
  offset += decode.len;
  return {
    len: offset - orgOffset,
    resultCode: decode.value
  };
};

export const encodeError = (
	buffer: EncodeBuffer,
	type: number,
	service: number,
	invokeId: number,
): void => {
	buffer.buffer[buffer.offset++] = type
	buffer.buffer[buffer.offset++] = invokeId
	buffer.buffer[buffer.offset++] = service
}

export const decodeError = (buffer: Buffer, offset: number): BACnetError => {
	const orgOffset = offset
	const type = buffer[offset++]
	const invokeId = buffer[offset++]
	const service = buffer[offset++]
	return {
		len: offset - orgOffset,
		type,
		service,
		invokeId,
	}
}

export const encodeAbort = (
	buffer: EncodeBuffer,
	type: number,
	invokeId: number,
	reason: number,
): void => {
	buffer.buffer[buffer.offset++] = type
	buffer.buffer[buffer.offset++] = invokeId
	buffer.buffer[buffer.offset++] = reason
}

export const decodeAbort = (buffer: Buffer, offset: number): Abort => {
	const orgOffset = offset
	const type = buffer[offset++]
	const invokeId = buffer[offset++]
	const reason = buffer[offset++]
	return {
		len: offset - orgOffset,
		type,
		invokeId,
		reason,
	}
}
