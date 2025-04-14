export interface EncodeBuffer {
  buffer: Buffer;
  offset: number;
}

export interface BACNetAddress {
  type?: number;
  net?: number;
  adr?: number[];
}

export interface TransportSettings {
  port?: number;
  interface?: string;
  broadcastAddress?: string;
}

export interface BACNetObjectID {
  type: number;
  instance: number;
}

export interface BACNetPropertyID {
  id: number;
  index: number;
}

export interface BACNetReadAccessSpecification {
  objectId: BACNetObjectID;
  properties: BACNetPropertyID[];
}

export interface BACNetBitString {
  bitsUsed: number;
  value: number[];
}

export interface BACNetCovSubscription {
  recipient: {
    network: number;
    address: number[];
  };
  subscriptionProcessId: number;
  monitoredObjectId: BACNetObjectID;
  monitoredProperty: BACNetPropertyID;
  issueConfirmedNotifications: boolean;
  timeRemaining: number;
  covIncrement: number;
}

export interface BACNetAlarm {
  objectId: BACNetObjectID;
  alarmState: number;
  acknowledgedTransitions: BACNetBitString;
}

export interface BACNetEvent {
  objectId: BACNetObjectID;
  eventState: number;
  acknowledgedTransitions: BACNetBitString;
  eventTimeStamps: Date[];
  notifyType: number;
  eventEnable: BACNetBitString;
  eventPriorities: number[];
}

export interface BACNetDevObjRef {
  id: number;
  arrayIndex: number;
  objectId: BACNetObjectID;
  deviceIndentifier: BACNetObjectID;
}

export interface BACNetAppData {
  type: number;
  value: any;
  encoding?: number;
}

export interface BACNetPropertyState {
  type: number;
  state: number;
}

export interface BACNetEventInformation {
  objectId: BACNetObjectID;
  eventState: number;
  acknowledgedTransitions: BACNetBitString;
  eventTimeStamps: any[];
  notifyType: number;
  eventEnable: BACNetBitString;
  eventPriorities: number[];
}

export interface DecodeResult<T> {
  len: number;
  value: T;
}

export interface TagResult {
  len: number;
  tagNumber: number;
  value?: number;
}

export interface ObjectIdResult {
  len: number;
  objectType: number;
  instance: number;
}

export interface ApplicationDataResult {
  len: number;
  type: number;
  value: any;
  encoding?: number;
}

export interface BACNetReadAccessResult {
  objectId: BACNetObjectID;
  values: {
    property: BACNetPropertyID;
    value: any[];
  }[];
}

export interface ReadAccessResultDecode {
  len: number;
  value: {
    objectId: BACNetObjectID;
    values: any[];
  };
}

export interface CharacterStringResult extends DecodeResult<string> {
  encoding: number;
}

export interface CalendarDateResult {
  len: number;
  year: number;
  month: number;
  day: number;
  wday: number;
}

export interface CalendarDateRangeResult {
  len: number;
  startDate: DecodeResult<Date>;
  endDate: DecodeResult<Date>;
}

export interface CalendarWeekDayResult {
  len: number;
  month: number;
  week: number;
  wday: number;
}

export interface CalendarResult {
  len: number;
  value: any[];
}

export interface AppDataResult {
  len: number;
  type: number;
  value: any;
  encoding?: number;
}

export interface DeviceObjPropertyRefResult {
  len: number;
  value: {
    objectId: ObjectIdResult;
    id: DecodeResult<number>;
  };
}

export interface ReadAccessSpecResult {
  len: number;
  value: BACNetReadAccessSpecification;
}

export interface CovSubscriptionResult {
  len: number;
  value: BACNetCovSubscription;
}

export interface ContextTagWithLengthResult {
  len: number;
  value: boolean;
}

export interface ContextCharacterStringResult extends DecodeResult<string> {
  encoding: number;
}
