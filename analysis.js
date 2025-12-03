/**
 * @Author: zgc zgc7788@gmail.com
 * @Date: 2025-11-06 09:39:12
 * @LastEditors: zgc zgc7788@gmail.com
 * @LastEditTime: 2025-11-26 11:30:55
 * @FilePath: \test\crypto-tracker.js
 * @Description: 加密货币价格监控与趋势分析工具 - 多币种版本（含RSI指标、增强趋势分析和模拟交易）
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// 配置文件路径
const CONFIG_FILE_PATH = path.join(__dirname, 'crypto-tracker-config.json');

// 默认配置（备用）
const DEFAULT_CONFIG = {
  COINS: [
    { symbol: 'PIEVERSEUSDT', name: 'PIEVERSE' },
  ],
  REST_BASE_URL: 'https://fapi.binance.com',
  PRICE_CHANGE_THRESHOLD: 0.04,
  PUSH_API_KEY: ['HNfKcdiSRkB2MUpWS6CNCj', 'npcnSihKPidjybmp8kiDR3'],
  PUSH_API_URL: 'https://api.day.app',
  MAX_FAILED_ATTEMPTS: 10,
  TIME_CONTROL: {
    INTERVAL: 10000,
    SYNC_INTERVAL: 1000,
    TARGET_SECONDS: [0, 10, 20, 30, 40, 50],
    ALLOWED_TIME_DEVIATION: 500
  },
  TREND_ANALYSIS: {
    TIME_WINDOW: 30,
    MIN_DATA_POINTS: 8,
    TREND_THRESHOLD: 0.015,
    VOLATILITY_THRESHOLD: 0.03,
    BREAKOUT_THRESHOLD: 0.025,
    RSI_PERIOD: 14,
    RSI_OVERBOUGHT: 80,
    RSI_OVERSOLD: 20,
    RSI_ALERT_COOLDOWN: 300000,

    // 优化增强趋势分析配置
    ENHANCED_TREND: {
      LONG_MOMENTUM_THRESHOLD: 0.02,
      MACD_HIST_WEAK: 0,
      MACD_HIST_STRONG: 0.001,
      MIN_DATA_POINTS_FOR_MACD: 26,

      // 新增MCAD转折点配置
      MCAD_TURNING_POINT: {
        ZERO_CROSS_THRESHOLD: 0.0005,     // 零轴交叉阈值
        DIVERGENCE_LOOKBACK: 5,           // 背离检测回看周期
        HISTOGRAM_REVERSAL_RATIO: 0.3,    // 直方图反转比例
        CONFIRMATION_CANDLES: 2           // 确认K线数量
      },

      // 新增布林带配置
      BOLLINGER_BANDS: {
        PERIOD: 20,
        STD_DEV: 2,
        BAND_SQUEEZE_THRESHOLD: 0.1       // 布林带收缩阈值
      },

      // 新增KDJ配置
      KDJ: {
        PERIOD: 9,
        SLOW_K: 3,
        SLOW_D: 3
      }
    }
  },
  TRADING: {
    DEFAULT_POSITION_SIZE: 100,
    DEFAULT_LEVERAGE: 1,
    TAKE_PROFIT_RATIO: 0.02,
    STOP_LOSS_RATIO: 0.01,
    MAX_TRADES_PER_COIN: 3,
    MIN_SIGNAL_INTERVAL: 180000,
    TRADE_LOG_FILE: "trading_log.json",

    // 新增转折点交易配置
    TURNING_POINT_TRADING: {
      BOTTOM_CONFIRMATION_CANDLES: 2,     // 底部确认K线数
      TOP_CONFIRMATION_CANDLES: 1,        // 顶部确认K线数
      REENTRY_ALLOWANCE: 0.005,           // 重新入场允许偏差
      STOP_LOSS_TIGHTENING: 0.5           // 止损收紧系数
    }
  }
};

/**
 * 增强趋势分析器（优化版）
 */
class EnhancedTrendAnalyzer {
  constructor(config) {
    this.config = config;
    this.priceCache = new Map(); // 缓存价格数据
  }

  /**
   * 计算EMA（指数移动平均）
   */
  calculateEMA(prices, period) {
    if (prices.length < period) return null;

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * 计算SMA（简单移动平均）
   */
  calculateSMA(prices) {
    if (prices.length === 0) return null;
    return prices.reduce((a, b) => a + b, 0) / prices.length;
  }

  /**
   * 计算标准偏差
   */
  calculateStdDev(prices, mean) {
    const squareDiffs = prices.map(price => {
      const diff = price - mean;
      return diff * diff;
    });
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / prices.length;
    return Math.sqrt(avgSquareDiff);
  }

  /**
   * 计算布林带
   */
  calculateBollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) return null;

    const recentPrices = prices.slice(-period);
    const middle = this.calculateSMA(recentPrices);
    const std = this.calculateStdDev(recentPrices, middle);

    return {
      upper: middle + (std * stdDev),
      middle: middle,
      lower: middle - (std * stdDev),
      bandwidth: ((std * stdDev * 2) / middle) * 100, // 带宽百分比
      squeeze: ((std * stdDev * 2) / middle) < this.config.ENHANCED_TREND.BOLLINGER_BANDS.BAND_SQUEEZE_THRESHOLD
    };
  }

  /**
   * 计算KDJ指标
   */
  calculateKDJ(prices, highPrices, lowPrices, period = 9, slowK = 3, slowD = 3) {
    if (prices.length < period || highPrices.length < period || lowPrices.length < period) {
      return null;
    }

    const recentPrices = prices.slice(-period);
    const recentHighs = highPrices.slice(-period);
    const recentLows = lowPrices.slice(-period);

    const highestHigh = Math.max(...recentHighs);
    const lowestLow = Math.min(...recentLows);

    if (highestHigh === lowestLow) return null;

    const currentPrice = recentPrices[recentPrices.length - 1];
    const rsv = ((currentPrice - lowestLow) / (highestHigh - lowestLow)) * 100;

    // 简化计算K和D
    const k = rsv; // 这里简化处理，实际需要递归计算
    const d = k;   // 简化处理
    const j = 3 * k - 2 * d;

    return {
      k: k,
      d: d,
      j: j,
      overbought: k > 80,
      oversold: k < 20,
      bullishCross: k > d && (k - d) > 5, // K线上穿D线
      bearishCross: k < d && (d - k) > 5  // K线下穿D线
    };
  }

  /**
   * 计算MACD（增强版）
   */
  calculateMACD(prices) {
    if (prices.length < 26) return null;

    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);

    if (ema12 === null || ema26 === null) return null;

    const macdLine = ema12 - ema26;

    // 计算信号线（9周期EMA of MACD）
    const macdValues = [];
    const tempPrices = [...prices];

    // 简化计算：计算最近9个点的MACD值平均
    for (let i = 0; i < 9; i++) {
      if (tempPrices.length < 26) break;
      const tempEma12 = this.calculateEMA(tempPrices.slice(0, 26), 12);
      const tempEma26 = this.calculateEMA(tempPrices.slice(0, 26), 26);
      if (tempEma12 && tempEma26) {
        macdValues.push(tempEma12 - tempEma26);
      }
      tempPrices.shift();
    }

    const signalLine = macdValues.length > 0 ?
      this.calculateSMA(macdValues) : macdLine * 0.9; // 简化处理

    const histogram = macdLine - signalLine;

    return {
      macd: macdLine,
      signal: signalLine,
      histogram: histogram,
      histogramChange: this.calculateHistogramChange(histogram, prices),
      zeroCross: this.detectZeroCross(macdLine, signalLine),
      bullishDivergence: this.detectBullishDivergence(prices, macdLine),
      bearishDivergence: this.detectBearishDivergence(prices, macdLine)
    };
  }

  /**
   * 计算直方图变化
   */
  calculateHistogramChange(currentHistogram, prices) {
    if (prices.length < 2) return 0;

    // 计算前一个MACD直方图值（简化）
    const prevPrices = prices.slice(0, -1);
    if (prevPrices.length < 26) return 0;

    const prevMacd = this.calculateMACD(prevPrices);
    if (!prevMacd) return 0;

    return currentHistogram - prevMacd.histogram;
  }

  /**
   * 检测零轴交叉
   */
  detectZeroCross(macdLine, signalLine) {
    const threshold = this.config.ENHANCED_TREND.MCAD_TURNING_POINT.ZERO_CROSS_THRESHOLD;

    return {
      bullish: macdLine > threshold && signalLine > threshold && macdLine > signalLine,
      bearish: macdLine < -threshold && signalLine < -threshold && macdLine < signalLine,
      crossingUp: macdLine > 0 && signalLine < 0 && macdLine > signalLine,
      crossingDown: macdLine < 0 && signalLine > 0 && macdLine < signalLine
    };
  }

  /**
   * 检测看涨背离（价格新低，MACD新高）
   */
  detectBullishDivergence(prices, currentMacd) {
    const lookback = this.config.ENHANCED_TREND.MCAD_TURNING_POINT.DIVERGENCE_LOOKBACK;
    if (prices.length < lookback * 2) return false;

    const recentPrices = prices.slice(-lookback * 2);
    const lowestPrice = Math.min(...recentPrices.slice(0, lookback));
    const currentPrice = recentPrices[recentPrices.length - 1];

    // 价格创新低但MACD没有新低
    return currentPrice < lowestPrice && currentMacd > 0;
  }

  /**
   * 检测看跌背离（价格新高，MACD新低）
   */
  detectBearishDivergence(prices, currentMacd) {
    const lookback = this.config.ENHANCED_TREND.MCAD_TURNING_POINT.DIVERGENCE_LOOKBACK;
    if (prices.length < lookback * 2) return false;

    const recentPrices = prices.slice(-lookback * 2);
    const highestPrice = Math.max(...recentPrices.slice(0, lookback));
    const currentPrice = recentPrices[recentPrices.length - 1];

    // 价格创新高但MACD没有新高
    return currentPrice > highestPrice && currentMacd < 0;
  }

  /**
   * 计算RSI
   */
  calculateRSI(priceChanges, period = 14) {
    if (priceChanges.length < period) {
      return null;
    }

    const recentChanges = priceChanges.slice(-period);

    let gains = 0;
    let losses = 0;

    for (const change of recentChanges) {
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) {
      return 100;
    }

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return rsi;
  }

  /**
   * 检测趋势转折点（核心功能）
   */
  detectTurningPoints(priceHistory, macdAnalysis, currentPrice) {
    if (priceHistory.length < 10) return null;

    const turningPoints = {
      potentialBottom: false,
      potentialTop: false,
      bottomConfidence: 0,
      topConfidence: 0,
      reasons: [],
      supportingIndicators: {}
    };

    const prices = priceHistory.map(item => item.price);
    const recentPrices = prices.slice(-5);
    const macd = macdAnalysis;

    // 1. 检测潜在底部
    const bottomSignals = this.detectPotentialBottom(prices, macd, currentPrice);
    if (bottomSignals.found) {
      turningPoints.potentialBottom = true;
      turningPoints.bottomConfidence = bottomSignals.confidence;
      turningPoints.reasons.push(...bottomSignals.reasons);
      turningPoints.supportingIndicators.bottom = bottomSignals.indicators;
    }

    // 2. 检测潜在顶部
    const topSignals = this.detectPotentialTop(prices, macd, currentPrice);
    if (topSignals.found) {
      turningPoints.potentialTop = true;
      turningPoints.topConfidence = topSignals.confidence;
      turningPoints.reasons.push(...topSignals.reasons);
      turningPoints.supportingIndicators.top = topSignals.indicators;
    }

    return turningPoints;
  }

  /**
   * 检测潜在底部
   */
  detectPotentialBottom(prices, macd, currentPrice) {
    const result = {
      found: false,
      confidence: 0,
      reasons: [],
      indicators: {}
    };

    if (prices.length < 10 || !macd) return result;

    const recentPrices = prices.slice(-5);
    const lowestRecent = Math.min(...recentPrices);
    const priceChange = ((currentPrice - lowestRecent) / lowestRecent) * 100;

    // 底部信号条件
    const conditions = [];

    // 1. MACD看涨背离
    if (macd.bullishDivergence) {
      conditions.push({ name: 'MACD看涨背离', weight: 30 });
      result.indicators.macdDivergence = true;
    }

    // 2. MACD零轴下方向上交叉
    if (macd.zeroCross && macd.zeroCross.crossingUp) {
      conditions.push({ name: 'MACD零轴上穿', weight: 25 });
      result.indicators.macdCrossUp = true;
    }

    // 3. RSI超卖（需要额外传入priceChanges）
    // 这里简化处理，实际需要计算RSI
    if (priceChange > 2) { // 假设从低点反弹超过2%
      conditions.push({ name: '价格反弹', weight: 20 });
      result.indicators.priceRecovery = true;
    }

    // 4. 成交量增加（这里简化，实际需要成交量数据）
    result.indicators.volumeIncrease = true; // 假设

    // 5. MACD直方图反转
    if (macd.histogramChange > 0 && macd.histogram < 0) {
      conditions.push({ name: 'MACD直方图反转', weight: 15 });
      result.indicators.histogramReversal = true;
    }

    // 计算置信度
    if (conditions.length >= 2) {
      result.found = true;
      result.confidence = conditions.reduce((sum, cond) => sum + cond.weight, 0);
      result.reasons = conditions.map(cond => cond.name);
    }

    return result;
  }

  /**
   * 检测潜在顶部
   */
  detectPotentialTop(prices, macd, currentPrice) {
    const result = {
      found: false,
      confidence: 0,
      reasons: [],
      indicators: {}
    };

    if (prices.length < 10 || !macd) return result;

    const recentPrices = prices.slice(-5);
    const highestRecent = Math.max(...recentPrices);
    const priceChange = ((currentPrice - highestRecent) / highestRecent) * 100;

    // 顶部信号条件
    const conditions = [];

    // 1. MACD看跌背离
    if (macd.bearishDivergence) {
      conditions.push({ name: 'MACD看跌背离', weight: 30 });
      result.indicators.macdDivergence = true;
    }

    // 2. MACD零轴上方向下交叉
    if (macd.zeroCross && macd.zeroCross.crossingDown) {
      conditions.push({ name: 'MACD零轴下穿', weight: 25 });
      result.indicators.macdCrossDown = true;
    }

    // 3. RSI超买（需要额外传入priceChanges）
    if (priceChange < -2) { // 假设从高点回落超过2%
      conditions.push({ name: '价格回落', weight: 20 });
      result.indicators.priceDecline = true;
    }

    // 4. MACD直方图反转
    if (macd.histogramChange < 0 && macd.histogram > 0) {
      conditions.push({ name: 'MACD直方图反转', weight: 15 });
      result.indicators.histogramReversal = true;
    }

    // 5. 布林带上轨压力
    const bollinger = this.calculateBollingerBands(prices);
    if (bollinger && currentPrice >= bollinger.upper) {
      conditions.push({ name: '布林带上轨压力', weight: 10 });
      result.indicators.bollingerUpper = true;
    }

    // 计算置信度
    if (conditions.length >= 2) {
      result.found = true;
      result.confidence = conditions.reduce((sum, cond) => sum + cond.weight, 0);
      result.reasons = conditions.map(cond => cond.name);
    }

    return result;
  }

  /**
   * 增强趋势分析（包含转折点检测）
   */
  analyzeEnhancedTrend(trendData, currentPrice, priceChanges) {
    if (trendData.length < this.config.ENHANCED_TREND.MIN_DATA_POINTS_FOR_MACD) {
      return null;
    }

    const prices = trendData.map(item => item.price);

    // 计算各种技术指标
    const smaShort = this.calculateSMA(prices.slice(-10));
    const smaMedium = this.calculateSMA(prices.slice(-20));
    const smaLong = this.calculateSMA(prices);
    const emaFast = this.calculateEMA(prices, 12);
    const emaSlow = this.calculateEMA(prices, 26);
    const macd = this.calculateMACD(prices);
    const rsi = this.calculateRSI(priceChanges);
    const bollinger = this.calculateBollingerBands(prices);

    // 检测转折点
    const turningPoints = this.detectTurningPoints(trendData, macd, currentPrice);

    const longMomentumRatio = currentPrice / smaLong;

    return {
      prices: prices,
      currentPrice: currentPrice,
      sma: { short: smaShort, medium: smaMedium, long: smaLong },
      ema: { fast: emaFast, slow: emaSlow },
      macd: macd,
      bollinger: bollinger,
      rsi: rsi,
      longMomentumRatio: longMomentumRatio,
      turningPoints: turningPoints, // 新增转折点分析
      timestamp: new Date().getTime()
    };
  }

  /**
   * 生成交易信号（优化版，包含转折点信号）
   */
  generateTradingSignal(analysis) {
    if (!analysis) return null;

    const {
      currentPrice,
      sma,
      ema,
      macd,
      bollinger,
      rsi,
      longMomentumRatio,
      turningPoints
    } = analysis;

    const THRESHOLDS = {
      LONG_MOMENTUM: this.config.ENHANCED_TREND.LONG_MOMENTUM_THRESHOLD,
      RSI_OVERBOUGHT: this.config.RSI_OVERBOUGHT,
      RSI_OVERSOLD: this.config.RSI_OVERSOLD,
      MACD_HIST_WEAK: this.config.ENHANCED_TREND.MACD_HIST_WEAK,
      MACD_HIST_STRONG: this.config.ENHANCED_TREND.MACD_HIST_STRONG
    };

    // 检查技术条件
    const conditions = {
      // 多头条件
      longMomentum: longMomentumRatio > (1 + THRESHOLDS.LONG_MOMENTUM),
      emaBullish: ema.fast > ema.slow && currentPrice > ema.fast,
      macdBullish: macd && macd.histogram >= THRESHOLDS.MACD_HIST_WEAK,
      rsiNotOverbought: rsi < THRESHOLDS.RSI_OVERBOUGHT,
      macdZeroCrossUp: macd && macd.zeroCross && macd.zeroCross.crossingUp,
      potentialBottom: turningPoints && turningPoints.potentialBottom,

      // 空头条件
      shortMomentum: longMomentumRatio < (1 - THRESHOLDS.LONG_MOMENTUM),
      emaBearish: ema.fast < ema.slow && currentPrice < ema.fast,
      macdBearish: macd && macd.histogram <= THRESHOLDS.MACD_HIST_WEAK,
      rsiNotOversold: rsi > THRESHOLDS.RSI_OVERSOLD,
      macdZeroCrossDown: macd && macd.zeroCross && macd.zeroCross.crossingDown,
      potentialTop: turningPoints && turningPoints.potentialTop,

      // 强度条件
      strongBullishMACD: macd && macd.histogram >= THRESHOLDS.MACD_HIST_STRONG,
      strongBearishMACD: macd && macd.histogram <= -THRESHOLDS.MACD_HIST_STRONG,
      veryBullishMomentum: longMomentumRatio > (1 + THRESHOLDS.LONG_MOMENTUM * 2),
      veryBearishMomentum: longMomentumRatio < (1 - THRESHOLDS.LONG_MOMENTUM * 2)
    };

    // 计算信号强度
    let signal = 'HOLD';
    let confidence = 'LOW';
    let reason = [];
    let signalType = 'REGULAR'; // REGULAR 或 TURNING_POINT

    // 检查转折点信号（优先）
    if (conditions.potentialBottom && turningPoints.bottomConfidence > 50) {
      signal = 'BUY';
      confidence = turningPoints.bottomConfidence > 70 ? '极度确信' : '高';
      reason = [`底部转折点检测 (置信度: ${turningPoints.bottomConfidence})`, ...turningPoints.reasons];
      signalType = 'TURNING_POINT';

    } else if (conditions.potentialTop && turningPoints.topConfidence > 50) {
      signal = 'SELL';
      confidence = turningPoints.topConfidence > 70 ? '极度确信' : '高';
      reason = [`顶部转折点检测 (置信度: ${turningPoints.topConfidence})`, ...turningPoints.reasons];
      signalType = 'TURNING_POINT';

    } else {
      // 常规信号逻辑（原逻辑）
      const strongBullishConditions = [
        conditions.longMomentum,
        conditions.emaBullish,
        conditions.macdBullish,
        conditions.rsiNotOverbought
      ].filter(Boolean).length;

      const veryStrongBullish = strongBullishConditions >= 3 &&
        (conditions.strongBullishMACD || conditions.veryBullishMomentum);

      const strongBearishConditions = [
        conditions.shortMomentum,
        conditions.emaBearish,
        conditions.macdBearish,
        conditions.rsiNotOversold
      ].filter(Boolean).length;

      const veryStrongBearish = strongBearishConditions >= 3 &&
        (conditions.strongBearishMACD || conditions.veryBearishMomentum);

      if (veryStrongBullish) {
        signal = 'BUY';
        confidence = '极度确信';
        reason = ['强烈多头动量', 'EMA多头排列', 'MACD看涨', 'RSI健康'];
      } else if (strongBullishConditions >= 3) {
        signal = 'BUY';
        confidence = '高';
        reason = ['多头动量明显', 'EMA支持上涨', 'MACD转强'];
      } else if (strongBullishConditions >= 2) {
        signal = 'BUY';
        confidence = 'MEDIUM';
        reason = ['多头信号初现', '技术指标偏多'];
      } else if (veryStrongBearish) {
        signal = 'SELL';
        confidence = '极度确信';
        reason = ['强烈空头动量', 'EMA空头排列', 'MACD看跌', 'RSI健康'];
      } else if (strongBearishConditions >= 3) {
        signal = 'SELL';
        confidence = '高';
        reason = ['空头动量明显', 'EMA支持下跌', 'MACD转弱'];
      } else if (strongBearishConditions >= 2) {
        signal = 'SELL';
        confidence = 'MEDIUM';
        reason = ['空头信号初现', '技术指标偏空'];
      } else {
        const isNeutralMarket =
          Math.abs(longMomentumRatio - 1) < THRESHOLDS.LONG_MOMENTUM * 0.5 &&
          Math.abs(ema.fast - ema.slow) / currentPrice < 0.01 &&
          macd && Math.abs(macd.histogram) < THRESHOLDS.MACD_HIST_STRONG * 0.5 &&
          rsi > 40 && rsi < 60;

        if (isNeutralMarket) {
          signal = 'HOLD';
          confidence = 'MEDIUM';
          reason = ['市场震荡', '无明显趋势', '等待突破'];
        } else {
          signal = 'HOLD';
          confidence = 'LOW';
          reason = ['信号矛盾', '需要更多确认'];
        }
      }
    }

    return {
      signal,
      confidence,
      reason,
      signalType, // 新增：信号类型
      conditions: {
        longMomentum: conditions.longMomentum,
        emaBullish: conditions.emaBullish,
        macdBullish: conditions.macdBullish,
        shortMomentum: conditions.shortMomentum,
        emaBearish: conditions.emaBearish,
        macdBearish: conditions.macdBearish,
        potentialBottom: conditions.potentialBottom,
        potentialTop: conditions.potentialTop
      },
      technicals: {
        longMomentumRatio: (longMomentumRatio - 1) * 100,
        emaSpread: ema.fast - ema.slow,
        macdHistogram: macd ? macd.histogram : null,
        macdLine: macd ? macd.macd : null,
        signalLine: macd ? macd.signal : null,
        rsi: rsi,
        bollingerBandwidth: bollinger ? bollinger.bandwidth : null,
        turningPoints: turningPoints
      }
    };
  }
}

/**
 * 交易管理器
 */
class TradingManager {
  constructor(config) {
    this.config = config.TRADING || {
      DEFAULT_POSITION_SIZE: 100,
      DEFAULT_LEVERAGE: 1,
      TAKE_PROFIT_RATIO: 0.02,
      STOP_LOSS_RATIO: 0.01,
      MAX_TRADES_PER_COIN: 3,
      MIN_SIGNAL_INTERVAL: 180000
    };

    this.tradeCounter = 0;
  }

  /**
   * 创建交易ID
   */
  generateTradeId() {
    return `TRADE_${Date.now()}_${++this.tradeCounter}`;
  }

  /**
   * 开仓交易
   */
  openTrade(symbol, name, signal, entryPrice, confidence) {
    const tradeId = this.generateTradeId();
    const positionSize = this.config.DEFAULT_POSITION_SIZE;
    const leverage = this.config.DEFAULT_LEVERAGE;

    // 根据信号类型设置止盈止损
    const isLong = signal === 'BUY';
    const takeProfitPrice = isLong
      ? entryPrice * (1 + this.config.TAKE_PROFIT_RATIO)
      : entryPrice * (1 - this.config.TAKE_PROFIT_RATIO);

    const stopLossPrice = isLong
      ? entryPrice * (1 - this.config.STOP_LOSS_RATIO)
      : entryPrice * (1 + this.config.STOP_LOSS_RATIO);

    const trade = {
      id: tradeId,
      symbol: symbol,
      name: name,
      type: isLong ? 'LONG' : 'SHORT',
      entryPrice: entryPrice,
      positionSize: positionSize,
      leverage: leverage,
      takeProfitPrice: takeProfitPrice,
      stopLossPrice: stopLossPrice,
      entryTime: new Date().getTime(),
      entryTimeString: new Date().toLocaleString(),
      status: 'OPEN',
      currentPrice: entryPrice,
      currentProfit: 0,
      profitPercentage: 0,
      maxProfit: 0,
      maxLoss: 0,
      signalConfidence: confidence,
      exitPrice: null,
      exitTime: null,
      exitReason: null,
      exitProfit: 0
    };

    return trade;
  }

  /**
   * 更新交易状态
   */
  updateTrade(trade, currentPrice) {
    trade.currentPrice = currentPrice;

    // 计算盈亏
    if (trade.type === 'LONG') {
      trade.currentProfit = (currentPrice - trade.entryPrice) / trade.entryPrice * trade.positionSize * trade.leverage;
    } else {
      trade.currentProfit = (trade.entryPrice - currentPrice) / trade.entryPrice * trade.positionSize * trade.leverage;
    }

    trade.profitPercentage = trade.currentProfit / trade.positionSize * 100;

    // 更新最大盈利/亏损
    if (trade.currentProfit > trade.maxProfit) {
      trade.maxProfit = trade.currentProfit;
    }
    if (trade.currentProfit < trade.maxLoss) {
      trade.maxLoss = trade.currentProfit;
    }

    // 检查止盈止损
    if (trade.type === 'LONG') {
      if (currentPrice >= trade.takeProfitPrice) {
        return { shouldClose: true, reason: 'TAKE_PROFIT', exitPrice: trade.takeProfitPrice };
      } else if (currentPrice <= trade.stopLossPrice) {
        return { shouldClose: true, reason: 'STOP_LOSS', exitPrice: trade.stopLossPrice };
      }
    } else {
      if (currentPrice <= trade.takeProfitPrice) {
        return { shouldClose: true, reason: 'TAKE_PROFIT', exitPrice: trade.takeProfitPrice };
      } else if (currentPrice >= trade.stopLossPrice) {
        return { shouldClose: true, reason: 'STOP_LOSS', exitPrice: trade.stopLossPrice };
      }
    }

    return { shouldClose: false };
  }

  /**
   * 平仓交易
   */
  closeTrade(trade, exitPrice, reason) {
    trade.status = 'CLOSED';
    trade.exitPrice = exitPrice;
    trade.exitTime = new Date().getTime();
    trade.exitTimeString = new Date().toLocaleString();
    trade.exitReason = reason;

    // 计算最终盈亏
    if (trade.type === 'LONG') {
      trade.exitProfit = (exitPrice - trade.entryPrice) / trade.entryPrice * trade.positionSize * trade.leverage;
    } else {
      trade.exitProfit = (trade.entryPrice - exitPrice) / trade.entryPrice * trade.positionSize * trade.leverage;
    }

    return trade;
  }
}

class MultiCryptoPriceMonitor {
  constructor(config = null) {
    // 配置热更新相关属性
    this.configWatchInterval = null;
    this.lastConfigUpdate = Date.now();
    this.configFilePath = CONFIG_FILE_PATH;

    // 加载配置
    if (config) {
      this.config = config;
    } else {
      this.config = this.loadConfigSync();
    }

    this.coinData = new Map();
    this.monitoringInterval = null;
    this.timeSyncInterval = null;
    this.currentCoinIndex = 0;
    this.lastFetchTime = 0;
    this.initialDataCollected = false;

    // 初始化增强趋势分析器
    this.trendAnalyzer = new EnhancedTrendAnalyzer(this.config.TREND_ANALYSIS);

    // 初始化交易管理器
    this.tradingManager = new TradingManager(this.config);

    // 交易统计
    this.globalTradeStats = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalProfit: 0,
      winRate: 0,
      activeTrades: 0,
      maxConcurrentTrades: 0
    };

    // 初始化币种数据
    this.initializeCoinData();

    // 创建axios实例
    this.axios = axios.create({
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    console.log(`初始化多币种价格监控器，共监控 ${this.config.COINS.length} 个币种:`);
    this.config.COINS.forEach((coin, index) => {
      console.log(`  ${index + 1}. ${coin.name} (${coin.symbol})`);
    });
    console.log(`精确时间控制: 每20秒获取价格 (${this.config.TIME_CONTROL.TARGET_SECONDS.join('s, ')}s)`);
    console.log(`趋势分析窗口: ${this.config.TREND_ANALYSIS.TIME_WINDOW}分钟`);
    console.log(`RSI周期: ${this.config.TREND_ANALYSIS.RSI_PERIOD}，超买: ${this.config.TREND_ANALYSIS.RSI_OVERBOUGHT}，超卖: ${this.config.TREND_ANALYSIS.RSI_OVERSOLD}`);
    console.log(`增强趋势分析: MACD + EMA + 动量分析`);
    console.log(`模拟交易: ${this.config.TRADING.DEFAULT_POSITION_SIZE}U仓位，止盈${this.config.TRADING.TAKE_PROFIT_RATIO * 100}%/止损${this.config.TRADING.STOP_LOSS_RATIO * 100}%`);

    // 启动交易统计报告
    this.startTradeReporting();
  }

  /**
   * 同步加载配置（用于初始化）
   */
  loadConfigSync() {
    try {
      const configData = require('./crypto-tracker-config.json');
      console.log(`[${this.getCurrentTimeString()}] ✅ 配置文件加载成功`);
      return configData;
    } catch (error) {
      console.error(`[${this.getCurrentTimeString()}] ❌ 配置文件加载失败:`, error.message);
      console.log('使用默认配置...');
      return this.getDefaultConfig();
    }
  }

  /**
   * 异步加载配置（用于热更新）
   */
  async loadConfigAsync() {
    try {
      const data = await fs.readFile(this.configFilePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`[${this.getCurrentTimeString()}] ❌ 配置文件读取失败:`, error.message);
      return null;
    }
  }

  /**
   * 获取默认配置
   */
  getDefaultConfig() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  /**
   * 启动配置热更新监听
   */
  startConfigHotReload() {
    console.log(`[${this.getCurrentTimeString()}] 🔄 启动配置热更新监听...`);

    this.configWatchInterval = setInterval(async () => {
      await this.checkConfigUpdate();
    }, 10000); // 每10秒检查一次配置更新
  }

  /**
   * 检查配置文件更新
   */
  async checkConfigUpdate() {
    try {
      const stats = await fs.stat(this.configFilePath);
      const mtime = stats.mtime.getTime();

      if (mtime > this.lastConfigUpdate) {
        console.log(`[${this.getCurrentTimeString()}] 📝 检测到配置文件更新，重新加载...`);
        await this.reloadConfig();
        this.lastConfigUpdate = mtime;
      }
    } catch (error) {
      // 配置文件不存在，创建默认配置
      if (error.code === 'ENOENT') {
        await this.createDefaultConfig();
      } else {
        console.error(`[${this.getCurrentTimeString()}] ❌ 检查配置更新失败:`, error.message);
      }
    }
  }

  /**
   * 创建默认配置文件
   */
  async createDefaultConfig() {
    try {
      await fs.writeFile(this.configFilePath, JSON.stringify(DEFAULT_CONFIG, null, 2));
      console.log(`[${this.getCurrentTimeString()}] ✅ 已创建默认配置文件: ${this.configFilePath}`);
    } catch (error) {
      console.error(`[${this.getCurrentTimeString()}] ❌ 创建默认配置文件失败:`, error.message);
    }
  }

  /**
   * 重新加载配置
   */
  async reloadConfig() {
    try {
      const newConfig = await this.loadConfigAsync();
      if (newConfig) {
        await this.updateRuntimeConfig(newConfig);
        console.log(`[${this.getCurrentTimeString()}] ✅ 配置热更新成功`);

        // 发送配置更新通知
        await this.sendConfigUpdateNotification(newConfig);
      }
    } catch (error) {
      console.error(`[${this.getCurrentTimeString()}] ❌ 配置重载失败:`, error.message);
    }
  }

  /**
   * 更新运行时配置
   */
  async updateRuntimeConfig(newConfig) {
    const oldCoinCount = this.config.COINS.length;
    const newCoinCount = newConfig.COINS.length;

    // 更新基础配置
    this.config.REST_BASE_URL = newConfig.REST_BASE_URL;
    this.config.PRICE_CHANGE_THRESHOLD = newConfig.PRICE_CHANGE_THRESHOLD;
    this.config.PUSH_API_KEY = newConfig.PUSH_API_KEY;
    this.config.PUSH_API_URL = newConfig.PUSH_API_URL;
    this.config.MAX_FAILED_ATTEMPTS = newConfig.MAX_FAILED_ATTEMPTS;
    this.config.TIME_CONTROL = newConfig.TIME_CONTROL;
    this.config.TREND_ANALYSIS = newConfig.TREND_ANALYSIS;
    this.config.TRADING = newConfig.TRADING;

    // 更新趋势分析器配置
    this.trendAnalyzer = new EnhancedTrendAnalyzer(this.config.TREND_ANALYSIS);

    // 更新交易管理器配置
    this.tradingManager = new TradingManager(this.config);

    // 处理币种列表变化
    if (JSON.stringify(this.config.COINS) !== JSON.stringify(newConfig.COINS)) {
      console.log(`[${this.getCurrentTimeString()}] 🔄 币种列表发生变化: ${oldCoinCount} -> ${newCoinCount}`);

      // 更新币种列表
      this.config.COINS = newConfig.COINS;

      // 重新初始化币种数据
      this.initializeCoinData();

      // 重置当前币种索引
      this.currentCoinIndex = 0;
    }

    console.log(`[${this.getCurrentTimeString()}] ⚙️  运行时配置已更新`);
  }

  /**
   * 发送配置更新通知
   */
  async sendConfigUpdateNotification(newConfig) {
    const title = '⚙️ 监控配置已更新';
    const message = `[${this.getCurrentTimeString()}]
监控配置已热更新成功!
📊 监控币种: ${newConfig.COINS.length}个
⏰ 时间间隔: ${newConfig.TIME_CONTROL.INTERVAL / 1000}秒
📈 趋势窗口: ${newConfig.TREND_ANALYSIS.TIME_WINDOW}分钟
💰 模拟交易: ${newConfig.TRADING.DEFAULT_POSITION_SIZE}U仓位
🎯 止盈止损: ${newConfig.TRADING.TAKE_PROFIT_RATIO * 100}%/${newConfig.TRADING.STOP_LOSS_RATIO * 100}%`;

    await this.sendPushNotification(title, message);
  }

  /**
  * 发送转折点检测提醒
  */
  async sendTurningPointAlert(analysis, tradingSignal) {
    const { symbol, name, currentPrice } = analysis;
    const { signal, confidence, reason, signalType, technicals } = tradingSignal;

    if (signalType !== 'TURNING_POINT') return;

    const turningPoints = technicals.turningPoints;
    if (!turningPoints) return;

    let title = '';
    let emoji = '';

    if (signal === 'BUY') {
      emoji = '🟢';
      title = `${emoji} ${name}底部转折点检测 (${currentPrice})`;
    } else {
      emoji = '🔴';
      title = `${emoji} ${name}顶部转折点检测 (${currentPrice})`;
    }

    const message = `[${this.getCurrentTimeString()}]
${name}${signal === 'BUY' ? '底部' : '顶部'}转折点检测!

📊 检测结果:
🎯 信号类型: ${signal} (${confidence})
📈 置信度: ${signal === 'BUY' ? turningPoints.bottomConfidence : turningPoints.topConfidence}%

💡 检测理由:
${reason.map(r => `• ${r}`).join('\n')}

📊 技术指标详情:
💰 当前价格: ${currentPrice} USDT
📟 MACD直方图: ${technicals.macdHistogram ? technicals.macdHistogram.toFixed(6) : 'N/A'}
📈 MACD线: ${technicals.macdLine ? technicals.macdLine.toFixed(6) : 'N/A'}
🎯 RSI: ${technicals.rsi ? technicals.rsi.toFixed(2) : 'N/A'}
📊 布林带宽: ${technicals.bollingerBandwidth ? technicals.bollingerBandwidth.toFixed(2) + '%' : 'N/A'}

⚡ 交易建议:
💡 转折点信号建议使用更紧止损
🎯 等待${signal === 'BUY' ? this.config.TRADING.TURNING_POINT_TRADING.BOTTOM_CONFIRMATION_CANDLES : this.config.TRADING.TURNING_POINT_TRADING.TOP_CONFIRMATION_CANDLES}根K线确认`;

    await this.sendPushNotification(title, message);
    console.log(`[${this.getCurrentTimeString()}] 🔄 ${name}${signal === 'BUY' ? '底部' : '顶部'}转折点检测完成`);
  }

  /**
   * 初始化币种数据
   */
  initializeCoinData() {
    this.coinData.clear();
    this.config.COINS.forEach(coin => {
      this.coinData.set(coin.symbol, {
        name: coin.name,
        lastPrice: null,
        currentPrice: null,
        priceHistory: [],
        trendData: [],
        priceChanges: [],
        rsi: null,
        failedAttempts: 0,
        lastCheckTime: null,
        lastTrendAlert: null,
        lastRsiAlert: null,
        lastTradingSignalAlert: null,
        trendState: 'neutral',
        previousTrendState: 'neutral',
        currentTradingSignal: null,
        previousTradingSignal: null,
        fetchCount: 0,

        // 新增交易相关字段
        activeTrades: [],         // 活跃交易
        tradeHistory: [],         // 历史交易记录
        tradeStats: {             // 交易统计
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          totalProfit: 0,
          winRate: 0,
          maxDrawdown: 0,
          currentDrawdown: 0
        },
        lastTradeTime: null       // 上次交易时间
      });
    });

    // 加载交易历史
    this.loadTradeHistory();
  }

  /**
   * 加载交易历史
   */
  async loadTradeHistory() {
    try {
      const data = await fs.readFile(this.config.TRADING.TRADE_LOG_FILE, 'utf8');
      const tradeHistory = JSON.parse(data);

      // 更新全局统计
      for (const trade of tradeHistory) {
        this.globalTradeStats.totalTrades++;
        if (trade.exitProfit > 0) {
          this.globalTradeStats.winningTrades++;
        } else {
          this.globalTradeStats.losingTrades++;
        }
        this.globalTradeStats.totalProfit += trade.exitProfit;
      }

      this.globalTradeStats.winRate = this.globalTradeStats.totalTrades > 0
        ? (this.globalTradeStats.winningTrades / this.globalTradeStats.totalTrades * 100).toFixed(2)
        : 0;

      console.log(`[${this.getCurrentTimeString()}] 📊 加载交易历史: ${tradeHistory.length}笔，胜率${this.globalTradeStats.winRate}%`);

    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`[${this.getCurrentTimeString()}] ❌ 加载交易历史失败:`, error.message);
      }
    }
  }

  /**
   * 保存交易历史
   */
  async saveTradeHistory() {
    try {
      const allTrades = [];
      for (const coin of this.config.COINS) {
        const coinInfo = this.coinData.get(coin.symbol);
        allTrades.push(...coinInfo.tradeHistory);
      }

      await fs.writeFile(
        this.config.TRADING.TRADE_LOG_FILE,
        JSON.stringify(allTrades, null, 2)
      );

      console.log(`[${this.getCurrentTimeString()}] 💾 保存交易历史: ${allTrades.length}笔`);
    } catch (error) {
      console.error(`[${this.getCurrentTimeString()}] ❌ 保存交易历史失败:`, error.message);
    }
  }

  /**
   * 获取当前时间的秒数和毫秒
   */
  getCurrentSecond() {
    const now = new Date();
    return {
      seconds: now.getSeconds(),
      milliseconds: now.getMilliseconds(),
      totalMs: now.getTime()
    };
  }

  /**
   * 获取下一个目标时间点的延迟
   */
  getNextTargetDelay() {
    const time = this.getCurrentSecond();
    const currentSecond = time.seconds;
    const currentMs = time.milliseconds;

    let minDelay = Infinity;

    for (const targetSecond of this.config.TIME_CONTROL.TARGET_SECONDS) {
      let delay = 0;

      if (targetSecond > currentSecond) {
        delay = (targetSecond - currentSecond) * 1000 - currentMs;
      } else if (targetSecond < currentSecond) {
        delay = (60 - currentSecond + targetSecond) * 1000 - currentMs;
      } else {
        if (currentMs > this.config.TIME_CONTROL.ALLOWED_TIME_DEVIATION) {
          delay = 20000 - (currentMs % 20000);
        } else {
          delay = 0;
        }
      }

      if (delay < minDelay) {
        minDelay = delay;
      }
    }

    return Math.max(0, minDelay);
  }

  /**
   * 获取指定币种的最新价格（无时间控制，用于初始数据收集）
   */
  async fetchPriceImmediately(symbol, name) {
    const coinInfo = this.coinData.get(symbol);

    try {
      console.log(`[${this.getCurrentTimeString()}] 正在获取${name}(${symbol})初始价格...`);
      const response = await this.axios.get(`${this.config.REST_BASE_URL}/fapi/v1/ticker/price`, {
        params: { symbol }
      });

      if (response.data && response.data.price) {
        const price = parseFloat(response.data.price);
        const timestamp = new Date().getTime();

        coinInfo.currentPrice = price;
        coinInfo.lastPrice = price;
        coinInfo.failedAttempts = 0;
        coinInfo.lastCheckTime = timestamp;
        coinInfo.fetchCount++;

        coinInfo.trendData.push({
          price: price,
          timestamp: timestamp,
          exactTime: this.getCurrentTimeString()
        });

        console.log(`[${this.getCurrentTimeString()}] ✅ ${name}初始价格获取成功: ${price} USDT`);
        return price;
      }
      throw new Error('未找到价格数据');
    } catch (error) {
      coinInfo.failedAttempts++;
      console.error(`[${this.getCurrentTimeString()}] ❌ ${name}初始价格获取失败(${coinInfo.failedAttempts}/${this.config.MAX_FAILED_ATTEMPTS}):`, error.message);
      throw error;
    }
  }

  /**
   * 精确时间控制的价格获取（用于正常监控周期）
   */
  async fetchPriceWithTimeControl(symbol, name) {
    // 添加随机延迟，避免并发请求
    const randomDelay = Math.floor(Math.random() * 2000); // 0-2秒随机延迟
    await new Promise(resolve => setTimeout(resolve, randomDelay));

    const coinInfo = this.coinData.get(symbol);

    try {
      console.log(`[${this.getCurrentTimeString()}] 正在获取${name}(${symbol})价格...`);
      const response = await this.axios.get(`${this.config.REST_BASE_URL}/fapi/v1/ticker/price`, {
        params: { symbol }
      });

      if (response.data && response.data.price) {
        const price = parseFloat(response.data.price);
        const timestamp = new Date().getTime();

        if (coinInfo.currentPrice !== null) {
          const priceChange = price - coinInfo.currentPrice;
          coinInfo.priceChanges.push(priceChange);

          if (coinInfo.priceChanges.length > this.config.TREND_ANALYSIS.RSI_PERIOD) {
            coinInfo.priceChanges.shift();
          }
        }

        coinInfo.currentPrice = price;
        coinInfo.failedAttempts = 0;
        coinInfo.lastCheckTime = timestamp;
        coinInfo.fetchCount++;

        coinInfo.trendData.push({
          price: price,
          timestamp: timestamp,
          exactTime: this.getCurrentTimeString()
        });

        this.cleanupTrendData(symbol);

        this.lastFetchTime = timestamp;

        console.log(`[${this.getCurrentTimeString()}] ✅ ${name}价格获取成功: ${price} USDT (总获取次数: ${coinInfo.fetchCount})`);
        return price;
      }
      throw new Error('未找到价格数据');
    } catch (error) {
      coinInfo.failedAttempts++;
      console.error(`[${this.getCurrentTimeString()}] ❌ ${name}价格获取失败(${coinInfo.failedAttempts}/${this.config.MAX_FAILED_ATTEMPTS}):`, error.message);

      if (coinInfo.failedAttempts >= this.config.MAX_FAILED_ATTEMPTS) {
        await this.sendPushNotification(
          `${name}价格监控警告`,
          `连续${this.config.MAX_FAILED_ATTEMPTS}次获取${name}价格失败，请检查连接`
        );
      }

      throw error;
    }
  }

  /**
   * 计算RSI指标
   */
  calculateRSI(priceChanges) {
    if (priceChanges.length < this.config.TREND_ANALYSIS.RSI_PERIOD) {
      return null;
    }

    const recentChanges = priceChanges.slice(-this.config.TREND_ANALYSIS.RSI_PERIOD);

    let gains = 0;
    let losses = 0;

    for (const change of recentChanges) {
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    const avgGain = gains / this.config.TREND_ANALYSIS.RSI_PERIOD;
    const avgLoss = losses / this.config.TREND_ANALYSIS.RSI_PERIOD;

    if (avgLoss === 0) {
      return 100;
    }

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return rsi;
  }

  /**
   * 智能清理趋势分析数据
   */
  cleanupTrendData(symbol) {
    const coinInfo = this.coinData.get(symbol);
    const timeWindowMs = this.config.TREND_ANALYSIS.TIME_WINDOW * 60 * 1000;
    const minDataPoints = this.config.TREND_ANALYSIS.ENHANCED_TREND?.MIN_DATA_POINTS_FOR_MACD ?? 20;

    // 使用重叠窗口：保留比分析窗口更长的数据
    const overlapFactor = 1.5; // 保留1.5倍时间窗口的数据
    const cleanupWindowMs = timeWindowMs * overlapFactor;
    const cutoffTime = new Date().getTime() - cleanupWindowMs;

    const beforeCount = coinInfo.trendData.length;

    // 温和清理：只清理远期的旧数据，保留足够缓冲
    coinInfo.trendData = coinInfo.trendData.filter(record =>
      record.timestamp > cutoffTime
    );

    // 只有在数据量非常大时才进行数量限制
    const comfortableDataPoints = minDataPoints * 4; // 宽松的数据量上限
    if (coinInfo.trendData.length > comfortableDataPoints) {
      // 保留更多的数据点，确保分析连续性
      const retainPoints = minDataPoints * 3;
      coinInfo.trendData = coinInfo.trendData.slice(-retainPoints);
    }

    if (beforeCount !== coinInfo.trendData.length) {
      console.log(`[${this.getCurrentTimeString()}] 温和清理${coinInfo.name}: ${beforeCount} -> ${coinInfo.trendData.length} (保留${overlapFactor}倍窗口)`);
    }

    // 记录数据状态
    const currentDataPoints = coinInfo.trendData.length;
    if (currentDataPoints < minDataPoints) {
      console.log(`[${this.getCurrentTimeString()}] 📊 ${coinInfo.name}数据积累中: ${currentDataPoints}/${minDataPoints}`);
    } else if (currentDataPoints >= minDataPoints) {
      console.log(`[${this.getCurrentTimeString()}] ✅ ${coinInfo.name}数据充足: ${currentDataPoints}个数据点`);
    }
  }

  /**
   * 5分钟趋势分析算法（包含RSI）
   */
  analyzeTrend(symbol, name) {
    const coinInfo = this.coinData.get(symbol);

    if (coinInfo.trendData.length < this.config.TREND_ANALYSIS.MIN_DATA_POINTS) {
      const progress = `${coinInfo.trendData.length}/${this.config.TREND_ANALYSIS.MIN_DATA_POINTS}`;
      console.log(`[${this.getCurrentTimeString()}] ${name}趋势分析: 数据不足 ${progress} (还需要${this.config.TREND_ANALYSIS.MIN_DATA_POINTS - coinInfo.trendData.length}个点)`);
      return null;
    }

    const trendData = coinInfo.trendData;
    const firstPrice = trendData[0].price;
    const lastPrice = trendData[trendData.length - 1].price;
    const priceChange = lastPrice - firstPrice;
    const priceChangePercent = priceChange / firstPrice;

    const sma = this.calculateSMA(trendData);
    const volatility = this.calculateVolatility(trendData);
    const trendStrength = this.calculateTrendStrength(trendData);

    coinInfo.rsi = this.calculateRSI(coinInfo.priceChanges);

    let trendDirection = 'neutral';
    if (priceChangePercent > this.config.TREND_ANALYSIS.TREND_THRESHOLD) {
      trendDirection = 'uptrend';
    } else if (priceChangePercent < -this.config.TREND_ANALYSIS.TREND_THRESHOLD) {
      trendDirection = 'downtrend';
    }

    const breakout = this.detectBreakout(trendData, sma);

    const analysisResult = {
      symbol: symbol,
      name: name,
      direction: trendDirection,
      strength: Math.abs(trendStrength),
      priceChange: priceChange,
      priceChangePercent: priceChangePercent * 100,
      volatility: volatility * 100,
      sma: sma,
      currentPrice: lastPrice,
      startPrice: firstPrice,
      dataPoints: trendData.length,
      rsi: coinInfo.rsi,
      breakout: breakout,
      timestamp: new Date().getTime(),
      timeRange: `${trendData[0].exactTime} - ${trendData[trendData.length - 1].exactTime}`
    };

    let rsiInfo = coinInfo.rsi !== null ? `RSI: ${coinInfo.rsi.toFixed(2)}` : 'RSI: 计算中';
    console.log(`[${this.getCurrentTimeString()}] 📊 ${name}趋势分析: ${trendDirection.toUpperCase()} | 变化: ${(priceChangePercent * 100).toFixed(2)}% | 强度: ${trendStrength.toFixed(4)} | ${rsiInfo}`);

    return analysisResult;
  }

  /**
   * 计算简单移动平均线
   */
  calculateSMA(trendData) {
    const sum = trendData.reduce((acc, item) => acc + item.price, 0);
    return sum / trendData.length;
  }

  /**
   * 计算价格波动性（标准差）
   */
  calculateVolatility(trendData) {
    const prices = trendData.map(item => item.price);
    const mean = prices.reduce((acc, price) => acc + price, 0) / prices.length;
    const variance = prices.reduce((acc, price) => acc + Math.pow(price - mean, 2), 0) / prices.length;
    return Math.sqrt(variance) / mean;
  }

  /**
   * 计算趋势强度（线性回归斜率）
   */
  calculateTrendStrength(trendData) {
    const n = trendData.length;
    const x = trendData.map((_, index) => index);
    const y = trendData.map(item => item.price);

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
    const sumXX = x.reduce((a, b) => a + b * b, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    const currentPrice = y[y.length - 1];
    return slope / currentPrice;
  }

  /**
   * 检测价格突破
   */
  detectBreakout(trendData, sma) {
    const recentPrices = trendData.slice(-3).map(item => item.price);
    const currentPrice = recentPrices[recentPrices.length - 1];

    const priceChangeFromSMA = (currentPrice - sma) / sma;

    if (Math.abs(priceChangeFromSMA) > this.config.TREND_ANALYSIS.BREAKOUT_THRESHOLD) {
      return {
        type: priceChangeFromSMA > 0 ? 'breakout_up' : 'breakout_down',
        strength: Math.abs(priceChangeFromSMA),
        currentPrice: currentPrice,
        sma: sma
      };
    }

    return null;
  }

  /**
   * 改进的趋势变化提醒（使用增强趋势分析）
   */
  async sendTrendChangeAlert(coinInfo, analysis) {
    const now = new Date().getTime();

    // 避免频繁发送提醒（至少间隔3分钟）
    if (coinInfo.lastTrendAlert && (now - coinInfo.lastTrendAlert < 3 * 60 * 1000)) {
      return;
    }

    // 使用增强趋势分析
    const enhancedAnalysis = this.trendAnalyzer.analyzeEnhancedTrend(
      coinInfo.trendData,
      analysis.currentPrice,
      coinInfo.priceChanges
    );

    if (!enhancedAnalysis) {
      console.log(`[${this.getCurrentTimeString()}] 📊 ${analysis.name}趋势分析: 数据不足，需要至少${this.config.TREND_ANALYSIS.ENHANCED_TREND.MIN_DATA_POINTS_FOR_MACD}个数据点`);
      return;
    }

    const tradingSignal = this.trendAnalyzer.generateTradingSignal(enhancedAnalysis);

    // 只在HIGH或CONVICTION信号时开仓
    if (tradingSignal.signal !== 'HOLD' &&
      (tradingSignal.confidence === '高' || tradingSignal.confidence === '极度确信')) {
      await this.sendTradingSignalAlert(analysis, enhancedAnalysis, tradingSignal);
      coinInfo.lastTrendAlert = now;
      coinInfo.lastTradingSignalAlert = now;
    }

    // 记录当前信号用于后续比较
    coinInfo.previousTradingSignal = coinInfo.currentTradingSignal;
    coinInfo.currentTradingSignal = tradingSignal;
  }

  /**
   * 发送交易信号提醒
   */
  async sendTradingSignalAlert(analysis, enhancedAnalysis, tradingSignal) {
    const { signal, confidence, reason, technicals } = tradingSignal;

    let title = '';
    let emoji = '';

    // 只有在HIGH或CONVICTION时开仓
    const shouldTrade = (signal === 'BUY' || signal === 'SELL') &&
      (confidence === '高' || confidence === '极度确信' || signalType === 'TURNING_POINT');

    switch (signal) {
      case 'BUY':
        emoji = confidence === '极度确信' ? '🚀' : '📈';
        title = `${emoji} ${analysis.name}买入信号 (${analysis.currentPrice})`;
        break;
      case 'SELL':
        emoji = confidence === '极度确信' ? '🔻' : '📉';
        title = `${emoji} ${analysis.name}卖出信号 (${analysis.currentPrice})`;
        break;
      case 'HOLD':
        emoji = '⏸️';
        title = `${emoji} ${analysis.name}观望 (${analysis.currentPrice})`;
        break;
    }

    const message = `[${this.getCurrentTimeString()}]
${analysis.name}交易信号: ${signal} (置信度: ${confidence})

📊 技术指标:
💰 价格: ${analysis.currentPrice} USDT
📈 长周期动量: ${technicals.longMomentumRatio.toFixed(2)}%
🔷 EMA差值: ${technicals.emaSpread ? technicals.emaSpread.toFixed(6) : 'N/A'}
📟 MACD直方图: ${technicals.macdHistogram ? technicals.macdHistogram.toFixed(6) : 'N/A'}
🎯 RSI: ${technicals.rsi ? technicals.rsi.toFixed(2) : 'N/A'}

💡 信号理由:
${reason.map(r => `• ${r}`).join('\n')}

⚙️ 基础分析:
📈 价格变化: ${analysis.priceChangePercent.toFixed(2)}%
🎯 趋势强度: ${(analysis.strength * 100).toFixed(2)}%
🌊 波动性: ${analysis.volatility.toFixed(2)}%`;

    // 如果需要交易，执行模拟开仓
    if (shouldTrade) {
      const coinInfo = this.coinData.get(analysis.symbol);
      const now = Date.now();

      // 检查交易间隔
      const canTrade = !coinInfo.lastTradeTime ||
        (now - coinInfo.lastTradeTime > this.config.TRADING.MIN_SIGNAL_INTERVAL);

      // 检查活跃交易数量
      const activeTradesCount = coinInfo.activeTrades.length;
      const hasActiveTrades = activeTradesCount > 0;

      if (canTrade && !hasActiveTrades) {
        // 执行模拟开仓
        const trade = this.tradingManager.openTrade(
          analysis.symbol,
          analysis.name,
          signal,
          analysis.currentPrice,
          confidence
        );

        coinInfo.activeTrades.push(trade);
        coinInfo.lastTradeTime = now;
        this.globalTradeStats.activeTrades++;

        // 更新最大并发交易数
        if (this.globalTradeStats.activeTrades > this.globalTradeStats.maxConcurrentTrades) {
          this.globalTradeStats.maxConcurrentTrades = this.globalTradeStats.activeTrades;
        }

        // 添加交易信息到推送
        const tradeMessage = `

💰 模拟交易开仓:
🔄 方向: ${trade.type}
💰 仓位: ${trade.positionSize} USDT
🎯 入场价格: ${trade.entryPrice.toFixed(6)}
✅ 止盈价格: ${trade.takeProfitPrice.toFixed(6)} (${(this.config.TRADING.TAKE_PROFIT_RATIO * 100).toFixed(1)}%)
❌ 止损价格: ${trade.stopLossPrice.toFixed(6)} (${(this.config.TRADING.STOP_LOSS_RATIO * 100).toFixed(1)}%)`;

        await this.sendPushNotification(title, message + tradeMessage);
        console.log(`[${this.getCurrentTimeString()}] 💰 模拟开仓: ${analysis.name} ${trade.type} @ ${trade.entryPrice.toFixed(6)}`);
      } else {
        if (hasActiveTrades) {
          console.log(`[${this.getCurrentTimeString()}] ⏰ ${analysis.name}已有${activeTradesCount}个活跃交易，跳过开仓`);
        }
        await this.sendPushNotification(title, message);
      }
    } else {
      await this.sendPushNotification(title, message);
    }

    console.log(`[${this.getCurrentTimeString()}] ✅ 已发送${analysis.name}交易信号: ${signal} (${confidence})`);
  }

  /**
   * 监控和更新活跃交易
   */
  async monitorTrades(symbol, name, currentPrice) {
    const coinInfo = this.coinData.get(symbol);

    if (coinInfo.activeTrades.length === 0) return;

    // 更新每个活跃交易
    for (let i = coinInfo.activeTrades.length - 1; i >= 0; i--) {
      const trade = coinInfo.activeTrades[i];
      const updateResult = this.tradingManager.updateTrade(trade, currentPrice);

      // 检查是否需要平仓
      if (updateResult.shouldClose) {
        // 执行平仓
        const closedTrade = this.tradingManager.closeTrade(
          trade,
          updateResult.exitPrice,
          updateResult.reason
        );

        // 从活跃交易移除
        coinInfo.activeTrades.splice(i, 1);

        // 添加到历史记录
        coinInfo.tradeHistory.push(closedTrade);

        // 更新统计
        coinInfo.tradeStats.totalTrades++;
        this.globalTradeStats.totalTrades++;

        if (closedTrade.exitProfit > 0) {
          coinInfo.tradeStats.winningTrades++;
          this.globalTradeStats.winningTrades++;
        } else {
          coinInfo.tradeStats.losingTrades++;
          this.globalTradeStats.losingTrades++;
        }

        coinInfo.tradeStats.totalProfit += closedTrade.exitProfit;
        this.globalTradeStats.totalProfit += closedTrade.exitProfit;

        // 更新胜率
        coinInfo.tradeStats.winRate = coinInfo.tradeStats.totalTrades > 0
          ? (coinInfo.tradeStats.winningTrades / coinInfo.tradeStats.totalTrades * 100).toFixed(2)
          : 0;

        this.globalTradeStats.winRate = this.globalTradeStats.totalTrades > 0
          ? (this.globalTradeStats.winningTrades / this.globalTradeStats.totalTrades * 100).toFixed(2)
          : 0;

        // 发送平仓通知
        const profitColor = closedTrade.exitProfit > 0 ? '🟢' : '🔴';
        const profitText = closedTrade.exitProfit > 0 ? '盈利' : '亏损';
        const profitPercent = (closedTrade.exitProfit / trade.positionSize * 100).toFixed(2);

        const closeMessage = `${profitColor} ${name}交易平仓通知
🔄 方向: ${trade.type}
💰 仓位: ${trade.positionSize} USDT
🎯 入场价格: ${trade.entryPrice.toFixed(6)}
🏁 离场价格: ${updateResult.exitPrice.toFixed(6)}
⏰ 持仓时间: ${Math.round((closedTrade.exitTime - closedTrade.entryTime) / 60000)}分钟
💸 盈亏: ${closedTrade.exitProfit.toFixed(2)} USDT (${profitPercent}%)
📊 平仓原因: ${updateResult.reason === 'TAKE_PROFIT' ? '止盈' : '止损'}

📈 当前胜率: ${coinInfo.tradeStats.winRate}%
💰 累计盈亏: ${coinInfo.tradeStats.totalProfit.toFixed(2)} USDT`;

        await this.sendPushNotification(`💰 ${name}交易${profitText}`, closeMessage);
        console.log(`[${this.getCurrentTimeString()}] 💰 ${name}交易平仓: ${profitText} ${closedTrade.exitProfit.toFixed(2)}USDT (${profitPercent}%)`);

        this.globalTradeStats.activeTrades--;

        // 保存交易历史
        await this.saveTradeHistory();
      }
    }
  }

  /**
   * 判断是否应该发送趋势变化提醒
   */
  shouldSendTrendChangeAlert(coinInfo, analysis) {
    // 1. 基本条件：趋势状态确实发生变化且不是中性
    if (coinInfo.previousTrendState === analysis.direction || analysis.direction === 'neutral') {
      return false;
    }

    // 2. 数据充足性检查：至少需要一定数量的数据点
    if (analysis.dataPoints < this.config.TREND_ANALYSIS.MIN_DATA_POINTS * 1.5) {
      console.log(`[${this.getCurrentTimeString()}] 📊 ${analysis.name}趋势变化提醒: 数据点不足 (${analysis.dataPoints})`);
      return false;
    }

    // 3. 趋势强度阈值：趋势必须足够强
    const minTrendStrength = 0.008; // 0.8% 的趋势强度
    if (analysis.strength < minTrendStrength) {
      console.log(`[${this.getCurrentTimeString()}] 📊 ${analysis.name}趋势变化提醒: 趋势强度不足 (${(analysis.strength * 100).toFixed(2)}%)`);
      return false;
    }

    // 4. 价格变化幅度检查
    const minPriceChangePercent = 1.5; // 至少1.5%的价格变化
    if (Math.abs(analysis.priceChangePercent) < minPriceChangePercent) {
      console.log(`[${this.getCurrentTimeString()}] 📊 ${analysis.name}趋势变化提醒: 价格变化幅度不足 (${analysis.priceChangePercent.toFixed(2)}%)`);
      return false;
    }

    // 5. 波动性检查：避免在高度波动时误判
    const maxVolatility = 5.0; // 最大允许波动性
    if (analysis.volatility > maxVolatility) {
      console.log(`[${this.getCurrentTimeString()}] 📊 ${analysis.name}趋势变化提醒: 波动性过高 (${analysis.volatility.toFixed(2)}%)`);
      return false;
    }

    // 6. RSI确认（如果可用）
    if (analysis.rsi !== null) {
      // 如果RSI在极端区域，趋势变化可能不可靠
      if (analysis.rsi > 75 || analysis.rsi < 25) {
        console.log(`[${this.getCurrentTimeString()}] 📊 ${analysis.name}趋势变化提醒: RSI在极端区域 (${analysis.rsi.toFixed(2)})`);
        return false;
      }
    }

    console.log(`[${this.getCurrentTimeString()}] 📊 ${analysis.name}趋势变化满足所有条件，发送提醒`);
    return true;
  }

  /**
   * 发送RSI超买超卖提醒
   */
  async sendRsiAlert(coinInfo, analysis) {
    const now = new Date().getTime();

    if (analysis.rsi === null) return;

    if (coinInfo.lastRsiAlert && (now - coinInfo.lastRsiAlert < this.config.TREND_ANALYSIS.RSI_ALERT_COOLDOWN)) {
      return;
    }

    let title = '';
    let message = '';

    if (analysis.rsi >= this.config.TREND_ANALYSIS.RSI_OVERBOUGHT) {
      title = `🚨 ${analysis.name}超买警告 (${coinInfo.currentPrice})`;
      message = `[${this.getCurrentTimeString()}]
${analysis.name}RSI进入超买区域!
📊 RSI: ${analysis.rsi.toFixed(2)} (超过${this.config.TREND_ANALYSIS.RSI_OVERBOUGHT})
💰 当前价格: ${analysis.currentPrice} USDT
💡 注意: 市场可能过热，考虑谨慎操作`;

      coinInfo.lastRsiAlert = now;
      await this.sendPushNotification(title, message);
      console.log(`[${this.getCurrentTimeString()}] ✅ 已发送${analysis.name}超买警告`);

    } else if (analysis.rsi <= this.config.TREND_ANALYSIS.RSI_OVERSOLD) {
      title = `🛒 ${analysis.name}超卖机会 (${coinInfo.currentPrice})`;
      message = `[${this.getCurrentTimeString()}]
${analysis.name}RSI进入超卖区域!
📊 RSI: ${analysis.rsi.toFixed(2)} (低于${this.config.TREND_ANALYSIS.RSI_OVERSOLD})
💰 当前价格: ${analysis.currentPrice} USDT
💡 注意: 市场可能超卖，考虑关注机会`;

      coinInfo.lastRsiAlert = now;
      await this.sendPushNotification(title, message);
      console.log(`[${this.getCurrentTimeString()}] ✅ 已发送${analysis.name}超卖提醒`);
    }
  }

  /**
   * 基于趋势分析发送智能提醒
   */
  async sendTrendAlert(analysis) {
    const coinInfo = this.coinData.get(analysis.symbol);

    // 只使用增强的趋势分析
    await this.sendTrendChangeAlert(coinInfo, analysis);
    await this.sendRsiAlert(coinInfo, analysis);

  }

  /**
   * 检查价格变化和趋势（用于正常监控周期）
   */
  async checkPriceAndTrend(symbol, name) {
    const coinInfo = this.coinData.get(symbol);

    const price = await this.fetchPriceWithTimeControl(symbol, name);
    if (price === null) return;

    // 监控和更新活跃交易
    await this.monitorTrades(symbol, name, price);

    if (coinInfo.lastPrice && coinInfo.currentPrice) {
      const priceChange = coinInfo.currentPrice - coinInfo.lastPrice;
      const priceChangePercent = Math.abs(priceChange / coinInfo.lastPrice);

      console.log(`[${this.getCurrentTimeString()}] ${name}价格变化: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(5)} USDT (${(priceChangePercent * 100).toFixed(2)}%)`);

      if (priceChangePercent >= this.config.PRICE_CHANGE_THRESHOLD) {
        const now = Date.now();

        // 修改这里：将10分钟改为1分钟
        if (!coinInfo.lastPriceAlert || (now - coinInfo.lastPriceAlert > 2 * 60 * 1000)) {
          const direction = priceChange > 0 ? '上涨' : '下跌';
          const message = `[${this.getCurrentTimeString()}]
${name}价格${direction}${(priceChangePercent * 100).toFixed(2)}%
当前价格: ${coinInfo.currentPrice} USDT
上次价格: ${coinInfo.lastPrice} USDT`;

          await this.sendPushNotification(
            `${name}价格${direction}波动提醒（${coinInfo.currentPrice}）`,
            message
          );

          // 记录最后一次价格提醒时间
          coinInfo.lastPriceAlert = now;
          console.log(`[${this.getCurrentTimeString()}] ✅ 已发送${name}价格波动提醒`);
        } else {
          // 这里也需要修改剩余时间计算
          const remainingSeconds = Math.ceil((1 * 60 * 1000 - (now - coinInfo.lastPriceAlert)) / 1000);
          console.log(`[${this.getCurrentTimeString()}] ⏰ ${name}价格提醒冷却中，${remainingSeconds}秒后可再次提醒`);
        }
      }
    }

    const trendAnalysis = this.analyzeTrend(symbol, name);
    if (trendAnalysis) {
      await this.sendTrendAlert(trendAnalysis);
    }

    coinInfo.lastPrice = coinInfo.currentPrice;
  }

  /**
   * 发送推送通知
   */
  async sendPushNotification(title, content) {
    try {
      const encodedTitle = encodeURIComponent(title);
      const encodedContent = encodeURIComponent(content);

      for (const apiKey of this.config.PUSH_API_KEY) {
        const url = `${this.config.PUSH_API_URL}/${apiKey}/${encodedTitle}/${encodedContent}`;
        await this.axios.get(url);
        console.log(`[${this.getCurrentTimeString()}] 📨 推送通知发送成功给 ${apiKey.substring(0, 8)}...`);
      }
    } catch (error) {
      console.error(`[${this.getCurrentTimeString()}] ❌ 推送通知发送失败:`, error.message);
    }
  }

  /**
   * 获取当前监控的币种信息
   */
  getCurrentCoin() {
    return this.config.COINS[this.currentCoinIndex];
  }

  /**
   * 移动到下一个币种
   */
  moveToNextCoin() {
    this.currentCoinIndex = (this.currentCoinIndex + 1) % this.config.COINS.length;
  }

  /**
   * 收集所有币种的初始数据
   */
  async collectInitialData() {
    console.log(`[${this.getCurrentTimeString()}] 🚀 开始收集所有币种初始价格数据...`);

    const initialPrices = [];

    for (const coin of this.config.COINS) {
      try {
        const price = await this.fetchPriceImmediately(coin.symbol, coin.name);
        initialPrices.push(`${coin.name}: ${price} USDT`);

        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        initialPrices.push(`${coin.name}: 获取失败`);
        console.error(`[${this.getCurrentTimeString()}] ❌ ${coin.name}初始价格获取失败:`, error.message);
      }
    }

    console.log(`[${this.getCurrentTimeString()}] ✅ 所有币种初始价格收集完成`);
    this.initialDataCollected = true;

    return initialPrices;
  }

  /**
   * 精确时间控制的监控循环
   */
  async startTimeControlledMonitoring() {
    console.log(`[${this.getCurrentTimeString()}] 🎯 等待下一个整20秒时间点开始精确监控...`);

    const initialDelay = this.getNextTargetDelay();
    console.log(`[${this.getCurrentTimeString()}] ⏰ 距离下一个目标时间点还有 ${initialDelay}ms`);

    setTimeout(() => {
      console.log(`[${this.getCurrentTimeString()}] 🚀 精确时间监控正式开始!`);

      this.executeMonitoringCycle();

      this.monitoringInterval = setInterval(() => {
        this.executeMonitoringCycle();
      }, this.config.TIME_CONTROL.INTERVAL);

    }, initialDelay);

    this.timeSyncInterval = setInterval(() => {
      this.checkTimeSync();
    }, this.config.TIME_CONTROL.SYNC_INTERVAL);
  }

  /**
   * 执行监控周期
   */
  async executeMonitoringCycle() {
    const currentCoin = this.getCurrentCoin();
    if (!currentCoin) return;

    const currentTime = this.getCurrentSecond();
    console.log(`[${this.getCurrentTimeString()}] 🎯 精确时间点执行: ${currentCoin.name} (秒: ${currentTime.seconds}.${currentTime.milliseconds.toString().padStart(3, '0')})`);

    try {
      await this.checkPriceAndTrend(currentCoin.symbol, currentCoin.name);
    } catch (error) {
      console.error(`[${this.getCurrentTimeString()}] ❌ ${currentCoin.name}监控过程中发生错误:`, error.message);
    }

    this.moveToNextCoin();
  }

  /**
   * 检查时间同步状态
   */
  checkTimeSync() {
    const time = this.getCurrentSecond();
    const currentSecond = time.seconds;

    if (this.config.TIME_CONTROL.TARGET_SECONDS.includes(currentSecond)) {
      console.log(`[${this.getCurrentTimeString()}] ⏱️  时间同步: 秒${time.seconds}.${time.milliseconds.toString().padStart(3, '0')} (目标点)`);
    }
  }

  /**
   * 生成交易统计报告
   */
  generateTradeReport() {
    const report = {
      timestamp: new Date().toLocaleString(),
      globalStats: { ...this.globalTradeStats },
      coinStats: {}
    };

    for (const coin of this.config.COINS) {
      const coinInfo = this.coinData.get(coin.symbol);
      report.coinStats[coin.name] = {
        totalTrades: coinInfo.tradeStats.totalTrades,
        winningTrades: coinInfo.tradeStats.winningTrades,
        losingTrades: coinInfo.tradeStats.losingTrades,
        winRate: coinInfo.tradeStats.winRate,
        totalProfit: coinInfo.tradeStats.totalProfit.toFixed(2),
        activeTrades: coinInfo.activeTrades.length,
        currentSignals: coinInfo.currentTradingSignal ?
          `${coinInfo.currentTradingSignal.signal} (${coinInfo.currentTradingSignal.confidence})` : '无信号'
      };
    }

    return report;
  }

  /**
   * 定期打印交易统计
   */
  startTradeReporting() {
    setInterval(() => {
      const report = this.generateTradeReport();

      console.log('\n=== 交易统计报告 ===');
      console.log(`📊 全局统计:`);
      console.log(`   总交易数: ${report.globalStats.totalTrades}`);
      console.log(`   盈利交易: ${report.globalStats.winningTrades}`);
      console.log(`   亏损交易: ${report.globalStats.losingTrades}`);
      console.log(`   胜率: ${report.globalStats.winRate}%`);
      console.log(`   总盈亏: ${report.globalStats.totalProfit.toFixed(2)} USDT`);
      console.log(`   活跃交易: ${report.globalStats.activeTrades}`);
      console.log(`   最大并发: ${report.globalStats.maxConcurrentTrades}`);

      console.log(`\n📈 各币种统计:`);
      for (const [coinName, stats] of Object.entries(report.coinStats)) {
        if (stats.totalTrades > 0) {
          console.log(`   ${coinName}: ${stats.totalTrades}次, 胜率${stats.winRate}%, 盈利${stats.totalProfit}U`);
        }
      }
      console.log('===================\n');

    }, 5 * 60 * 1000); // 每5分钟报告一次
  }

  /**
   * 开始监控所有币种价格
   */
  async startMonitoring() {
    console.log(`[${this.getCurrentTimeString()}] 开始监控${this.config.COINS.length}个币种价格...`);

    const initialPrices = await this.collectInitialData();

    console.log(`[${this.getCurrentTimeString()}] 所有币种初始价格已获取，准备开始精确时间监控`);

    await this.sendPushNotification(
      `多币种精确监控已启动`,
      `监控 ${this.config.COINS.length} 个币种
⏰ 时间控制: 每20秒获取 (${this.config.TIME_CONTROL.TARGET_SECONDS.join('s, ')}s)
📊 趋势窗口: ${this.config.TREND_ANALYSIS.TIME_WINDOW}分钟
📈 RSI监控: ${this.config.TREND_ANALYSIS.RSI_PERIOD}周期 (超买${this.config.TREND_ANALYSIS.RSI_OVERBOUGHT}/超卖${this.config.TREND_ANALYSIS.RSI_OVERSOLD})
🚀 增强分析: MACD + EMA + 动量分析
💰 模拟交易: ${this.config.TRADING.DEFAULT_POSITION_SIZE}U仓位，止盈${this.config.TRADING.TAKE_PROFIT_RATIO * 100}%/止损${this.config.TRADING.STOP_LOSS_RATIO * 100}%
初始价格:
${initialPrices.join('\n')}`
    );

    // 启动配置热更新监听
    this.startConfigHotReload();

    await this.startTimeControlledMonitoring();

    process.on('SIGINT', () => this.stopMonitoring());
    process.on('SIGTERM', () => this.stopMonitoring());
  }

  /**
   * 停止监控价格
   */
  async stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    if (this.timeSyncInterval) {
      clearInterval(this.timeSyncInterval);
      this.timeSyncInterval = null;
    }
    if (this.configWatchInterval) {
      clearInterval(this.configWatchInterval);
      this.configWatchInterval = null;
    }

    const finalPrices = [];
    const finalTrends = [];
    const finalRSI = [];
    const finalSignals = [];
    const tradeStats = [];
    const fetchStats = [];

    for (const coin of this.config.COINS) {
      const coinInfo = this.coinData.get(coin.symbol);
      finalPrices.push(`${coin.name}: ${coinInfo.currentPrice || '未知'} USDT`);
      finalTrends.push(`${coin.name}: ${coinInfo.trendState}`);
      finalRSI.push(`${coin.name}: ${coinInfo.rsi !== null ? coinInfo.rsi.toFixed(2) : '无数据'}`);

      const signal = coinInfo.currentTradingSignal ?
        `${coinInfo.currentTradingSignal.signal} (${coinInfo.currentTradingSignal.confidence})` : '无信号';
      finalSignals.push(`${coin.name}: ${signal}`);

      tradeStats.push(`${coin.name}: ${coinInfo.tradeStats.totalTrades}次, 胜率${coinInfo.tradeStats.winRate}%, 盈利${coinInfo.tradeStats.totalProfit.toFixed(2)}U`);
      fetchStats.push(`${coin.name}: ${coinInfo.fetchCount}次`);
    }

    await this.sendPushNotification(
      `多币种监控已停止`,
      `最后价格:
${finalPrices.join('\n')}

趋势状态:
${finalTrends.join('\n')}

交易信号:
${finalSignals.join('\n')}

交易统计:
${tradeStats.join('\n')}

RSI数值:
${finalRSI.join('\n')}

获取统计:
${fetchStats.join('\n')}

全局统计:
总交易: ${this.globalTradeStats.totalTrades}次
胜率: ${this.globalTradeStats.winRate}%
总盈亏: ${this.globalTradeStats.totalProfit.toFixed(2)} USDT`
    );

    // 保存交易历史
    await this.saveTradeHistory();

    console.log(`[${this.getCurrentTimeString()}] 价格监控已停止`);
    process.exit(0);
  }

  /**
   * 获取当前时间字符串
   */
  getCurrentTimeString() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
  }

  /**
   * 获取详细的监控状态统计
   */
  getMonitoringStatus() {
    const status = {
      totalCoins: this.config.COINS.length,
      monitoredCoins: [],
      trendSummary: {
        uptrend: 0,
        downtrend: 0,
        neutral: 0
      },
      rsiSummary: {
        overbought: 0,
        oversold: 0,
        normal: 0
      },
      signalSummary: {
        buy: 0,
        sell: 0,
        hold: 0
      },
      fetchStats: {}
    };

    for (const coin of this.config.COINS) {
      const coinInfo = this.coinData.get(coin.symbol);
      const trendAnalysis = this.analyzeTrend(coin.symbol, coin.name);

      const coinStatus = {
        name: coin.name,
        symbol: coin.symbol,
        currentPrice: coinInfo.currentPrice,
        trendState: coinInfo.trendState,
        rsi: coinInfo.rsi,
        tradingSignal: coinInfo.currentTradingSignal,
        dataPoints: coinInfo.trendData.length,
        fetchCount: coinInfo.fetchCount,
        trendAnalysis: trendAnalysis,
        lastCheckTime: coinInfo.lastCheckTime ? new Date(coinInfo.lastCheckTime).toLocaleString() : '从未检查'
      };

      status.monitoredCoins.push(coinStatus);
      status.trendSummary[coinInfo.trendState]++;

      if (coinInfo.rsi !== null) {
        if (coinInfo.rsi >= this.config.TREND_ANALYSIS.RSI_OVERBOUGHT) {
          status.rsiSummary.overbought++;
        } else if (coinInfo.rsi <= this.config.TREND_ANALYSIS.RSI_OVERSOLD) {
          status.rsiSummary.oversold++;
        } else {
          status.rsiSummary.normal++;
        }
      }

      if (coinInfo.currentTradingSignal) {
        status.signalSummary[coinInfo.currentTradingSignal.signal.toLowerCase()]++;
      }

      status.fetchStats[coin.name] = coinInfo.fetchCount;
    }

    return status;
  }
}

/**
 * 转折点交易管理器（扩展原交易管理器）
 */
class TurningPointTradingManager extends TradingManager {
  constructor(config) {
    super(config);
    this.turningPointConfig = config.TRADING.TURNING_POINT_TRADING || {
      BOTTOM_CONFIRMATION_CANDLES: 2,
      TOP_CONFIRMATION_CANDLES: 1,
      REENTRY_ALLOWANCE: 0.005,
      STOP_LOSS_TIGHTENING: 0.5
    };

    this.turningPointHistory = new Map(); // 记录转折点历史
  }

  /**
   * 开仓交易（优化版，支持转折点交易）
   */
  openTrade(symbol, name, signal, entryPrice, confidence, signalType = 'REGULAR', turningPointData = null) {
    const trade = super.openTrade(symbol, name, signal, entryPrice, confidence);

    // 如果是转折点交易，调整止损策略
    if (signalType === 'TURNING_POINT' && turningPointData) {
      const isLong = signal === 'BUY';

      // 转折点交易使用更紧的止损
      const tighterStopLossRatio = this.config.STOP_LOSS_RATIO * this.turningPointConfig.STOP_LOSS_TIGHTENING;

      trade.stopLossPrice = isLong
        ? entryPrice * (1 - tighterStopLossRatio)
        : entryPrice * (1 + tighterStopLossRatio);

      trade.takeProfitRatio = this.config.TAKE_PROFIT_RATIO * 1.5; // 提高止盈比例
      trade.takeProfitPrice = isLong
        ? entryPrice * (1 + trade.takeProfitRatio)
        : entryPrice * (1 - trade.takeProfitRatio);

      trade.signalType = 'TURNING_POINT';
      trade.turningPointData = turningPointData;
    }

    return trade;
  }

  /**
   * 检查转折点确认
   */
  checkTurningPointConfirmation(symbol, currentPrice, signal, turningPointData) {
    if (!turningPointData) return false;

    const history = this.turningPointHistory.get(symbol) || [];

    // 检查确认K线数量
    const confirmationCandles = signal === 'BUY'
      ? this.turningPointConfig.BOTTOM_CONFIRMATION_CANDLES
      : this.turningPointConfig.TOP_CONFIRMATION_CANDLES;

    // 记录当前价格到历史
    history.push({
      price: currentPrice,
      time: Date.now(),
      signal: signal
    });

    // 保持历史记录长度
    if (history.length > 10) {
      history.shift();
    }

    this.turningPointHistory.set(symbol, history);

    // 检查是否满足确认条件
    if (history.length >= confirmationCandles) {
      const recentPrices = history.slice(-confirmationCandles);

      if (signal === 'BUY') {
        // 底部确认：价格持续上涨
        const allIncreasing = recentPrices.every((price, index) => {
          if (index === 0) return true;
          return price.price > recentPrices[index - 1].price;
        });
        return allIncreasing;
      } else {
        // 顶部确认：价格持续下跌
        const allDecreasing = recentPrices.every((price, index) => {
          if (index === 0) return true;
          return price.price < recentPrices[index - 1].price;
        });
        return allDecreasing;
      }
    }

    return false;
  }
}

// 使用示例
async function main() {
  try {
    const monitor = new MultiCryptoPriceMonitor();
    await monitor.startMonitoring();

    console.log('\n🎯 智能精确趋势监控系统已启动!');
    console.log('✨ 功能特性:');
    console.log('   • 立即获取所有币种初始价格');
    console.log('   • 精确20秒间隔价格获取 (0s, 20s, 40s)');
    console.log('   • 5分钟趋势分析 (需要15个数据点)');
    console.log('   • RSI指标计算 (14周期)');
    console.log('   • 增强趋势分析: MACD + EMA + 动量分析');
    console.log('   • 明确交易信号: BUY/SELL/HOLD (CONVICTION高度确信/高/MEDIUM/LOW)');
    console.log('   • 趋势变化实时提醒');
    console.log('   • RSI超买(>80)/超卖(<20)警告');
    console.log('   • 配置热更新支持');
    console.log('按 Ctrl+C 停止监控');
    console.log('=======================================');

    setInterval(() => {
      const status = monitor.getMonitoringStatus();
      console.log('\n=== 精确监控统计 ===');
      console.log(`总币种数: ${status.totalCoins}`);
      console.log(`上涨趋势: ${status.trendSummary.uptrend}`);
      console.log(`下跌趋势: ${status.trendSummary.downtrend}`);
      console.log(`中性趋势: ${status.trendSummary.neutral}`);
      console.log(`买入信号: ${status.signalSummary.buy}`);
      console.log(`卖出信号: ${status.signalSummary.sell}`);
      console.log(`观望信号: ${status.signalSummary.hold}`);
      console.log(`超买币种: ${status.rsiSummary.overbought}`);
      console.log(`超卖币种: ${status.rsiSummary.oversold}`);
      console.log('获取次数:', status.fetchStats);
      console.log('===================\n');
    }, 60000);

  } catch (error) {
    console.error('程序启动失败:', error.message);
  }
}

// 运行主函数
main();

module.exports = {
  MultiCryptoPriceMonitor,
  DEFAULT_CONFIG,
  EnhancedTrendAnalyzer
};