/**
 * Blank add-form notes mean "leave the existing note alone" for duplicates.
 * Clearing a private note remains an explicit action in the holding editor.
 */
export function resolvePrivateNoteForAddV2(
  draft: string,
  existingNote?: string,
): string | undefined {
  const normalizedDraft = draft.trim();
  return normalizedDraft || existingNote;
}
