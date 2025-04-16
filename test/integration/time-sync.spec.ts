'use strict'

import { describe, it } from '@jest/globals'

import * as utils from './utils'

describe('bacnet - timeSync integration', () => {
	it('should send a time sync package', () => {
		const client = new utils.BacnetClient({ apduTimeout: 200 })
		client.timeSync('127.0.0.1', new Date())
		client.close()
	})
})
