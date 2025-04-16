'use strict'

import { describe, expect, it } from '@jest/globals'

import * as utils from './utils'

describe('bacnet - subscribeCOV integration', () => {
	it('should return a timeout error if no device is available', (next) => {
		const client = new utils.BacnetClient({ apduTimeout: 200 })
		client.subscribeCOV(
			'127.0.0.1',
			{ type: 5, instance: 3 },
			7,
			false,
			false,
			0,
			{},
			(err) => {
				expect(err.message).toEqual('ERR_TIMEOUT')
				client.close()
				next()
			},
		)
	})
})
