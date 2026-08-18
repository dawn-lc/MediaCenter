interface Props {
    checked: boolean;
    onChange: (checked: boolean) => void;
    ariaLabel?: string;
    disabled?: boolean;
}

/**
 * 开关（toggle switch）组件
 * - 保留原生 checkbox 输入（视觉隐藏），保证可访问性与键盘操作
 * - 视觉为「轨道 + 滑块」，checked 时滑块右移并点亮主题色
 */
export default function ToggleSwitch({ checked, onChange, ariaLabel, disabled }: Props) {
    return (
        <label className={`switch${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}`}>
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                disabled={disabled}
                aria-label={ariaLabel}
            />
            <span className="switch-track" aria-hidden="true">
                <span className="switch-thumb" />
            </span>
        </label>
    );
}
