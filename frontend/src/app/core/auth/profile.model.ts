/**
 * Role values mirror the `public.user_role` enum in the database.
 *
 * `pesquisador` escreve dado clínico como o médico e, ao contrário dele, enxerga e
 * edita o acervo dos outros pesquisadores. O que ele alcança é decidido pela RLS
 * (`app.same_research_pool`), nunca aqui: no cliente o papel só decide o que mostrar.
 */
export type UserRole = 'user' | 'medico' | 'pesquisador' | 'admin';

/** A row from the `public.users` profile table. */
export interface UserProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  /**
   * Authoritative role, owned by the backend. Regular users cannot modify it
   * (enforced by RLS), and the client treats it as read-only — it drives UX
   * gating only, never real authorization. See `auth.guard.ts`.
   */
  role: UserRole;
}
