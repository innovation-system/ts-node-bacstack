'use strict'

import { describe, expect, it } from '@jest/globals'

import * as utils from './utils'

describe('bacnet - addListElement integration', () => {
	it('should return a timeout error if no device is available', (next) => {
		const client = new utils.BacnetClient({ apduTimeout: 200 })
		client.addListElement(
			'127.0.0.1',
			{ type: 19, instance: 101 },
			{ id: 80, index: 0 },
			[{ type: 1, value: true }],
			{},
			(err) => {
				expect(err.message).toEqual('ERR_TIMEOUT')
				client.close()
				next()
			},
		)
	})
})
