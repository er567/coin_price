/**
 * @Author: zgc zgc7788@gmail.com
 * @Date: 2025-11-06 09:39:12
 * @LastEditors: zgc zgc7788@gmail.com
 * @LastEditTime: 2025-11-26 11:30:55
 * @FilePath: \test\crypto-tracker.js
 * @Description: 加密货币价格监控与趋势分析工具 - 多币种版本（含RSI指标和增强趋势分析）
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
  PRICE_CHANGE_THRESHOLD: 0.02,
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
    // 新增增强趋势分析配置
    ENHANCED_TREND: {
      LONG_MOMENTUM_THRESHOLD: 0.02, // 2% 长周期动量阈值
      MACD_HIST_WEAK: 0,
      MACD_HIST_STRONG: 0.001,
      MIN_DATA_POINTS_FOR_MACD: 26 // MACD需要更多数据点
    }
  }
};

/**
 * 增强趋势分析器
 */
class EnhancedTrendAnalyzer {
  constructor(config) {
    this.config = config;
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
   * 计算MACD
   */
  calculateMACD(prices) {
    if (prices.length < 26) return null;
    
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    
    if (ema12 === null || ema26 === null) return null;
    
    const macdLine = ema12 - ema26;
    
    // 计算信号线（9周期EMA）
    const signalPrices = prices.slice(-9); // 简化计算，使用最近9个价格
    const signalLine = this.calculateEMA(signalPrices, 9);
    
    const histogram = macdLine - signalLine;
    
    return {
      macd: macdLine,
      signal: signalLine,
      histogram: histogram
    };
  }

  /**
   * 计算价格变化序列
   */
  calculatePriceChanges(prices) {
    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i-1]);
    }
    return changes;
  }

  /**
   * 计算SMA
   */
  calculateSMA(prices) {
    if (prices.length === 0) return null;
    return prices.reduce((a, b) => a + b, 0) / prices.length;
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
   * 增强趋势分析
   */
  analyzeEnhancedTrend(trendData, currentPrice, priceChanges) {
    if (trendData.length < this.config.ENHANCED_TREND.MIN_DATA_POINTS_FOR_MACD) {
      return null;
    }

    const prices = trendData.map(item => item.price);
    
    // 计算各种技术指标
    const smaShort = this.calculateSMA(prices.slice(-10)); // 10周期SMA
    const smaMedium = this.calculateSMA(prices.slice(-20)); // 20周期SMA
    const smaLong = this.calculateSMA(prices); // 全周期SMA
    
    const emaFast = this.calculateEMA(prices, 12);
    const emaSlow = this.calculateEMA(prices, 26);
    
    const macd = this.calculateMACD(prices);
    const rsi = this.calculateRSI(priceChanges);
    
    const longMomentumRatio = currentPrice / smaLong;
    
    return {
      prices: prices,
      currentPrice: currentPrice,
      sma: {
        short: smaShort,
        medium: smaMedium,
        long: smaLong
      },
      ema: {
        fast: emaFast,
        slow: emaSlow
      },
      macd: macd,
      rsi: rsi,
      longMomentumRatio: longMomentumRatio,
      timestamp: new Date().getTime()
    };
  }

  /**
   * 生成交易信号
   */
  generateTradingSignal(analysis) {
    if (!analysis) return null;

    const {
      currentPrice,
      sma,
      ema,
      macd,
      rsi,
      longMomentumRatio
    } = analysis;

    // 使用配置中的阈值
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
      
      // 空头条件
      shortMomentum: longMomentumRatio < (1 - THRESHOLDS.LONG_MOMENTUM),
      emaBearish: ema.fast < ema.slow && currentPrice < ema.fast,
      macdBearish: macd && macd.histogram <= THRESHOLDS.MACD_HIST_WEAK,
      rsiNotOversold: rsi > THRESHOLDS.RSI_OVERSOLD,
      
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

    // 检查强烈多头信号
    const strongBullishConditions = [
      conditions.longMomentum,
      conditions.emaBullish,
      conditions.macdBullish,
      conditions.rsiNotOverbought
    ].filter(Boolean).length;

    const veryStrongBullish = strongBullishConditions >= 3 && 
      (conditions.strongBullishMACD || conditions.veryBullishMomentum);

    // 检查强烈空头信号
    const strongBearishConditions = [
      conditions.shortMomentum,
      conditions.emaBearish,
      conditions.macdBearish,
      conditions.rsiNotOversold
    ].filter(Boolean).length;

    const veryStrongBearish = strongBearishConditions >= 3 && 
      (conditions.strongBearishMACD || conditions.veryBearishMomentum);

    // 生成信号
    if (veryStrongBullish) {
      signal = 'BUY';
      confidence = 'CONVICTION';
      reason = ['强烈多头动量', 'EMA多头排列', 'MACD看涨', 'RSI健康'];
    } else if (strongBullishConditions >= 3) {
      signal = 'BUY';
      confidence = 'HIGH';
      reason = ['多头动量明显', 'EMA支持上涨', 'MACD转强'];
    } else if (strongBullishConditions >= 2) {
      signal = 'BUY';
      confidence = 'MEDIUM';
      reason = ['多头信号初现', '技术指标偏多'];
    } else if (veryStrongBearish) {
      signal = 'SELL';
      confidence = 'CONVICTION';
      reason = ['强烈空头动量', 'EMA空头排列', 'MACD看跌', 'RSI健康'];
    } else if (strongBearishConditions >= 3) {
      signal = 'SELL';
      confidence = 'HIGH';
      reason = ['空头动量明显', 'EMA支持下跌', 'MACD转弱'];
    } else if (strongBearishConditions >= 2) {
      signal = 'SELL';
      confidence = 'MEDIUM';
      reason = ['空头信号初现', '技术指标偏空'];
    } else {
      // 中性市场条件
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

    return {
      signal,
      confidence,
      reason,
      conditions: {
        longMomentum: conditions.longMomentum,
        emaBullish: conditions.emaBullish,
        macdBullish: conditions.macdBullish,
        shortMomentum: conditions.shortMomentum,
        emaBearish: conditions.emaBearish,
        macdBearish: conditions.macdBearish
      },
      technicals: {
        longMomentumRatio: (longMomentumRatio - 1) * 100,
        emaSpread: ema.fast - ema.slow,
        macdHistogram: macd ? macd.histogram : null,
        rsi: rsi
      }
    };
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

    // 更新趋势分析器配置
    this.trendAnalyzer = new EnhancedTrendAnalyzer(this.config.TREND_ANALYSIS);

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
🔔 价格阈值: ${(newConfig.PRICE_CHANGE_THRESHOLD * 100).toFixed(1)}%`;

    await this.sendPushNotification(title, message);
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
        fetchCount: 0
      });
    });
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
   * 清理趋势分析数据，只保留指定时间窗口内的数据
   */
  cleanupTrendData(symbol) {
    const coinInfo = this.coinData.get(symbol);
    const timeWindowMs = this.config.TREND_ANALYSIS.TIME_WINDOW * 60 * 1000;
    const cutoffTime = new Date().getTime() - timeWindowMs;

    const beforeCount = coinInfo.trendData.length;
    coinInfo.trendData = coinInfo.trendData.filter(record =>
      record.timestamp > cutoffTime
    );

    if (beforeCount !== coinInfo.trendData.length) {
      console.log(`[${this.getCurrentTimeString()}] 清理${this.coinData.get(symbol).name}趋势数据: ${beforeCount} -> ${coinInfo.trendData.length}`);
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

    // 只在信号明确时发送提醒（避免过多的HOLD信号）
    if (tradingSignal.signal !== 'HOLD' || tradingSignal.confidence === 'CONVICTION') {
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
    
    switch(signal) {
      case 'BUY':
        emoji = confidence === 'CONVICTION' ? '🚀' : '📈';
        title = `${emoji} ${analysis.name}买入信号 (${confidence})`;
        break;
      case 'SELL':
        emoji = confidence === 'CONVICTION' ? '🔻' : '📉';
        title = `${emoji} ${analysis.name}卖出信号 (${confidence})`;
        break;
      case 'HOLD':
        emoji = '⏸️';
        title = `${emoji} ${analysis.name}观望 (${confidence})`;
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

    await this.sendPushNotification(title, message);
    console.log(`[${this.getCurrentTimeString()}] ✅ 已发送${analysis.name}交易信号: ${signal} (${confidence})`);
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
      title = `🚨 ${analysis.name}超买警告`;
      message = `[${this.getCurrentTimeString()}]
${analysis.name}RSI进入超买区域!
📊 RSI: ${analysis.rsi.toFixed(2)} (超过${this.config.TREND_ANALYSIS.RSI_OVERBOUGHT})
💰 当前价格: ${analysis.currentPrice} USDT
💡 注意: 市场可能过热，考虑谨慎操作`;

      coinInfo.lastRsiAlert = now;
      await this.sendPushNotification(title, message);
      console.log(`[${this.getCurrentTimeString()}] ✅ 已发送${analysis.name}超买警告`);

    } else if (analysis.rsi <= this.config.TREND_ANALYSIS.RSI_OVERSOLD) {
      title = `🛒 ${analysis.name}超卖机会`;
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

    if (coinInfo.lastPrice && coinInfo.currentPrice) {
      const priceChange = coinInfo.currentPrice - coinInfo.lastPrice;
      const priceChangePercent = Math.abs(priceChange / coinInfo.lastPrice);

      console.log(`[${this.getCurrentTimeString()}] ${name}价格变化: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(5)} USDT (${(priceChangePercent * 100).toFixed(2)}%)`);

      if (priceChangePercent >= this.config.PRICE_CHANGE_THRESHOLD) {
        const direction = priceChange > 0 ? '上涨' : '下跌';
        const message = `[${this.getCurrentTimeString()}]
${name}价格${direction}${(priceChangePercent * 100).toFixed(2)}%
当前价格: ${coinInfo.currentPrice} USDT
上次价格: ${coinInfo.lastPrice} USDT`;
        this.sendPushNotification(
          `${name}价格${direction}波动提醒`,
          message
        );
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
    const fetchStats = [];

    for (const coin of this.config.COINS) {
      const coinInfo = this.coinData.get(coin.symbol);
      finalPrices.push(`${coin.name}: ${coinInfo.currentPrice || '未知'} USDT`);
      finalTrends.push(`${coin.name}: ${coinInfo.trendState}`);
      finalRSI.push(`${coin.name}: ${coinInfo.rsi !== null ? coinInfo.rsi.toFixed(2) : '无数据'}`);
      
      const signal = coinInfo.currentTradingSignal ? 
        `${coinInfo.currentTradingSignal.signal} (${coinInfo.currentTradingSignal.confidence})` : '无信号';
      finalSignals.push(`${coin.name}: ${signal}`);
      
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

RSI数值:
${finalRSI.join('\n')}

获取统计:
${fetchStats.join('\n')}`
    );

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
    console.log('   • 明确交易信号: BUY/SELL/HOLD (CONVICTION/HIGH/MEDIUM/LOW)');
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