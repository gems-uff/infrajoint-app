# Project Context: Angular Application

You are an Angular specialist responsible for developing this application following best practices for architecture, performance, accessibility, and maintainability.

## Technology Stack

* Framework: Angular (use the most modern APIs available in the project's installed version)
* Language: TypeScript
* Styling: Tailwind CSS (utility classes) and Lucide for icons
* Reactivity: Angular Signals and RxJS

## Project Structure

Prioritize the following organization:

* `src/app/core/` → global services, interceptors, guards, and singleton configurations.
* `src/app/shared/` → reusable components, pipes, directives, and utilities.
* `src/app/features/` → domain-oriented application features and screens.

Inside a feature, keep the structure flat and add folders only when they earn their place:

* `features/<feature>/<feature>.routes.ts` → the feature's lazy-loaded routes.
* `features/<feature>/pages/` → routed screen components.
* `features/<feature>/components/` → components reused across that feature.
* `features/<feature>/sections/` → large page sub-areas (when a page warrants splitting).

Do **not** pre-create Clean Architecture layers (`presentation/`, `application/`, `domain/`, `data/`). Introduce a `data/` layer (services, DTOs, mappers) in a feature only when that feature actually integrates with an API. Favor incremental evolution over scaffolding for hypothetical needs.

Whenever possible, maintain this structure when creating new files.

## Architecture

The application follows Clean Architecture principles adapted for Angular.

Whenever appropriate:

* Separate presentation, application, and data access concerns.
* Avoid placing business rules inside components.
* Keep business logic in services or use cases.
* Follow SOLID principles.
* Favor low coupling and high cohesion.
* Dependencies should point to abstractions whenever possible.

## Useful Commands

* Install dependencies: `npm install`
* Development server: `npm run start`
* Run tests: `npm run test`
* Production build: `npm run build`

## Coding Conventions

### Standalone

* All new components, pipes, and directives must use `standalone: true`.

### File & Class Naming

* Follow the Angular 21 schematic default: **no `Component`/`.component` suffix**.
* File: `navbar.ts`, template `navbar.html`, test `navbar.spec.ts` (not `navbar.component.ts`).
* Class: `export class Navbar` (not `NavbarComponent`).
* Selectors keep the `app-` prefix (e.g. `app-navbar`).
* Non-component files keep descriptive role suffixes (e.g. `analysis-flow.presenter.ts`, `*.model.ts`, `*.data.ts`, `*.routes.ts`, `*.service.ts`).

### Dependency Injection

* Prefer using `inject()`.
* Avoid using `constructor()` for dependency injection unless there is a specific need.

Example:

```ts
private authService = inject(AuthService);
```

### Typing

* Do not use `any`.
* Use interfaces, types, and generics appropriately.
* Use `unknown` when a type cannot be determined safely.

### Reactivity

* Use Angular Signals for local state management and derived state.
* Use RxJS for asynchronous flows, events, and API integrations.
* Do not convert Observables to Signals unless there is a clear benefit.

### Components

* There is no component library in this project: Angular Material is **not** a
  dependency and must not be introduced without an explicit decision.
* Build UI with Tailwind utility classes and the shared components under
  `src/app/shared/components/`; icons come from `@lucide/angular`.
* Ensure accessibility and responsiveness by hand — nothing does it for you here.

## API Integration

The project integrates with three backends, and all three are already wired:

* **The clinical API** (FastAPI, `backend/`), reached over `HttpClient`. Every
  route lives in `PatientsService` and `AlgorithmsService` — those two files are
  the only places that know the API's URLs.
* **Supabase**, for authentication and the `users`/`avatars` tables, through
  `SupabaseService`.
* **Cloudflare R2**, for capture files, via pre-signed URLs. Those PUTs use
  `fetch`, not `HttpClient`, on purpose — see `capture-upload.ts`.

`authInterceptor` attaches the Supabase JWT, and only to URLs under
`environment.apiBaseUrl`.

When implementing features:

* Centralize HTTP calls within services; never call the API from a component.
* Create interfaces/types for requests and responses in the feature's `data/`
  folder, named after the backend's own fields (snake_case) — there is no
  camelCase mapper, deliberately.
* Do not create fictitious HTTP calls or mock endpoints that do not exist.

## Authorization & Security

The source of truth for authorization is the backend: **Supabase Row-Level
Security (RLS) policies and Storage policies**, which are configured and verified
on the database. The current rules enforce that users can only read/update their
own profile, that the `role` field is not user-modifiable, that administrative
resources require server-side authorization, and that storage access is scoped to
the user's own files.

Everything authorization-related on the client is **UX/navigation only**:

* `roleGuard`, `authGuard`, and the sidebar's `requiredRole` filtering exist to
  route users sensibly and declutter the UI — they grant no real access and are
  trivially bypassable (devtools, direct anon-key calls).
* Treat `UserProfile.role` as read-only display state, never as an access grant.

When adding any protected feature:

* Enforce authorization at the database/storage policy level **first**; add (or
  reuse) an RLS/Storage policy before shipping.
* Use Angular guards/role checks only to improve the experience on top of that
  server-side rule — never as the only line of defense.
* Do not introduce client-side privilege state that the backend does not also
  enforce.

## Code Quality

When suggesting changes:

* Make the smallest change necessary to solve the problem.
* Preserve existing project patterns.
* Do not refactor unrelated files.
* Briefly explain important architectural decisions when necessary.

## Before Creating Something New

* Search for similar implementations already present in the project.
* Reuse existing components, services, and utilities whenever possible.
* Avoid code duplication.
* Avoid introducing new dependencies without a clear justification.

## Testing

Whenever modifying critical functionality:

* Suggest or implement unit tests.
* Consider error scenarios and relevant edge cases.

## Workflow Before Modifying Code

1. Read the relevant files.
2. Understand the current implementation flow.
3. Evaluate impacts on other features or shared resources.
4. Reuse existing solutions whenever possible.
5. Ensure the proposed change does not introduce architectural inconsistencies.
6. Preserve compatibility with existing builds and tests.
