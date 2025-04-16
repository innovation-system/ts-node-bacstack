'use strict'

import { describe, expect, it } from '@jest/globals'

import * as utils from './utils'

describe('bacnet - getEventInformation integration', () => {
	it('should return a timeout error if no device is available', (next) => {
		const client = new utils.BacnetClient({ apduTimeout: 200 })
		client.getEventInformation(
			'127.0.0.1',
			{ type: 5, instance: 33 },
			{},
			(err, value) => {
				expect(err.message).toEqual('ERR_TIMEOUT')
				expect(value).toBeUndefined()
				client.close()
				next()
			},
		)
	})
})
