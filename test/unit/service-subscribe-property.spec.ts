'use strict'

import { describe, expect, it } from '@jest/globals'

import * as utils from './utils'
import * as baServices from '../../src/lib/services'

describe('bacnet - Services layer SubscribeProperty unit', () => {
	it('should successfully encode and decode with cancellation request', () => {
		const buffer = utils.getBuffer()
		baServices.subscribeProperty.encode(
			buffer,
			7,
			{ type: 148, instance: 362 },
			true,
			false,
			1,
			{ id: 85, index: 0xffffffff },
			true,
			1,
		)
		const result = baServices.subscribeProperty.decode(buffer.buffer, 0)
		delete result.len
		expect(result).toEqual({
			cancellationRequest: true,
			covIncrement: 1,
			issueConfirmedNotifications: false,
			lifetime: 0,
			monitoredObjectId: {
				instance: 362,
				type: 148,
			},
			monitoredProperty: {
				index: 4294967295,
				id: 85,
			},
			subscriberProcessId: 7,
		})
	})

	it('should successfully encode and decode without cancellation request', () => {
		const buffer = utils.getBuffer()
		baServices.subscribeProperty.encode(
			buffer,
			8,
			{ type: 149, instance: 363 },
			false,
			true,
			2,
			{ id: 86, index: 3 },
			false,
			10,
		)
		const result = baServices.subscribeProperty.decode(buffer.buffer, 0)
		delete result.len
		expect(result).toEqual({
			cancellationRequest: false,
			covIncrement: 0,
			issueConfirmedNotifications: true,
			lifetime: 2,
			monitoredObjectId: {
				instance: 363,
				type: 149,
			},
			monitoredProperty: {
				index: 3,
				id: 86,
			},
			subscriberProcessId: 8,
		})
	})
})
