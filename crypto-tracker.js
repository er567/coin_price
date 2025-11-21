/**
 * @Author: zgc zgc7788@gmail.com
 * @Date: 2025-11-06 09:39:12
 * @LastEditors: zgc zgc7788@gmail.com
 * @LastEditTime: 2025-11-06 10:09:55
 * @FilePath: \test\crypto-tracker.js
 * @Description: 加密货币价格监控与波动提醒工具 - 多币种版本
 */

const axios = require('axios');

// 可配置参数 - 在这里修改监控的币种和相关设置
const CONFIG = {
  COINS: [
    { symbol: 'BEATUSDT', name: 'BEAT' },
    { symbol: 'TNSRUSDT', name: 'TNSR' },
  ],                    // 监控的币种列表
  REST_BASE_URL: 'https://fapi.binance.com',
  CHECK_INTERVAL: 20000,          // 单个币种监控间隔（毫秒）
  PRICE_CHANGE_THRESHOLD: 0.02,   // 价格变化阈值（百分比）
  PUSH_API_KEY: 'HNfKcdiSRkB2MUpWS6CNCj', // BARK app 推送链接
  PUSH_API_URL: 'https://api.day.app',
  MAX_FAILED_ATTEMPTS: 5,
  COIN_FETCH_DELAY: 5000          // 币种间获取延迟（毫秒）
};

class MultiCryptoPriceMonitor {
  constructor(config = CONFIG) {
    this.config = config;
    this.coinData = new Map(); // 存储每个币种的数据
    this.monitoringInterval = null;
    this.currentCoinIndex = 0; // 当前监控的币种索引
    
    // 初始化币种数据
    this.config.COINS.forEach(coin => {
      this.coinData.set(coin.symbol, {
        name: coin.name,
        lastPrice: null,
        currentPrice: null,
        priceHistory: [],
        failedAttempts: 0,
        lastCheckTime: null
      });
    });
    
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
    console.log(`监控间隔: ${this.config.CHECK_INTERVAL / 1000}秒/币种, 价格变动阈值: ${this.config.PRICE_CHANGE_THRESHOLD * 100}%`);
    console.log(`币种间获取延迟: ${this.config.COIN_FETCH_DELAY / 1000}秒`);
  }

  /**
   * 获取指定币种的最新价格
   */
  async getLatestPrice(symbol, name) {
    const coinInfo = this.coinData.get(symbol);
    
    try {
      console.log(`[${this.getCurrentTime()}] 正在获取${name}(${symbol})最新价格...`);
      const response = await this.axios.get(`${this.config.REST_BASE_URL}/fapi/v1/ticker/price`, {
        params: { symbol }
      });
      
      if (response.data && response.data.price) {
        const price = parseFloat(response.data.price);
        coinInfo.currentPrice = price;
        coinInfo.failedAttempts = 0; // 重置失败计数
        coinInfo.lastCheckTime = new Date().getTime();
        console.log(`[${this.getCurrentTime()}] ${name}价格: ${price} USDT`);
        return price;
      }
      throw new Error('未找到价格数据');
    } catch (error) {
      coinInfo.failedAttempts++;
      console.error(`[${this.getCurrentTime()}] 获取${name}(${symbol})价格失败(${coinInfo.failedAttempts}/${this.config.MAX_FAILED_ATTEMPTS}):`, error.message);
      
      // 连续失败次数过多时发送警告
      if (coinInfo.failedAttempts >= this.config.MAX_FAILED_ATTEMPTS) {
        await this.sendPushNotification(
          `${name}价格监控警告`, 
          `连续${this.config.MAX_FAILED_ATTEMPTS}次获取${name}价格失败，请检查连接`
        );
        console.log(`[${this.getCurrentTime()}] 已发送${name}连接失败警告`);
      }
      
      throw error;
    }
  }

  /**
   * 检查指定币种的价格变化
   */
  checkPriceChange(symbol, name) {
    const coinInfo = this.coinData.get(symbol);
    
    if (coinInfo.lastPrice && coinInfo.currentPrice) {
      const priceChange = coinInfo.currentPrice - coinInfo.lastPrice;
      const priceChangePercent = Math.abs(priceChange / coinInfo.lastPrice);
      
      // 记录价格历史
      coinInfo.priceHistory.push({
        price: coinInfo.currentPrice,
        timestamp: new Date().getTime()
      });
      
      // 只保留最近24小时的记录
      this.cleanupOldHistory(symbol);
      
      console.log(`[${this.getCurrentTime()}] ${name}价格变化: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(5)} USDT (${(priceChangePercent * 100).toFixed(2)}%)`);
      
      // 价格变化超过阈值时发送通知
      if (priceChangePercent >= this.config.PRICE_CHANGE_THRESHOLD) {
        const direction = priceChange > 0 ? '上涨' : '下跌';
        const currentTime = this.getCurrentTime();
        const message = `[${currentTime}]
${name}价格${direction}${(priceChangePercent * 100).toFixed(2)}%，当前价格${coinInfo.currentPrice} USDT，上次价格${coinInfo.lastPrice} USDT`;
        this.sendPushNotification(
          `${name}价格${direction}波动提醒`, 
          message
        );
        console.log(`[${this.getCurrentTime()}] ${name}价格波动超过阈值，已发送通知`);
      }
    }
    
    // 更新最后价格
    coinInfo.lastPrice = coinInfo.currentPrice;
  }

  /**
   * 清理指定币种的旧价格历史数据
   */
  cleanupOldHistory(symbol) {
    const coinInfo = this.coinData.get(symbol);
    const oneDayAgo = new Date().getTime() - (24 * 60 * 60 * 1000);
    coinInfo.priceHistory = coinInfo.priceHistory.filter(record => record.timestamp > oneDayAgo);
  }

  /**
   * 发送推送通知
   */
  async sendPushNotification(title, content) {
    try {
      // 对URL进行编码
      const encodedTitle = encodeURIComponent(title);
      const encodedContent = encodeURIComponent(content);
      const url = `${this.config.PUSH_API_URL}/${this.config.PUSH_API_KEY}/${encodedTitle}/${encodedContent}`;
      
      await this.axios.get(url);
      console.log(`[${this.getCurrentTime()}] 推送通知发送成功`);
    } catch (error) {
      console.error(`[${this.getCurrentTime()}] 推送通知发送失败:`, error.message);
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
   * 监控单个币种
   */
  async monitorSingleCoin() {
    const currentCoin = this.getCurrentCoin();
    if (!currentCoin) return;

    try {
      await this.getLatestPrice(currentCoin.symbol, currentCoin.name);
      this.checkPriceChange(currentCoin.symbol, currentCoin.name);
    } catch (error) {
      console.error(`[${this.getCurrentTime()}] ${currentCoin.name}价格检查过程中发生错误:`, error.message);
    }
    
    // 移动到下一个币种
    this.moveToNextCoin();
  }

  /**
   * 开始监控所有币种价格
   */
  async startMonitoring() {
    console.log(`[${this.getCurrentTime()}] 开始监控${this.config.COINS.length}个币种价格...`);
    
    // 立即获取所有币种的初始价格
    console.log(`[${this.getCurrentTime()}] 正在获取初始价格...`);
    const initialPrices = [];
    
    for (const coin of this.config.COINS) {
      try {
        const price = await this.getLatestPrice(coin.symbol, coin.name);
        initialPrices.push(`${coin.name}: ${price} USDT`);
        
        // 币种间延迟
        if (this.config.COIN_FETCH_DELAY > 0 && coin !== this.config.COINS[this.config.COINS.length - 1]) {
          await new Promise(resolve => setTimeout(resolve, this.config.COIN_FETCH_DELAY));
        }
      } catch (error) {
        initialPrices.push(`${coin.name}: 获取失败`);
        console.error(`[${this.getCurrentTime()}] 获取${coin.name}初始价格失败:`, error.message);
      }
    }
    
    console.log(`[${this.getCurrentTime()}] 所有币种初始价格已获取，准备开始定期监控`);
    
    // 发送启动通知
    await this.sendPushNotification(
      `多币种价格监控已启动`, 
      `监控 ${this.config.COINS.length} 个币种\n初始价格:\n${initialPrices.join('\n')}`
    );
    
    // 设置定期检查 - 每个间隔检查一个币种
    this.monitoringInterval = setInterval(async () => {
      await this.monitorSingleCoin();
    }, this.config.CHECK_INTERVAL);
    
    // 监听进程终止信号
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
      
      // 获取最后价格信息
      const finalPrices = [];
      for (const coin of this.config.COINS) {
        const coinInfo = this.coinData.get(coin.symbol);
        finalPrices.push(`${coin.name}: ${coinInfo.currentPrice || '未知'} USDT`);
      }
      
      // 发送停止通知
      await this.sendPushNotification(
        `多币种价格监控已停止`, 
        `最后监控价格:\n${finalPrices.join('\n')}`
      );
      
      console.log(`[${this.getCurrentTime()}] 价格监控已停止`);
      process.exit(0);
    }
  }

  /**
   * 获取当前时间字符串
   */
  getCurrentTime() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * 获取监控状态统计
   */
  getMonitoringStatus() {
    const status = {
      totalCoins: this.config.COINS.length,
      monitoredCoins: [],
      failedCoins: []
    };
    
    for (const coin of this.config.COINS) {
      const coinInfo = this.coinData.get(coin.symbol);
      const coinStatus = {
        name: coin.name,
        symbol: coin.symbol,
        currentPrice: coinInfo.currentPrice,
        lastPrice: coinInfo.lastPrice,
        failedAttempts: coinInfo.failedAttempts,
        lastCheckTime: coinInfo.lastCheckTime ? new Date(coinInfo.lastCheckTime).toLocaleString() : '从未检查'
      };
      
      status.monitoredCoins.push(coinStatus);
      
      if (coinInfo.failedAttempts > 0) {
        status.failedCoins.push(coin.name);
      }
    }
    
    return status;
  }
}

// 使用示例
async function main() {
  try {
    // 创建多币种监控实例
    const monitor = new MultiCryptoPriceMonitor();
    
    // 开始监控
    await monitor.startMonitoring();
    
    // 显示运行信息
    console.log('\n多币种价格监控系统已启动!');
    console.log('按 Ctrl+C 停止监控');
    console.log('=======================================');
    
    // 可选：每隔一段时间显示状态统计
    setInterval(() => {
      const status = monitor.getMonitoringStatus();
      console.log('\n=== 监控状态统计 ===');
      console.log(`总币种数: ${status.totalCoins}`);
      console.log(`异常币种: ${status.failedCoins.length > 0 ? status.failedCoins.join(', ') : '无'}`);
      console.log('===================\n');
    }, 60000); // 每分钟显示一次统计
    
  } catch (error) {
    console.error('程序启动失败:', error.message);
  }
}

// 运行主函数
main();

// 导出配置和类，方便其他文件使用
module.exports = {
  MultiCryptoPriceMonitor,
  CONFIG
};