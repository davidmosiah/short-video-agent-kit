# Changelog


## 0.1.9 - 2026-07-30

### Security

- Security: Seedance webhook fail-closed without secret; default listen 127.0.0.1.

## 0.1.7 - 2026-05-29
- Add a README Quickstart with real, captured dry-run output: a Sora `generate` plan, a provider-neutral `payload` re-targeted to Gemini Veo, and `doctor` provider readiness. No code changes — docs only.

## 0.1.4 - 2026-05-22
- Add `validateVideoMetadata({title, description, tags})` returning `{ok, errors}`. Defaults enforce the most restrictive common-denominator limits across short-form destinations: title <=100, description <=5000, tags <=500 entries, each tag <=100 chars. Limits are overridable via the second-arg options.
- 13 new tests covering required title, type checks, boundary lengths, tag arity, multi-error accumulation, and custom limits.

## 0.1.3
- Previous release.
