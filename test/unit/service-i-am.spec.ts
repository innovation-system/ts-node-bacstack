'use strict'

import { describe, expect, it } from '@jest/globals'

import * as utils from './utils'
import * as baServices from '../../src/lib/services'

describe('bacnet - Services layer Iam unit', () => {
	it('should successfully encode and decode', () => {
		const buffer = utils.getBuffer()
		baServices.iAm.encode(buffer, 47, 1, 1, 7)
		const result = baServices.iAm.decode(buffer.buffer, 0)
		delete result.len
		expect(result).toEqual({
			deviceId: 47,
			maxApdu: 1,
			segmentation: 1,
			vendorId: 7,
		})
	})
})
