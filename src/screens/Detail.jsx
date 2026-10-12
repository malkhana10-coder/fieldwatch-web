import { useState, Fragment } from 'react'
import { useEngine, Sheet, Icon, Glyph, Sparkline, Switch, Setting, ago, copyText } from '../ui.jsx'
import { explainMatch, suggestFleet, hex4 } from '../engine/catalog.js'
import { serviceName } from '../engine/lookup.js'
import { maskMac } from '../engine/geo.js'
import { radioText } from '../engine/reports.js'
import { riskScore, RISK_TEXT, explainPlain, guidance, distanceBand, appleKind } from '../engine/intel.js'
import { RiskBadge } from './Home.jsx'
import { radioColor } from './Live.jsx'
import { SignatureEditor } from './Signatures.jsx'

export function Detail({ radioKey, onClose, onHunt }) {
  const e = useEngine()
  const t = e.t
  const r = e.radios.get(radioKey)
  const [newSig, setNewSig] = useState(null)
  if (!r) return null
  const privacy = e.settings.privacy
  const named = e.named[r.key] || {}
  const fleets = r.fleetIds.map((id) => e.fleetById(id)).filter(Boolean)
  const now = Date.now()
  return (
    <Sheet title={<div className="row"><Glyph r={r} color={radioColor(e, r)} /><div style={{ minWidth: 0 }}><div className="ellipsis">{e.displayName(r) || (r.hidden ? t('hidden') : t('unknown'))}</div><div className="small muted mono">{maskMac(r.mac, privacy)}</div></div></div>} onClose={onClose}>
      <div className="stack">
        <div className="row wrap">
          <button className="btn primary" onClick={() => onHunt(r.key)}><Icon name="target" size={16} />{t('hunt')}</button>
          <button className="btn" onClick={async () => { await copyText(radioText(r, e, t)); e.toast(t('copied')) }}><Icon name="copy" size={16} />{t('share')}</button>
          <button className="btn" onClick={() => setNewSig(suggestFleet(r))}><Icon name="plus" size={16} />{t('createSignature')}</button>
        </div>

        {(() => {
          const risk = riskScore(r, { engine: e, place: e.currentPlace() })
          const band = distanceBand(r.rssi)
          const apple = appleKind(r)
          return (
            <div className="card card-pad stack">
              <div className="row" style={{ gap: 12 }}>
                <RiskBadge score={risk.score} big />
                <div className="grow">
                  <div style={{ fontWeight: 700 }}>{t('explanation')}</div>
                  <div className="small">{explainPlain(r, e)}</div>
                </div>
              </div>
              <div className="row wrap">
                <span className="tag"><Icon name="target" size={12} />{t('distance')}: {t.lang === 'ar' ? band.ar : band.en}</span>
                {apple && <span className="tag info">{t('appleType')}: {t.lang === 'ar' ? apple.ar : apple.en}</span>}
                {r.linkedFrom && <span className="tag warn">{t('rotating', { n: r.linkedCount })}</span>}
                {r.anomaly && <span className="tag attn">{t('anomaly')}</span>}
              </div>
              {risk.reasons.filter((x) => x.w).length > 0 && (
                <div>
                  <div className="small muted" style={{ marginBottom: 4 }}>{t('why2')}</div>
                  <div className="row wrap">{risk.reasons.filter((x) => x.w).map((x) => <span key={x.k} className={'tag ' + (x.w < 0 ? 'ok' : x.w >= 20 ? 'attn' : '')}>{(RISK_TEXT[x.k]?.[t.lang] || x.k)} <span className="ltr">{x.w > 0 ? '+' : ''}{x.w}</span></span>)}</div>
                </div>
              )}
              {risk.score >= 30 && (
                <div>
                  <div className="small muted" style={{ marginBottom: 4 }}>{t('whatToDo')}</div>
                  <ol className="steps">{guidance(r, e).map((g, i) => <li key={i}>{g}</li>)}</ol>
                </div>
              )}
            </div>
          )
        })()}

        {fleets.filter((f) => f.attentionNote).map((f) => (
          <div key={f.id} className="note" style={{ background: 'var(--danger-soft)' }}>
            <div className="row" style={{ marginBottom: 4 }}><Icon name="alert" size={16} style={{ color: 'var(--danger)' }} /><b>{t('attention')} · {f.name}</b></div>
            <div dir="auto" style={{ textAlign: 'start' }}>{e.fleetNotes(f).attentionNote}</div>
          </div>
        ))}

        <div className="card card-pad">
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div>
              <div className="small muted">{t('rssi')}</div>
              <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1 }} className="ltr">{r.rssi}<span className="small muted"> dBm</span></div>
              <div className="small muted">{t('avg')} <span className="ltr">{Math.round(e.avgRssi(r))}</span> · {ago(t, r.lastSeen, now)}</div>
            </div>
            <div className="grow" style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Sparkline data={r.history} width={220} height={56} color={radioColor(e, r) || 'var(--accent)'} />
            </div>
          </div>
        </div>

        <div className="card card-pad">
          <dl className="kv">
            <dt>Radio</dt><dd>{r.kind === 'WIFI' ? 'Wi-Fi AP' : 'Bluetooth LE'}</dd>
            <dt>MAC</dt><dd><span className="mono">{maskMac(r.mac, privacy)}</span> <span className="tag">{r.randomized ? t('randomized') : t('factory')}</span></dd>
            {r.vendor && <><dt>{t('vendor')}</dt><dd>{r.vendor}</dd></>}
            {r.company && <><dt>{t('company')}</dt><dd>{r.company} <span className="mono faint">0x{hex4(r.mfg[0].companyId)}</span></dd></>}
            {r.kind === 'WIFI' && <><dt>{t('channel')}</dt><dd className="ltr">{r.channel} · {r.freq} MHz</dd></>}
            {r.security && <><dt>{t('security')}</dt><dd>{r.security}</dd></>}
            {r.uuids?.length > 0 && <><dt>{t('services')}</dt><dd>{r.uuids.map((u) => <div key={u} className="mono">{u.toUpperCase()}{serviceName(u) ? <span className="faint"> · {serviceName(u)}</span> : ''}</div>)}</dd></>}
            {r.mfg?.length > 0 && <><dt>{t('mfgData')}</dt><dd className="mono" style={{ fontSize: 12 }}>{r.mfg.map((m) => `0x${hex4(m.companyId)} ${m.dataHex}`).join(' · ')}</dd></>}
            {r.svcData?.length > 0 && <><dt>Service data</dt><dd className="mono" style={{ fontSize: 12 }}>{r.svcData.map((s) => `${s.uuid.toUpperCase()}: ${s.dataHex}`).join(' · ')}</dd></>}
            <dt>{t('firstSeen')}</dt><dd>{t.time(r.firstSeen)}</dd>
            <dt>{t('count')}</dt><dd>{r.count}</dd>
            {r.positions.length > 0 && <><dt>GPS</dt><dd>{r.positions.length} {t('points')}{e.coTravel(r) && <span className="tag warn" style={{ marginInlineStart: 6 }}>{t('movingWithYou')}</span>}</dd></>}
          </dl>
        </div>

        {r.decoded?.length > 0 && (
          <div className="card card-pad">
            <h3>{t('decoded')}</h3>
            <dl className="kv">{r.decoded.map((d, i) => <Fragment key={i}><dt>{d.label}</dt><dd className="mono">{d.value}</dd></Fragment>)}</dl>
          </div>
        )}

        <div className="card card-pad">
          <h3>{t('why')}</h3>
          {!fleets.length && <div className="small muted">{t('noSignature')}</div>}
          {fleets.map((f) => (
            <div key={f.id} style={{ marginBottom: 10 }}>
              <div className="row"><b>{f.name}</b><span className="tag">{t.cls(f.kind)}</span>{e.watch.has(f.id) && <span className="tag info"><Icon name="bell" size={11} />{t('bookmarked')}</span>}</div>
              <div className="row wrap" style={{ marginTop: 4 }}>{explainMatch(r, f).map((s, i) => <span key={i} className="tag mono">{s}</span>)}</div>
              {f.notes && <div className="small muted" dir="auto" style={{ marginTop: 4, textAlign: 'start' }}>{e.fleetNotes(f).notes}{e.fleetNotes(f).translated && <span className="tag" style={{ marginInlineStart: 6 }}>{t('translatedNote')}</span>}</div>}
            </div>
          ))}
        </div>

        <div className="card">
          <div className="setting" style={{ display: 'block' }}>
            <label className="field"><span>{t('customName')}</span>
              <input className="input" value={named.name || ''} onChange={(ev) => e.setNamed(r.key, { name: ev.target.value })} />
            </label>
          </div>
          <Setting title={t('markMine')} hint={t.lang === 'ar' ? 'لا يُصدر تنبيهات ويُستبعد من المرافقة.' : 'No alerts; left out of co-travel callouts.'}><Switch checked={named.mine} onChange={(v) => e.setNamed(r.key, { mine: v })} /></Setting>
          <Setting title={t('alertOn')}><Switch checked={named.alert} onChange={(v) => e.setNamed(r.key, { alert: v })} /></Setting>
          <div className="setting" style={{ display: 'block' }}>
            <label className="field"><span>{t('notes')}</span>
              <textarea className="input" value={named.notes || ''} onChange={(ev) => e.setNamed(r.key, { notes: ev.target.value })} />
            </label>
          </div>
        </div>
      </div>
      {newSig && <SignatureEditor fleet={newSig} isNew onClose={() => setNewSig(null)} />}
    </Sheet>
  )
}
