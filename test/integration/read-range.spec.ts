'use strict'

import { describe, expect, it } from '@jest/globals'

import * as utils from './utils'

describe('bacnet - readRange integration', () => {
	it('should return a timeout error if no device is available', (next) => {
		const client = new utils.BacnetClient({ apduTimeout: 200 })
		client.readRange(
			'127.0.0.1',
			{ type: 20, instance: 0 },
			0,
			200,
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
