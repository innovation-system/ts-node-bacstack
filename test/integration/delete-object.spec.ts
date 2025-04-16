'use strict';

import {describe, expect, it} from '@jest/globals';

import * as utils from './utils';

describe('bacnet - deleteObject integration', () => {
  it('should return a timeout error if no device is available', (next) => {
    const client = new utils.BacnetClient({apduTimeout: 200});
    client.deleteObject('127.0.0.1', {type: 2, instance: 15}, {}, (err) => {
      expect(err.message).toEqual('ERR_TIMEOUT');
      client.close();
      next();
    });
  });
});
