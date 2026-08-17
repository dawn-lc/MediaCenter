/**
 * 前端通用配置常量
 */

// ── 分页 ──
/** 管理后台列表每页条目数 */
export const ADMIN_PAGE_SIZE = 20;
/** 首页媒体列表每页条目数 */
export const HOME_PAGE_SIZE = 18;

// ── 时长 ──
/** Toast 提示默认显示时长（毫秒） */
export const TOAST_DURATION = 8000;
/** Modal 关闭动画持续时间（毫秒） */
export const MODAL_CLOSE_MS = 200;
/** 图片自动播放轮播间隔（毫秒） */
export const IMAGE_SLIDE_INTERVAL_MS = 1000;

// ── 防抖 ──
/** 本地存储防抖写入延迟（毫秒） */
export const DEBOUNCE_MS = 300;

// ── 签名 URL ──
/** 签名 URL 最小余量 TTL（秒），低于此值刷新 */
export const SIGN_URL_TTL_MARGIN = 30;
/** 签名 URL 中 expires 参数名 */
export const SIGN_URL_EXPIRES_PARAM = 'expires';

// ── 存储 ──
/** localStorage key 前缀 */
export const STORAGE_PREFIX = 'mediacenter_';

// ── 缩略图 ──
/** 缩略图宽度（与后端服务端生成一致） */
export const THUMBNAIL_WIDTH = 380;

// ── 播放列表虚拟滚动 ──
/** 列表项高度（px） */
export const LIST_ITEM_HEIGHT = 40;
/** 虚拟滚动上下额外渲染项数 */
export const VIRTUAL_SCROLL_OVERSCAN = 15;
/** 自定义滚动条宽度（px） */
export const SCROLLBAR_WIDTH = 8;
/** 鼠标滚轮每次滚动步进项数 */
export const WHEEL_STEP = 3;

// ── 播放器默认值 ──
/** 竖屏视频最大高度占视口比例 */
export const PORTRAIT_VIDEO_MAX_HEIGHT_RATIO = 0.85;
/** 视频画面拖动调整进度：激活拖拽的最小水平位移（px） */
export const VIDEO_DRAG_SEEK_THRESHOLD = 12;
/** 视频画面双击判定间隔（ms）：两次点击间隔小于该值视为双击（越大双击越易触发） */
export const VIDEO_DOUBLE_CLICK_MS = 400;
/** 默认播放速度 */
export const DEFAULT_PLAYBACK_RATE = 1;
/** 默认音量 */
export const DEFAULT_VOLUME = 1;
/** 默认自动播放视频 */
export const DEFAULT_AUTO_PLAY_VIDEO = true;
/** 默认图片停留时长（秒），0 表示不自动切换 */
export const DEFAULT_STATIC_IMAGE_DURATION = 0;

// ── 默认排序 ──
/** 首页默认排序字段 */
export const DEFAULT_SORT_FIELD = 'createdAt';
/** 首页默认排序方向 */
export const DEFAULT_SORT_ORDER = 'desc';

// ── 其他 ──
/** Toast 之间的间距（px） */
export const TOAST_GAP = 8;
/** 文件大小换算基数 */
export const BYTE_BASE = 1024;
/** 文件大小单位列表 */
export const BYTE_UNITS: readonly string[] = ['B', 'KB', 'MB', 'GB', 'TB'];
/** 「刚刚」时间阈值（毫秒） */
export const JUST_NOW_THRESHOLD_MS = 60_000;
/**
 * 标签表达式最大长度（字符）
 * ⚠️ 必须与后端 src/config.ts 中 maxExprLength 保持一致
 */
export const TAG_EXPR_MAX_LENGTH = 512;
/**
 * 标签表达式最大嵌套深度
 * ⚠️ 必须与后端 src/config.ts 中 maxDepth 保持一致
 */
export const TAG_EXPR_MAX_DEPTH = 32;
