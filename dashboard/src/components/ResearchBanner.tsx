import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export default function ResearchBanner() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="mx-4 mt-3 rounded overflow-hidden"
      style={{
        backgroundColor: 'rgba(249,115,22,0.05)',
        borderLeft: '4px solid var(--color-primary)',
        border: '1px solid rgba(249,115,22,0.2)',
        borderLeftWidth: '4px',
      }}
    >
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
        style={{ cursor: 'pointer', backgroundColor: 'transparent', border: 'none' }}
      >
        <span className="text-xs leading-snug pr-2" style={{ color: 'var(--color-text-primary)' }}>
          {expanded ? (
            <span className="font-medium" style={{ color: 'var(--color-primary)' }}>
              Research Context
            </span>
          ) : (
            <>
              <span style={{ color: 'var(--color-text-muted)' }}>
                NashAlert asks: can community data improve infrastructure prioritization in Nashville?
              </span>
            </>
          )}
        </span>
        <span style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3">
          <div
            className="text-xs leading-relaxed mb-3"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <p className="mb-2">
              <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                Primary question:
              </span>{' '}
              Can community-sourced real-time infrastructure reports, combined with historical Nashville
              311 open data and a recurrence-weighted scoring algorithm, produce a more informed and
              defensible infrastructure maintenance priority queue than complaint volume alone?
            </p>
            <p className="mb-2">
              <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                Secondary question:
              </span>{' '}
              Do lower-income Nashville census tracts exhibit higher infrastructure complaint recurrence
              rates relative to their 311 report volume — suggesting systematic underreporting that a
              passive complaint-driven system would fail to correct?
            </p>
            <p>
              <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                Methodology:
              </span>{' '}
              Each location is scored using a composite of frequency (40%), recency with 365-day
              exponential decay (30%), severity (20%), and resolution time (10%) across 334,710
              Nashville 311 infrastructure complaints from 2017–2026.
            </p>
          </div>
          <a
            href="https://github.com/kolekaushik/nashalert"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs underline"
            style={{ color: 'var(--color-primary)' }}
          >
            View on GitHub →
          </a>
        </div>
      )}
    </div>
  );
}
