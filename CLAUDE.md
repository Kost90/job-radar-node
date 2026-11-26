# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm ci                          # install dependencies
npm run dev -- --dry-run        # run locally without writing to DynamoDB/Sheets
npm run dev                     # run locally (writes to real sheet)
npm run try:llm                 # LLM prompt playground; writes nothing
npm test                        # run tests (vitest)
npm run typecheck               # tsc --noEmit
npm run lint                    # biome check
npm run lint:fix                # biome check --write
npm run build                   # esbuild bundle via scripts/build.mjs
npm run package                 # build + zip for Lambda
```

The dev script loads from `.env` (copy from `.env.example`). Tests are in `test/`.

## Architecture

This is a **daily serverless job-radar** running on AWS Lambda (Node.js 24, arm64), triggered by EventBridge Scheduler at 07:00 Europe/London.

### Pipeline (`src/pipeline.ts`)

The core orchestration: `runPipeline()` wires up all stages via `PipelineDeps` and returns a `PipelineSummary`. Stages in order:

1. **Crawl** (`src/crawl.ts`) — fetches job postings from Greenhouse, Ashby and Workable APIs for each company in `config/companies.json`
2. **Filter** (`src/filter.ts`) — `matchJob()` is a pure function: rejects jobs older than 7 days, checks title/location/skill keywords from `config/profile.json`, returns a keyword score (40 + 10×skills, capped at 100)
3. **Dedup** — strips duplicate URLs within one crawl run
4. **Claim** (`src/seen.ts`) — DynamoDB conditional `PutItem` with `attribute_not_exists(job_key)`: atomic check-and-mark; a job is processed at most once across runs (TTL 40 days). `memorySeenStore` is used for local/dry-run.
5. **AI score** (`src/scoring.ts`) — sends each new job + resume JSON to Claude via `src/llm.ts`. Returns `score 0–100`, one of `apply_as_is | tailor_resume | skip`, advice text, and gaps. Concurrency is capped at 3; per-run cap defaults to 50 jobs. Per-job failures are non-fatal; a whole-scorer failure falls back to keyword scores.
6. **Write** (`src/sheets.ts`) — appends rows to Google Sheets. If this fails, the DynamoDB claims are released so the next run retries.
7. **Notify** (`src/notify.ts`) — sends a Telegram message. Failure here is a warning, not a run failure.

### Lambda entry point (`src/handler.ts`)

Top-level `await` at module scope performs all init (SSM parameter reads, Google key validation, resume parse) **at cold start** so a misconfiguration fails immediately with a clear error. Warm invocations reuse cached state. Accepts `{ dryRun?: boolean }` as the event payload.

### Configuration

- `config/companies.json` — list of `{ ats, slug }` objects; `ats` is one of `greenhouse | ashby | workable`
- `config/profile.json` — keyword lists (`titleKeywords`, `excludeTitleKeywords`, `skillKeywords`, `locations`) and `minScore`
- `config/resume.example.json` — example schema; real resume lives in SSM Parameter Store (never in the repo)

Both JSON configs are validated with Zod at startup.

### LLM client (`src/llm.ts`)

Plain `fetch` to the Anthropic Messages API — no SDK. Uses structured outputs (`output_config.format.type = "json_schema"`), `thinking: disabled`, `effort: "low"`. Retries 2× with 1 s base delay. The `Llm` interface is a single `json()` method, making it easy to stub in tests.

### Infrastructure (`infra/`)

Terraform in `infra/` (S3 state with native locking). `infra/bootstrap/` is one-time setup (state bucket, OIDC provider, CI roles). Pull requests get a plan comment; merges to main apply and run a dry-run smoke test via GitHub Actions.

### Key design constraints

- **No AWS SDK for Claude, Sheets, or Telegram** — raw `fetch` only; keeps the Lambda bundle under 1 MB.
- **LLM runs after dedup** — cost scales with new jobs (~a few/day), not the full crawl (~hundreds).
- **Resume is validated JSON in SSM** — a parse error fails the cold start, not mid-run. No PII enters Terraform state.
- **DynamoDB on provisioned 1 RCU / 5 WCU** — stays inside the always-free tier.
- **SSM Standard Parameters** — free; secrets never appear in Terraform state or GitHub secrets.

## Code conventions

- TypeScript strict mode; `npm run typecheck && npm run lint && npm test` must pass before a task is done.
- Validate all external data (ATS API responses, SSM values, LLM output) with Zod at the boundary; inside the pipeline trust the types.
- Every outbound `fetch` has a timeout (`AbortSignal.timeout(...)`); no unbounded waits inside Lambda.
- Error handling: per-job failures are caught and counted in `PipelineSummary`;
- Logging: structured JSON via AWS Logger; never log resume content, prompts, API keys or full LLM responses.
- No new runtime dependencies without a reason — bundle must stay < 1 MB.

## Testing

- Tests live in the top-level `test/` folder as `test/*.test.ts` (vitest), not next to the source in `src/`. Shared helpers are in `test/helpers.ts`.
- Stub external services through `PipelineDeps` and the `Llm` interface, not by mocking `fetch` globally.
- Pure functions (`matchJob`, dedup) get table-driven tests.
