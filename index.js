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

// TODO: change with telegram bot
var PROFIT_TARGET = 1
var STOP_LOSS_TARGET = -1
var messageId = null
var messageToSend = ''
var SYMBOL = 'GMT/USDT'
var ENABLE_TRADE = true
var LEVERAGE = 10 // lever in 1x to 125x
var DELAY = 3000 // 3s
var logLevel = LOG.DEBUG

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
    const market = await binanceExchange.market(SYMBOL)

    // set leverage
    const setLeverage = await binanceExchange.fapiPrivatePostLeverage({
        'symbol': market.id,
        'leverage': LEVERAGE,
    })

    // set hedged mode
    try {
        const setHedgedMode = await binanceExchange.setPositionMode({
            'hedged': true,
            symbol: SYMBOL
        })
    } catch (error) {
        if (error instanceof ccxt.NetworkError) {
            if (logLevel == LOG.DEBUG) {
                log(`[SETUP] setHedgedMode failed due to a network error: ${error.message}`)
            }
        } else if (error instanceof ccxt.ExchangeError) {
            if (logLevel == LOG.DEBUG) {
                log(`[SETUP] setHedgedMode failed due to exchange error: ${error.message}`)
            }
        } else {
            if (logLevel == LOG.DEBUG) {
                log(`[SETUP] setHedgedMode failed with: ${error.message}`)
            }
        }
    }

    // set marginType
    try {
        const setMarginType = await binanceExchange.fapiPrivatePostMarginType({
            'symbol': market.id,
            'marginType': MARGINTYPE.isolated
        })
    } catch (error) {
        if (error instanceof ccxt.NetworkError) {
            if (logLevel == LOG.DEBUG) {
                log(`[SETUP] setMarginType failed due to a network error: ${error.message}`)
            }
        } else if (error instanceof ccxt.ExchangeError) {
            if (logLevel == LOG.DEBUG) {
                log(`[SETUP] setMarginType failed due to exchange error: ${error.message}`)
            }
        } else {
            if (logLevel == LOG.DEBUG) {
                log(`[SETUP] setMarginType failed with: ${error.message}`) 
            }
        }
    }

    // get total usdt
    const balance = await binanceExchange.fetchBalance();
    const totalUSDT = balance.total.USDT
    if (logLevel == LOG.DEBUG) {
        log(`\n`)
        log(`[INFO] Date: ${Date()}`)
        log(`[INFO] USDT: ${totalUSDT}`)     
    }

    // analytics
    if (logLevel == LOG.DEBUG) {
        log(`\n`)
    }
    const result1M = await analytics(SYMBOL, TIME.oneMinute, COUNT_DATA.oneMinute)
    const result1H = await analytics(SYMBOL, TIME.oneHour, COUNT_DATA.oneHour)
    const result4H = await analytics(SYMBOL, TIME.fourHour, COUNT_DATA.fourHour)

    // check to create order and close position if needed
    let hadPosition = await handleAllPosition(balance.info.positions, market, totalUSDT)
    const positionSideOrder = createPositionSide(result1M.data, result1H.data, result4H.data)

    // create open order if needed
    if (!hadPosition && positionSideOrder != null) {
        const side = positionSideOrder == POSITION_SIDE.LONG ? SIDE.BUY : SIDE.SELL
        const amount = parseInt(0.95 * totalUSDT * LEVERAGE)
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
    return { hight: hight, low: low, average: average, lastPrice: lastPrice, data: priceObject}
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
        if (error instanceof ccxt.NetworkError) {
            if (logLevel == LOG.DEBUG) {
                log(`[ORDER] ${type} order failed due to a network error: ${error.message}`)
            }
        } else if (error instanceof ccxt.ExchangeError) {
            if (logLevel == LOG.DEBUG) {
                log(`[ORDER] ${type} order failed due to exchange error: ${error.message}`)
            }
        } else {
            if (logLevel == LOG.DEBUG) {
                log(`[ORDER] ${type} order failed with: ${error.message}`)
            }
        }
    }
}

async function handleAllPosition(positions, market, totalUSDT) {
    var hadPosition = false
    for (let i = 0; i < positions.length; i++) {
        const position = positions[i]
        if (position.symbol == market.id && position.initialMargin != 0) {
            let positionSide = position.positionSide
            hadPosition = position.initialMargin > 1
            if (takeProfitOrStoploss(position, totalUSDT)) {
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
function createPositionSide(result1M, result1H, result4H) {
    let obj1 = result1M[result1M.length - 1]
    let obj2 = result1M[result1M.length - 2]
    let obj3 = result1M[result1M.length - 3]
    let isObj1Augment = obj1.open > obj1.close
    let isObj2Augment = obj2.open > obj2.close
    let isObj3Augment = obj3.open > obj3.close
    if (isObj1Augment == true && isObj2Augment == true && isObj3Augment == true) {
        return POSITION_SIDE.SHORT
    } else if (isObj1Augment == false && isObj2Augment == false && isObj3Augment == false) {
        return POSITION_SIDE.LONG
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
function takeProfitOrStoploss(position, totalUSDT) {
    let takeProfit = position.unrealizedProfit >= PROFIT_TARGET
    let stopLoss = position.unrealizedProfit <= STOP_LOSS_TARGET
    let result = takeProfit || stopLoss
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
        let startCommand = 'start'
        let endCommand = 'end'
        let toggleLogCommand = 'log'
        if (msg.text.toString().toLowerCase().indexOf(startCommand) === 0) {
            messageId = msg.chat.id
        }
        if (msg.text.toString().toLowerCase().indexOf(endCommand) === 0) {
            messageId = null
        }
        if (msg.text.toString().toLowerCase().indexOf(toggleLogCommand) === 0) {
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