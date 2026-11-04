# ADR-0002: Internationalization Deferred to M011

- **Status:** Accepted
- **Date:** 2026-06-13
- **Decision Owner:** Rackula maintainers
- **Related:** #2184, M011 -- Internationalization, M014 -- Canvas UX Overhaul, M015 -- Storage Model

## Context

A vestigial Paraglide runtime existed under `src/lib/i18n/paraglide/`. Inspection showed it was orphaned generated output, not a working i18n layer:

- The directory was entirely untracked and git-ignored (the generated tree carries its own `.gitignore` of `*`), so CI and other contributors never saw it.
- There was no `@inlang/paraglide-js` dependency in `package.json`.
- There was no inlang project config (`project.inlang`) and no source message catalogues; the generated message modules were empty stubs.
- Nothing in `src` imported it.

In parallel, M014 (Canvas UX Overhaul) and M015 (Storage Model) introduce the project's largest batch of new user-facing copy: the app menu (#2073), command registry text (#2096), storage status chip and toasts (#2035, #2038), and conflict and snapshot dialogs (#2041, #2042).

M011 (Internationalization) already exists as a dedicated milestone. The open question was whether new M014/M015 strings should go through an i18n layer now, or be authored inline and retrofitted when M011 is prioritized.

## Decision

1. Delete the orphaned `src/lib/i18n/` directory. It is dead, untracked generated output with no dependency, config, catalogue, or usage backing it.
2. Do not adopt an i18n layer for M014/M015. New user-facing strings are authored inline as literal English copy in components.
3. Internationalization is owned by M011. When M011 is prioritized it adopts a clean i18n setup (dependency, config, catalogues, component wiring) and retrofits existing strings then.

## Rationale

- The Paraglide output was never wired up; there is nothing of value to preserve and no partial setup to build on.
- Adopting i18n now would force every new M014/M015 string through catalogues and a standing seven-locale translation commitment (en, de, fr, nl, it, es, pl) before i18n is a prioritized milestone. For a solo maintainer that is front-loaded overhead with no near-term payoff.
- It matches the project's greenfield, simplicity-first philosophy: only implement what is asked, and delete unused code completely.
- A single clean adoption in M011 is cheaper and less error-prone than a half-wired adoption now plus later rework.

## Consequences

### Positive

- Dead code removed; no orphaned generated tree lingering on developer machines.
- M014/M015 proceed without i18n overhead on every new string.
- i18n adoption happens once, cleanly, when M011 is prioritized.

### Negative

- Strings authored during M014/M015 will need a retrofit pass into catalogues when M011 lands. This is accepted: the retrofit is bounded and M011 already scopes it.

### Follow-Up Work

- M011 -- Internationalization: adopt the i18n toolchain, author catalogues, wire components, and retrofit existing inline strings.
