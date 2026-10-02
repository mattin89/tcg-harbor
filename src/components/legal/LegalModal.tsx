import { useMemo } from 'react';
import { LEGAL_CONFIG } from '../../config/legalConfig';
import { getAllLegalDocuments, type LegalDocument } from '../../domain/legalContent';
import { Modal } from '../ui';

interface LegalModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly documentSlug: LegalDocument['slug'];
}

export function LegalModal({ open, onClose, documentSlug }: LegalModalProps) {
  const documents = useMemo(() => getAllLegalDocuments(LEGAL_CONFIG), []);
  const doc = documents[documentSlug] ?? documents.terms;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={doc.title}
      eyebrow={`${LEGAL_CONFIG.brandName} · Legal Information`}
      wide
    >
      <div className="legal-modal-content" style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: '0.5rem' }}>
        <p style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '0.875rem', marginBottom: '1rem' }}>
          {doc.subtitle}
        </p>
        <p style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '0.75rem', marginBottom: '1.5rem' }}>
          Last updated: {doc.lastUpdated}
        </p>

        <div className="legal-modal-sections" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {doc.sections.map((section) => (
            <article key={section.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text, #f8fafc)' }}>
                {section.title}
              </h3>
              {section.content.map((paragraph, index) => (
                <p key={index} style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--text-secondary, #cbd5e1)' }}>
                  {paragraph}
                </p>
              ))}
              {section.listItems && (
                <ul style={{ paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  {section.listItems.map((item, idx) => (
                    <li key={idx} style={{ fontSize: '0.875rem', lineHeight: 1.5, color: 'var(--text-secondary, #cbd5e1)' }}>
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>

        <div style={{ marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid var(--border, #1f2937)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-muted, #94a3b8)' }}>
          <span>{LEGAL_CONFIG.brandName} · Legal Compliance</span>
          <span>Contact: {LEGAL_CONFIG.legalEmail}</span>
        </div>
      </div>
    </Modal>
  );
}
