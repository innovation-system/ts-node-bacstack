'use strict'

import { describe, it } from '@jest/globals'

import * as utils from './utils'

describe('bacnet - unconfirmedPrivateTransfer integration', () => {
	it('should correctly send a telegram', () => {
		const client = new utils.BacnetClient({ apduTimeout: 200 })
		client.unconfirmedPrivateTransfer(
			'127.0.0.1',
			0,
			7,
			[0x00, 0xaa, 0xfa, 0xb1, 0x00],
		)
		client.close()
	})
})
