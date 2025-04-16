'use strict'

import { describe, expect, it } from '@jest/globals'

import * as utils from './utils'

describe('bacnet - writeFile integration', () => {
	it('should return a timeout error if no device is available', (next) => {
		const client = new utils.BacnetClient({ apduTimeout: 200 })
		client.writeFile(
			'127.0.0.1',
			{ type: 10, instance: 2 },
			0,
			[
				[5, 6, 7, 8],
				[5, 6, 7, 8],
			],
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
