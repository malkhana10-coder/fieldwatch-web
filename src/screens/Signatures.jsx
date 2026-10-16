import { useMemo, useState } from 'react'
import { useEngine, Icon, Sheet, Switch, Setting, CLASS_ICON, ConfirmButton } from '../ui.jsx'
import { describeRule } from '../engine/catalog.js'
import { fleetColor } from './Live.jsx'
import { PALETTE } from '../engine/catalog.js'
import { download, pickFile } from '../engine/storage.js'
import { CLASSES } from '../i18n.js'

const RULE_KINDS = ['OUI', 'MAC_PREFIX', 'NAME_GLOB', 'NAME_CONTAINS', 'SERVICE_UUID', 'SERVICE_DATA', 'MANUFACTURER_ID', 'MANUFACTURER_DATA', 'VENDOR_IE_OUI', 'HIDDEN_SSID']

export function SignatureEditor({ fleet, isNew, onClose }) {
  const e = useEngine()
  const t = e.t
  const [f, setF] = useState(() => structuredClone(fleet))
  const upd = (patch) => setF({ ...f, ...patch })
  const updRule = (i, patch) => upd({ rules: f.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  return (
    <Sheet title={isNew ? t('newSignature') : f.name} onClose={onClose}
      actions={<button className="btn sm primary" onClick={() => { e.upsertFleet(f); e.toast(t('save') + ' ✓'); onClose() }}>{t('save')}</button>}>
      <div className="stack">
        <label className="field"><span>{t('name')}</span><input className="input" dir="auto" value={f.name} onChange={(ev) => upd({ name: ev.target.value })} /></label>
        <div className="row wrap">
          <label className="field grow"><span>{t('class')}</span>
            <select className="input" value={f.kind} onChange={(ev) => upd({ kind: ev.target.value })}>
              {CLASSES.map((c) => <option key={c} value={c}>{t.cls(c)}</option>)}
            </select>
          </label>
          <div className="field" role="radiogroup" aria-label={t('colorLabel')}><span aria-hidden="true">{t('colorLabel')}</span>
            <div className="row wrap">{PALETTE.map((c, i) => <button key={i} type="button" role="radio" aria-checked={f.colorIndex === i} aria-label={t('colorN', { n: i + 1 })} title={t('colorN', { n: i + 1 })} onClick={() => upd({ colorIndex: i })} style={{ width: 24, height: 24, borderRadius: 6, background: fleetColor(i), border: f.colorIndex === i ? '2px solid var(--text)' : '1px solid var(--line)' }} />)}</div>
          </div>
        </div>
        <div className="card">
          <Setting title={f.matchAny !== false ? t('matchAny') : t('matchAll')}><Switch checked={f.matchAny !== false} onChange={(v) => upd({ matchAny: v })} /></Setting>
          <Setting title={t('enabled')}><Switch checked={f.enabled} onChange={(v) => upd({ enabled: v })} /></Setting>
        </div>
        <div>
          <div className="row" style={{ marginBottom: 6 }}><b className="grow">{t('rules')} ({f.rules.length})</b>
            <button className="btn sm" onClick={() => upd({ rules: [...f.rules, { kind: 'NAME_GLOB', text: '', companyId: 0, dataPrefixHex: '', radio: null, enabled: true }] })}><Icon name="plus" size={14} />{t('add')}</button>
          </div>
          <div className="card" style={{ maxHeight: 360, overflow: 'auto' }}>
            {f.rules.slice(0, 200).map((r, i) => (
              <div key={i} className="setting" style={{ flexWrap: 'wrap' }}>
                <select className="input" style={{ width: 'auto' }} aria-label={t('ruleKind')} value={r.kind} onChange={(ev) => updRule(i, { kind: ev.target.value })}>{RULE_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
                {['MANUFACTURER_ID', 'MANUFACTURER_DATA'].includes(r.kind)
                  ? <input className="input mono" style={{ width: 110 }} aria-label={t('ruleCompany')} placeholder="0x004C" value={'0x' + (r.companyId || 0).toString(16).toUpperCase()} onChange={(ev) => updRule(i, { companyId: parseInt(ev.target.value.replace(/^0x/i, ''), 16) || 0 })} />
                  : <input className="input mono grow" style={{ minWidth: 120 }} aria-label={t('ruleValue')} value={r.text} placeholder={r.kind === 'OUI' ? 'AA:BB:CC' : r.kind.startsWith('NAME') ? 'Name*' : 'FEAA'} onChange={(ev) => updRule(i, { text: ev.target.value })} />}
                {['MANUFACTURER_DATA', 'SERVICE_DATA'].includes(r.kind) && <input className="input mono" style={{ width: 110 }} aria-label={t('ruleData')} placeholder={t('ruleData')} value={r.dataPrefixHex} onChange={(ev) => updRule(i, { dataPrefixHex: ev.target.value })} />}
                <select className="input" style={{ width: 'auto' }} aria-label={t('fRadio')} value={r.radio || ''} onChange={(ev) => updRule(i, { radio: ev.target.value || null })}>
                  <option value="">{t('fBoth')}</option><option value="WIFI">Wi-Fi</option><option value="BLE">BLE</option>
                </select>
                <Switch checked={r.enabled !== false} onChange={(v) => updRule(i, { enabled: v })} label={t('ruleEnabled')} />
                <button className="btn sm icon ghost" aria-label={t('delete')} onClick={() => upd({ rules: f.rules.filter((_, j) => j !== i) })}><Icon name="trash" size={15} /></button>
              </div>
            ))}
            {f.rules.length > 200 && <div className="setting small muted">+{f.rules.length - 200}…</div>}
          </div>
        </div>
        <label className="field"><span>{t('sigNotes')}</span><textarea className="input" dir="auto" value={f.notes} onChange={(ev) => upd({ notes: ev.target.value })} /></label>
        <label className="field"><span>{t('attentionNote')}</span><textarea className="input" dir="auto" value={f.attentionNote} onChange={(ev) => upd({ attentionNote: ev.target.value })} /></label>
        {!isNew && <ConfirmButton confirmLabel={t('tapConfirm')} onConfirm={() => { e.deleteFleet(f.id); onClose() }}><Icon name="trash" size={15} />{t('delete')}</ConfirmButton>}
      </div>
    </Sheet>
  )
}

export function Signatures() {
  const e = useEngine()
  const t = e.t
  const [q, setQ] = useState('')
  const [cls, setCls] = useState('')
  const [only, setOnly] = useState('')
  const [edit, setEdit] = useState(null)
  const [openId, setOpenId] = useState(null)

  const liveCounts = useMemo(() => {
    const m = {}
    const now = Date.now()
    for (const r of e.radios.values()) if (now - r.lastSeen < 60000) for (const id of r.fleetIds) m[id] = (m[id] || 0) + 1
    return m
  }, [e.version])

  const list = e.fleets.filter((f) => {
    if (cls && f.kind !== cls) return false
    if (only === 'watch' && !e.watch.has(f.id)) return false
    if (only === 'attn' && !f.attentionNote) return false
    if (only === 'custom' && f.builtIn) return false
    if (only === 'live' && !liveCounts[f.id]) return false
    if (q && !(f.name + ' ' + f.notes).toLowerCase().includes(q.toLowerCase())) return false
    return true
  }).sort((a, b) => (liveCounts[b.id] || 0) - (liveCounts[a.id] || 0) || a.name.localeCompare(b.name))
  const ruleCount = e.fleets.reduce((a, f) => a + f.rules.length, 0)

  return (
    <div className="stack">
      <div className="hero">
        <div className="row wrap">
          <div className="grow" style={{ flex: '1 1 220px' }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{t('catalog')} <span className="tag ok">#{e.catalogVersion}</span></div>
            <div className="muted">{t('sigCount', { n: e.fleets.length, r: t.num(ruleCount) })}</div>
          </div>
          <button className="btn" onClick={() => setEdit({ fleet: { id: 'custom-' + Date.now().toString(36), name: '', enabled: true, matchAny: true, colorIndex: 4, rules: [], notes: '', attentionNote: '', builtIn: false, kind: 'OTHER' }, isNew: true })}><Icon name="plus" size={15} />{t('newSignature')}</button>
          <button className="btn" onClick={async () => {
            const file = await pickFile('.json,application/json')
            if (!file) return
            try { const n = e.importSignatures(file.text); e.toast(t('imported', { n })) } catch (err) { e.toast(t('importFailed', { e: err.message }), 'warn') }
          }}><Icon name="upload" size={15} />{t('importSigs')}</button>
          <button className="btn" onClick={() => download('fieldwatch-signatures.json', e.exportSignatures(), 'application/json')}><Icon name="download" size={15} />{t('exportSigs')}</button>
        </div>
      </div>

      <div className="controls">
        <div className="search grow" style={{ minWidth: 200 }}><Icon name="search" size={16} /><input className="input" type="search" value={q} placeholder={t('searchSigs')} aria-label={t('searchSigs')} onChange={(ev) => setQ(ev.target.value)} /></div>
        <select className="input" style={{ width: 'auto', maxWidth: '100%' }} aria-label={t('fClasses')} value={cls} onChange={(ev) => setCls(ev.target.value)}>
          <option value="">{t('fClasses')}: {t('all')}</option>
          {CLASSES.map((c) => <option key={c} value={c}>{t.cls(c)}</option>)}
        </select>
      </div>
      <div className="row wrap">
        {[['', t('all')], ['live', t('liveHits')], ['watch', t('bookmarked')], ['attn', t('attention')], ['custom', t('custom')]].map(([k, l]) => (
          <button key={k} className={'chip' + (only === k ? ' on' : '')} aria-pressed={only === k} onClick={() => setOnly(k)}>{l}</button>
        ))}
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => e.setAllFleets(true, list.map((f) => f.id))}>{t('enableAll')}</button>
        <button className="btn sm ghost" onClick={() => e.setAllFleets(false, list.map((f) => f.id))}>{t('disableAll')}</button>
      </div>

      <div className="card">
        {list.map((f) => (
          <div key={f.id}>
            <div className="sig">
              <span className="sig-swatch" style={{ background: fleetColor(f.colorIndex) }} />
              <button className="grow" style={{ background: 'none', border: 0, textAlign: 'start', padding: 0, minWidth: 0 }} aria-expanded={openId === f.id} onClick={() => setOpenId(openId === f.id ? null : f.id)}>
                <div className="row" style={{ gap: 6 }}>
                  <Icon name={CLASS_ICON[f.kind] || 'dot'} size={15} />
                  <b className="ellipsis" dir="auto">{f.name}</b>
                  {f.attentionNote && <span className="tag attn">!</span>}
                  {liveCounts[f.id] > 0 && <span className="tag ok">{liveCounts[f.id]}</span>}
                </div>
                <div className="tiny faint">{t.cls(f.kind)} · {t('ruleCount', { n: f.rules.length })} · {f.builtIn ? t('builtIn') : t('custom')}{f.decode ? ` · ${t('decodeTag')}` : ''}</div>
              </button>
              <button className={'btn sm icon ' + (e.watch.has(f.id) ? '' : 'ghost')} style={e.watch.has(f.id) ? { color: 'var(--info)' } : undefined} title={t('bookmarked')} aria-label={t('bookmarked')} onClick={() => e.toggleWatch(f.id)}><Icon name="bell" size={15} /></button>
              <Switch checked={f.enabled} onChange={(v) => e.toggleFleet(f.id, v)} label={f.name} />
            </div>
            {openId === f.id && (
              <div style={{ padding: '0 14px 14px' }}>
                {f.attentionNote && <div className="note small" style={{ background: 'var(--danger-soft)', marginBottom: 8 }} dir="ltr">{f.attentionNote}</div>}
                {f.notes && <div className="small muted" dir="ltr" style={{ marginBottom: 8, textAlign: 'start' }}>{f.notes}</div>}
                <div className="row wrap" style={{ marginBottom: 8 }}>
                  {f.rules.slice(0, 24).map((r, i) => <span key={i} className="tag mono" style={r.enabled === false ? { opacity: .4 } : undefined}>{describeRule(r)}</span>)}
                  {f.rules.length > 24 && <span className="tag">+{f.rules.length - 24}</span>}
                </div>
                <button className="btn sm" onClick={() => setEdit({ fleet: f })}><Icon name="gear" size={14} />{t('edit')}</button>
              </div>
            )}
          </div>
        ))}
        {!list.length && <div className="empty">—</div>}
      </div>
      <div className="row"><span className="spacer" />
        <ConfirmButton className="btn sm danger" title={t('confirmReset')} confirmLabel={t('tapConfirm')} onConfirm={() => e.resetCatalog()}>{t('resetCatalog')}</ConfirmButton>
      </div>
      {edit && <SignatureEditor fleet={edit.fleet} isNew={edit.isNew} onClose={() => setEdit(null)} />}
    </div>
  )
}
