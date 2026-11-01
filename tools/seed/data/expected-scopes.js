'use strict'
const CVD = { process: 'SEWCVD', models: [{ model: 'SEWMODELA', eqpCount: 5 }, { model: 'SEWMODELB', eqpCount: 1 }] }
const ETCH = { process: 'SEWETCH', models: [{ model: 'SEWMODELA', eqpCount: 1 }, { model: 'SEWMODELB', eqpCount: 1 }] }
const PHOTO = { process: 'SEWPHOTO', models: [{ model: 'SEWMODELA', eqpCount: 1 }, { model: 'SEWMODELB', eqpCount: 1 }] }
// SEWCVD/SEWMODELA 유효 5대 = A01·A02·DUP01·PRX01·PRX02. 뺀 수 3 = BADREQ·BADMAIL·DUP01 둘째.
module.exports = {
  sew_master: { status: 200, processes: [CVD, ETCH, PHOTO], excludedEqpCount: 3 },
  sew_cvd: { status: 200, processes: [CVD], excludedEqpCount: 3 },
  sew_multi: { status: 200, processes: [CVD, ETCH], excludedEqpCount: 3 },
  sew_mastercvd: { status: 200, processes: [CVD], excludedEqpCount: 3 },
  sew_spaces: { status: 200, processes: [CVD], excludedEqpCount: 3 },
  sew_longgrade: { status: 200, processes: [PHOTO], excludedEqpCount: 0 },
  sew_none: { status: 403 }
}
