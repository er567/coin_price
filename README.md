# 加密货币价格监控与趋势分析工具

基于 Node.js 的多币种加密货币价格监控与趋势分析工具，支持实时价格追踪、技术指标分析和智能交易信号推送。

## 功能特点

- **多币种监控**：同时监控多个加密货币价格变动
- **精确时间控制**：在特定时间点（0s, 20s, 40s）精确获取价格数据
- **增强趋势分析**：集成MACD、EMA、RSI等技术指标进行深度分析
- **智能交易信号**：根据多种技术指标生成BUY/SELL/HOLD交易信号，支持不同置信度等级
- **RSI超买超卖预警**：监测RSI指标，在超买或超卖区域发送预警
- **实时推送通知**：使用BARK App接收价格波动和交易信号通知
- **配置热更新**：无需重启即可更新监控配置
- **详细统计报告**：定期生成趋势状态、交易信号和RSI统计
- **错误处理机制**：包含重试逻辑和失败警告

## 技术指标

- **RSI（相对强弱指标）**：检测市场超买超卖状态
- **MACD（移动平均线收敛发散指标）**：识别价格动量变化
- **EMA（指数移动平均线）**：追踪价格趋势
- **SMA（简单移动平均线）**：计算价格均值
- **趋势强度分析**：基于线性回归斜率计算趋势强度
- **波动性分析**：计算价格标准差评估市场波动性
- **价格突破检测**：识别价格对移动平均线的突破

## 前置要求

- Node.js 14.0+
- BARK App（用于接收推送通知）
- Binance API 访问权限

## 快速开始

### 1. 安装依赖
```bash
npm install axios
```

### 2. 配置参数
创建或修改 `crypto-tracker-config.json` 配置文件：

```json
{
  "COINS": [
    { "symbol": "PIEVERSEUSDT", "name": "PIEVERSE" }
    // 添加更多币种...
  ],
  "REST_BASE_URL": "https://fapi.binance.com",
  "PRICE_CHANGE_THRESHOLD": 0.04,
  "PUSH_API_KEY": ["你的BARK_API_KEY1", "你的BARK_API_KEY2"],
  "PUSH_API_URL": "https://api.day.app",
  "MAX_FAILED_ATTEMPTS": 10,
  "TIME_CONTROL": {
    "INTERVAL": 10000,
    "SYNC_INTERVAL": 1000,
    "TARGET_SECONDS": [0, 10, 20, 30, 40, 50],
    "ALLOWED_TIME_DEVIATION": 500
  },
  "TREND_ANALYSIS": {
    "TIME_WINDOW": 30,
    "MIN_DATA_POINTS": 8,
    "TREND_THRESHOLD": 0.015,
    "VOLATILITY_THRESHOLD": 0.03,
    "BREAKOUT_THRESHOLD": 0.025,
    "RSI_PERIOD": 14,
    "RSI_OVERBOUGHT": 80,
    "RSI_OVERSOLD": 20,
    "RSI_ALERT_COOLDOWN": 300000,
    "ENHANCED_TREND": {
      "LONG_MOMENTUM_THRESHOLD": 0.02,
      "MACD_HIST_WEAK": 0,
      "MACD_HIST_STRONG": 0.001,
      "MIN_DATA_POINTS_FOR_MACD": 26
    }
  }
}
```

### 3. 运行监控
```bash
node analysis.js
```

## 配置说明

### 基础配置

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `COINS` | 监控币种列表，包含symbol和name字段 | - |
| `REST_BASE_URL` | Binance API基础URL | https://fapi.binance.com |
| `PRICE_CHANGE_THRESHOLD` | 价格变化阈值（触发提醒） | 0.04 (4%) |
| `PUSH_API_KEY` | BARK推送API Key列表 | - |
| `PUSH_API_URL` | BARK API URL | https://api.day.app |
| `MAX_FAILED_ATTEMPTS` | 最大失败尝试次数 | 10 |

### 时间控制配置

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `TIME_CONTROL.INTERVAL` | 主监控间隔（毫秒） | 10000 |
| `TIME_CONTROL.SYNC_INTERVAL` | 时间同步间隔（毫秒） | 1000 |
| `TIME_CONTROL.TARGET_SECONDS` | 目标秒数点 | [0, 10, 20, 30, 40, 50] |
| `TIME_CONTROL.ALLOWED_TIME_DEVIATION` | 允许的时间偏差（毫秒） | 500 |

### 趋势分析配置

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `TREND_ANALYSIS.TIME_WINDOW` | 趋势分析时间窗口（分钟） | 30 |
| `TREND_ANALYSIS.MIN_DATA_POINTS` | 最小数据点数 | 8 |
| `TREND_ANALYSIS.TREND_THRESHOLD` | 趋势阈值 | 0.015 |
| `TREND_ANALYSIS.VOLATILITY_THRESHOLD` | 波动性阈值 | 0.03 |
| `TREND_ANALYSIS.BREAKOUT_THRESHOLD` | 突破阈值 | 0.025 |
| `TREND_ANALYSIS.RSI_PERIOD` | RSI计算周期 | 14 |
| `TREND_ANALYSIS.RSI_OVERBOUGHT` | RSI超买阈值 | 80 |
| `TREND_ANALYSIS.RSI_OVERSOLD` | RSI超卖阈值 | 20 |
| `TREND_ANALYSIS.RSI_ALERT_COOLDOWN` | RSI提醒冷却时间（毫秒） | 300000 (5分钟) |

### 增强趋势分析配置

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `ENHANCED_TREND.LONG_MOMENTUM_THRESHOLD` | 长周期动量阈值 | 0.02 (2%) |
| `ENHANCED_TREND.MACD_HIST_WEAK` | 弱MACD直方图阈值 | 0 |
| `ENHANCED_TREND.MACD_HIST_STRONG` | 强MACD直方图阈值 | 0.001 |
| `ENHANCED_TREND.MIN_DATA_POINTS_FOR_MACD` | MACD计算最小数据点数 | 26 |

## 推送设置

1. 在iOS设备上安装BARK App
2. 获取BARK API Key
3. 将API Key添加到配置文件的`PUSH_API_KEY`数组中
4. 支持多个API Key，可实现多设备同时接收通知

## 使用示例

### 基本使用
```javascript
const { MultiCryptoPriceMonitor } = require('./analysis');

// 创建实例
const monitor = new MultiCryptoPriceMonitor();

// 开始监控
monitor.startMonitoring();
```

### 自定义配置使用
```javascript
const { MultiCryptoPriceMonitor } = require('./analysis');

// 自定义配置
const customConfig = {
  COINS: [
    { symbol: 'BTCUSDT', name: '比特币' },
    { symbol: 'ETHUSDT', name: '以太坊' }
  ],
  PRICE_CHANGE_THRESHOLD: 0.05,
  // 其他配置...
};

// 使用自定义配置创建实例
const monitor = new MultiCryptoPriceMonitor(customConfig);
monitor.startMonitoring();
```

## 输出示例

### 启动日志
```
初始化多币种价格监控器，共监控 1 个币种:
  1. PIEVERSE (PIEVERSEUSDT)
精确时间控制: 每20秒获取价格 (0s, 10s, 20s, 30s, 40s, 50s)
趋势分析窗口: 30分钟
RSI周期: 14，超买: 80，超卖: 20
增强趋势分析: MACD + EMA + 动量分析
[09:39:15.078] 🚀 开始收集所有币种初始价格数据...
[09:39:15.078] 正在获取PIEVERSE(PIEVERSEUSDT)初始价格...
[09:39:16.123] ✅ PIEVERSE初始价格获取成功: 0.12345 USDT
[09:39:16.123] ✅ 所有币种初始价格收集完成
[09:39:16.123] 所有币种初始价格已获取，准备开始精确时间监控
[09:39:16.124] 📨 推送通知发送成功给 XXXXXXXX...
[09:39:16.124] 🎯 等待下一个整20秒时间点开始精确监控...
[09:39:16.124] ⏰ 距离下一个目标时间点还有 3876ms
```

### 交易信号通知
```
[09:45:20.135] 📊 PIEVERSE趋势分析: UPTREND | 变化: 2.56% | 强度: 0.0023 | RSI: 58.45
[09:45:20.142] 📨 推送通知发送成功给 XXXXXXXX...
[09:45:20.142] ✅ 已发送PIEVERSE交易信号: BUY (HIGH)
```

### 定期统计报告
```
=== 精确监控统计 ===
总币种数: 1
上涨趋势: 1
下跌趋势: 0
中性趋势: 0
买入信号: 1
卖出信号: 0
观望信号: 0
超买币种: 0
超卖币种: 0
获取次数: { 'PIEVERSE': 15 }
===================
```

## 故障排除

**常见问题：**
- **推送通知失败**：检查BARK API Key是否正确，BARK App是否正常运行
- **价格获取失败**：确认币种符号格式是否正确，交易所API是否可达
- **技术指标计算错误**：确保收集了足够的数据点（MACD至少需要26个数据点）
- **配置更新不生效**：配置热更新需要10秒时间检测，耐心等待
- **请求限制问题**：如果遇到API请求限制，可增加币种间的随机延迟

## 高级功能

### 配置热更新
工具支持配置文件热更新，修改`crypto-tracker-config.json`后无需重启即可应用新配置：

1. 修改配置文件中的参数
2. 系统会在10秒内自动检测到配置变化
3. 配置更新后会发送通知确认

### 交易信号系统

交易信号基于多种技术指标综合分析，包括：

- **信号类型**：BUY（买入）、SELL（卖出）、HOLD（观望）
- **置信度等级**：CONVICTION（强确信）、HIGH（高）、MEDIUM（中）、LOW（低）
- **信号理由**：详细的技术指标依据说明

## 代码结构

- **MultiCryptoPriceMonitor**：主监控类，负责价格获取和监控流程
- **EnhancedTrendAnalyzer**：增强趋势分析器，负责计算技术指标和生成交易信号
- **配置管理**：支持配置加载、热更新和默认配置生成
- **通知系统**：处理价格波动、趋势变化和交易信号的推送

## 免责声明

本工具仅用于技术学习和市场分析，不构成投资建议。加密货币市场波动剧烈，投资存在高风险，请谨慎决策。

## 注意事项

- 遵守Binance API使用条款，避免频繁请求导致IP被封禁
- 建议在非交易高峰期运行监控，减少API请求限制风险
- 定期检查配置文件，确保监控参数符合当前市场状况
- 技术指标分析具有滞后性，仅供参考，不保证预测准确性

---

**版本信息**：v1.0.0 | 作者：zgc | 最后更新：2025-11-26
