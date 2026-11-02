'use strict'
// 사내 C# enum·상수. 근거: DataStruct/ScenarioData.cs·ScenarioProperty.cs·ContributionItems.cs, StaticClass/Constants.cs·KeyboardCode.cs.
const NEXT_STEP = Object.freeze({ FAIL: -1, SUCCESS: 10000, SKIP: 10001, NEXT: 10002 })
const OPERATION_NAMES = ['None', 'ImageSearching', 'OCR', 'Variable', 'EqpState']
const SCRIPT_TYPE_NAMES = ['None', 'MouseLeftClick', 'MouseLeftDoubleClick', 'MouseRightClick', 'MouseMove', 'Keyboard', 'Wait', 'Variable',
  'OICommand', 'FindWindow', 'SendEmail', 'RunCommand', 'CustomScript', 'FAP', 'ACS', 'NativeFunction']
const OCR_VALUE_TYPE_NAMES = ['None', 'Text', 'Number', 'Regex']
const OCR_OPERATION_NAMES = ['None', 'TextEqual', 'TextNotEqual', 'TextContain', 'TextNotContain', 'NumberEqual', 'NumberNotEqual',
  'NumberInRange', 'NumberOutOfRange', 'NumberLessThan', 'NumberGreaterThan']
const SCENARIO_TYPE_NAMES = ['NOT_DEFINED', 'ALARM_RECOVERY', 'PM_MACRO', 'CONDITION_CHECK', 'SILENT_DOWN_INFORM', 'GLASS_DEFECT',
  'SOP_INFORM', 'FAP', 'ACCIDENT_PREVENTION']
const TRIGGER_TYPE_NAMES = ['USER_DEFINED', 'EES', 'REALTIME']
const TRIGGER_NAMES = ['NA', 'Log', 'RV', 'EqState', 'Time', 'Scenario', 'Manual']
const GRADE_NAMES = ['N/A', 'S', 'A', 'B', 'C', 'D', 'NotUsed'] // 사내 등급 콤보 문구·순서(enum 0 NA 는 화면에 "N/A") [사용자 확인 2026-11-01, 사내 XAML 2026-11-02, Q-008]
const PERFORM_TYPE_NAMES = ['None', 'Active', 'Passive']
const ACCIDENT_TYPE_NAMES = ['None', 'Electric', 'Leak', 'Fire', 'Chemical', 'HumanError', 'System']
const AUTHORITY_NAMES = ['Normal User', 'Administrator', 'Conductor', 'Manager']
// Java AWT KeyEvent 값(에이전트가 robot.keyPress 로 누름)
const KEY_CODE_NAMES = Object.freeze({
  8: 'Backspace', 9: 'Tab', 10: 'Enter', 20: 'CapsLock', 27: 'Esc', 32: 'Space', 33: 'PgUp', 34: 'PgDn', 35: 'End', 36: 'Home',
  37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down', 112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6', 118: 'F7',
  119: 'F8', 120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12', 127: 'Delete', 154: 'PrintScreen', 155: 'Insert', 524: 'Win'
})
const NOT_ENTERED = 'Not entered' // StringLib.Common_NotEntered (사본 resx 값, 미입력)

const nameOf = (list, v) => (Number.isInteger(v) && v >= 0 && v < list.length ? list[v] : null)

module.exports = {
  NEXT_STEP, OPERATION_NAMES, SCRIPT_TYPE_NAMES, OCR_VALUE_TYPE_NAMES, OCR_OPERATION_NAMES, SCENARIO_TYPE_NAMES,
  TRIGGER_TYPE_NAMES, TRIGGER_NAMES, GRADE_NAMES, PERFORM_TYPE_NAMES, ACCIDENT_TYPE_NAMES, AUTHORITY_NAMES, KEY_CODE_NAMES,
  NOT_ENTERED, nameOf
}
