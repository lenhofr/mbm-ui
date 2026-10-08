import React, { useEffect, useMemo, useRef, useState } from 'react'
import Sheet from './ui/Sheet'
import { Icon } from '../icons/Icons'
import { TIP_CATEGORIES, searchTips, type QuickTip } from '../lib/quickTips'
import './QuickTips.css'

export function TipCard({ tip }: { tip: QuickTip }) {
  return (
    <article className="tip-card">
      <h3 className="tip-title">{tip.title}</h3>
      {tip.text && <p className="tip-text">{tip.text}</p>}
      {tip.rows && (
        <dl className="tip-rows">
          {tip.rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {tip.note && <p className="tip-note">{tip.note}</p>}
    </article>
  )
}

/** Tips matching a Home search, shown above the recipe grid. */
export function InlineTips({ tips }: { tips: QuickTip[] }) {
  if (!tips.length) return null
  return (
    <section className="inline-tips" aria-label="Quick tips">
      <div className="tip-label"><Icon name="bulb" size={14} weight="bold" />Quick tip</div>
      <div className="tip-stack">{tips.map(t => <TipCard key={t.id} tip={t} />)}</div>
    </section>
  )
}

export default function QuickTipsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  // Fresh filter each time the sheet opens. No autofocus: the keyboard would cover the sheet.
  useEffect(() => { if (open) setQ('') }, [open])

  // New filter results start at the top of the list.
  useEffect(() => { listRef.current?.scrollTo?.({ top: 0 }) }, [q])

  const groups = useMemo(() => {
    const hits = searchTips(q)
    return TIP_CATEGORIES.map(c => ({ category: c, tips: hits.filter(t => t.category === c) })).filter(g => g.tips.length)
  }, [q])

  return (
    <Sheet open={open} onClose={onClose} label="Quick tips" tall>
      <div className="qt-head">
        <h2 className="sheet-title">Quick tips</h2>
        <button type="button" className="qt-close" onClick={onClose} aria-label="Close quick tips">
          <Icon name="close" size={18} weight="bold" />
        </button>
      </div>
      <label className="search qt-filter">
        <Icon name="search" size={19} />
        <span className="sr-only">Filter tips</span>
        <input
          type="search"
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Filter tips"
        />
        {q && (
          <button type="button" className="search-x" onClick={() => setQ('')} aria-label="Clear filter">
            <Icon name="close" size={14} weight="bold" />
          </button>
        )}
      </label>
      <div className="sheet-list" ref={listRef}>
        {groups.length === 0 ? (
          <p className="qt-empty">No tips for “{q.trim()}”.</p>
        ) : groups.map(g => (
          <section key={g.category} aria-label={g.category}>
            <div className="sec-label">{g.category}</div>
            <div className="tip-stack">{g.tips.map(t => <TipCard key={t.id} tip={t} />)}</div>
          </section>
        ))}
      </div>
    </Sheet>
  )
}
