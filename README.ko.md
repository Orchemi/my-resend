# my-resend

> 🌐 **언어**: [English](./README.md) · **한국어**

**Resend SDK 와 호환되는 self-hosted 메일 게이트웨이.**

my-resend 는 [eibrahim/freeresend](https://github.com/eibrahim/freeresend) (MIT) 의 hard fork 입니다. 출처와 분기 시점은 [NOTICE](./NOTICE) 를 참조하세요. AWS SES 를 backend 로 사용하며 (SES v2 마이그레이션 진행 중), DNS 자동화는 DigitalOcean 과 AWS Route53 양쪽을 지원합니다. Resend Node SDK 와 호환되므로 기존 Resend 사용자는 환경변수 `RESEND_BASE_URL` 만 바꿔서 이관할 수 있습니다.

> ⚠️ **상태**: my-resend 는 upstream 으로부터 활발히 분기 중입니다. 브랜딩 정리, SES v2 마이그레이션, Route53 지원은 작업 진행 중이며, 그 전까지는 README 가 기본적으로 upstream 동작을 설명합니다.

---

## 주요 기능

- 🚀 **Resend SDK 100% 호환** — `RESEND_BASE_URL` 환경변수만 바꾸면 기존 코드 변경 없이 이관
- 🏠 **Self-hosted** — 메일 인프라를 직접 통제, 발송 비용을 SES 단가($0.10/1000건)로 회수
- 📧 **Amazon SES 연동** — DKIM 자동 서명, 안정적인 deliverability
- 🌐 **DNS 자동 등록** — DigitalOcean DNS / AWS Route53 (provider-pluggable, 진행 중)
- 🔐 **DKIM 인증** — DKIM 키 자동 생성 및 DNS 레코드 자동 등록
- 🔑 **API key 관리** — 도메인별 다중 API key 발급, prefix `mrs_` (예정)
- 📊 **발송 로그** — 모든 발송 건의 전달 상태와 로그 추적
- 🎯 **도메인 verify** — SES 도메인 인증 자동화
- 🔒 **보안** — JWT 인증 + 견고한 API key 검증
- 🐳 **Docker / Dokku 준비됨** — 컨테이너 배포 + Dokku one-touch deploy

## 빠른 시작

영어 README 의 [Quick Start](./README.md#quick-start) 섹션을 참조하세요. 본 한국어 문서는 추후 my-resend 자체의 시나리오(예: 홈서버 Dokku + Route53) 가 정리되는 대로 단계별 가이드로 확장될 예정입니다.

## upstream 과의 차이

자세한 변경 사항은 [NOTICE](./NOTICE) 의 *Planned Divergence* 항목을 참조하세요. 요약:

| 영역 | upstream (freeresend) | my-resend |
|---|---|---|
| AWS SDK | SES v1 (`@aws-sdk/client-ses`) | SES v2 (`@aws-sdk/client-sesv2`, 진행 중) |
| DNS 자동화 | DigitalOcean DNS only | DigitalOcean + AWS Route53 (provider-pluggable, 진행 중) |
| API key prefix | `frs_` | `mrs_` (진행 중) |
| 문서 언어 | English | English + 한국어 |
| 배포 타깃 | 일반 호스팅 | 홈서버 Dokku 우선 (horbis 인프라 컨벤션) |

## 라이선스

MIT — [LICENSE](./LICENSE) 참조. 원작자의 copyright 는 그대로 보존되며, my-resend 의 추가 기여분은 별도로 표시되어 있습니다.

## 기여 / 문의

이슈와 PR 은 GitHub 저장소에서 환영합니다: <https://github.com/Orchemi/my-resend>
