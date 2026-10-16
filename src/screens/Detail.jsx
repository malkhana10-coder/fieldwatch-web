import { useState, Fragment } from 'react'
import { useEngine, Sheet, Icon, Glyph, Sparkline, Switch, Setting, ago, copyText } from '../ui.jsx'
import { explainMatch, suggestFleet, hex4 } from '../engine/catalog.js'
import { serviceName } from '../engine/lookup.js'
import { maskMac } from '../engine/geo.js'
import { radioText } from '../engine/reports.js'
import { radioColor } from './Live.jsx'
import { SignatureEditor } from './Signatures.jsx'
import { TrackerTag, useLocate } from './Intel.jsx'
import { NumUnit, Dist, tNode, enumLabel, decodedView, maskMacsIn, privateSuggestion } from './format.jsx'
import { trackerState } from '../engine/intel.js'
import { distM } from '../engine/geo.js'

export function Detail({ radioKey, onClose, onHunt }) {
  const e = useEngine()
  const t = e.t
  const r = e.radios.get(radioKey)
  const [newSig, setNewSig] = useState(null)
  const est = useLocate(r)
  if (!r) return null
  const privacy = e.settings.privacy
  const named = e.named[r.key] || {}
  const fleets = r.fleetIds.map((id) => e.fleetById(id)).filter(Boolean)
  const now = Date.now()
  const m = t('m')
  return (
    <Sheet title={<div className="row"><Glyph r={r} color={radioColor(e, r)} /><div style={{ minWidth: 0 }}><div className="ellipsis" dir="auto">{e.displayName(r) || (r.hidden ? t('hidden') : t('unknown'))}</div><div className="small muted mono">{maskMac(r.mac, privacy)}</div></div></div>} onClose={onClose}>
      <div className="stack">
        <div className="row wrap">
          <button className="btn primary" onClick={() => onHunt(r.key)}><Icon name="target" size={16} />{t('hunt')}</button>
          <button className="btn" onClick={async () => { await copyText(radioText(r, e, t)); e.toast(t('copied')) }}><Icon name="copy" size={16} />{t('share')}</button>
          <button className="btn" onClick={() => setNewSig(privateSuggestion(suggestFleet(r, { privacy }), r.mac, privacy))}><Icon name="plus" size={16} />{t('createSignature')}</button>
        </div>

        {fleets.filter((f) => f.attentionNote).map((f) => (
          <div key={f.id} className="note" style={{ background: 'var(--danger-soft)' }}>
            <div className="row" style={{ marginBottom: 4 }}><Icon name="alert" size={16} style={{ color: 'var(--danger)' }} /><b>{t('attention')} · {f.name}</b></div>
            <div dir="ltr" style={{ textAlign: 'start' }}>{maskMacsIn(f.attentionNote, privacy)}</div>
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
            <dt>{t('radioKind')}</dt><dd>{r.kind === 'WIFI' ? t('wifiAp') : t('bleLong')}</dd>
            <dt>MAC</dt><dd><span className="mono">{maskMac(r.mac, privacy)}</span> <span className="tag">{r.randomized ? t('randomized') : t('factory')}</span></dd>
            {r.vendor && <><dt>{t('vendor')}</dt><dd><bdi>{r.vendor}</bdi></dd></>}
            {r.company && <><dt>{t('company')}</dt><dd><bdi>{r.company}</bdi> <span className="mono faint">0x{hex4(r.mfg[0].companyId)}</span></dd></>}
            {r.kind === 'WIFI' && <><dt>{t('channel')}</dt><dd className="ltr">{r.channel} · <NumUnit v={r.freq} u="MHz" /></dd></>}
            {r.security && <><dt>{t('security')}</dt><dd>{r.security}</dd></>}
            {r.uuids?.length > 0 && <><dt>{t('services')}</dt><dd>{r.uuids.map((u) => <div key={u} className="mono">{u.toUpperCase()}{serviceName(u) ? <span className="faint"> · {serviceName(u)}</span> : ''}</div>)}</dd></>}
            {r.mfg?.length > 0 && <><dt>{t('mfgData')}</dt><dd className="mono" style={{ fontSize: 12 }}>{r.mfg.map((m) => `0x${hex4(m.companyId)} ${m.dataHex}`).join(' · ')}</dd></>}
            {r.svcData?.length > 0 && <><dt>{t('svcData')}</dt><dd className="mono" style={{ fontSize: 12 }}>{r.svcData.map((s) => `${s.uuid.toUpperCase()}: ${s.dataHex}`).join(' · ')}</dd></>}
            {trackerState(r, now) && <><dt>{t('trackerState')}</dt><dd><TrackerTag ts={trackerState(r, now)} /></dd></>}
            {r.prevMacs?.length > 0 && <><dt>{t('prevAddresses')}</dt><dd><div className="small muted">{t('rotatedHint')}</div>{r.prevMacs.slice().reverse().map((m) => <div key={m} className="mono">{maskMac(m, privacy)}</div>)}</dd></>}
            {est && <><dt>{t('locateTitle')}</dt><dd>{tNode(t, 'locateEst', { r: <NumUnit v={'±' + est.radiusM} u={m} />, n: est.n })}{e.pos && <> · {tNode(t, 'droneFromYou', { d: <Dist m={distM(e.pos, est)} t={t} /> })}</>}</dd></>}
            <dt>{t('firstSeen')}</dt><dd>{t.time(r.identityFirstSeen || r.firstSeen)}</dd>
            <dt>{t('count')}</dt><dd>{r.count}</dd>
            {r.positions.length > 0 && <><dt>{t('gps')}</dt><dd>{t('pointsN', { n: r.positions.length })}{e.coTravel(r) && <span className="tag warn" style={{ marginInlineStart: 6 }}>{t('movingWithYou')}</span>}</dd></>}
          </dl>
        </div>

        {r.drone && (
          <div className="card card-pad">
            <h3>{t('dronesTitle')}</h3>
            <dl className="kv">
              {r.drone.id && <><dt>{t('droneId')}</dt><dd><span className="mono">{r.drone.id}</span>{r.drone.idType != null && <span className="faint"> · {enumLabel(t, 'idType', r.drone.idType, 4)}</span>}</dd></>}
              {r.drone.uaType != null && <><dt>{t('uaTypeLabel')}</dt><dd>{enumLabel(t, 'uaType', r.drone.uaType, 15)}</dd></>}
              {r.drone.status != null && <><dt>{t('droneStatus')}</dt><dd>{enumLabel(t, 'droneSt', r.drone.status, 4)}</dd></>}
              {r.drone.height != null && <><dt>{t('droneHeight')}</dt><dd><NumUnit v={r.drone.height} u={m} />{r.drone.altGeo != null && <> · {t('altGeo')} <NumUnit v={r.drone.altGeo} u={m} /></>}</dd></>}
              {r.drone.speed != null && <><dt>{t('droneSpeed')}</dt><dd><NumUnit v={r.drone.speed} u={t('mps')} />{r.drone.vspeed != null && <> · {'↕\u00a0'}<NumUnit v={r.drone.vspeed} u={t('mps')} /></>}</dd></>}
              {r.drone.direction != null && <><dt>{t('droneHeading')}</dt><dd><span className="ltr">{Math.round(r.drone.direction)}°</span></dd></>}
              {r.drone.lat != null && <><dt>{t('gps')}</dt><dd className="mono">{privacy ? '••' : `${r.drone.lat.toFixed(5)}, ${r.drone.lon.toFixed(5)}`}</dd></>}
              {r.drone.opLat != null && <><dt>{t('droneOperator')}</dt><dd className="mono">{privacy ? '••' : `${r.drone.opLat.toFixed(5)}, ${r.drone.opLon.toFixed(5)}`}{r.drone.lat != null && <span className="faint" style={{ fontFamily: 'var(--font)' }}> · <Dist m={distM({ lat: r.drone.lat, lon: r.drone.lon }, { lat: r.drone.opLat, lon: r.drone.opLon })} t={t} /></span>}</dd></>}
              {r.drone.operatorId && <><dt>{t('droneOpId')}</dt><dd className="mono">{r.drone.operatorId}</dd></>}
            </dl>
          </div>
        )}

        {r.decoded?.length > 0 && (
          <div className="card card-pad">
            <h3>{t('decoded')}</h3>
            <dl className="kv">{r.decoded.map((f, i) => { const d = decodedView(f, privacy); return <Fragment key={i}><dt dir="auto">{d.label}</dt><dd className="mono">{d.value}</dd></Fragment> })}</dl>
          </div>
        )}

        <div className="card card-pad">
          <h3>{t('why')}</h3>
          {!fleets.length && <div className="small muted">{t('noSignature')}</div>}
          {fleets.map((f) => (
            <div key={f.id} style={{ marginBottom: 10 }}>
              <div className="row wrap"><b dir="auto">{f.name}</b><span className="tag">{t.cls(f.kind)}</span>{e.watch.has(f.id) && <span className="tag info"><Icon name="bell" size={11} />{t('bookmarked')}</span>}</div>
              <div className="row wrap" style={{ marginTop: 4 }}>{explainMatch(r, f, { privacy }).map((s, i) => <span key={i} className="tag mono">{maskMacsIn(s, privacy)}</span>)}</div>
              {f.notes && <div className="small muted" dir="ltr" style={{ marginTop: 4, textAlign: 'start' }}>{maskMacsIn(f.notes, privacy)}</div>}
            </div>
          ))}
        </div>

        <div className="card">
          <div className="setting" style={{ display: 'block' }}>
            <label className="field"><span>{t('customName')}</span>
              <input className="input" dir="auto" value={named.name || ''} onChange={(ev) => e.setNamed(r.key, { name: ev.target.value })} />
            </label>
          </div>
          <Setting title={t('markMine')} hint={t('markMineHint')}><Switch checked={named.mine} onChange={(v) => e.setNamed(r.key, { mine: v })} /></Setting>
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
