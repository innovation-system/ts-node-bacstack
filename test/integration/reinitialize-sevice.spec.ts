'use strict'

import { describe, expect, it } from '@jest/globals'

import * as utils from './utils'

describe('bacnet - reinitializeDevice integration', () => {
	it('should return a timeout error if no device is available', (next) => {
		const client = new utils.BacnetClient({ apduTimeout: 200 })
		client.reinitializeDevice(
			'127.0.0.1',
			1,
			{ password: 'Test1234' },
			(err) => {
				expect(err.message).toEqual('ERR_TIMEOUT')
				client.close()
				next()
			},
		)
	})
})
