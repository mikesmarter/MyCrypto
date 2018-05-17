import { SagaIterator, delay } from 'redux-saga';
import { select, take, call, apply, fork, put, all, takeLatest } from 'redux-saga/effects';
import BN from 'bn.js';
import { toTokenBase, Wei } from 'libs/units';
import { EAC_SCHEDULING_CONFIG, parseSchedulingParametersValidity } from 'libs/scheduling';
import RequestFactory from 'libs/scheduling/contracts/RequestFactory';
import { validDecimal, validNumber } from 'libs/validators';
import { getOffline, getNodeLib } from 'redux/config';
import { TypeKeys as TransactionTypeKeys } from 'redux/transaction/types';
import { getDecimal, getUnit } from 'redux/transaction/selectors';
import { setGasLimitField } from 'redux/transaction/actions';
import { validateInput } from 'redux/transaction/helpers';
import {
  TypeKeys,
  SetCurrentScheduleTimestampAction,
  SetCurrentScheduleTimezoneAction,
  SetSchedulingToggleAction,
  SetCurrentTimeBountyAction,
  SetCurrentWindowSizeAction,
  SetCurrentWindowStartAction
} from './types';
import {
  setScheduleTimestampField,
  setScheduleTimezone,
  setTimeBountyField,
  setWindowSizeField,
  setWindowStartField,
  setScheduleParamsValidity
} from './actions';
import {
  isSchedulingEnabled,
  getValidateScheduleParamsCallPayload,
  IGetValidateScheduleParamsCallPayload
} from './selectors';

//#region Schedule Timestamp
export function* setCurrentScheduleTimestampSaga({
  payload: raw
}: SetCurrentScheduleTimestampAction): SagaIterator {
  let value: Date | null = null;

  value = new Date(raw);

  yield put(setScheduleTimestampField({ value, raw }));
}

export const currentScheduleTimestamp = takeLatest(
  [TypeKeys.CURRENT_SCHEDULE_TIMESTAMP_SET],
  setCurrentScheduleTimestampSaga
);
//#endregion Schedule Timestamp

//#region Schedule Timezone
export function* setCurrentScheduleTimezoneSaga({
  payload: raw
}: SetCurrentScheduleTimezoneAction): SagaIterator {
  const value = raw;

  yield put(setScheduleTimezone({ value, raw }));
}

export const currentScheduleTimezone = takeLatest(
  [TypeKeys.CURRENT_SCHEDULE_TIMEZONE_SET],
  setCurrentScheduleTimezoneSaga
);
//#endregion Schedule Timezone

//#region Scheduling Toggle
export function* setGasLimitForSchedulingSaga({
  payload: { value: useScheduling }
}: SetSchedulingToggleAction): SagaIterator {
  const gasLimit = useScheduling
    ? EAC_SCHEDULING_CONFIG.SCHEDULING_GAS_LIMIT
    : EAC_SCHEDULING_CONFIG.SCHEDULE_GAS_LIMIT_FALLBACK;

  yield put(
    setGasLimitField({
      raw: gasLimit.toString(),
      value: gasLimit
    })
  );
}

export const currentSchedulingToggle = takeLatest(
  [TypeKeys.SCHEDULING_TOGGLE_SET],
  setGasLimitForSchedulingSaga
);
//#endregion Scheduling Toggle

//#region Time Bounty
export function* setCurrentTimeBountySaga({
  payload: raw
}: SetCurrentTimeBountyAction): SagaIterator {
  const decimal: number = yield select(getDecimal);
  const unit: string = yield select(getUnit);

  if (!validNumber(parseInt(raw, 10)) || !validDecimal(raw, decimal)) {
    yield put(setTimeBountyField({ raw, value: null }));
  }

  const value = toTokenBase(raw, decimal);
  const isInputValid: boolean = yield call(validateInput, value, unit);

  const isValid = isInputValid && value.gte(Wei('0'));

  yield put(setTimeBountyField({ raw, value: isValid ? value : null }));
}

export const currentTimeBounty = takeLatest(
  [TypeKeys.CURRENT_TIME_BOUNTY_SET],
  setCurrentTimeBountySaga
);
//#endregion Time Bounty

//#region Window Size
export function* setCurrentWindowSizeSaga({
  payload: raw
}: SetCurrentWindowSizeAction): SagaIterator {
  let value: BN | null = null;

  if (!validNumber(parseInt(raw, 10))) {
    yield put(setWindowSizeField({ raw, value: null }));
  }

  value = new BN(raw);

  yield put(setWindowSizeField({ value, raw }));
}

export const currentWindowSize = takeLatest(
  [TypeKeys.CURRENT_WINDOW_SIZE_SET],
  setCurrentWindowSizeSaga
);
//#endregion Window Size

//#region Window Start
export function* setCurrentWindowStartSaga({
  payload: raw
}: SetCurrentWindowStartAction): SagaIterator {
  let value: number | null = null;

  value = parseInt(raw, 10);

  yield put(setWindowStartField({ value, raw }));
}

export const currentWindowStart = takeLatest(
  [TypeKeys.CURRENT_WINDOW_START_SET],
  setCurrentWindowStartSaga
);
//#endregion Window Start

//#region Params Validity
export function* shouldValidateParams(): SagaIterator {
  while (true) {
    yield take([
      TransactionTypeKeys.TO_FIELD_SET,
      TransactionTypeKeys.DATA_FIELD_SET,
      TransactionTypeKeys.VALUE_FIELD_SET,
      TypeKeys.CURRENT_TIME_BOUNTY_SET,
      TypeKeys.WINDOW_SIZE_FIELD_SET,
      TypeKeys.WINDOW_START_FIELD_SET,
      TypeKeys.SCHEDULE_TIMESTAMP_FIELD_SET,
      TypeKeys.TIME_BOUNTY_FIELD_SET,
      TypeKeys.SCHEDULE_TYPE_SET,
      TypeKeys.SCHEDULING_TOGGLE_SET,
      TypeKeys.SCHEDULE_TIMEZONE_SET
    ]);

    yield call(delay, 250);

    const isOffline: boolean = yield select(getOffline);
    const scheduling: boolean = yield select(isSchedulingEnabled);

    if (isOffline || !scheduling) {
      continue;
    }

    yield call(checkSchedulingParametersValidity);
  }
}

function* checkSchedulingParametersValidity() {
  const validateParamsCallData: IGetValidateScheduleParamsCallPayload = yield select(
    getValidateScheduleParamsCallPayload
  );

  if (!validateParamsCallData) {
    return yield put(
      setScheduleParamsValidity({
        value: false
      })
    );
  }

  const node = yield select(getNodeLib);

  const callResult: string = yield apply(node, node.sendCallRequest, [validateParamsCallData]);

  const { paramsValidity } = RequestFactory.validateRequestParams.decodeOutput(callResult);

  const errors = parseSchedulingParametersValidity(paramsValidity);

  yield put(
    setScheduleParamsValidity({
      value: errors.length === 0
    })
  );
}

export const schedulingParamsValidity = fork(shouldValidateParams);
//#endregion Params Validity

export function* scheduleSaga(): SagaIterator {
  yield all([
    currentWindowSize,
    currentWindowStart,
    currentScheduleTimestamp,
    currentTimeBounty,
    currentSchedulingToggle,
    currentScheduleTimezone,
    schedulingParamsValidity
  ]);
}