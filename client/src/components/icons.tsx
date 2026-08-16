/**
 * 轻量内联 SVG 图标（stroke 风格，currentColor 跟随文字颜色）
 * 替代 emoji：跨平台渲染一致、可精确控制大小与颜色
 */
interface IconProps {
    size?: number;
    className?: string;
}

function svgProps(size: number, className?: string) {
    return {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
        className,
        'aria-hidden': true,
    };
}

/** 太阳（浅色） */
export function SunIcon({ size = 20, className }: IconProps) {
    return (
        <svg {...svgProps(size, className)}>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
    );
}

/** 月亮（深色） */
export function MoonIcon({ size = 20, className }: IconProps) {
    return (
        <svg {...svgProps(size, className)}>
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
    );
}

/** 显示器（跟随系统） */
export function MonitorIcon({ size = 20, className }: IconProps) {
    return (
        <svg {...svgProps(size, className)}>
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <path d="M8 21h8M12 17v4" />
        </svg>
    );
}
