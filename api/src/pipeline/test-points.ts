import type { ChecklistItem, FeatureType, TestPoint, TcType } from "../types/tc.js";

interface PointTemplate {
  pointType: string;
  intent: string;
  suggestedTcType: TcType;
  required: boolean;
}

const POINT_RULES: ReadonlyMap<FeatureType, readonly PointTemplate[]> = new Map([
  ["조회", [
    { pointType: "정상조회", intent: "정상 데이터 조회 시 올바른 결과가 반환된다", suggestedTcType: "Functional", required: true },
    { pointType: "빈결과", intent: "데이터 없을 때 빈 상태가 적절히 표시된다", suggestedTcType: "Boundary", required: true },
    { pointType: "필터정렬", intent: "필터/정렬 조건에 따라 결과가 올바르게 변한다", suggestedTcType: "Functional", required: false },
    { pointType: "페이지네이션", intent: "대량 데이터에서 페이지 이동이 정상 동작한다", suggestedTcType: "Boundary", required: false },
  ]],
  ["등록", [
    { pointType: "정상등록", intent: "유효 데이터로 등록 시 성공하고 결과가 반영된다", suggestedTcType: "Functional", required: true },
    { pointType: "필수값누락", intent: "필수 필드 누락 시 적절한 오류가 표시된다", suggestedTcType: "Negative", required: true },
    { pointType: "중복등록", intent: "동일 데이터 중복 등록 시 적절히 처리된다", suggestedTcType: "Negative", required: false },
    { pointType: "입력경계값", intent: "입력 필드의 최소/최대 길이 경계에서 올바르게 동작한다", suggestedTcType: "Boundary", required: false },
  ]],
  ["수정", [
    { pointType: "정상수정", intent: "유효 데이터로 수정 시 변경이 저장된다", suggestedTcType: "Functional", required: true },
    { pointType: "필수값검증", intent: "필수 필드를 비우고 저장 시 오류가 표시된다", suggestedTcType: "Negative", required: true },
    { pointType: "취소재진입", intent: "수정 취소 후 재진입 시 원래 값이 유지된다", suggestedTcType: "Functional", required: false },
  ]],
  ["삭제", [
    { pointType: "정상삭제", intent: "삭제 실행 시 대상이 제거되고 목록에서 사라진다", suggestedTcType: "Functional", required: true },
    { pointType: "삭제확인", intent: "삭제 전 확인 절차가 동작한다", suggestedTcType: "Functional", required: true },
    { pointType: "참조무결성", intent: "다른 데이터가 참조 중일 때 삭제가 적절히 처리된다", suggestedTcType: "Negative", required: false },
  ]],
  ["상태전이", [
    { pointType: "유효전이", intent: "허용된 상태 전이가 정상 처리된다", suggestedTcType: "Functional", required: true },
    { pointType: "비허용전이", intent: "허용되지 않은 상태 전이 시도가 차단된다", suggestedTcType: "Negative", required: true },
    { pointType: "전이후반영", intent: "상태 전이 후 UI와 데이터가 올바르게 반영된다", suggestedTcType: "Functional", required: false },
  ]],
  ["승인반려", [
    { pointType: "승인처리", intent: "승인 실행 시 상태가 변경되고 후속 처리가 진행된다", suggestedTcType: "Functional", required: true },
    { pointType: "반려처리", intent: "반려 실행 시 사유 입력과 상태 변경이 정상 동작한다", suggestedTcType: "Functional", required: true },
    { pointType: "권한없는승인", intent: "승인 권한 없는 사용자의 시도가 차단된다", suggestedTcType: "Security", required: false },
  ]],
  ["권한제어", [
    { pointType: "허용역할", intent: "허용된 역할로 접근 시 기능이 정상 동작한다", suggestedTcType: "Functional", required: true },
    { pointType: "비허용역할", intent: "비허용 역할로 접근 시 차단되고 안내 메시지가 표시된다", suggestedTcType: "Security", required: true },
    { pointType: "숨김차단", intent: "권한 없는 메뉴/버튼이 숨겨지거나 비활성화된다", suggestedTcType: "Security", required: false },
  ]],
  ["파일처리", [
    { pointType: "정상업로드", intent: "허용 형식/크기의 파일 업로드가 성공한다", suggestedTcType: "Functional", required: true },
    { pointType: "비허용파일", intent: "비허용 형식이나 초과 크기 파일이 거부된다", suggestedTcType: "Negative", required: true },
    { pointType: "다운로드검증", intent: "업로드된 파일을 다운로드하면 원본과 동일하다", suggestedTcType: "Functional", required: false },
  ]],
  ["결제금액", [
    { pointType: "정상결제", intent: "유효 결제수단으로 결제가 승인된다", suggestedTcType: "Functional", required: true },
    { pointType: "결제실패", intent: "잔액 부족/카드 만료 등 실패 시 적절한 오류가 표시된다", suggestedTcType: "Negative", required: true },
    { pointType: "환불처리", intent: "환불 요청 시 금액이 정확히 반환된다", suggestedTcType: "Functional", required: true },
    { pointType: "금액경계값", intent: "최소/최대 결제 금액 경계에서 올바르게 동작한다", suggestedTcType: "Boundary", required: false },
    { pointType: "중복결제방지", intent: "동일 요청의 중복 결제가 차단된다", suggestedTcType: "Security", required: false },
  ]],
  ["스케줄배치", [
    { pointType: "정상실행", intent: "예약 시간 도래 시 배치가 정상 실행된다", suggestedTcType: "Functional", required: true },
    { pointType: "실패재시도", intent: "실행 실패 시 재시도 또는 알림이 동작한다", suggestedTcType: "Negative", required: true },
    { pointType: "중복실행방지", intent: "동일 배치의 중복 실행이 방지된다", suggestedTcType: "Negative", required: false },
  ]],
  ["외부연동", [
    { pointType: "정상연동", intent: "외부 시스템과의 정상 통신이 성공한다", suggestedTcType: "Functional", required: true },
    { pointType: "연동실패", intent: "외부 시스템 장애/타임아웃 시 적절히 처리된다", suggestedTcType: "Negative", required: true },
    { pointType: "데이터정합성", intent: "연동 후 내부 데이터가 외부와 일치한다", suggestedTcType: "Functional", required: false },
  ]],
]);

const MAX_POINTS_PER_FEATURE_TYPE: ReadonlyMap<FeatureType, number> = new Map([
  ["조회", 4],
  ["등록", 4],
  ["수정", 3],
  ["삭제", 3],
  ["상태전이", 3],
  ["승인반려", 3],
  ["권한제어", 3],
  ["파일처리", 3],
  ["결제금액", 5],
  ["스케줄배치", 3],
  ["외부연동", 3],
]);

export function deriveTestPoints(
  item: ChecklistItem,
  requiredOnly = true,
): TestPoint[] {
  const featureTypes = item.featureTypes ?? ["조회"];
  const seen = new Set<string>();
  const points: TestPoint[] = [];
  let seq = 1;

  for (const ft of featureTypes) {
    const templates = POINT_RULES.get(ft);
    if (!templates) continue;

    const cap = MAX_POINTS_PER_FEATURE_TYPE.get(ft) ?? 3;
    let count = 0;

    for (const tmpl of templates) {
      if (count >= cap) break;
      if (requiredOnly && !tmpl.required) continue;

      const dedupeKey = `${tmpl.pointType}|${tmpl.suggestedTcType}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      points.push({
        id: `${item.id}-TP-${String(seq++).padStart(2, "0")}`,
        featureItemId: item.id,
        pointType: tmpl.pointType,
        intent: tmpl.intent,
        suggestedTcType: tmpl.suggestedTcType,
        required: tmpl.required,
      });
      count++;
    }
  }

  if (points.length === 0) {
    points.push({
      id: `${item.id}-TP-01`,
      featureItemId: item.id,
      pointType: "정상조회",
      intent: `${item.feature} 기능이 정상 동작한다`,
      suggestedTcType: "Functional",
      required: true,
    });
  }

  return points;
}

export function deriveTestPointsForChecklist(
  checklist: ChecklistItem[],
  requiredOnly = true,
): Map<string, TestPoint[]> {
  const result = new Map<string, TestPoint[]>();
  for (const item of checklist) {
    result.set(item.id, deriveTestPoints(item, requiredOnly));
  }

  if (checklist.length > 0) {
    let totalPoints = 0;
    let requiredPoints = 0;
    for (const pts of result.values()) {
      totalPoints += pts.length;
      requiredPoints += pts.filter((p) => p.required).length;
    }
    console.log(
      `[test-points] ${checklist.length} items -> ${totalPoints} points (required: ${requiredPoints})`,
    );
  }

  return result;
}
