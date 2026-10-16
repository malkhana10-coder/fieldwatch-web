import { useState } from 'react'
import { useEngine, Sheet, Seg, Switch, Setting, Icon, CLASS_ICON } from '../ui.jsx'
import { CLASSES } from '../i18n.js'

export function Filters({ onClose }) {
  const e = useEngine()
  const t = e.t
  const f = e.settings.filters
  const [presetName, setPresetName] = useState('')
  const toggleClass = (c) => {
    const s = new Set(f.classes)
    s.has(c) ? s.delete(c) : s.add(c)
    e.setFilters({ classes: [...s] })
  }
  const presets = e.settings.presets || []
  return (
    <Sheet title={t('filters')} onClose={onClose} actions={<button className="btn sm" onClick={() => e.resetFilters()}>{t('clearFilters')}</button>}>
      <div className="stack">
        <div className="card">
          <Setting title={t('fRadio')}>
            <Seg value={f.radio} label={t('fRadio')} onChange={(v) => e.setFilters({ radio: v })} options={[{ value: 'BOTH', label: t('fBoth') }, { value: 'WIFI', label: 'Wi-Fi' }, { value: 'BLE', label: 'BLE' }]} />
          </Setting>
          <div className="setting" style={{ display: 'block' }}>
            <div className="row"><span className="grow">{t('fMinRssi')}</span><b className="ltr">{f.minRssi} dBm</b></div>
            <input type="range" min="-100" max="-40" step="1" aria-label={t('fMinRssi')} aria-valuetext={`${f.minRssi} dBm`} value={f.minRssi} onChange={(ev) => e.setFilters({ minRssi: Number(ev.target.value) })} style={{ direction: 'ltr' }} />
          </div>
          <div className="setting" style={{ display: 'block' }}>
            <div className="row"><span className="grow">{t('fMaxAge')}</span><b className="nowrap">{f.maxAge} {t('seconds')}</b></div>
            <input type="range" min="10" max="600" step="10" aria-label={t('fMaxAge')} aria-valuetext={`${f.maxAge} ${t('seconds')}`} value={f.maxAge} onChange={(ev) => e.setFilters({ maxAge: Number(ev.target.value) })} style={{ direction: 'ltr' }} />
          </div>
          <Setting title={t('fOnlyMatched')}><Switch checked={f.onlyMatched} onChange={(v) => e.setFilters({ onlyMatched: v })} /></Setting>
          <Setting title={t('fOnlyAttention')}><Switch checked={f.onlyAttention} onChange={(v) => e.setFilters({ onlyAttention: v })} /></Setting>
          <Setting title={t('fHideMine')}><Switch checked={f.hideMine} onChange={(v) => e.setFilters({ hideMine: v })} /></Setting>
          <Setting title={t('fHideRandom')}><Switch checked={f.hideRandom} onChange={(v) => e.setFilters({ hideRandom: v })} /></Setting>
        </div>
        <div>
          <div className="row" style={{ margin: '0 2px 8px' }}>
            <b className="grow">{t('fClasses')}</b>
            <button className="btn sm ghost" onClick={() => e.setFilters({ classes: [] })}>{t('all')}</button>
          </div>
          <div className="row wrap">
            {CLASSES.map((c) => (
              <button key={c} className={'chip' + (f.classes.includes(c) ? ' on' : '')} aria-pressed={f.classes.includes(c)} onClick={() => toggleClass(c)}>
                <Icon name={CLASS_ICON[c]} size={14} />{t.cls(c)}
              </button>
            ))}
          </div>
        </div>
        <div className="card card-pad">
          <h3>{t('fPresets')}</h3>
          <div className="row wrap" style={{ marginBottom: 10 }}>
            {presets.length === 0 && <span className="small faint">—</span>}
            {presets.map((p, i) => (
              <span key={i} className="chip">
                <button className="btn sm ghost" style={{ padding: 0, minHeight: 0 }} onClick={() => e.setFilters({ ...p.filters })}>{p.name}</button>
                <button className="btn sm ghost icon" style={{ minHeight: 0, width: 18 }} aria-label={t('delete')} onClick={() => e.set({ presets: presets.filter((_, j) => j !== i) })}><Icon name="x" size={12} /></button>
              </span>
            ))}
          </div>
          <div className="row">
            <input className="input grow" placeholder={t('presetName')} aria-label={t('presetName')} value={presetName} onChange={(ev) => setPresetName(ev.target.value)} />
            <button className="btn" disabled={!presetName.trim()} onClick={() => { e.set({ presets: [...presets, { name: presetName.trim(), filters: { ...f, q: '' } }] }); setPresetName('') }}>{t('save')}</button>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
