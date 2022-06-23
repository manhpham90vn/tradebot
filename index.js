const ccxt = require('ccxt')
const moment = require('moment')
const delay = require('delay')
const dotenv = require('dotenv')
const telegramBot = require('node-telegram-bot-api');

// config env
dotenv.config()

// config bot
const bot = new telegramBot(process.env.TELEGRAM, { polling: true });

// constant
const TIME = {
    oneMinute: '1m',
    oneHour: '1h',
    fourHour: '4h'
}

const COUNT_DATA = {
    oneMinute: 1 * 60, // 1 hour
    oneHour: 1 * 24, // 1 day
    fourHour: 1 * 6 * 3 // 3 day
}

const MARGINTYPE = {
    cross: 'CROSSED',
    isolated: 'ISOLATED'
}

const SIDE = {
    BUY: 'buy',
    SELL: 'sell'
}

const POSITION_SIDE = {
    LONG: 'LONG',
    SHORT: 'SHORT'
}

const LOG = {
    DEBUG: 'debug',
    INFO: 'info'
}

const COMMAND = {
    START: 'start',
    END: 'end',
    LOG: 'log'
}

// TODO: change with telegram bot
// global constant
var PROFIT_TARGET = 1
var STOP_LOSS_TARGET = -1
var messageId = null
var messageToSend = ''
var SYMBOL = 'GMT/USDT'
var ENABLE_TRADE = true
var LEVERAGE = 15 // lever in 1x to 125x
var DELAY = 3000 // 3s
var logLevel = LOG.DEBUG

// global variable
var totalUSDT = null
var market = null
var result1M = null
var result1H = null
var result4H = null
var positions = null
var countTakeProfit = 0
var countStoploss = 0
// api key
const binanceExchange = new ccxt.binanceusdm({
    apiKey: process.env.APIKEY,
    secret: process.env.SECRET,
    options: {
        'defaultType': 'future'
    },
    rateLimit: true
});

async function getInfo() {
    // load markets and settings for trade
    const markets = await binanceExchange.loadMarkets()

    // select ${SYMBOL}
    const _market = await binanceExchange.market(SYMBOL)
    market = _market

    try {
        const setLeverage = await binanceExchange.fapiPrivatePostLeverage({
            'symbol': market.id,
            'leverage': LEVERAGE,
        })
    } catch (error) {
        if (logLevel != LOG.DEBUG) {
            return
        }
        if (error instanceof ccxt.NetworkError) {
            log(`[SETUP] setLeverage failed due to a network error: ${error.message}`)
        } else if (error instanceof ccxt.ExchangeError) {
            log(`[SETUP] setLeverage failed due to exchange error: ${error.message}`)
        } else {
            log(`[SETUP] setLeverage failed with: ${error.message}`)
        }
    }

    // set hedged mode
    try {
        const setHedgedMode = await binanceExchange.setPositionMode({
            'hedged': true,
            symbol: SYMBOL
        })
    } catch (error) {
        if (logLevel != LOG.DEBUG) {
            return
        }
        if (error instanceof ccxt.NetworkError) {
            log(`[SETUP] setHedgedMode failed due to a network error: ${error.message}`)
        } else if (error instanceof ccxt.ExchangeError) {
            log(`[SETUP] setHedgedMode failed due to exchange error: ${error.message}`)
        } else {
            log(`[SETUP] setHedgedMode failed with: ${error.message}`)
        }
    }

    // set marginType
    try {
        const setMarginType = await binanceExchange.fapiPrivatePostMarginType({
            'symbol': market.id,
            'marginType': MARGINTYPE.isolated
        })
    } catch (error) {
        if (logLevel != LOG.DEBUG) {
            return
        }
        if (error instanceof ccxt.NetworkError) {
            log(`[SETUP] setMarginType failed due to a network error: ${error.message}`)
        } else if (error instanceof ccxt.ExchangeError) {
            log(`[SETUP] setMarginType failed due to exchange error: ${error.message}`)
        } else {
            log(`[SETUP] setMarginType failed with: ${error.message}`)
        }
    }

    // get total usdt
    const balance = await binanceExchange.fetchBalance();
    totalUSDT = balance.total.USDT
    if (logLevel == LOG.DEBUG) {
        log(`\n`)
        log(`[INFO] Date: ${Date()}`)
        log(`[INFO] USDT: ${totalUSDT}`)
        log(`[INFO] Count TakeProfit : ${countTakeProfit} - Count Stoploss: ${countStoploss}`)
    }

    // analytics
    if (logLevel == LOG.DEBUG) {
        log(`\n`)
    }
    const _result1M = await analytics(SYMBOL, TIME.oneMinute, COUNT_DATA.oneMinute)
    result1M = _result1M
    const _result1H = await analytics(SYMBOL, TIME.oneHour, COUNT_DATA.oneHour)
    result1H = _result1H
    const _result4H = await analytics(SYMBOL, TIME.fourHour, COUNT_DATA.fourHour)
    result4H = _result4H

    // check to create order and close position if needed
    const _positions = balance.info.positions
    positions = _positions
    const hadPosition = await handleAllPosition()
    const positionSideOrder = createPositionSide()

    // create open order if needed
    if (!hadPosition && positionSideOrder != null) {
        const side = positionSideOrder == POSITION_SIDE.LONG ? SIDE.BUY : SIDE.SELL
        const amount = parseInt(0.90 * totalUSDT * LEVERAGE)
        if (logLevel == LOG.DEBUG) {
            log(`\n`)
        }
        await order('open', amount, side, positionSideOrder)
    }
}

async function analytics(SYMBOL, time, COUNT) {
    const priceResponse = await binanceExchange.fetchOHLCV(SYMBOL, time, undefined, COUNT)
    const priceObject = priceResponse.map(price => {
        return {
            timestamp: moment(price[0]).format(),
            open: price[1],
            hight: price[2],
            low: price[3],
            close: price[4],
            volume: price[5]
        }
    })
    const hight = Math.max(...priceObject.map(e => e.hight))
    const low = Math.min(...priceObject.map(e => e.low))
    const lastPrice = priceObject[priceResponse.length - 1].close
    const average = (hight + low) / 2
    if (logLevel == LOG.DEBUG) {
        log(`[ANALYTICS] Time: ${time} - Hight: ${hight} - Low: ${low} - Average: ${average} - Current: ${lastPrice}`)
    }
    return { hight: hight, low: low, average: average, lastPrice: lastPrice, data: priceObject }
}

async function order(type, amount, side, position_side) {
    try {
        if (logLevel == LOG.DEBUG) {
            log(`[ORDER] ${type} order with ${SYMBOL} ${amount} ${side} ${position_side}`)
        }
        if (ENABLE_TRADE) {
            const order = await binanceExchange.createOrder(SYMBOL, 'market', side, amount, undefined, { 'positionSide': position_side })
        }
    } catch (error) {
        if (logLevel != LOG.DEBUG) {
            return
        }
        if (error instanceof ccxt.NetworkError) {
            log(`[ORDER] ${type} order failed due to a network error: ${error.message}`)
        } else if (error instanceof ccxt.ExchangeError) {
            log(`[ORDER] ${type} order failed due to exchange error: ${error.message}`)
        } else {
            log(`[ORDER] ${type} order failed with: ${error.message}`)
        }
    }
}

async function handleAllPosition() {
    var hadPosition = false
    for (let i = 0; i < positions.length; i++) {
        const position = positions[i]
        if (position.symbol == market.id && position.initialMargin != 0) {
            const positionSide = position.positionSide
            hadPosition = position.initialMargin > 1
            if (takeProfitOrStoploss(position)) {
                const side = positionSide == POSITION_SIDE.LONG ? SIDE.SELL : SIDE.BUY
                if (logLevel == LOG.DEBUG) {
                    log(`\n`)
                }
                // create close order if needed
                await order('close', Math.abs(position.positionAmt), side, positionSide)
            }
        }
    }
    return hadPosition
}

// logic to long of short
function createPositionSide() {
    const data1M = result1M.data
    const obj1 = data1M[data1M.length - 1]
    const obj2 = data1M[data1M.length - 2]
    const obj3 = data1M[data1M.length - 3]
    const isObj1Augment = obj1.open > obj1.close
    const isObj2Augment = obj2.open > obj2.close
    const isObj3Augment = obj3.open > obj3.close
    if (isObj1Augment == true && isObj2Augment == true && isObj3Augment == true) {
        return POSITION_SIDE.LONG
    } else if (isObj1Augment == false && isObj2Augment == false && isObj3Augment == false) {
        return POSITION_SIDE.SHORT
    } else if (obj1.volume > (obj2.volume + obj3.volume)) {
        if (isObj1Augment == true) {
            return POSITION_SIDE.SHORT
        } else {
            return POSITION_SIDE.LONG
        }
    } else {
        return null
    }
}

// condition to trigger take profit or stop loss action
function takeProfitOrStoploss(position) {
    const takeProfit = position.unrealizedProfit >= PROFIT_TARGET
    const stopLoss = position.unrealizedProfit <= STOP_LOSS_TARGET
    const result = takeProfit || stopLoss
    if (takeProfit) {
        countTakeProfit++
    }
    if (stopLoss) {
        countStoploss++
    }
    if (logLevel == LOG.DEBUG) {
        log(`\n`)
        log(`[POSITION] Symbol: ${position.symbol} - InitialMargin: ${position.initialMargin} - EntryPrice: ${position.entryPrice} - Position Side: ${position.positionSide} - Isolated: ${position.isolated} - Leverage: ${position.leverage}X`)
        log(`\n`)
        log(`[POSITION] Symbol: ${position.symbol} - Profit: ${position.unrealizedProfit} - TakeProfit: ${takeProfit} - Profit Target: ${PROFIT_TARGET} - Stoploss: ${stopLoss} - Stoploss Target: ${STOP_LOSS_TARGET}`)
    } else if (logLevel == LOG.INFO) {
        if (result) {
            log(`\n`)
            log(`[INFO] Date: ${Date()}`)
            log(`[INFO] USDT: ${totalUSDT}`)
            log(`[INFO] Count TakeProfit : ${countTakeProfit} - Count Stoploss: ${countStoploss}`)
            log(`\n`)
            log(`[POSITION] Symbol: ${position.symbol} - InitialMargin: ${position.initialMargin} - EntryPrice: ${position.entryPrice} - Position Side: ${position.positionSide} - Isolated: ${position.isolated} - Leverage: ${position.leverage}X`)
            log(`\n`)
            log(`[POSITION] Symbol: ${position.symbol} - Profit: ${position.unrealizedProfit} - TakeProfit: ${takeProfit} - Profit Target: ${PROFIT_TARGET} - Stoploss: ${stopLoss} - Stoploss Target: ${STOP_LOSS_TARGET}`)
        }
    }
    return result
}

function log(message) {
    messageToSend += message + '\n'
}

function sendLog() {
    if (messageId == null || messageToSend == '\n' || messageToSend == '') {
        return
    }
    bot.sendMessage(messageId, messageToSend)
}

function clearLog() {
    messageToSend = ''
}

async function main() {
    bot.on('message', (msg) => {
        if (msg.text.toString().toLowerCase().indexOf(COMMAND.START) === 0) {
            messageId = msg.chat.id
        }
        if (msg.text.toString().toLowerCase().indexOf(COMMAND.END) === 0) {
            messageId = null
        }
        if (msg.text.toString().toLowerCase().indexOf(COMMAND.LOG) === 0) {
            logLevel = (logLevel == LOG.INFO) ? LOG.DEBUG : LOG.INFO
        }
    })
    while (true) {
        clearLog()
        await getInfo()
        await delay(DELAY)
        sendLog()
    }
}

main()