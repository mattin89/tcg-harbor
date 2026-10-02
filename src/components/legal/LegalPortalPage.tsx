import { useMemo } from 'react';
import { LEGAL_CONFIG } from '../../config/legalConfig';
import { getAllLegalDocuments, type LegalDocument } from '../../domain/legalContent';
import { Button, Chip } from '../ui';
import { Icon } from '../Icon';

export type LegalTabSlug = LegalDocument['slug'];

interface LegalPortalPageProps {
  readonly activeSlug?: LegalTabSlug;
  readonly navigate: (path: string) => void;
  readonly isAuthenticated?: boolean;
}

const TAB_CONFIG: Array<{ slug: LegalTabSlug; path: string; label: string; icon: Parameters<typeof Icon>[0]['name'] }> = [
  { slug: 'terms', path: '/terms', label: 'Terms of Service', icon: 'shield' },
  { slug: 'privacy', path: '/privacy', label: 'Privacy Policy (GDPR)', icon: 'lock' },
  { slug: 'cookies', path: '/cookies', label: 'Cookie & Storage Policy', icon: 'settings' },
  { slug: 'impressum', path: '/impressum', label: 'Legal Notice (Impressum)', icon: 'store' },
  { slug: 'disclaimers', path: '/legal', label: 'IP & Disclaimers', icon: 'cards' },
];

export function LegalPortalPage({
  activeSlug = 'terms',
  navigate,
  isAuthenticated = false,
}: LegalPortalPageProps) {
  const documents = useMemo(() => getAllLegalDocuments(LEGAL_CONFIG), []);
  const activeDoc = documents[activeSlug] ?? documents.terms;

  const handleTabClick = (path: string) => {
    navigate(path);
  };

  const handleBack = () => {
    navigate(isAuthenticated ? '/' : '/cards');
  };

  return (
    <div className="page legal-portal-page" style={{ padding: '2rem 1rem', maxWidth: '1100px', margin: '0 auto', minHeight: '80vh' }}>
      {/* Header bar */}
      <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '2rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <Button variant="ghost" size="sm" onClick={handleBack} icon="arrow-down" aria-label="Go back">
              <span style={{ transform: 'rotate(90deg)', display: 'inline-block' }}>➜</span> Back to {isAuthenticated ? 'Dashboard' : 'Catalog'}
            </Button>
            <Chip tone="positive">{LEGAL_CONFIG.brandName}</Chip>
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: '0 0 0.5rem 0', color: 'var(--ink, #132130)', letterSpacing: '-0.02em' }}>
            Legal & Compliance Portal
          </h1>
          <p style={{ margin: 0, color: 'var(--muted, #63717e)', fontSize: '0.9rem' }}>
            EU regulatory disclosures, intellectual property notices, and data protection terms.
          </p>
        </div>

        <div style={{ textAlign: 'right' }}>
          <Chip tone="neutral">Entity: {LEGAL_CONFIG.operatorName}</Chip>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted, #63717e)', marginTop: '0.35rem' }}>
            Effective: {LEGAL_CONFIG.effectiveDate} · {LEGAL_CONFIG.governingLaw}
          </div>
        </div>
      </header>

      {/* Tabs navigation */}
      <nav
        aria-label="Legal document navigation"
        style={{
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          marginBottom: '2rem',
          borderBottom: '1px solid var(--line, #deddd8)',
          paddingBottom: '0.75rem',
        }}
      >
        {TAB_CONFIG.map((tab) => {
          const isActive = tab.slug === activeSlug;
          return (
            <button
              key={tab.slug}
              type="button"
              onClick={() => handleTabClick(tab.path)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.55rem 1.1rem',
                borderRadius: '10px',
                border: '1px solid',
                borderColor: isActive ? 'var(--navy-900, #091827)' : 'var(--line, #deddd8)',
                cursor: 'pointer',
                fontWeight: isActive ? 700 : 500,
                fontSize: '0.875rem',
                backgroundColor: isActive ? 'var(--navy-900, #091827)' : 'var(--paper, #fffdf9)',
                color: isActive ? '#ffffff' : 'var(--ink, #132130)',
                boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <Icon name={tab.icon} size={15} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Document content wrapper */}
      <main
        className="panel"
        style={{
          backgroundColor: 'var(--paper, #fffdf9)',
          border: '1px solid var(--line, #deddd8)',
          borderRadius: '16px',
          padding: '2.5rem',
          color: 'var(--ink, #132130)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <header style={{ marginBottom: '2rem', paddingBottom: '1.25rem', borderBottom: '1px solid var(--line, #deddd8)' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 0.5rem 0', color: 'var(--ink, #132130)' }}>{activeDoc.title}</h2>
          <p style={{ margin: '0 0 0.5rem 0', color: 'var(--muted, #63717e)', fontSize: '0.95rem', lineHeight: 1.5 }}>
            {activeDoc.subtitle}
          </p>
          <div style={{ fontSize: '0.8rem', color: 'var(--muted, #63717e)' }}>
            Operating Entity: <strong style={{ color: 'var(--ink, #132130)' }}>{LEGAL_CONFIG.operatorName}</strong> · Last modified: <strong style={{ color: 'var(--ink, #132130)' }}>{activeDoc.lastUpdated}</strong>
          </div>
        </header>

        {/* Text sections */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {activeDoc.sections.map((section) => (
            <section key={section.id} aria-labelledby={`section-heading-${section.id}`} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <h3 id={`section-heading-${section.id}`} style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--ink, #132130)' }}>
                {section.title}
              </h3>
              {section.content.map((paragraph, idx) => (
                <p key={idx} style={{ margin: 0, fontSize: '0.925rem', lineHeight: 1.65, color: '#243447' }}>
                  {paragraph}
                </p>
              ))}

              {section.listItems && section.listItems.length > 0 && (
                <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {section.listItems.map((item, itemIdx) => (
                    <li key={itemIdx} style={{ fontSize: '0.925rem', lineHeight: 1.55, color: '#243447' }}>
                      {item}
                    </li>
                  ))}
                </ul>
              )}

              {/* Special disclosure table for cookies tab */}
              {activeSlug === 'cookies' && section.id === 'storage-inventory' && (
                <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: '0.85rem',
                      textAlign: 'left',
                      backgroundColor: 'var(--paper, #fffdf9)',
                      border: '1px solid var(--line, #deddd8)',
                      borderRadius: '10px',
                      overflow: 'hidden',
                    }}
                  >
                    <thead>
                      <tr style={{ backgroundColor: 'var(--navy-900, #091827)', color: '#ffffff' }}>
                        <th style={{ padding: '0.75rem 1rem' }}>Storage Key</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Mechanism</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Classification</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Purpose</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Retention</th>
                      </tr>
                    </thead>
                    <tbody>
                      {LEGAL_CONFIG.clientStorageRegistry.map((entry, index) => (
                        <tr
                          key={entry.key}
                          style={{
                            borderTop: '1px solid var(--line, #deddd8)',
                            backgroundColor: index % 2 === 0 ? 'transparent' : 'rgba(0, 0, 0, 0.02)',
                          }}
                        >
                          <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontWeight: 600, color: 'var(--blue, #427da2)' }}>
                            {entry.key}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: 'var(--ink, #132130)' }}>
                            {entry.storageType}
                          </td>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <Chip tone={entry.classification === 'Strictly Necessary' ? 'positive' : 'neutral'}>
                              {entry.classification}
                            </Chip>
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#243447', maxWidth: '300px', lineHeight: 1.4 }}>
                            {entry.purpose}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: 'var(--muted, #63717e)', fontSize: '0.8rem' }}>
                            {entry.retention}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>

        {/* Contact footer inside legal portal */}
        <footer
          style={{
            marginTop: '3rem',
            paddingTop: '1.5rem',
            borderTop: '1px solid var(--line, #deddd8)',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            fontSize: '0.85rem',
            color: 'var(--muted, #63717e)',
          }}
        >
          <div>
            <strong style={{ color: 'var(--ink, #132130)' }}>Questions regarding legal compliance?</strong>
            <div style={{ marginTop: '0.25rem' }}>Operating entity: <strong style={{ color: 'var(--ink, #132130)' }}>{LEGAL_CONFIG.operatorName}</strong></div>
            <div>Data privacy: <a href={`mailto:${LEGAL_CONFIG.privacyEmail}`} style={{ color: 'var(--blue, #427da2)', textDecoration: 'underline' }}>{LEGAL_CONFIG.privacyEmail}</a></div>
            <div>Legal inquiries: <a href={`mailto:${LEGAL_CONFIG.legalEmail}`} style={{ color: 'var(--blue, #427da2)', textDecoration: 'underline' }}>{LEGAL_CONFIG.legalEmail}</a></div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <Button variant="secondary" size="sm" onClick={() => handleTabClick('/terms')}>Terms</Button>
            <Button variant="secondary" size="sm" onClick={() => handleTabClick('/privacy')}>Privacy</Button>
            <Button variant="secondary" size="sm" onClick={() => handleTabClick('/impressum')}>Impressum</Button>
          </div>
        </footer>
      </main>
    </div>
  );
}
