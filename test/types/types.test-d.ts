import {expectType} from 'tsd';
import {BACNetAddress} from '../../lib/types';


const address: BACNetAddress = {type: 0};

expectType<BACNetAddress>(address);
