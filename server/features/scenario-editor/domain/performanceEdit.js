'use strict'
// 성과 정보 쓰기 값(SC_PROPERTY.performance). 필드 이름·순서는 사내 C# PerformanceItem 그대로(EqpPerfornmanceLoss 오타·WaferLoss, 01 §5.10).
const { NOT_ENTERED } = require('./enums')

// 사내 new PerformanceItem() — 새 대상 저장에서 성과를 복사하지 않을 때 쓴다(13 §2.6). TriggerInfo 는 대입이 없어 null,
// 심의자는 화면 문구 Common_NotEntered(DC-049), 기여자는 빈 목록이다. 0 은 Int32 로 나간다(드라이버가 Int32 범위 정수를 Int32 로 쓴다 — 사내 C# int·enum 과 같다).
function emptyPerformance() {
  return {
    Group: '',
    Trigger: 0,
    TriggerInfo: null,
    Grade: 0,
    Supervisor: NOT_ENTERED,
    SupervisorComment: '',
    CitizenDeveloper: [],
    PerformType: 0,
    ScenarioDescription: '',
    ManWorkLoss: 0,
    EqpPerfornmanceLoss: 0,
    EqpStopLoss: 0,
    WaferLoss: 0,
    InvestCostLoss: 0,
    AdditionalEffect: '',
    AccidentType: 0,
    AccidentInfo: '',
    UpdateDate: ''
  }
}

module.exports = { emptyPerformance }
