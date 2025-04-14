import {expectType} from 'tsd';
import {BACNetAddress} from '../../src/lib/types';


const address: BACNetAddress = {type: 0};

expectType<BACNetAddress>(address);
