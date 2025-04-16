'use strict'

import { describe, expect, it } from '@jest/globals'

import * as utils from './utils'
import * as baServices from '../../src/lib/services'

describe('bacnet - Services layer iHave unit', () => {
	it('should successfully encode and decode', () => {
		const buffer = utils.getBuffer()
		baServices.iHave.encode(
			buffer,
			{ type: 8, instance: 443 },
			{ type: 0, instance: 4 },
			'LgtCmd01',
		)
		const result = baServices.iHave.decode(
			buffer.buffer,
			0,
			buffer.offset,
		)
		delete result.len
		expect(result).toEqual({
			deviceId: { type: 8, instance: 443 },
			objectId: { type: 0, instance: 4 },
			objectName: 'LgtCmd01',
		})
	})
})
