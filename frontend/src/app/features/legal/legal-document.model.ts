/** A bullet inside a legal document list, optionally prefixed by a label. */
export interface LegalListItem {
  label?: string;
  text: string;
}

/** The content primitives a legal document section is built from. */
export type LegalBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: LegalListItem[] }
  | { kind: 'note'; title: string; text: string }
  | { kind: 'contact'; label: string; email: string };

/** A numbered section of a legal document, addressable by its anchor `id`. */
export interface LegalSection {
  /** Anchor used by the table of contents and by deep links. */
  id: string;
  title: string;
  blocks: LegalBlock[];
}
