# 010-4-korean-translation-paired-docs

## 개요

- **이슈**: [#27](https://github.com/Orchemi/my-resend/issues/27)
- **브랜치**: `feat/27` (stacked on `feat/26` → `feat/25` → `feat/24`)
- **상태**: 진행 중
- **생성일**: 2026-05-14
- **선행**: plan 010-3 (PR #26, feat/26). 본 plan 은 010 sweep 시리즈의 마무리 단계로, Tier 1~3 정렬이 끝난 영문 문서를 한국어로 번역하여 README.ko.md 와 짝을 맞춘다.

## 배경

`README.md` / `README.ko.md` 가 line 3 toggle (`🌐 **Languages**: **English** · [한국어]`) 패턴으로 잘 정착되어 있다. 그러나 README 에서 들어온 한국어 사용자가 `SETUP.md` / `DEPLOYMENT.md` / `PROJECT_SUMMARY.md` 로 이동하는 순간 영문으로 떨어진다 — 일관성 단절.

본 plan 은 3 영문 문서를 한국어로 번역해 `.ko.md` 짝을 만들고, cross-link 를 언어 모드별로 정렬해 사용자가 한 번 한국어 모드에 진입하면 그대로 머무를 수 있게 한다.

## 목표

- [ ] plan 010-4 본 문서 신설
- [ ] `SETUP.ko.md` 신설 — SETUP.md 한국어 번역, README.ko.md 톤 일치
- [ ] `DEPLOYMENT.ko.md` 신설 — DEPLOYMENT.md 한국어 번역
- [ ] `PROJECT_SUMMARY.ko.md` 신설 — PROJECT_SUMMARY.md 한국어 번역
- [ ] 영문 + 한글 6 파일 line 3 에 언어 toggle 라인 추가
- [ ] Cross-link 언어별 정렬
- [ ] CI 4단 통과

## 설계

### 번역 정책

1. **영문이 source of truth**. 영문 변경 시 한글이 parity 를 유지한다 — README.md L419 의 안내와 동일 규칙
2. **톤**: README.ko.md 패턴을 그대로 답습 — 해요체 / 명사형 혼용, 기술 용어는 영문 그대로 (`hosted zone`, `Bearer token` 등)
3. **단일 파일 (한글 버전 없음) 참조**:
   - `NOTICE`, `LICENSE` — 법적 문서. 영문 단일 권위 출처
   - `CLAUDE.md` — LLM 어시스턴트 컨텍스트. 영문 유지가 OSS 컨벤션
   - `database.sql`, `.env.local.example` — 코드/설정 파일
   - 위 단일 파일은 영문/한글 양쪽 모두 동일하게 참조
4. **한국어 fixture 도메인**: 영문과 동일하게 RFC 2606 (`example.com` / `example.org` / `example.net`) 사용
5. **OSS 가시성**: 한국어 본문에도 `horbis` / `.claude.local` / `홈서버` / `huns.site` 등 누출 금지

### Toggle 라인 패턴

영문 (line 3):
```markdown
> 🌐 **Languages**: **English** · [한국어](./SETUP.ko.md)
```

한글 (line 3):
```markdown
> 🌐 **언어**: [English](./SETUP.md) · **한국어**
```

3 쌍 모두 동일 패턴 적용.

### Cross-link 정렬 규칙

| 참조 대상 | 영문 문서에서 | 한글 문서에서 |
|----------|------------|--------------|
| `README` | `[README.md](./README.md)` | `[README.ko.md](./README.ko.md)` |
| `SETUP` | `[SETUP.md](./SETUP.md)` | `[SETUP.ko.md](./SETUP.ko.md)` |
| `DEPLOYMENT` | `[DEPLOYMENT.md](./DEPLOYMENT.md)` | `[DEPLOYMENT.ko.md](./DEPLOYMENT.ko.md)` |
| `PROJECT_SUMMARY` | `[PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md)` | `[PROJECT_SUMMARY.ko.md](./PROJECT_SUMMARY.ko.md)` |
| `NOTICE` | `[NOTICE](./NOTICE)` | `[NOTICE](./NOTICE)` (동일) |
| `LICENSE` | `[LICENSE](./LICENSE)` | `[LICENSE](./LICENSE)` (동일) |
| `CLAUDE.md` | `CLAUDE.md` | `CLAUDE.md` (동일) |
| `CONTRIBUTING.md` | `[CONTRIBUTING.md](./CONTRIBUTING.md)` | `[CONTRIBUTING.md](./CONTRIBUTING.md)` (동일 — 한글본 미존재) |
| `database.sql`, `.env.local.example` | 그대로 | 그대로 (동일) |

## 010-4 작업 절차 (5 분할 커밋)

| # | 커밋 메시지 | 변경 파일 |
|---|--------------|-----------|
| 1 | `docs(plan): add 010-4 korean translation paired docs plan` | `docs/plan/010-4-korean-translation-paired-docs.md` |
| 2 | `docs(setup): add Korean translation SETUP.ko.md` | `SETUP.ko.md` (신규) + `SETUP.md` toggle + cross-link 정렬 |
| 3 | `docs(deployment): add Korean translation DEPLOYMENT.ko.md` | `DEPLOYMENT.ko.md` (신규) + `DEPLOYMENT.md` toggle + cross-link 정렬 |
| 4 | `docs(project-summary): add Korean translation PROJECT_SUMMARY.ko.md` | `PROJECT_SUMMARY.ko.md` (신규) + `PROJECT_SUMMARY.md` toggle + cross-link 정렬 |
| 5 | `docs(repo): pair Korean docs in CONTRIBUTING and add cross-link parity check` | `CONTRIBUTING.md` (한글 문서 가리키는 라인 정리, 영문본은 영문만 가리킴) |

## 머지 기준

- [ ] CI 4단 통과
- [ ] 3 영문 + 3 한글 = 6 파일 line 3 에 toggle 라인 존재 (`grep -nE "^> 🌐 \\*\\*(Languages|언어)\\*\\*" {SETUP,DEPLOYMENT,PROJECT_SUMMARY}{,.ko}.md` 결과 6 hits)
- [ ] 영문 문서 안에서 `*.ko.md` 참조 = toggle 라인 1 곳만 (cross-link 본문 내 0)
- [ ] 한글 문서 안에서 비-`*.ko.md`·비-단일파일 참조 0 (단일파일·toggle 제외)

## 비스코프

- `CLAUDE.md`, `NOTICE`, `LICENSE`, `CONTRIBUTING.md` 한국어 번역 — 사유는 § 설계 § 단일 파일 참조 단락
- `.kiro/specs/hosted-version-waitlist/` (Tier 4 marketing) — plan 010 의 결정대로 보류

## 진행 로그

| 날짜 | 내용 |
|------|------|
| 2026-05-14 | 이슈 #27, `feat/27` 분기, 본 plan 작성 |
