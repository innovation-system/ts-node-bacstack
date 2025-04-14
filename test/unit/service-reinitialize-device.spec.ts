'use strict';

import {describe, expect, it} from '@jest/globals';

import * as utils from './utils';
import * as baServices from '../../src/lib/services';

describe('bacstack - Services layer ReinitializeDevice unit', () => {
  it('should successfully encode and decode', () => {
    const buffer = utils.getBuffer();
    let password;
    baServices.reinitializeDevice.encode(buffer, 5, password);
    const result = baServices.reinitializeDevice.decode(buffer.buffer, 0, buffer.offset);
    delete result.len;
    expect(result).toEqual({
      state: 5
    });
  });

  it('should successfully encode and decode with password', () => {
    const buffer = utils.getBuffer();
    baServices.reinitializeDevice.encode(buffer, 5, 'Test1234$');
    const result = baServices.reinitializeDevice.decode(buffer.buffer, 0, buffer.offset);
    delete result.len;
    expect(result).toEqual({
      state: 5,
      password: 'Test1234$'
    });
  });
});
