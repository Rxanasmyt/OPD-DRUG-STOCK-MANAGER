import { MinusIcon, PlusIcon } from './Icons'

/** ปุ่ม +/- ปรับจำนวนแบบแตะเดียว ลดการพิมพ์ตัวเลขหน้างาน */
export default function QtyStepper({ value, onChange, step = 1, min = 0, max, unit }) {
  function set(next) {
    let n = next
    if (min !== undefined) n = Math.max(min, n)
    if (max !== undefined) n = Math.min(max, n)
    onChange(n)
  }

  return (
    <div className="stepper">
      <button type="button" onClick={() => set((Number(value) || 0) - step)} aria-label="ลดจำนวน">
        <MinusIcon width={20} height={20} />
      </button>
      <input
        className="input"
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        min={min}
        max={max}
      />
      <button type="button" onClick={() => set((Number(value) || 0) + step)} aria-label="เพิ่มจำนวน">
        <PlusIcon width={20} height={20} />
      </button>
      {unit && <span className="text-muted text-sm" style={{ minWidth: 40 }}>{unit}</span>}
    </div>
  )
}
