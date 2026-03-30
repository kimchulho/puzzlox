# Web App

웹 브라우저용 클라이언트 (`apps/web`).

- 소스: `apps/web/src`, 엔트리: `apps/web/index.html`
- 개발만 프론트: `npm run dev:web`
- API·소켓과 함께: 루트에서 `npm run dev` (서버가 Vite 미들웨어로 이 설정을 사용)
- 빌드: `npm run build:web` → `apps/web/dist`

공유 타입은 `import … from "@contracts/…"` 로 `packages/contracts` 를 참조합니다.
