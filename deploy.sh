#!/bin/bash
# waterbean 저장소 → Artifact Registry 빌드·푸시 후 Cloud Run 배포
#
# 필수 환경 변수 (예시는 주석 참고):
#   GCP_LOCATION, GCP_PROJECT, GCP_VPC_NETWORK, GCP_VPC_SUBNET, GAR_REPOSITORY
#   D1_SITE, D1_NAME, D1_VERSION, D1_ENV
# 선택: SERVICE_ACCOUNT (비우면 gcloud가 프로젝트 기본 실행 SA 사용, 보통 PROJECT_NUMBER-compute@developer.gserviceaccount.com)
#       NODE_ENV (기본 production), DOCKER_FILE (기본 ./Dockerfile), NO_DRY_RUN=1
#
# Secret Manager (파일 마운트, README와 동일):
#   waterbean-secret-key  → 컨테이너 /run/secrets/app.env  (api/.env 형식)
#   fcws-sheet-access-key → 컨테이너 /secrets/fcws-sheet.json (Sheets SA JSON)
#
# Cloud Run 실행 SA(명시했거나 기본 Compute SA)에 두 시크릿에 대한 secretAccessor 권한이 있어야 합니다.

set -euo pipefail

: "${GCP_LOCATION:?required}"
: "${GCP_PROJECT:?required}"
: "${GCP_VPC_NETWORK:?required}"
: "${GCP_VPC_SUBNET:?required}"
: "${GAR_REPOSITORY:?required}"
: "${D1_SITE:?required}"
: "${D1_NAME:?required}"
: "${D1_VERSION:?required}"
: "${D1_ENV:?required}"

: "${NODE_ENV:=production}"
: "${DOCKER_FILE:=./Dockerfile}"

WATERBEAN_SECRET_NAME=waterbean-secret-key
FCWS_SHEET_SECRET_NAME=fcws-sheet-access-key

echo "GCP_LOCATION=${GCP_LOCATION}"
echo "GCP_PROJECT=${GCP_PROJECT}"
echo "GAR_REPOSITORY=${GAR_REPOSITORY}"
echo "D1_SITE=${D1_SITE} D1_NAME=${D1_NAME} D1_VERSION=${D1_VERSION} D1_ENV=${D1_ENV}"
if [[ -n "${SERVICE_ACCOUNT:-}" ]]; then
  echo "SERVICE_ACCOUNT=${SERVICE_ACCOUNT}"
else
  echo "SERVICE_ACCOUNT=(unset → Cloud Run default compute SA)"
fi
echo "DOCKER_FILE=${DOCKER_FILE}"
echo "Secrets: ${WATERBEAN_SECRET_NAME} → /run/secrets/app.env , ${FCWS_SHEET_SECRET_NAME} → /secrets/fcws-sheet.json"

if [[ -z "${NO_DRY_RUN:-}" ]]; then
  echo "배포하려면 NO_DRY_RUN=1 을 설정하세요."
  EXEC=(echo)
else
  EXEC=()
fi

GAR_HOST="${GCP_LOCATION}-docker.pkg.dev"
IMAGE_TAG="${GAR_HOST}/${GCP_PROJECT}/${GAR_REPOSITORY}/${D1_SITE}-${D1_NAME}:${D1_VERSION}"
RUN_SERVICE="run-${D1_SITE}-${D1_ENV}-${D1_NAME}"

"${EXEC[@]}" gcloud auth configure-docker "${GAR_HOST}" --quiet

"${EXEC[@]}" docker build \
  --file "${DOCKER_FILE}" \
  -t "${IMAGE_TAG}" .

"${EXEC[@]}" docker push "${IMAGE_TAG}"

# README: DOTENV_CONFIG_PATH + GOOGLE_SERVICE_ACCOUNT_KEY_PATH + Cloud Run PORT
DEPLOY_ENV_VARS=(
  "NODE_ENV=${NODE_ENV}"
  "D1_ENV=${D1_ENV}"
  "GCP_PROJECT_ID=${GCP_PROJECT}"
  "DOTENV_CONFIG_PATH=/run/secrets/app.env"
  "GOOGLE_SERVICE_ACCOUNT_KEY_PATH=/secrets/fcws-sheet.json"
)
oIFS=${IFS}
IFS=','; ENV_VARS_JOINED="${DEPLOY_ENV_VARS[*]}"; IFS=${oIFS}

SECRET_MOUNTS=(
  "/run/secrets/app.env=${WATERBEAN_SECRET_NAME}:latest"
  "/secrets/fcws-sheet.json=${FCWS_SHEET_SECRET_NAME}:latest"
)
oIFS=${IFS}
IFS=','; SECRETS_JOINED="${SECRET_MOUNTS[*]}"; IFS=${oIFS}

CLOUD_RUN_ARGS=(
  --image="${IMAGE_TAG}"
  --region="${GCP_LOCATION}"
  --port=8080
  --execution-environment=gen2
)
if [[ -n "${SERVICE_ACCOUNT:-}" ]]; then
  CLOUD_RUN_ARGS+=(--service-account="${SERVICE_ACCOUNT}")
fi
CLOUD_RUN_ARGS+=(
  --allow-unauthenticated
  --ingress=internal-and-cloud-load-balancing
  --clear-vpc-connector
  --network="${GCP_VPC_NETWORK}"
  --subnet="${GCP_VPC_SUBNET}"
  --set-env-vars="${ENV_VARS_JOINED}"
  --set-secrets="${SECRETS_JOINED}"
)

"${EXEC[@]}" gcloud run deploy "${RUN_SERVICE}" "${CLOUD_RUN_ARGS[@]}"
