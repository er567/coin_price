# 加密货币价格监控与波动提醒工具

基于 Node.js 的多币种加密货币价格监控工具，支持实时价格追踪和波动提醒推送。

## 功能特点

- **多币种监控**：同时监控多个加密货币价格
- **智能提醒**：价格波动超过阈值自动推送
- **稳定可靠**：错误重试机制和失败警告
- **实时监控**：轮询获取最新价格数据
- **详细日志**：完整运行状态记录

## 前置要求

- Node.js 14.0+
- BARK App（接收推送）

## 快速开始

### 1. 安装依赖
```bash
npm install axios
```

### 2. 配置参数
修改 `crypto-tracker.js` 中的配置：

```javascript
const CONFIG = {
  COINS: [
    { symbol: 'BEATUSDT', name: 'BEAT' },
    { symbol: 'TNSRUSDT', name: 'TNSR' },
    // 添加更多币种...
  ],
  CHECK_INTERVAL: 20000,          // 监控间隔（毫秒）
  PRICE_CHANGE_THRESHOLD: 0.02,   // 价格变化阈值（2%）
  PUSH_API_KEY: '你的BARK_API_KEY',
};
```

### 3. 运行监控
```bash
node crypto-tracker.js
```

## 配置说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `COINS` | 监控币种列表 | - |
| `CHECK_INTERVAL` | 监控间隔（毫秒） | 20000 |
| `PRICE_CHANGE_THRESHOLD` | 价格变化阈值 | 0.02 |
| `PUSH_API_KEY` | BARK推送API Key | - |
| `MAX_FAILED_ATTEMPTS` | 最大失败次数 | 5 |
| `COIN_FETCH_DELAY` | 币种间延迟（毫秒） | 5000 |

## 推送设置

1. iOS安装BARK App
2. 获取BARK API Key
3. 填入配置中的 `PUSH_API_KEY`

## 使用示例

```javascript
const { MultiCryptoPriceMonitor } = require('./crypto-tracker');

// 创建实例
const monitor = new MultiCryptoPriceMonitor();

// 开始监控
monitor.startMonitoring();
```

## 输出示例

```
初始化多币种价格监控器，共监控 2 个币种:
  1. BEAT (BEATUSDT)
  2. TNSR (TNSRUSDT)

[2025-11-06 10:15:30] 开始监控2个币种价格...
[2025-11-06 10:15:31] BEAT价格: 0.12345 USDT
[2025-11-06 10:15:37] TNSR价格: 1.23456 USDT
```

## 故障排除

**常见问题：**
- 推送通知失败：检查BARK API Key
- 价格获取失败：确认币种符号格式正确
- 请求限制：增加监控间隔时间

## 免责声明

本工具仅用于技术学习，不构成投资建议。加密货币投资存在高风险，请谨慎决策。

---

**注意**：遵守交易所API使用条款，避免频繁请求导致IP被封禁。
