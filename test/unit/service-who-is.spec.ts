'use strict'

import { describe, expect, it } from '@jest/globals'

import * as utils from './utils'
import * as baServices from '../../src/lib/services'

describe('bacnet - Services layer WhoIs unit', () => {
	it('should successfully encode and decode', () => {
		const buffer = utils.getBuffer()
		baServices.whoIs.encode(buffer, 1, 3000)
		const result = baServices.whoIs.decode(buffer.buffer, 0, buffer.offset)
		delete result.len
		expect(result).toEqual({
			lowLimit: 1,
			highLimit: 3000,
		})
	})
})
